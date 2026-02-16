/**
 * ProjectScanner service - Scans ~/.claude/projects/ directory and lists all projects.
 *
 * Responsibilities:
 * - Read project directories from ~/.claude/projects/
 * - Decode directory names to original paths (with cwd fallback)
 * - List session files for each project
 * - Read task list data from ~/.claude/todos/
 * - Return sorted list of projects by recent activity
 *
 * Delegates to specialized services:
 * - SessionContentFilter: Noise detection and message filtering
 * - WorktreeGrouper: Git repository grouping
 * - SubagentLocator: Subagent file lookup
 * - SessionSearcher: Search functionality
 */

import {
  type PaginatedSessionsResult,
  type Project,
  type RepositoryGroup,
  type SearchSessionsResult,
  type Session,
  type SessionCursor,
  type SessionMetadataLevel,
  type SessionsByIdsOptions,
  type SessionsPaginationOptions,
} from '@main/types';
import {
  analyzeSessionFileMetadata,
  extractCwd,
  extractFirstUserMessagePreview,
} from '@main/utils/jsonl';
import {
  buildSessionPath,
  buildSubagentsPath,
  buildTodoPath,
  extractBaseDir,
  extractProjectName,
  extractSessionId,
  getProjectsBasePath,
  getTodosBasePath,
  isValidEncodedPath,
} from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import * as path from 'path';

import { LocalFileSystemProvider } from '../infrastructure/LocalFileSystemProvider';

import { ProjectPathResolver } from './ProjectPathResolver';
import { SessionContentFilter } from './SessionContentFilter';
import { SessionSearcher } from './SessionSearcher';
import { SubagentLocator } from './SubagentLocator';
import { subprojectRegistry } from './SubprojectRegistry';
import { WorktreeGrouper } from './WorktreeGrouper';

import type { FileSystemProvider, FsDirent } from '../infrastructure/FileSystemProvider';

const logger = createLogger('Discovery:ProjectScanner');

export class ProjectScanner {
  private readonly projectsDir: string;
  private readonly todosDir: string;
  private readonly contentPresenceCache = new Map<
    string,
    { mtimeMs: number; size: number; hasContent: boolean }
  >();
  private readonly sessionMetadataCache = new Map<
    string,
    {
      mtimeMs: number;
      size: number;
      metadata: Awaited<ReturnType<typeof analyzeSessionFileMetadata>>;
    }
  >();
  private readonly sessionPreviewCache = new Map<
    string,
    { mtimeMs: number; size: number; preview: { text: string; timestamp: string } | null }
  >();

  // Delegated services
  private readonly fsProvider: FileSystemProvider;
  private readonly sessionContentFilter: typeof SessionContentFilter;
  private readonly worktreeGrouper: WorktreeGrouper;
  private readonly subagentLocator: SubagentLocator;
  private readonly sessionSearcher: SessionSearcher;
  private readonly projectPathResolver: ProjectPathResolver;

  constructor(projectsDir?: string, todosDir?: string, fsProvider?: FileSystemProvider) {
    this.projectsDir = projectsDir ?? getProjectsBasePath();
    this.todosDir = todosDir ?? getTodosBasePath();
    this.fsProvider = fsProvider ?? new LocalFileSystemProvider();

    // Initialize delegated services
    this.sessionContentFilter = SessionContentFilter;
    this.worktreeGrouper = new WorktreeGrouper(this.projectsDir, this.fsProvider);
    this.subagentLocator = new SubagentLocator(this.projectsDir, this.fsProvider);
    this.sessionSearcher = new SessionSearcher(this.projectsDir, this.fsProvider);
    this.projectPathResolver = new ProjectPathResolver(this.projectsDir, this.fsProvider);
  }

  // ===========================================================================
  // Project Scanning
  // ===========================================================================

  /**
   * Scans the projects directory and returns a list of all projects.
   * @returns Promise resolving to projects sorted by most recent activity
   */
  async scan(): Promise<Project[]> {
    const startedAt = Date.now();
    try {
      if (!(await this.fsProvider.exists(this.projectsDir))) {
        logger.warn(`Projects directory does not exist: ${this.projectsDir}`);
        return [];
      }

      // Clear the subproject registry on full re-scan
      subprojectRegistry.clear();

      const entries = await this.fsProvider.readdir(this.projectsDir);

      // Filter to only directories with valid encoding pattern
      const projectDirs = entries.filter(
        (entry) => entry.isDirectory() && isValidEncodedPath(entry.name)
      );

      // Process each project directory (may return multiple projects per dir)
      const projectArrays = await this.collectFulfilledInBatches(
        projectDirs,
        this.fsProvider.type === 'ssh' ? 8 : 24,
        async (dir) => this.scanProject(dir.name)
      );

      // Flatten and sort by most recent
      const validProjects = projectArrays.flat();
      validProjects.sort((a, b) => (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0));

      if (this.fsProvider.type === 'ssh') {
        logger.debug(
          `SSH scan completed: ${validProjects.length} projects in ${Date.now() - startedAt}ms`
        );
      }

      return validProjects;
    } catch (error) {
      logger.error('Error scanning projects directory:', error);
      return [];
    }
  }

