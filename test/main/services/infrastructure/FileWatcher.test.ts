import { EventEmitter } from 'events';
import type * as FsType from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    watch: vi.fn(),
    // Stash the real existsSync so tests can delegate to it for real file I/O
    __realExistsSync: actual.existsSync,
  };
});

vi.mock('../../../../src/main/services/error/ErrorDetector', () => ({
  errorDetector: {
    detectErrors: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../../../src/main/services/infrastructure/ConfigManager', () => ({
  ConfigManager: {
    getInstance: () => ({
      getConfig: () => ({
        notifications: { includeSubagentErrors: true, triggers: [] },
      }),
    }),
  },
}));

vi.mock('../../../../src/main/services/discovery/ProjectPathResolver', () => ({
  projectPathResolver: {
    invalidateProject: vi.fn(),
  },
}));

import * as fs from 'fs';

import { errorDetector } from '../../../../src/main/services/error/ErrorDetector';
import { DataCache } from '../../../../src/main/services/infrastructure/DataCache';
import { FileWatcher } from '../../../../src/main/services/infrastructure/FileWatcher';

function createFakeWatcher(): FsType.FSWatcher {
  const emitter = new EventEmitter() as EventEmitter & { close: () => void };
  emitter.close = vi.fn(() => {
    emitter.emit('close');
  });
  return emitter as unknown as FsType.FSWatcher;
}

/** Make existsSync delegate to the real implementation (needed for tests with real temp files) */
function useRealExistsSync() {
  const realFn = (fs as unknown as { __realExistsSync: typeof fs.existsSync }).__realExistsSync;
  vi.mocked(fs.existsSync).mockImplementation((p) => realFn(p));
}

function createMockNotificationManager() {
  return {
    addError: vi.fn().mockResolvedValue(null),
  } as unknown as Parameters<FileWatcher['setNotificationManager']>[0];
}

/** Helper to write a valid JSONL line */
function jsonlLine(uuid: string, text: string): string {
  return (
    JSON.stringify({
      type: 'assistant',
      uuid,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
      },
    }) + '\n'
  );
}

