/**
 * FileWatcher service - Watches for changes in Claude Code project files.
 *
 * Responsibilities:
 * - Watch ~/.claude/projects/ directory for session changes
 * - Watch ~/.claude/todos/ directory for todo changes
 * - Detect new/modified/deleted files
 * - Emit events to notify renderer process
 * - Invalidate cache entries when files change
 * - Detect errors in changed session files and notify NotificationManager
 */

import { type FileChangeEvent, type ParsedMessage } from '@main/types';
import { parseJsonlFile, parseJsonlLine } from '@main/utils/jsonl';
import { getProjectsBasePath, getTodosBasePath } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import { projectPathResolver } from '../discovery/ProjectPathResolver';
import { type ProjectScanner } from '../discovery/ProjectScanner';
import { errorDetector } from '../error/ErrorDetector';

import { ConfigManager } from './ConfigManager';
import { type DataCache } from './DataCache';
import { LocalFileSystemProvider } from './LocalFileSystemProvider';
import { type NotificationManager } from './NotificationManager';

import type { FileSystemProvider, FsDirent } from './FileSystemProvider';

const logger = createLogger('Service:FileWatcher');

/** Debounce window for file change events */
const DEBOUNCE_MS = 100;
/** Retry delay when watched directories are unavailable or watcher errors occur */
const WATCHER_RETRY_MS = 2000;
/** Interval for periodic catch-up scan to detect missed fs.watch events */
const CATCH_UP_INTERVAL_MS = 30_000;
/** Only catch-up scan files modified within this window */
const CATCH_UP_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

interface AppendedParseResult {
  messages: ParsedMessage[];
  parsedLineCount: number;
  consumedBytes: number;
}

interface ActiveSessionFile {
  projectId: string;
  sessionId: string;
  subagentId?: string;
}

export class FileWatcher extends EventEmitter {
  private projectsWatcher: fs.FSWatcher | null = null;
  private todosWatcher: fs.FSWatcher | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private projectsPath: string;
  private todosPath: string;
  private dataCache: DataCache;
  private fsProvider: FileSystemProvider;
  private notificationManager: NotificationManager | null = null;
  private projectScanner: ProjectScanner | null = null;
  private isWatching: boolean = false;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  /** Track last processed line count per file for incremental error detection */
  private lastProcessedLineCount = new Map<string, number>();
  /** Track last processed file size in bytes for append-only parsing optimization */
  private lastProcessedSize = new Map<string, number>();
  /** Active session files tracked for periodic catch-up scan */
  private activeSessionFiles = new Map<string, ActiveSessionFile>();
  /** Timer for periodic catch-up scan */
  private catchUpTimer: NodeJS.Timeout | null = null;
  /** Timer for SSH polling mode (replaces fs.watch) */
  private pollingTimer: NodeJS.Timeout | null = null;
  /** Polling interval for SSH mode */
  private static readonly SSH_POLL_INTERVAL_MS = 3000;
  /** Guard to prevent overlapping SSH polling runs */
  private pollingInProgress = false;
  /** Indicates whether the first polling baseline snapshot has completed */
  private sshPollPrimed = false;
  /** Track file sizes for SSH polling change detection */
  private polledFileSizes = new Map<string, number>();
  /** Files currently being processed (concurrency guard) */
  private processingInProgress = new Set<string>();
  /** Files that need reprocessing after current processing completes */
  private pendingReprocess = new Set<string>();
  /** Flag to prevent reuse after disposal */
  private disposed = false;

  constructor(
    dataCache: DataCache,
    projectsPath?: string,
    todosPath?: string,
    fsProvider?: FileSystemProvider
  ) {
    super();
    this.projectsPath = projectsPath ?? getProjectsBasePath();
    this.todosPath = todosPath ?? getTodosBasePath();
    this.dataCache = dataCache;
    this.fsProvider = fsProvider ?? new LocalFileSystemProvider();
  }