  // ===========================================================================
  // Repository Grouping (Worktree Support)
  // ===========================================================================

  /**
   * Scans projects and groups them by git repository.
   * Projects belonging to the same git repository (main repo + worktrees)
   * are grouped together under a single RepositoryGroup.
   * Non-git projects are represented as single-worktree groups.
   *
   * Sessions are filtered to exclude noise-only sessions, so counts
   * accurately reflect visible sessions in the UI.
   *
   * @returns Promise resolving to RepositoryGroups sorted by most recent activity
   */
  async scanWithWorktreeGrouping(): Promise<RepositoryGroup[]> {
    try {
      // 1. Scan all projects using existing logic
      const projects = await this.scan();

      if (projects.length === 0) {
        return [];
      }

      // 2. Delegate to WorktreeGrouper
      return this.worktreeGrouper.groupByRepository(projects);
    } catch (error) {
      logger.error('Error scanning with worktree grouping:', error);
      return [];
    }
  }

  /**
   * Lists sessions for a specific worktree within a repository group.
   * This is a convenience method that delegates to listSessions since
   * worktree.id is the same as project.id.
   *
   * @param worktreeId - The worktree ID (same as project ID)
   */
  async listWorktreeSessions(worktreeId: string): Promise<Session[]> {
    return this.listSessions(worktreeId);
  }

  // ===========================================================================
  // Project Scanning (continued)
  // ===========================================================================