describe('FileWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retries and starts watchers when directories appear later', () => {
    const dataCache = new DataCache(50, 10, false);
    let dirsAvailable = false;

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockImplementation((targetPath) => {
      if (targetPath === '/tmp/projects' || targetPath === '/tmp/todos') {
        return dirsAvailable;
      }
      return false;
    });

    const watchMock = vi.mocked(fs.watch);
    watchMock.mockImplementation(() => createFakeWatcher());

    const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');
    watcher.start();

    expect(watchMock).toHaveBeenCalledTimes(0);

    dirsAvailable = true;
    vi.advanceTimersByTime(2000);

    expect(watchMock).toHaveBeenCalledTimes(2);
    watcher.stop();
  });

  it('recovers from watcher errors by re-registering affected watcher', () => {
    const dataCache = new DataCache(50, 10, false);
    const projectWatcher = createFakeWatcher();
    const todoWatcher = createFakeWatcher();
    const replacementProjectWatcher = createFakeWatcher();

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockImplementation((targetPath) => {
      return targetPath === '/tmp/projects' || targetPath === '/tmp/todos';
    });

    const watchMock = vi.mocked(fs.watch);
    watchMock
      .mockImplementationOnce(() => projectWatcher)
      .mockImplementationOnce(() => todoWatcher)
      .mockImplementationOnce(() => replacementProjectWatcher);

    const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');
    watcher.start();
    expect(watchMock).toHaveBeenCalledTimes(2);

    (projectWatcher as unknown as EventEmitter).emit('error', new Error('watch failed'));
    vi.advanceTimersByTime(2000);

    expect(watchMock).toHaveBeenCalledTimes(3);
    watcher.stop();
  });

  it('keeps append offset pinned for partial trailing lines until completed', async () => {
    vi.useRealTimers();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-'));
    const filePath = path.join(tempDir, 'session.jsonl');
    const firstLine = jsonlLine('a1', 'hi');
    fs.writeFileSync(filePath, firstLine, 'utf8');

    const dataCache = new DataCache(50, 10, false);
    const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');

    const firstPass = await (
      watcher as unknown as {
        parseAppendedMessages: (
          targetPath: string,
          startOffset: number
        ) => Promise<{ parsedLineCount: number; consumedBytes: number }>;
      }
    ).parseAppendedMessages(filePath, 0);
    expect(firstPass.parsedLineCount).toBe(1);
    expect(firstPass.consumedBytes).toBe(Buffer.byteLength(firstLine, 'utf8'));

    const partialSuffix =
      '{"type":"assistant","uuid":"a2","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"assistant","content":[{"type":"text","text":"partial"';
    fs.appendFileSync(filePath, partialSuffix, 'utf8');

    const partialPass = await (
      watcher as unknown as {
        parseAppendedMessages: (
          targetPath: string,
          startOffset: number
        ) => Promise<{ parsedLineCount: number; consumedBytes: number }>;
      }
    ).parseAppendedMessages(filePath, firstPass.consumedBytes);
    expect(partialPass.parsedLineCount).toBe(0);
    expect(partialPass.consumedBytes).toBe(0);

    const completion = '}]}}\n';
    fs.appendFileSync(filePath, completion, 'utf8');

    const completedPass = await (
      watcher as unknown as {
        parseAppendedMessages: (
          targetPath: string,
          startOffset: number
        ) => Promise<{ parsedLineCount: number; consumedBytes: number }>;
      }
    ).parseAppendedMessages(filePath, firstPass.consumedBytes);
    expect(completedPass.parsedLineCount).toBe(1);
    expect(completedPass.consumedBytes).toBeGreaterThan(0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // Catch-Up Scan Tests
  // ===========================================================================

  describe('catch-up scan', () => {
    it('detects file growth missed by fs.watch', async () => {
      vi.useRealTimers();
      useRealExistsSync();
      vi.mocked(errorDetector.detectErrors).mockResolvedValue([]);

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-catchup-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'session-1.jsonl');
      const line1 = jsonlLine('u1', 'hello');
      fs.writeFileSync(filePath, line1, 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      // Simulate having previously processed the file by directly setting tracking state
      const watcherAny = watcher as unknown as {
        lastProcessedLineCount: Map<string, number>;
        lastProcessedSize: Map<string, number>;
        activeSessionFiles: Map<string, { projectId: string; sessionId: string }>;
        runCatchUpScan: () => Promise<void>;
      };
      const initialSize = fs.statSync(filePath).size;
      watcherAny.lastProcessedLineCount.set(filePath, 1);
      watcherAny.lastProcessedSize.set(filePath, initialSize);
      watcherAny.activeSessionFiles.set(filePath, {
        projectId: 'test-project',
        sessionId: 'session-1',
      });

      // Append new data WITHOUT triggering fs.watch (simulating a missed event)
      const line2 = jsonlLine('u2', 'world');
      fs.appendFileSync(filePath, line2, 'utf8');

      // Run catch-up scan manually
      await watcherAny.runCatchUpScan();

      // The error detector should have been called with the new message
      expect(errorDetector.detectErrors).toHaveBeenCalled();
      const calls = vi.mocked(errorDetector.detectErrors).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1]).toBe('session-1');
      expect(lastCall[2]).toBe('test-project');

      // Verify tracking state was updated
      expect(watcherAny.lastProcessedLineCount.get(filePath)).toBe(2);
      expect(watcherAny.lastProcessedSize.get(filePath)).toBeGreaterThan(initialSize);

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('skips files with no size change', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-noop-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'session-1.jsonl');
      const line1 = jsonlLine('u1', 'hello');
      fs.writeFileSync(filePath, line1, 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      const watcherAny = watcher as unknown as {
        lastProcessedLineCount: Map<string, number>;
        lastProcessedSize: Map<string, number>;
        activeSessionFiles: Map<string, { projectId: string; sessionId: string }>;
        runCatchUpScan: () => Promise<void>;
      };
      const currentSize = fs.statSync(filePath).size;
      watcherAny.lastProcessedLineCount.set(filePath, 1);
      watcherAny.lastProcessedSize.set(filePath, currentSize);
      watcherAny.activeSessionFiles.set(filePath, {
        projectId: 'test-project',
        sessionId: 'session-1',
      });

      vi.mocked(errorDetector.detectErrors).mockClear();

      // Run catch-up scan without any file changes
      await watcherAny.runCatchUpScan();

      // Error detector should NOT have been called since file hasn't changed
      expect(errorDetector.detectErrors).not.toHaveBeenCalled();

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('removes stale files older than 1 hour from active tracking', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-stale-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'old-session.jsonl');
      fs.writeFileSync(filePath, jsonlLine('u1', 'old'), 'utf8');

      // Set file mtime to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(filePath, twoHoursAgo, twoHoursAgo);

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      const watcherAny = watcher as unknown as {
        activeSessionFiles: Map<string, { projectId: string; sessionId: string }>;
        lastProcessedSize: Map<string, number>;
        runCatchUpScan: () => Promise<void>;
      };
      watcherAny.activeSessionFiles.set(filePath, {
        projectId: 'test-project',
        sessionId: 'old-session',
      });
      watcherAny.lastProcessedSize.set(filePath, 0);

      await watcherAny.runCatchUpScan();

      // Stale file should be removed from active tracking
      expect(watcherAny.activeSessionFiles.has(filePath)).toBe(false);

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('handles deleted files gracefully during catch-up scan', async () => {
      vi.useRealTimers();

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');
      watcher.setNotificationManager(notificationManager);

      const filePath = '/tmp/projects/test-project/nonexistent.jsonl';

      const watcherAny = watcher as unknown as {
        activeSessionFiles: Map<string, { projectId: string; sessionId: string }>;
        lastProcessedSize: Map<string, number>;
        lastProcessedLineCount: Map<string, number>;
        runCatchUpScan: () => Promise<void>;
      };
      watcherAny.activeSessionFiles.set(filePath, {
        projectId: 'test-project',
        sessionId: 'nonexistent',
      });
      watcherAny.lastProcessedSize.set(filePath, 100);
      watcherAny.lastProcessedLineCount.set(filePath, 5);

      // Should not throw
      await watcherAny.runCatchUpScan();

      // Deleted file should be cleaned up
      expect(watcherAny.activeSessionFiles.has(filePath)).toBe(false);
      expect(watcherAny.lastProcessedSize.has(filePath)).toBe(false);
      expect(watcherAny.lastProcessedLineCount.has(filePath)).toBe(false);

      watcher.stop();
    });
  });

  // ===========================================================================
  // Concurrency Guard Tests
  // ===========================================================================

  describe('concurrency guard', () => {
    it('prevents concurrent processing of the same file', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-concurrent-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'session-1.jsonl');
      fs.writeFileSync(filePath, jsonlLine('u1', 'hello'), 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      // Make detectErrors slow to simulate long processing
      let detectResolve: () => void;
      const detectPromise = new Promise<void>((resolve) => {
        detectResolve = resolve;
      });
      vi.mocked(errorDetector.detectErrors).mockImplementation(
        () =>
          new Promise((resolve) => {
            detectPromise.then(() => resolve([]));
          })
      );

      const watcherAny = watcher as unknown as {
        detectErrorsInSessionFile: (
          projectId: string,
          sessionId: string,
          filePath: string
        ) => Promise<void>;
        processingInProgress: Set<string>;
        pendingReprocess: Set<string>;
      };

      // Start first call (will block on detectErrors)
      const first = watcherAny.detectErrorsInSessionFile('test-project', 'session-1', filePath);

      // Wait a tick so the first call enters the processing block and reaches detectErrors
      await new Promise((r) => setTimeout(r, 50));

      // Verify the file is marked as processing
      expect(watcherAny.processingInProgress.has(filePath)).toBe(true);

      // Second call should be deferred (returns immediately)
      const second = watcherAny.detectErrorsInSessionFile('test-project', 'session-1', filePath);
      await second;

      // Verify pending reprocess was set
      expect(watcherAny.pendingReprocess.has(filePath)).toBe(true);

      // Resolve the slow detectErrors
      detectResolve!();
      await first;

      // After first completes, pending reprocess triggers a re-run
      // Wait for the re-run to complete
      await new Promise((r) => setTimeout(r, 100));

      // pendingReprocess should be cleared after reprocessing
      expect(watcherAny.pendingReprocess.has(filePath)).toBe(false);
      expect(watcherAny.processingInProgress.has(filePath)).toBe(false);

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  // ===========================================================================
  // Fallback Size Tracking Tests
  // ===========================================================================

  describe('lastProcessedSize in fallback path', () => {
    it('re-stats file after full parse to capture concurrent writes', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-size-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const filePath = path.join(projectDir, 'session-1.jsonl');
      const line1 = jsonlLine('u1', 'hello');
      fs.writeFileSync(filePath, line1, 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      vi.mocked(errorDetector.detectErrors).mockResolvedValue([]);

      const watcherAny = watcher as unknown as {
        detectErrorsInSessionFile: (
          projectId: string,
          sessionId: string,
          filePath: string
        ) => Promise<void>;
        lastProcessedSize: Map<string, number>;
        lastProcessedLineCount: Map<string, number>;
      };

      // First call - fallback path (no lastProcessedLineCount)
      await watcherAny.detectErrorsInSessionFile('test-project', 'session-1', filePath);

      // The lastProcessedSize should match the actual file size on disk
      const actualSize = fs.statSync(filePath).size;
      expect(watcherAny.lastProcessedSize.get(filePath)).toBe(actualSize);
      expect(watcherAny.lastProcessedLineCount.get(filePath)).toBe(1);

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  // ===========================================================================
  // Timer Lifecycle Tests
  // ===========================================================================

  describe('timer lifecycle', () => {
    it('starts catch-up timer on start() and clears on stop()', () => {
      const dataCache = new DataCache(50, 10, false);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.watch).mockImplementation(() => createFakeWatcher());

      const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');

      const watcherAny = watcher as unknown as {
        catchUpTimer: NodeJS.Timeout | null;
      };

      expect(watcherAny.catchUpTimer).toBeNull();

      watcher.start();
      expect(watcherAny.catchUpTimer).not.toBeNull();

      watcher.stop();
      expect(watcherAny.catchUpTimer).toBeNull();
    });

    it('clears all tracking state on stop()', () => {
      const dataCache = new DataCache(50, 10, false);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.watch).mockImplementation(() => createFakeWatcher());

      const watcher = new FileWatcher(dataCache, '/tmp/projects', '/tmp/todos');

      const watcherAny = watcher as unknown as {
        activeSessionFiles: Map<string, unknown>;
        processingInProgress: Set<string>;
        pendingReprocess: Set<string>;
      };

      watcher.start();

      // Add some tracking state
      watcherAny.activeSessionFiles.set('/tmp/file.jsonl', {
        projectId: 'p',
        sessionId: 's',
      });
      watcherAny.processingInProgress.add('/tmp/file.jsonl');
      watcherAny.pendingReprocess.add('/tmp/file.jsonl');

      watcher.stop();

      expect(watcherAny.activeSessionFiles.size).toBe(0);
      expect(watcherAny.processingInProgress.size).toBe(0);
      expect(watcherAny.pendingReprocess.size).toBe(0);
    });
  });

  // ===========================================================================
  // Active Session Seeding & Historical Error Suppression Tests
  // ===========================================================================

  describe('seedActiveSessionFiles and historical error suppression', () => {
    it('baselines active session and subagent files so catch-up scan does not detect false growth', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-seed-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      const sessionDir = path.join(projectDir, 'session-1');
      const subagentsDir = path.join(sessionDir, 'subagents');
      fs.mkdirSync(subagentsDir, { recursive: true });

      const sessionFile = path.join(projectDir, 'session-1.jsonl');
      const subagentFile = path.join(subagentsDir, 'agent-123.jsonl');

      fs.writeFileSync(
        sessionFile,
        jsonlLine('u1', 'session msg 1') + jsonlLine('u2', 'session msg 2'),
        'utf8'
      );
      fs.writeFileSync(subagentFile, jsonlLine('sub1', 'subagent msg 1'), 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      const watcherAny = watcher as unknown as {
        seedActiveSessionFiles: () => Promise<void>;
        runCatchUpScan: () => Promise<void>;
        lastProcessedSize: Map<string, number>;
        lastProcessedLineCount: Map<string, number>;
        activeSessionFiles: Map<string, { projectId: string; sessionId: string; subagentId?: string }>;
      };

      vi.mocked(errorDetector.detectErrors).mockClear();

      // Seed active session files
      await watcherAny.seedActiveSessionFiles();

      // Both session and subagent files should be in activeSessionFiles
      expect(watcherAny.activeSessionFiles.has(sessionFile)).toBe(true);
      expect(watcherAny.activeSessionFiles.has(subagentFile)).toBe(true);

      // Both should have their size and line counts initialized
      expect(watcherAny.lastProcessedSize.get(sessionFile)).toBe(fs.statSync(sessionFile).size);
      expect(watcherAny.lastProcessedLineCount.get(sessionFile)).toBe(2);

      expect(watcherAny.lastProcessedSize.get(subagentFile)).toBe(fs.statSync(subagentFile).size);
      expect(watcherAny.lastProcessedLineCount.get(subagentFile)).toBe(1);

      // Run catch-up scan immediately after seeding
      await watcherAny.runCatchUpScan();

      // No false error detection should have been triggered
      expect(errorDetector.detectErrors).not.toHaveBeenCalled();

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('suppresses historical errors on first observation of unseeded files', async () => {
      vi.useRealTimers();
      useRealExistsSync();

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filewatcher-historical-'));
      const projectsDir = path.join(tempDir, 'projects');
      const projectDir = path.join(projectsDir, 'test-project');
      fs.mkdirSync(projectDir, { recursive: true });

      const sessionFile = path.join(projectDir, 'session-old.jsonl');

      // Create a file with a message timestamp in the past (1 hour ago)
      const pastTime = new Date(Date.now() - 3600 * 1000).toISOString();
      const oldLine =
        JSON.stringify({
          type: 'assistant',
          uuid: 'old-1',
          timestamp: pastTime,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'historical message' }],
          },
        }) + '\n';
      fs.writeFileSync(sessionFile, oldLine, 'utf8');

      const dataCache = new DataCache(50, 10, false);
      const notificationManager = createMockNotificationManager();
      const watcher = new FileWatcher(dataCache, projectsDir, path.join(tempDir, 'todos'));
      watcher.setNotificationManager(notificationManager);

      // Watcher starts NOW
      const watcherStartTime = Date.now();
      watcher.setWatcherStartTime(watcherStartTime);

      vi.mocked(errorDetector.detectErrors).mockClear();

      const watcherAny = watcher as unknown as {
        detectErrorsInSessionFile: (
          projectId: string,
          sessionId: string,
          filePath: string
        ) => Promise<void>;
      };

      // First observation of this unseeded file
      await watcherAny.detectErrorsInSessionFile('test-project', 'session-old', sessionFile);

      // detectErrors should be called with an empty list because the message was historical
      expect(errorDetector.detectErrors).toHaveBeenCalledWith(
        [],
        'session-old',
        'test-project',
        sessionFile
      );

      // Now append a new message with current timestamp
      const newLine =
        JSON.stringify({
          type: 'assistant',
          uuid: 'new-1',
          timestamp: new Date().toISOString(),
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'new message' }],
          },
        }) + '\n';
      fs.appendFileSync(sessionFile, newLine, 'utf8');

      vi.mocked(errorDetector.detectErrors).mockClear();

      // Second observation (incremental append path)
      await watcherAny.detectErrorsInSessionFile('test-project', 'session-old', sessionFile);

      // detectErrors should now be called with only the new message
      expect(errorDetector.detectErrors).toHaveBeenCalled();
      const calls = vi.mocked(errorDetector.detectErrors).mock.calls;
      expect(calls[0][0].length).toBe(1);
      expect(calls[0][0][0].uuid).toBe('new-1');

      watcher.stop();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});