  /**
   * Sets the NotificationManager for error detection integration.
   * Must be called before start() to enable error notifications.
   */
  setNotificationManager(manager: NotificationManager): void {
    this.notificationManager = manager;
  }

  /**
   * Sets the ProjectScanner for cache invalidation on file changes.
   */
  setProjectScanner(scanner: ProjectScanner): void {
    this.projectScanner = scanner;
  }

  /**
   * Sets the filesystem provider. Used when switching between local and SSH modes.
   */
  setFileSystemProvider(provider: FileSystemProvider): void {
    this.fsProvider = provider;
  }

  // ===========================================================================
  // Watcher Control
  // ===========================================================================

  /**
   * Starts watching the projects and todos directories.
   */
  start(): void {
    if (this.disposed) {
      logger.error('Cannot start disposed FileWatcher');
      return;
    }

    if (this.isWatching) {
      logger.warn('Already watching');
      return;
    }

    this.isWatching = true;
    if (this.fsProvider.type === 'ssh') {
      this.startPollingMode();
    } else {
      this.ensureWatchers();
    }
    this.seedActiveSessionFiles().catch((err) => {
      logger.error('Error seeding active session files:', err);
    });
    this.startCatchUpTimer();
  }

  /**
   * Stops all watchers.
   */
  stop(): void {
    this.isWatching = false;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.projectsWatcher) {
      this.projectsWatcher.close();
      this.projectsWatcher = null;
    }

    if (this.todosWatcher) {
      this.todosWatcher.close();
      this.todosWatcher = null;
    }

    // Clear any pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Clear catch-up timer
    if (this.catchUpTimer) {
      clearInterval(this.catchUpTimer);
      this.catchUpTimer = null;
    }

    // Clear SSH polling timer
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.pollingInProgress = false;
    this.sshPollPrimed = false;
    this.polledFileSizes.clear();

    // Clear error detection tracking
    this.lastProcessedLineCount.clear();
    this.lastProcessedSize.clear();
    this.activeSessionFiles.clear();
    this.processingInProgress.clear();
    this.pendingReprocess.clear();