  /**
   * Scans a single project directory and returns project metadata.
   * If sessions have different cwd values, splits into multiple projects.
   */
  private async scanProject(encodedName: string): Promise<Project[]> {
    try {
      const projectPath = path.join(this.projectsDir, encodedName);
      const entries = await this.fsProvider.readdir(projectPath);

      // Get session files (.jsonl at root level)
      const sessionFiles = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith('.jsonl')
      );

      if (sessionFiles.length === 0) {
        return [];
      }

      // Collect file stats and cwd for each session
      interface SessionInfo {
        sessionId: string;
        filePath: string;
        mtimeMs: number;
        birthtimeMs: number;
        cwd: string | null;
      }

      const shouldSplitByCwd = this.fsProvider.type !== 'ssh';
      const sessionInfos = await this.collectFulfilledInBatches(
        sessionFiles,
        this.fsProvider.type === 'ssh' ? 32 : 128,
        async (file) => {
          const filePath = path.join(projectPath, file.name);
          const { mtimeMs, birthtimeMs } = await this.resolveFileDetails(file, filePath);
          let cwd: string | null = null;

          // Over SSH, avoid reading every file body during project discovery.
          if (shouldSplitByCwd) {
            try {
              cwd = await extractCwd(filePath, this.fsProvider);
            } catch {
              // Ignore unreadable files
            }
          }

          return {
            sessionId: extractSessionId(file.name),
            filePath,
            mtimeMs,
            birthtimeMs,
            cwd,
          } satisfies SessionInfo;
        }
      );

      if (sessionInfos.length === 0) {
        return [];
      }

      // Group sessions by cwd
      const cwdGroups = new Map<string, SessionInfo[]>();
      const baseName = extractProjectName(encodedName);
      const decodedFallback = baseName; // Used when cwd is null

      for (const info of sessionInfos) {
        const key = shouldSplitByCwd ? (info.cwd ?? `__decoded__${decodedFallback}`) : encodedName;
        const group = cwdGroups.get(key) ?? [];
        group.push(info);
        cwdGroups.set(key, group);
      }

      // If only 1 unique cwd, return single project (current behavior)
      if (cwdGroups.size <= 1) {
        const allSessionIds = sessionInfos.map((s) => s.sessionId);
        let mostRecentSession: number | undefined;
        let createdAt = Date.now();
        for (const info of sessionInfos) {
          if (!mostRecentSession || info.mtimeMs > mostRecentSession) {
            mostRecentSession = info.mtimeMs;
          }
          if (info.birthtimeMs < createdAt) {
            createdAt = info.birthtimeMs;
          }
        }

        const sessionPaths = sessionInfos.map((s) => s.filePath);
        const actualPath = await this.projectPathResolver.resolveProjectPath(encodedName, {
          sessionPaths,
        });

        return [
          {
            id: encodedName,
            path: actualPath,
            name: baseName,
            sessions: allSessionIds,
            createdAt: Math.floor(createdAt),
            mostRecentSession: mostRecentSession ? Math.floor(mostRecentSession) : undefined,
          },
        ];
      }

      // Multiple unique cwds: split into subprojects
      const projects: Project[] = [];

      // Find the "root" cwd (shortest path, or the one matching the decoded name)
      const cwdKeys = [...cwdGroups.keys()].filter((k) => !k.startsWith('__decoded__'));
      const rootCwd = cwdKeys.reduce(
        (shortest, cwd) => (cwd.length <= shortest.length ? cwd : shortest),
        cwdKeys[0] ?? ''
      );

      for (const [cwdKey, sessions] of cwdGroups) {
        const isDecodedFallback = cwdKey.startsWith('__decoded__');
        const actualCwd = isDecodedFallback ? null : cwdKey;

        // Register in subproject registry
        const sessionIds = sessions.map((s) => s.sessionId);
        const compositeId = subprojectRegistry.register(
          encodedName,
          actualCwd ?? decodedFallback,
          sessionIds
        );

        // Compute timestamps
        let mostRecentSession: number | undefined;
        let createdAt = Date.now();
        for (const info of sessions) {
          if (!mostRecentSession || info.mtimeMs > mostRecentSession) {
            mostRecentSession = info.mtimeMs;
          }
          if (info.birthtimeMs < createdAt) {
            createdAt = info.birthtimeMs;
          }
        }

        // Build display name
        let displayName: string;
        if (!actualCwd || actualCwd === rootCwd) {
          displayName = baseName;
        } else {
          // Use last segment of cwd for disambiguation
          const lastSegment = path.basename(actualCwd);
          displayName = `${baseName} (${lastSegment})`;
        }

        projects.push({
          id: compositeId,
          path: actualCwd ?? decodedFallback,
          name: displayName,
          sessions: sessionIds,
          createdAt: Math.floor(createdAt),
          mostRecentSession: mostRecentSession ? Math.floor(mostRecentSession) : undefined,
        });
      }

      return projects;
    } catch (error) {
      logger.error(`Error scanning project ${encodedName}:`, error);
      return [];
    }
  }

  /**
   * Gets details for a specific project by ID.
   * Handles composite IDs by scanning the base directory and finding the matching subproject.
   */
  async getProject(projectId: string): Promise<Project | null> {
    const baseDir = extractBaseDir(projectId);
    const projectPath = path.join(this.projectsDir, baseDir);

    if (!(await this.fsProvider.exists(projectPath))) {
      return null;
    }

    // For composite IDs, scan and find the matching subproject
    if (subprojectRegistry.isComposite(projectId)) {
      const projects = await this.scanProject(baseDir);
      return projects.find((p) => p.id === projectId) ?? null;
    }

    const projects = await this.scanProject(baseDir);
    return projects.find((p) => p.id === projectId) ?? projects[0] ?? null;
  }

  // ===========================================================================
  // Session Listing
  // ===========================================================================

  /**
   * Lists all sessions for a given project with metadata.
   * Filters out sessions that contain only noise messages.
   */
  async listSessions(projectId: string): Promise<Session[]> {
    try {
      const baseDir = extractBaseDir(projectId);
      const projectPath = path.join(this.projectsDir, baseDir);
      const sessionFilter = await this.getSessionFilterForProject(projectId);
      const shouldFilterNoise = this.fsProvider.type !== 'ssh';
      const metadataLevel: SessionMetadataLevel = this.fsProvider.type === 'ssh' ? 'light' : 'deep';

      if (!(await this.fsProvider.exists(projectPath))) {
        return [];
      }

      const entries = await this.fsProvider.readdir(projectPath);
      let sessionFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

      // Filter to only sessions belonging to this subproject
      if (sessionFilter) {
        sessionFiles = sessionFiles.filter((f) => sessionFilter.has(extractSessionId(f.name)));
      }

      const sessionPaths = sessionFiles.map((file) => path.join(projectPath, file.name));
      const decodedPath = await this.resolveProjectPathForId(projectId, sessionPaths);

      const sessions = await Promise.all(
        sessionFiles.map(async (file) => {
          const sessionId = extractSessionId(file.name);
          const filePath = path.join(projectPath, file.name);
          const fileDetails = await this.resolveFileDetails(file, filePath);
          const prefetchedMtimeMs = fileDetails.mtimeMs;
          const prefetchedSize = fileDetails.size;
          const prefetchedBirthtimeMs = fileDetails.birthtimeMs;

          if (shouldFilterNoise) {
            // Check if session has non-noise messages (delegated to SessionContentFilter)
            const hasContent = await this.hasDisplayableContent(
              filePath,
              prefetchedMtimeMs,
              prefetchedSize
            );
            if (!hasContent) {
              return null; // Filter out noise-only sessions
            }
          }

          return this.buildSessionForListing(
            metadataLevel,
            projectId,
            sessionId,
            filePath,
            decodedPath,
            prefetchedMtimeMs,
            prefetchedSize,
            prefetchedBirthtimeMs
          );
        })
      );

      // Filter out null results (noise-only sessions)
      const validSessions = sessions.filter((s): s is Session => s !== null);

      // Sort by created date (most recent first)
      validSessions.sort((a, b) => b.createdAt - a.createdAt);

      return validSessions;
    } catch (error) {
      logger.error(`Error listing sessions for project ${projectId}:`, error);
      return [];
    }
  }

  /**
   * Lists sessions for a project with cursor-based pagination.
   * Efficiently fetches only the sessions needed for the current page.
   *
   * @param projectId - The project ID to list sessions for
   * @param cursor - Base64-encoded cursor from previous page (null for first page)
   * @param limit - Number of sessions to return (default 20)
   * @returns Paginated result with sessions, cursor, and metadata
   */
  async listSessionsPaginated(
    projectId: string,
    cursor: string | null,
    limit: number = 20,
    options?: SessionsPaginationOptions
  ): Promise<PaginatedSessionsResult> {
    const startedAt = Date.now();
    try {
      const includeTotalCount = options?.includeTotalCount ?? false;
      const prefilterAll = options?.prefilterAll ?? false;
      const baseDir = extractBaseDir(projectId);
      const projectPath = path.join(this.projectsDir, baseDir);
      const sessionFilter = await this.getSessionFilterForProject(projectId);
      const shouldFilterNoise = this.fsProvider.type !== 'ssh';
      const metadataLevel: SessionMetadataLevel =
        options?.metadataLevel ?? (this.fsProvider.type === 'ssh' ? 'light' : 'deep');

      if (!(await this.fsProvider.exists(projectPath))) {
        return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
      }

      // Step 1: Get all session files with their timestamps (lightweight stat calls)
      const entries = await this.fsProvider.readdir(projectPath);
      let sessionFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

      // Filter to only sessions belonging to this subproject
      if (sessionFilter) {
        sessionFiles = sessionFiles.filter((f) => sessionFilter.has(extractSessionId(f.name)));
      }

      // Get stats for all session files (parallel for SSH performance)
      interface SessionFileInfo {
        name: string;
        sessionId: string;
        timestamp: number;
        filePath: string;
        mtimeMs: number;
        size: number;
        birthtimeMs: number;
      }

      const fileInfos = await this.collectFulfilledInBatches(
        sessionFiles,
        this.fsProvider.type === 'ssh' ? 48 : 200,
        async (file) => {
          const filePath = path.join(projectPath, file.name);
          const fileDetails = await this.resolveFileDetails(file, filePath);
          return {
            name: file.name,
            sessionId: extractSessionId(file.name),
            timestamp: fileDetails.mtimeMs,
            filePath,
            mtimeMs: fileDetails.mtimeMs,
            size: fileDetails.size,
            birthtimeMs: fileDetails.birthtimeMs,
          } satisfies SessionFileInfo;
        }
      );

      // Step 2: Sort by timestamp descending (most recent first)
      fileInfos.sort((a, b) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        // Tie-breaker: sort by sessionId alphabetically
        return a.sessionId.localeCompare(b.sessionId);
      });

      // Step 3: Optionally pre-filter all sessions for accurate total count
      // This is slower but provides exact totalCount.
      let validSessionIds: Set<string> | null = null;
      let totalCount = 0;
      if (prefilterAll && shouldFilterNoise && metadataLevel === 'deep') {
        const contentResults = await Promise.allSettled(
          fileInfos.map(async (fileInfo) => ({
            sessionId: fileInfo.sessionId,
            hasContent: await this.hasDisplayableContent(
              fileInfo.filePath,
              fileInfo.mtimeMs,
              fileInfo.size
            ),
          }))
        );
        validSessionIds = new Set<string>();
        for (const result of contentResults) {
          if (result.status === 'fulfilled' && result.value.hasContent) {
            validSessionIds.add(result.value.sessionId);
          }
        }
        totalCount = validSessionIds.size;
      }

      // Step 4: Apply cursor filter to find starting position
      let startIndex = 0;
      if (cursor) {
        try {
          const decoded = JSON.parse(
            Buffer.from(cursor, 'base64').toString('utf8')
          ) as SessionCursor;
          startIndex = fileInfos.findIndex((info) => {
            // Find the first item that comes AFTER the cursor
            if (info.timestamp < decoded.timestamp) return true;
            if (info.timestamp === decoded.timestamp && info.sessionId > decoded.sessionId)
              return true;
            return false;
          });
          // If cursor not found, start from beginning
          if (startIndex === -1) startIndex = fileInfos.length;
        } catch {
          // Invalid cursor, start from beginning
          startIndex = 0;
        }
      }

      // Step 5: Fetch sessions for this page
      const decodedPath = await this.resolveProjectPathForId(
        projectId,
        fileInfos.map((fileInfo) => fileInfo.filePath)
      );
      const sessions: Session[] = [];
      let scannedCandidates = 0;

      // Fetch page items in parallel batches for SSH performance.
      // Process candidates in chunks, checking content + building metadata concurrently.
      const BATCH_SIZE = limit + 1; // One extra to detect hasMore
      let batchStart = startIndex;

      while (sessions.length < limit + 1 && batchStart < fileInfos.length) {
        // Take a batch of candidates (overshoot to account for filtered-out items)
        const batchEnd = Math.min(batchStart + BATCH_SIZE * 2, fileInfos.length);
        const batch = fileInfos.slice(batchStart, batchEnd);
        scannedCandidates += batch.length;

        // Step 5a: Check content in parallel
        let contentBatch: { fileInfo: SessionFileInfo; hasContent: boolean }[];
        if (validSessionIds) {
          contentBatch = batch.map((fileInfo) => ({
            fileInfo,
            hasContent: validSessionIds.has(fileInfo.sessionId),
          }));
        } else if (!shouldFilterNoise) {
          contentBatch = batch.map((fileInfo) => ({ fileInfo, hasContent: true }));
        } else {
          const contentResults = await Promise.allSettled(
            batch.map(async (fileInfo) => ({
              fileInfo,
              hasContent: await this.hasDisplayableContent(
                fileInfo.filePath,
                fileInfo.mtimeMs,
                fileInfo.size
              ),
            }))
          );
          contentBatch = contentResults
            .filter(
              (
                r
              ): r is PromiseFulfilledResult<{ fileInfo: SessionFileInfo; hasContent: boolean }> =>
                r.status === 'fulfilled'
            )
            .map((r) => r.value);
        }

        // Step 5b: Build metadata in parallel for items with content
        const withContent = contentBatch.filter((c) => c.hasContent);
        const needed = limit + 1 - sessions.length;
        const toBuild = withContent.slice(0, needed);

        const builtSessions = await this.collectFulfilledInBatches(
          toBuild,
          this.fsProvider.type === 'ssh' ? 4 : 16,
          async ({ fileInfo }) =>
            this.buildSessionForListing(
              metadataLevel,
              projectId,
              fileInfo.sessionId,
              fileInfo.filePath,
              decodedPath,
              fileInfo.mtimeMs,
              fileInfo.size,
              fileInfo.birthtimeMs
            )
        );
        sessions.push(...builtSessions);

        batchStart = batchEnd;
      }

      // Step 6: Build next cursor
      let nextCursor: string | null = null;
      const hasMore = sessions.length > limit || startIndex + scannedCandidates < fileInfos.length;

      const pageSessions = hasMore ? sessions.slice(0, limit) : sessions;

      // If total count wasn't precomputed, keep UI-safe lower bound
      if (!includeTotalCount) {
        // Lightweight mode: return a lower-bound count to avoid full scans.
        totalCount = pageSessions.length + (hasMore ? 1 : 0);
      }

      if (pageSessions.length > 0 && hasMore) {
        const lastSession = pageSessions[pageSessions.length - 1];
        const lastFileInfo = fileInfos.find((f) => f.sessionId === lastSession.id);
        if (lastFileInfo) {
          const cursorData: SessionCursor = {
            timestamp: lastFileInfo.timestamp,
            sessionId: lastFileInfo.sessionId,
          };
          nextCursor = Buffer.from(JSON.stringify(cursorData)).toString('base64');
        }
      }

      const result: PaginatedSessionsResult = {
        sessions: pageSessions,
        nextCursor,
        hasMore: nextCursor !== null,
        totalCount,
      };

      if (this.fsProvider.type === 'ssh') {
        logger.debug(
          `SSH listSessionsPaginated(${projectId}) returned ${result.sessions.length} sessions in ${Date.now() - startedAt}ms (hasMore=${result.hasMore})`
        );
      }

      return result;
    } catch (error) {
      logger.error(`Error listing paginated sessions for project ${projectId}:`, error);
      return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
    }
  }

  /**
   * Build session metadata from a session file.
   */
  private async buildSessionMetadata(
    projectId: string,
    sessionId: string,
    filePath: string,
    projectPath: string,
    prefetchedMtimeMs?: number,
    prefetchedSize?: number,
    prefetchedBirthtimeMs?: number
  ): Promise<Session> {
    const hasPrefetchedCoreStats =
      typeof prefetchedMtimeMs === 'number' && typeof prefetchedSize === 'number';
    const needsBirthtimeStat = typeof prefetchedBirthtimeMs !== 'number';
    const stats =
      hasPrefetchedCoreStats && !needsBirthtimeStat ? null : await this.fsProvider.stat(filePath);
    const effectiveMtime = prefetchedMtimeMs ?? stats?.mtimeMs ?? Date.now();
    const effectiveSize = prefetchedSize ?? stats?.size ?? -1;
    const birthtimeMs = prefetchedBirthtimeMs ?? stats?.birthtimeMs ?? effectiveMtime;
    const cachedMetadata = this.sessionMetadataCache.get(filePath);
    const metadata =
      cachedMetadata?.mtimeMs === effectiveMtime && cachedMetadata.size === effectiveSize
        ? cachedMetadata.metadata
        : await analyzeSessionFileMetadata(filePath, this.fsProvider);
    if (cachedMetadata?.mtimeMs !== effectiveMtime || cachedMetadata.size !== effectiveSize) {
      this.sessionMetadataCache.set(filePath, {
        mtimeMs: effectiveMtime,
        size: effectiveSize,
        metadata,
      });
    }

    // Check for subagents and load task list data in parallel
    const [hasSubagents, todoData] = await Promise.all([
      this.subagentLocator.hasSubagents(projectId, sessionId),
      this.loadTodoData(sessionId),
    ]);
    const metadataLevel: SessionMetadataLevel = 'deep';
    const firstMessageTimestampMs = this.parseTimestampMs(metadata.firstUserMessage?.timestamp);
    const createdAt =
      firstMessageTimestampMs !== null && Number.isFinite(firstMessageTimestampMs)
        ? firstMessageTimestampMs
        : birthtimeMs;

    return {
      id: sessionId,
      projectId,
      projectPath,
      todoData,
      createdAt: Math.floor(createdAt),
      firstMessage: metadata.firstUserMessage?.text,
      messageTimestamp: metadata.firstUserMessage?.timestamp,
      hasSubagents,
      messageCount: metadata.messageCount,
      isOngoing: metadata.isOngoing,
      gitBranch: metadata.gitBranch ?? undefined,
      metadataLevel,
      contextConsumption: metadata.contextConsumption,
      compactionCount: metadata.compactionCount,
      phaseBreakdown: metadata.phaseBreakdown,
    };
  }

  /**
   * Build a lightweight session record using filesystem metadata only.
   * Used as SSH fallback when deep parsing fails transiently.
   */
  private async buildLightSessionMetadata(
    projectId: string,
    sessionId: string,
    filePath: string,
    projectPath: string,
    prefetchedMtimeMs?: number,
    prefetchedSize?: number,
    prefetchedBirthtimeMs?: number
  ): Promise<Session> {
    const hasPrefetchedCoreStats =
      typeof prefetchedMtimeMs === 'number' && typeof prefetchedSize === 'number';
    const needsBirthtimeStat = typeof prefetchedBirthtimeMs !== 'number';
    const stats =
      hasPrefetchedCoreStats && !needsBirthtimeStat ? null : await this.fsProvider.stat(filePath);
    const effectiveMtime = prefetchedMtimeMs ?? stats?.mtimeMs ?? Date.now();
    const effectiveSize = prefetchedSize ?? stats?.size ?? -1;
    const birthtimeMs = prefetchedBirthtimeMs ?? stats?.birthtimeMs ?? effectiveMtime;
    const cachedPreview = this.sessionPreviewCache.get(filePath);
    const preview =
      cachedPreview?.mtimeMs === effectiveMtime && cachedPreview.size === effectiveSize
        ? cachedPreview.preview
        : await this.extractLightPreviewWithRetry(filePath);
    if (cachedPreview?.mtimeMs !== effectiveMtime || cachedPreview.size !== effectiveSize) {
      this.sessionPreviewCache.set(filePath, {
        mtimeMs: effectiveMtime,
        size: effectiveSize,
        preview,
      });
    }
    const metadataLevel: SessionMetadataLevel = 'light';
    const previewTimestampMs = this.parseTimestampMs(preview?.timestamp);
    const createdAt =
      previewTimestampMs !== null && Number.isFinite(previewTimestampMs)
        ? previewTimestampMs
        : birthtimeMs;

    return {
      id: sessionId,
      projectId,
      projectPath,
      createdAt: Math.floor(createdAt),
      firstMessage: preview?.text,
      messageTimestamp: preview?.timestamp,
      hasSubagents: false,
      messageCount: 0,
      metadataLevel,
    };
  }

  /**
   * Build session metadata according to requested listing depth.
   * In SSH mode, deep parse failures degrade gracefully to light metadata.
   */
  private async buildSessionForListing(
    metadataLevel: SessionMetadataLevel,
    projectId: string,
    sessionId: string,
    filePath: string,
    projectPath: string,
    prefetchedMtimeMs?: number,
    prefetchedSize?: number,
    prefetchedBirthtimeMs?: number
  ): Promise<Session> {
    if (metadataLevel === 'light') {
      return this.buildLightSessionMetadata(
        projectId,
        sessionId,
        filePath,
        projectPath,
        prefetchedMtimeMs,
        prefetchedSize,
        prefetchedBirthtimeMs
      );
    }

    try {
      return await this.buildSessionMetadata(
        projectId,
        sessionId,
        filePath,
        projectPath,
        prefetchedMtimeMs,
        prefetchedSize,
        prefetchedBirthtimeMs
      );
    } catch (error) {
      // In SSH mode, never drop a visible session row due to transient deep-parse failures.
      if (this.fsProvider.type !== 'ssh') {
        throw error;
      }

      logger.debug(`SSH metadata parse failed for ${sessionId}, using light fallback`, error);
      return this.buildLightSessionMetadata(
        projectId,
        sessionId,
        filePath,
        projectPath,
        prefetchedMtimeMs,
        prefetchedSize,
        prefetchedBirthtimeMs
      );
    }
  }

  /**
   * Gets a single session's metadata.
   */
  async getSession(projectId: string, sessionId: string): Promise<Session | null> {
    const filePath = this.getSessionPath(projectId, sessionId);

    if (!(await this.fsProvider.exists(filePath))) {
      return null;
    }

    const metadataLevel: SessionMetadataLevel = 'deep';
    const decodedPath = await this.resolveProjectPathForId(projectId);
    return this.buildSessionForListing(metadataLevel, projectId, sessionId, filePath, decodedPath);
  }

  /**
   * Gets a single session's metadata with optional depth override.
   */
  async getSessionWithOptions(
    projectId: string,
    sessionId: string,
    options?: SessionsByIdsOptions
  ): Promise<Session | null> {
    const filePath = this.getSessionPath(projectId, sessionId);

    if (!(await this.fsProvider.exists(filePath))) {
      return null;
    }

    const metadataLevel: SessionMetadataLevel =
      options?.metadataLevel ?? (this.fsProvider.type === 'ssh' ? 'light' : 'deep');
    const decodedPath = await this.resolveProjectPathForId(projectId);
    return this.buildSessionForListing(metadataLevel, projectId, sessionId, filePath, decodedPath);
  }

  // ===========================================================================
  // Task List Data
  // ===========================================================================

  /**
   * Loads task list data for a session from ~/.claude/todos/{sessionId}.json
   */
  async loadTodoData(sessionId: string): Promise<unknown> {
    try {
      const todoPath = buildTodoPath(path.dirname(this.projectsDir), sessionId);

      if (!(await this.fsProvider.exists(todoPath))) {
        return undefined;
      }

      const content = await this.fsProvider.readFile(todoPath);
      return JSON.parse(content) as unknown;
    } catch (error) {
      // Log but continue - task list data is non-critical
      logger.debug(`Failed to load task list data for session ${sessionId}:`, error);
      return undefined;
    }
  }

  // ===========================================================================
  // Path Helpers
  // ===========================================================================

  /**
   * Gets the path to the session JSONL file.
   */
  getSessionPath(projectId: string, sessionId: string): string {
    return buildSessionPath(this.projectsDir, projectId, sessionId);
  }

  /**
   * Gets the path to the subagents directory.
   */
  getSubagentsPath(projectId: string, sessionId: string): string {
    return buildSubagentsPath(this.projectsDir, projectId, sessionId);
  }

  /**
   * Lists all session file paths for a project.
   */
  async listSessionFiles(projectId: string): Promise<string[]> {
    try {
      const baseDir = extractBaseDir(projectId);
      const projectPath = path.join(this.projectsDir, baseDir);
      const sessionFilter = await this.getSessionFilterForProject(projectId);

      if (!(await this.fsProvider.exists(projectPath))) {
        return [];
      }

      const entries = await this.fsProvider.readdir(projectPath);

      let files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

      if (sessionFilter) {
        files = files.filter((entry) => sessionFilter.has(extractSessionId(entry.name)));
      }

      return files.map((entry) => path.join(projectPath, entry.name));
    } catch (error) {
      logger.error(`Error listing session files for project ${projectId}:`, error);
      return [];
    }
  }

  /**
   * Returns the session filter set for a project.
   * In local mode, composite IDs are refreshed from disk first so newly created
   * sessions are not hidden by stale registry entries.
   */
  private async getSessionFilterForProject(projectId: string): Promise<Set<string> | null> {
    if (this.fsProvider.type === 'local' && subprojectRegistry.isComposite(projectId)) {
      const baseDir = extractBaseDir(projectId);
      await this.scanProject(baseDir);
    }
    return subprojectRegistry.getSessionFilter(projectId);
  }

  // ===========================================================================
  // Subagent Detection (delegated to SubagentLocator)
  // ===========================================================================

  /**
   * Checks if a session has a subagents directory (async).
   */
  async hasSubagents(projectId: string, sessionId: string): Promise<boolean> {
    return this.subagentLocator.hasSubagents(projectId, sessionId);
  }

  /**
   * Checks if a session has subagent files (session-specific only).
   * Only checks the NEW structure: {projectId}/{sessionId}/subagents/
   * Verifies that at least one subagent file has non-empty content.
   */
  hasSubagentsSync(projectId: string, sessionId: string): boolean {
    return this.subagentLocator.hasSubagentsSync(projectId, sessionId);
  }

  /**
   * Lists all subagent files for a session from both NEW and OLD structures.
   * Returns NEW structure files first, then OLD structure files.
   */
  async listSubagentFiles(projectId: string, sessionId: string): Promise<string[]> {
    return this.subagentLocator.listSubagentFiles(projectId, sessionId);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Gets the base projects directory path.
   */
  getProjectsDir(): string {
    return this.projectsDir;
  }

  /**
   * Gets the base todos directory path.
   */
  getTodosDir(): string {
    return this.todosDir;
  }

  /**
   * Gets the FileSystemProvider instance used by this scanner.
   */
  getFileSystemProvider(): FileSystemProvider {
    return this.fsProvider;
  }

  /**
   * Checks if the projects directory exists.
   */
  async projectsDirExists(): Promise<boolean> {
    return this.fsProvider.exists(this.projectsDir);
  }

  // ===========================================================================
  // Search (delegated to SessionSearcher)
  // ===========================================================================

  /**
   * Searches sessions in a project for a query string.
   * Filters out noise messages and returns matching content.
   *
   * @param projectId - The project ID to search in
   * @param query - Search query string
   * @param maxResults - Maximum number of results to return (default 50)
   */
  async searchSessions(
    projectId: string,
    query: string,
    maxResults: number = 50
  ): Promise<SearchSessionsResult> {
    return this.sessionSearcher.searchSessions(projectId, query, maxResults);
  }

  /**
   * Resolve best-available file timestamps from directory entry metadata or stat fallback.
   */
  private async resolveFileDetails(
    entry: FsDirent | undefined,
    filePath: string
  ): Promise<{ mtimeMs: number; birthtimeMs: number; size: number }> {
    if (
      entry &&
      typeof entry.mtimeMs === 'number' &&
      typeof entry.birthtimeMs === 'number' &&
      typeof entry.size === 'number'
    ) {
      return {
        mtimeMs: entry.mtimeMs,
        birthtimeMs: entry.birthtimeMs,
        size: entry.size,
      };
    }

    const stats = await this.fsProvider.stat(filePath);
    return {
      mtimeMs: stats.mtimeMs,
      birthtimeMs: stats.birthtimeMs,
      size: stats.size,
    };
  }

  private parseTimestampMs(timestamp: string | undefined): number | null {
    if (!timestamp) {
      return null;
    }
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
  }

  /**
   * Runs async mapping in bounded batches and returns only fulfilled results.
   * This prevents overwhelming SFTP servers with unbounded parallel requests.
   */
  private async collectFulfilledInBatches<T, R>(
    items: T[],
    batchSize: number,
    mapper: (item: T) => Promise<R>
  ): Promise<R[]> {
    const safeBatchSize = Math.max(1, batchSize);
    const results: R[] = [];

    for (let i = 0; i < items.length; i += safeBatchSize) {
      const batch = items.slice(i, i + safeBatchSize);
      const settled = await Promise.allSettled(batch.map((item) => mapper(item)));
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }

    return results;
  }

  private async extractLightPreviewWithRetry(
    filePath: string
  ): Promise<{ text: string; timestamp: string } | null> {
    const maxAttempts = this.fsProvider.type === 'ssh' ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await extractFirstUserMessagePreview(filePath, this.fsProvider);
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts && this.isTransientFsError(error)) {
          await this.sleep(50 * attempt);
          continue;
        }
        break;
      }
    }

    if (lastError) {
      logger.debug(`Failed to extract light preview for ${filePath}:`, lastError);
    }
    return null;
  }

  private getErrorCode(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'number') {
        return String(code);
      }
      if (typeof code === 'string') {
        return code;
      }
    }
    return '';
  }

  private isTransientFsError(error: unknown): boolean {
    const code = this.getErrorCode(error);
    return (
      code === '4' ||
      code === 'EAGAIN' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'EPIPE'
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Resolves the project path for a given project ID.
   * For composite IDs, uses the registry's cwd directly.
   * For plain IDs, delegates to ProjectPathResolver.
   */
  private async resolveProjectPathForId(
    projectId: string,
    sessionPaths?: string[]
  ): Promise<string> {
    const registryCwd = subprojectRegistry.getCwd(projectId);
    if (registryCwd) {
      return registryCwd;
    }
    const baseDir = extractBaseDir(projectId);
    return this.projectPathResolver.resolveProjectPath(baseDir, {
      sessionPaths,
    });
  }

  /**
   * Checks whether a session file has non-noise displayable content.
   * Uses mtime+size memoization to avoid expensive re-parsing on repeated requests.
   */
  private async hasDisplayableContent(
    filePath: string,
    mtimeMs?: number,
    size?: number
  ): Promise<boolean> {
    try {
      const hasPrefetched = typeof mtimeMs === 'number' && typeof size === 'number';
      const stats = hasPrefetched ? null : await this.fsProvider.stat(filePath);
      const effectiveMtime = mtimeMs ?? stats?.mtimeMs ?? Date.now();
      const effectiveSize = size ?? stats?.size ?? -1;
      const cached = this.contentPresenceCache.get(filePath);
      if (cached?.mtimeMs === effectiveMtime && cached.size === effectiveSize) {
        return cached.hasContent;
      }

      const hasContent = await this.sessionContentFilter.hasNonNoiseMessages(
        filePath,
        this.fsProvider
      );
      this.contentPresenceCache.set(filePath, {
        mtimeMs: effectiveMtime,
        size: effectiveSize,
        hasContent,
      });
      return hasContent;
    } catch {
      return false;
    }
  }
}