    logger.info('Stopped watching');
  }

  /**
   * Disposes all resources and prevents reuse.
   * Performs comprehensive cleanup of all timers, watchers, maps, and listeners.
   *
   * After calling dispose(), this FileWatcher cannot be restarted.
   * Use stop() for temporary pausing that can be resumed with start().
   */
  dispose(): void {
    if (this.disposed) {
      logger.warn('FileWatcher already disposed');
      return;
    }

    logger.info('Disposing FileWatcher');

    // 1. Stop watchers and clear timers (uses existing stop() logic)
    this.stop();

    // 2. Clear retry timer (stop() already handles this, but being explicit)
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    // 3. Clear all debounce timers (stop() already handles this)
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // 4. Clear catch-up timer (stop() already handles this)
    if (this.catchUpTimer) {
      clearInterval(this.catchUpTimer);
      this.catchUpTimer = null;
    }

    // 5. Clear polling timer (stop() already handles this)
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }

    // 6. Clear all tracking maps (stop() already handles most of these)
    this.lastProcessedLineCount.clear();
    this.lastProcessedSize.clear();
    this.activeSessionFiles.clear();
    this.polledFileSizes.clear();
    this.processingInProgress.clear();
    this.pendingReprocess.clear();

    // 7. Remove all EventEmitter listeners (MUST be last)
    this.removeAllListeners();

    // 8. Mark as disposed
    this.disposed = true;

    logger.info('FileWatcher disposed');
  }

  /**
   * Starts the projects directory watcher.
   */
  private startProjectsWatcher(): void {
    if (this.projectsWatcher) {
      return;
    }

    try {
      if (!fs.existsSync(this.projectsPath)) {
        logger.warn(`FileWatcher: Projects directory does not exist: ${this.projectsPath}`);
        this.scheduleWatcherRetry();
        return;
      }

      this.projectsWatcher = fs.watch(
        this.projectsPath,
        { recursive: true },
        (eventType, filename) => {
          if (filename) {
            this.handleProjectsChange(eventType, filename);
          }
        }
      );
      this.attachWatcherRecovery(this.projectsWatcher, 'projects');

      logger.info(`FileWatcher: Started watching projects at ${this.projectsPath}`);
    } catch (error) {
      logger.error('Error starting projects watcher:', error);
      this.projectsWatcher = null;
      this.scheduleWatcherRetry();
    }
  }

  /**
   * Starts the todos directory watcher.
   */
  private startTodosWatcher(): void {
    if (this.todosWatcher) {
      return;
    }

    try {
      if (!fs.existsSync(this.todosPath)) {
        // Todos directory may not exist yet - that's OK
        this.scheduleWatcherRetry();
        return;
      }

      this.todosWatcher = fs.watch(this.todosPath, (eventType, filename) => {
        if (filename) {
          this.handleTodosChange(eventType, filename);
        }
      });
      this.attachWatcherRecovery(this.todosWatcher, 'todos');

      logger.info(`FileWatcher: Started watching todos at ${this.todosPath}`);
    } catch (error) {
      logger.error('Error starting todos watcher:', error);
      this.todosWatcher = null;
      this.scheduleWatcherRetry();
    }
  }

  private ensureWatchers(): void {
    if (!this.isWatching || this.fsProvider.type === 'ssh') {
      return;
    }

    this.startProjectsWatcher();
    this.startTodosWatcher();

    if (!this.projectsWatcher || !this.todosWatcher) {
      this.scheduleWatcherRetry();
    }
  }

  private scheduleWatcherRetry(): void {
    if (!this.isWatching || this.retryTimer) {
      return;
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.ensureWatchers();
    }, WATCHER_RETRY_MS);
  }

  private attachWatcherRecovery(watcher: fs.FSWatcher, watcherType: 'projects' | 'todos'): void {
    watcher.on('error', (error) => {
      logger.error(`FileWatcher: ${watcherType} watcher error:`, error);
      if (watcherType === 'projects') {
        this.projectsWatcher = null;
      } else {
        this.todosWatcher = null;
      }
      this.scheduleWatcherRetry();
    });

    watcher.on('close', () => {
      if (!this.isWatching) {
        return;
      }
      if (watcherType === 'projects') {
        this.projectsWatcher = null;
      } else {
        this.todosWatcher = null;
      }
      this.scheduleWatcherRetry();
    });
  }

  // ===========================================================================
  // SSH Polling Mode
  // ===========================================================================

  /**
   * Starts polling mode for SSH connections.
   * Polls the projects directory for file changes instead of using fs.watch().
   */
  private startPollingMode(): void {
    if (this.pollingTimer) return;

    logger.info('FileWatcher: Starting SSH polling mode');
    const runPoll = (): void => {
      if (this.pollingInProgress) {
        return;
      }

      this.pollingInProgress = true;
      this.pollForChanges()
        .catch((err) => {
          logger.error('Error during SSH polling:', err);
        })
        .finally(() => {
          this.pollingInProgress = false;
        });
    };

    // Prime immediately so newly created sessions appear without waiting a full interval.
    runPoll();
    this.pollingTimer = setInterval(runPoll, FileWatcher.SSH_POLL_INTERVAL_MS);
  }

  /**
   * Polls the projects directory for file changes in SSH mode.
   */
  private async pollForChanges(): Promise<void> {
    try {
      const seenFiles = new Set<string>();
      const projectDirs = await this.fsProvider.readdir(this.projectsPath);
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;

        const projectPath = path.join(this.projectsPath, dir.name);
        let entries: FsDirent[];
        try {
          entries = await this.fsProvider.readdir(projectPath);
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

          const fullPath = path.join(projectPath, entry.name);
          seenFiles.add(fullPath);
          try {
            const observedSize =
              typeof entry.size === 'number'
                ? entry.size
                : (await this.fsProvider.stat(fullPath)).size;
            const lastSize = this.polledFileSizes.get(fullPath);
            const relativePath = path.join(dir.name, entry.name);

            if (lastSize === undefined) {
              // First time seeing this file: after baseline, emit add.
              this.polledFileSizes.set(fullPath, observedSize);
              if (this.sshPollPrimed) {
                this.handleProjectsChange('rename', relativePath);
              }
            } else if (observedSize !== lastSize) {
              // File changed
              this.polledFileSizes.set(fullPath, observedSize);
              this.handleProjectsChange('change', relativePath);
            }
          } catch {
            continue;
          }
        }
      }

      // Detect deleted files after baseline is established.
      if (this.sshPollPrimed) {
        const removedFiles: string[] = [];
        for (const trackedPath of this.polledFileSizes.keys()) {
          if (!seenFiles.has(trackedPath)) {
            removedFiles.push(trackedPath);
          }
        }
        for (const removedPath of removedFiles) {
          this.polledFileSizes.delete(removedPath);
          const relativePath = path.relative(this.projectsPath, removedPath);
          if (relativePath && !relativePath.startsWith('..')) {
            this.handleProjectsChange('rename', relativePath);
          }
        }
      } else {
        this.sshPollPrimed = true;
      }
    } catch (err) {
      logger.error('Error polling for changes:', err);
    }
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Handles file change events in the projects directory.
   */
  private handleProjectsChange(eventType: string, filename: string): void {
    try {
      // Ignore non-JSONL files
      if (!filename.endsWith('.jsonl')) {
        return;
      }

      // Debounce rapid changes to the same file
      this.debounce(filename, () => this.processProjectsChange(eventType, filename));
    } catch (error) {
      logger.error('Error handling projects change:', error);
    }
  }

  /**
   * Process a debounced projects change.
   */
  private async processProjectsChange(eventType: string, filename: string): Promise<void> {
    const fullPath = path.isAbsolute(filename)
      ? path.normalize(filename)
      : path.join(this.projectsPath, filename);
    const relativePath = path.relative(this.projectsPath, fullPath);

    // Ignore events outside of the watched projects root.
    if (relativePath.startsWith('..')) {
      return;
    }

    // Normalize separators to support platform/event source differences.
    const parts = relativePath.split(/[\\/]/).filter(Boolean);
    const projectId = parts[0];

    if (!projectId) return;
    const fileExists = await this.fsProvider.exists(fullPath);

    // Determine change type
    let changeType: FileChangeEvent['type'];
    if (eventType === 'rename') {
      changeType = fileExists ? 'add' : 'unlink';
    } else {
      changeType = 'change';
    }

    // Parse session ID and check if it's a subagent
    let sessionId: string | undefined;
    let isSubagent = false;

    // Session file at project root: projectId/sessionId.jsonl
    if (parts.length === 2 && parts[1].endsWith('.jsonl')) {
      sessionId = path.basename(parts[1], '.jsonl');
    }
    // Subagent file: projectId/sessionId/subagents/agent-hash.jsonl
    else if (parts.length === 4 && parts[2] === 'subagents' && parts[3].endsWith('.jsonl')) {
      sessionId = parts[1];
      isSubagent = true;
    }

    if (sessionId) {
      // Invalidate cache
      this.dataCache.invalidateSession(projectId, sessionId);
      this.projectScanner?.invalidateCachesForProject(projectId);
      projectPathResolver.invalidateProject(projectId);
      if (changeType === 'unlink') {
        this.clearErrorTracking(fullPath);
      }

      // Emit event
      const event: FileChangeEvent = {
        type: changeType,
        path: fullPath,
        projectId,
        sessionId,
        isSubagent,
      };

      this.emit('file-change', event);
      logger.info(
        `FileWatcher: ${changeType} ${isSubagent ? 'subagent' : 'session'} - ${relativePath}`
      );

      // Detect errors in changed session files (not deleted files)
      if (changeType !== 'unlink' && this.notificationManager) {
        if (isSubagent) {
          // Only process subagent files if config allows
          const config = ConfigManager.getInstance().getConfig();
          if (config.notifications.includeSubagentErrors) {
            const subagentFilename = path.basename(parts[3], '.jsonl');
            const subagentId = subagentFilename.replace(/^agent-/, '');
            this.activeSessionFiles.set(fullPath, { projectId, sessionId, subagentId });
            this.detectErrorsInSessionFile(projectId, sessionId, fullPath, subagentId).catch(
              (err) => {
                logger.error('Error detecting errors in subagent file:', err);
              }
            );
          }
        } else {
          this.activeSessionFiles.set(fullPath, { projectId, sessionId });
          this.detectErrorsInSessionFile(projectId, sessionId, fullPath).catch((err) => {
            logger.error('Error detecting errors in session file:', err);
          });
        }
      }
    }
  }

  // ===========================================================================
  // Error Detection
  // ===========================================================================

  /**
   * Detects errors in a session file and sends notifications.
   * Uses incremental processing to only check new lines since last check.
   */
  private async detectErrorsInSessionFile(
    projectId: string,
    sessionId: string,
    filePath: string,
    subagentId?: string
  ): Promise<void> {
    if (!this.notificationManager) {
      return;
    }

    // Concurrency guard: if already processing this file, mark for reprocessing
    if (this.processingInProgress.has(filePath)) {
      this.pendingReprocess.add(filePath);
      return;
    }

    this.processingInProgress.add(filePath);
    try {
      // Get the last processed line count for this file
      const lastLineCount = this.lastProcessedLineCount.get(filePath) ?? 0;
      const lastSize = this.lastProcessedSize.get(filePath) ?? 0;
      const fileStats = await this.fsProvider.stat(filePath);
      const currentSize = fileStats.size;

      // Fast path: no size change means no new data
      if (currentSize === lastSize && lastLineCount > 0) {
        return;
      }

      const canUseIncrementalAppend = lastLineCount > 0 && currentSize > lastSize;
      let newMessages: ParsedMessage[] = [];
      let currentLineCount: number;
      let processedSize: number;

      if (canUseIncrementalAppend) {
        const appended = await this.parseAppendedMessages(filePath, lastSize);
        newMessages = appended.messages;
        currentLineCount = lastLineCount + appended.parsedLineCount;
        processedSize = lastSize + appended.consumedBytes;
      } else {
        // Fallback for first-read, truncation, or rewrite scenarios
        const messages = await parseJsonlFile(filePath);
        currentLineCount = messages.length;
        newMessages = messages.slice(lastLineCount);
        // Re-stat after full parse to capture bytes written during the parse
        const postParseStats = await this.fsProvider.stat(filePath);
        processedSize = postParseStats.size;
      }

      // If no new lines, skip processing
      if (currentLineCount <= lastLineCount) {
        this.lastProcessedSize.set(filePath, processedSize);
        return;
      }

      // Detect errors in new messages
      // Note: We pass the offset-adjusted line numbers to errorDetector
      const errors = await errorDetector.detectErrors(newMessages, sessionId, projectId, filePath);

      // Adjust line numbers to account for the offset and annotate subagent errors
      for (const error of errors) {
        if (error.lineNumber !== undefined) {
          error.lineNumber = error.lineNumber + lastLineCount;
        }
        if (subagentId) {
          error.subagentId = subagentId;
        }
      }

      // Notify for each detected error
      for (const error of errors) {
        await this.notificationManager.addError(error);
      }

      // Update the last processed line count
      this.lastProcessedLineCount.set(filePath, currentLineCount);
      this.lastProcessedSize.set(filePath, processedSize);

      if (errors.length > 0) {
        logger.info(`FileWatcher: Detected ${errors.length} errors in ${filePath}`);
      }
    } catch (err) {
      logger.error(`FileWatcher: Error processing session file for errors: ${filePath}`, err);
    } finally {
      this.processingInProgress.delete(filePath);

      // If a reprocess was requested while we were processing, run again
      if (this.pendingReprocess.has(filePath)) {
        this.pendingReprocess.delete(filePath);
        this.detectErrorsInSessionFile(projectId, sessionId, filePath, subagentId).catch((e) => {
          logger.error('Error during reprocessing of session file:', e);
        });
      }
    }
  }

  /**
   * Clears the error detection tracking for a specific file.
   * Call this when a file is deleted or to force re-processing.
   */
  clearErrorTracking(filePath: string): void {
    this.lastProcessedLineCount.delete(filePath);
    this.lastProcessedSize.delete(filePath);
    this.activeSessionFiles.delete(filePath);
  }

  /**
   * Clears all error detection tracking.
   */
  clearAllErrorTracking(): void {
    this.lastProcessedLineCount.clear();
    this.lastProcessedSize.clear();
    this.activeSessionFiles.clear();
  }

  /**
   * Parse only newly appended JSONL lines from the given byte offset.
   */
  private async parseAppendedMessages(
    filePath: string,
    startOffset: number
  ): Promise<AppendedParseResult> {
    const parsedMessages: ParsedMessage[] = [];
    const stream = this.fsProvider.createReadStream(filePath, {
      start: startOffset,
      encoding: 'utf8',
    });

    let buffer = '';
    let consumedBytes = 0;
    let parsedLineCount = 0;
    for await (const chunk of stream) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        consumedBytes += Buffer.byteLength(`${rawLine}\n`, 'utf8');
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line.trim()) {
          continue;
        }
        try {
          const parsed = parseJsonlLine(line);
          if (parsed) {
            parsedMessages.push(parsed);
            parsedLineCount++;
          }
        } catch {
          // Ignore malformed appended lines; full parse path will recover on next rewrite.
        }
      }
    }

    // Handle final line without trailing newline
    if (buffer.trim()) {
      try {
        const parsed = parseJsonlLine(buffer);
        if (parsed) {
          parsedMessages.push(parsed);
          parsedLineCount++;
          consumedBytes += Buffer.byteLength(buffer, 'utf8');
        }
      } catch {
        // Keep offset pinned until this trailing partial becomes a complete line.
      }
    }

    return {
      messages: parsedMessages,
      parsedLineCount,
      consumedBytes,
    };
  }

  /**
   * Handles file change events in the todos directory.
   */
  private handleTodosChange(eventType: string, filename: string): void {
    try {
      // Only handle JSON files
      if (!filename.endsWith('.json')) {
        return;
      }

      // Debounce rapid changes
      this.debounce(`todos/${filename}`, () => this.processTodosChange(eventType, filename));
    } catch (error) {
      logger.error('Error handling todos change:', error);
    }
  }

  /**
   * Process a debounced todos change.
   */
  private async processTodosChange(eventType: string, filename: string): Promise<void> {
    // Session ID is the filename without extension
    const sessionId = path.basename(filename, '.json');
    const fullPath = path.join(this.todosPath, filename);
    const fileExists = await this.fsProvider.exists(fullPath);

    // Determine change type
    let changeType: FileChangeEvent['type'];
    if (eventType === 'rename') {
      changeType = fileExists ? 'add' : 'unlink';
    } else {
      changeType = 'change';
    }

    // Emit event (we don't have projectId for todos)
    const event: FileChangeEvent = {
      type: changeType,
      path: fullPath,
      sessionId,
      isSubagent: false,
    };

    this.emit('todo-change', event);
    logger.info(`FileWatcher: ${changeType} todo - ${filename}`);
  }

  // ===========================================================================
  // Active Session Seeding
  // ===========================================================================

  /**
   * Seeds activeSessionFiles with recently modified .jsonl files so the
   * catch-up scan can detect growth in sessions that were already active
   * before the FileWatcher started.
   */
  private async seedActiveSessionFiles(): Promise<void> {
    const now = Date.now();
    try {
      if (!(await this.fsProvider.exists(this.projectsPath))) {
        return;
      }

      const projectDirs = await this.fsProvider.readdir(this.projectsPath);
      for (const dir of projectDirs) {
        if (!dir.isDirectory()) continue;

        const projectPath = path.join(this.projectsPath, dir.name);
        let entries: FsDirent[];
        try {
          entries = await this.fsProvider.readdir(projectPath);
        } catch {
          continue;
        }

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;

          const fullPath = path.join(projectPath, entry.name);
          try {
            const stats = await this.fsProvider.stat(fullPath);
            if (now - stats.mtimeMs <= CATCH_UP_MAX_AGE_MS) {
              const sessionId = path.basename(entry.name, '.jsonl');
              this.activeSessionFiles.set(fullPath, {
                projectId: dir.name,
                sessionId,
              });
            }
          } catch {
            continue;
          }
        }
      }

      if (this.activeSessionFiles.size > 0) {
        logger.info(
          `FileWatcher: Seeded ${this.activeSessionFiles.size} active session files`
        );
      }
    } catch (err) {
      logger.error('Error seeding active session files:', err);
    }
  }

  // ===========================================================================
  // Catch-Up Scan
  // ===========================================================================

  /**
   * Starts the periodic catch-up timer to detect file growth missed by fs.watch.
   * FSEvents on macOS can coalesce, delay, or drop events. This timer polls
   * tracked active session files every CATCH_UP_INTERVAL_MS to detect unprocessed growth.
   */
  private startCatchUpTimer(): void {
    if (this.catchUpTimer) {
      return;
    }

    this.catchUpTimer = setInterval(() => {
      this.runCatchUpScan().catch((err) => {
        logger.error('Error during catch-up scan:', err);
      });
    }, CATCH_UP_INTERVAL_MS);
  }

  /**
   * Scans active session files for unprocessed growth.
   * Only checks files modified within the last hour.
   */
  private async runCatchUpScan(): Promise<void> {
    if (!this.notificationManager || this.activeSessionFiles.size === 0) {
      return;
    }

    const now = Date.now();

    for (const [filePath, info] of this.activeSessionFiles) {
      try {
        const stats = await this.fsProvider.stat(filePath);

        // Skip files not modified recently
        if (now - stats.mtimeMs > CATCH_UP_MAX_AGE_MS) {
          this.activeSessionFiles.delete(filePath);
          continue;
        }

        const lastSize = this.lastProcessedSize.get(filePath) ?? 0;
        if (stats.size > lastSize) {
          logger.info(`FileWatcher: Catch-up scan detected growth in ${filePath}`);
          await this.detectErrorsInSessionFile(
            info.projectId,
            info.sessionId,
            filePath,
            info.subagentId
          );
        }
      } catch (err) {
        // File may have been deleted between iterations
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          this.activeSessionFiles.delete(filePath);
          this.clearErrorTracking(filePath);
        } else {
          logger.error(`FileWatcher: Error during catch-up stat for ${filePath}:`, err);
        }
      }
    }
  }

  // ===========================================================================
  // Debouncing
  // ===========================================================================

  /**
   * Debounce a function call for a specific key.
   */
  private debounce(key: string, fn: () => void): void {
    // Clear existing timer for this key
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      fn();
    }, DEBOUNCE_MS);

    this.debounceTimers.set(key, timer);
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  /**
   * Returns whether the watcher is currently active.
   */
  isActive(): boolean {
    return this.isWatching;
  }

  /**
   * Returns watched paths.
   */
  getWatchedPaths(): { projects: string; todos: string } {
    return {
      projects: this.projectsPath,
      todos: this.todosPath,
    };
  }
}
