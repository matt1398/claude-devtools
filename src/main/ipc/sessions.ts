/**
 * IPC Handlers for Session Operations.
 *
 * Handlers:
 * - get-sessions: List sessions for a project
 * - get-sessions-paginated: List sessions with cursor-based pagination
 * - get-session-detail: Get full session detail with subagents
 * - get-session-groups: Get conversation groups for a session
 * - get-session-metrics: Get metrics for a session
 */

import { createLogger } from '@shared/utils/logger';
import { type IpcMain, type IpcMainInvokeEvent } from 'electron';

import { DataCache } from '../services';
import {
  type ConversationGroup,
  type PaginatedSessionsResult,
  type Session,
  type SessionDetail,
  type SessionMetrics,
  type SessionsByIdsOptions,
  type SessionsPaginationOptions,
} from '../types';
import { sessionParserPool } from '../workers/SessionParserPool';

import { coercePageLimit, validateProjectId, validateSessionId } from './guards';

import type { ServiceContextRegistry } from '../services';
import type { WaterfallData } from '@shared/types';

const logger = createLogger('IPC:sessions');

// Service registry - set via initialize
let registry: ServiceContextRegistry;

// Sessions where native pipeline produced invalid chunks — permanently use JS fallback
const nativeDisabledSessions = new Set<string>();

/**
 * Initializes session handlers with service registry.
 */
export function initializeSessionHandlers(contextRegistry: ServiceContextRegistry): void {
  registry = contextRegistry;
}

/**
 * Registers all session-related IPC handlers.
 */
export function registerSessionHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get-sessions', handleGetSessions);
  ipcMain.handle('get-sessions-paginated', handleGetSessionsPaginated);
  ipcMain.handle('get-sessions-by-ids', handleGetSessionsByIds);
  ipcMain.handle('get-session-detail', handleGetSessionDetail);
  ipcMain.handle('get-session-groups', handleGetSessionGroups);
  ipcMain.handle('get-session-metrics', handleGetSessionMetrics);
  ipcMain.handle('get-waterfall-data', handleGetWaterfallData);

  logger.info('Session handlers registered');
}

/**
 * Removes all session IPC handlers.
 */
export function removeSessionHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('get-sessions');
  ipcMain.removeHandler('get-sessions-paginated');
  ipcMain.removeHandler('get-sessions-by-ids');
  ipcMain.removeHandler('get-session-detail');
  ipcMain.removeHandler('get-session-groups');
  ipcMain.removeHandler('get-session-metrics');
  ipcMain.removeHandler('get-waterfall-data');

  // Release accumulated per-session state
  nativeDisabledSessions.clear();

  logger.info('Session handlers removed');
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handler for 'get-sessions' IPC call.
 * Lists all sessions for a given project.
 */
async function handleGetSessions(
  _event: IpcMainInvokeEvent,
  projectId: string
): Promise<Session[]> {
  try {
    const validatedProject = validateProjectId(projectId);
    if (!validatedProject.valid) {
      logger.error(`get-sessions rejected: ${validatedProject.error ?? 'Invalid projectId'}`);
      return [];
    }

    const { projectScanner } = registry.getActive();
    const sessions = await projectScanner.listSessions(validatedProject.value!);
    return sessions;
  } catch (error) {
    logger.error(`Error in get-sessions for project ${projectId}:`, error);
    return [];
  }
}

/**
 * Handler for 'get-sessions-paginated' IPC call.
 * Lists sessions for a project with cursor-based pagination.
 */
async function handleGetSessionsPaginated(
  _event: IpcMainInvokeEvent,
  projectId: string,
  cursor: string | null,
  limit?: number,
  options?: SessionsPaginationOptions
): Promise<PaginatedSessionsResult> {
  try {
    const validatedProject = validateProjectId(projectId);
    if (!validatedProject.valid) {
      logger.error(
        `get-sessions-paginated rejected: ${validatedProject.error ?? 'Invalid projectId'}`
      );
      return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
    }

    const { projectScanner } = registry.getActive();
    const safeLimit = coercePageLimit(limit, 20);
    const result = await projectScanner.listSessionsPaginated(
      validatedProject.value!,
      cursor,
      safeLimit,
      options
    );
    return result;
  } catch (error) {
    logger.error(`Error in get-sessions-paginated for project ${projectId}:`, error);
    return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
  }
}

/**
 * Handler for 'get-sessions-by-ids' IPC call.
 * Fetches lightweight session metadata for specific session IDs.
 * Used to load pinned sessions that may not be in the paginated list.
 */
async function handleGetSessionsByIds(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionIds: string[],
  options?: SessionsByIdsOptions
): Promise<Session[]> {
  try {
    const validatedProject = validateProjectId(projectId);
    if (!validatedProject.valid) {
      logger.error(
        `get-sessions-by-ids rejected: ${validatedProject.error ?? 'Invalid projectId'}`
      );
      return [];
    }

    if (!Array.isArray(sessionIds)) {
      logger.error('get-sessions-by-ids rejected: sessionIds must be an array');
      return [];
    }

    // Cap at 50 IDs
    const capped = sessionIds.slice(0, 50);

    // Validate each session ID
    const validIds: string[] = [];
    for (const id of capped) {
      const validated = validateSessionId(id);
      if (validated.valid) {
        validIds.push(validated.value!);
      }
    }

    if (validIds.length === 0) {
      return [];
    }

    const { projectScanner } = registry.getActive();
    const fsType = projectScanner.getFileSystemProvider().type;
    const metadataLevel = options?.metadataLevel ?? (fsType === 'ssh' ? 'light' : 'deep');
    const results = await Promise.all(
      validIds.map((id) =>
        projectScanner.getSessionWithOptions(validatedProject.value!, id, { metadataLevel })
      )
    );

    return results.filter((s): s is Session => s !== null);
  } catch (error) {
    logger.error(`Error in get-sessions-by-ids for project ${projectId}:`, error);
    return [];
  }
}

/**
 * Handler for 'get-session-detail' IPC call.
 * Gets full session detail including parsed chunks and subagents.
 * Uses cache to avoid re-parsing large files.
 */
async function handleGetSessionDetail(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<SessionDetail | null> {
  try {
    const validatedProject = validateProjectId(projectId);
    const validatedSession = validateSessionId(sessionId);
    if (!validatedProject.valid || !validatedSession.valid) {
      logger.error(
        `get-session-detail rejected: ${validatedProject.error ?? validatedSession.error ?? 'Invalid parameters'}`
      );
      return null;
    }

    const { projectScanner, sessionParser, subagentResolver, chunkBuilder, dataCache } =
      registry.getActive();

    const safeProjectId = validatedProject.value!;
    const safeSessionId = validatedSession.value!;
    const cacheKey = DataCache.buildKey(safeProjectId, safeSessionId);

    // Check cache first
    let sessionDetail = dataCache.get(cacheKey);
    let usedNative = false;

    if (!sessionDetail) {
      const fsType = projectScanner.getFileSystemProvider().type;
      // In SSH mode, avoid an extra deep metadata scan before full parse.
      const session = await projectScanner.getSessionWithOptions(safeProjectId, safeSessionId, {
        metadataLevel: fsType === 'ssh' ? 'light' : 'deep',
      });
      if (!session) {
        logger.error(`Session not found: ${sessionId}`);
        return null;
      }

      // Try native Rust pipeline (local filesystem only).
      // Rust handles: JSONL read -> classify -> chunk -> tool executions -> semantic steps.
      // Returns serde_json::Value with exact TS field names. JS only converts timestamps.
      // JS still handles: subagent resolution (requires filesystem provider).
      // Use native Rust pipeline for local sessions WITHOUT subagents.
      // Sessions with subagents need ProcessLinker + sidechain context which
      // only the JS pipeline provides (Review finding #1).
      const hasSubagentFiles = await projectScanner.hasSubagents(
        safeProjectId,
        safeSessionId
      );
      if (fsType === 'local' && !hasSubagentFiles && !nativeDisabledSessions.has(cacheKey)) {
        try {
          const { buildSessionChunksNative } = await import('../utils/nativeJsonl');
          const sessionPath = projectScanner.getSessionPath(safeProjectId, safeSessionId);
          const nativeResult = buildSessionChunksNative(sessionPath);
          // Validate ALL chunks — not just the first. If any chunk has wrong
          // shape, fall back to JS pipeline instead of sending bad data to renderer.
          const isValidNative =
            nativeResult &&
            nativeResult.chunks.length > 0 &&
            (nativeResult.chunks as Record<string, unknown>[]).every(
              (c) =>
                c != null &&
                typeof c.chunkType === 'string' &&
                'rawMessages' in c &&
                'startTime' in c &&
                'metrics' in c
            );

          if (isValidNative) {
            sessionDetail = {
              session,
              messages: [],
              chunks: nativeResult.chunks as SessionDetail['chunks'],
              processes: [],
              metrics: nativeResult.metrics as SessionDetail['metrics'],
            };
            usedNative = true;
          } else if (nativeResult) {
            // Native produced chunks but they failed validation — permanently
            // disable native for this session to avoid repeated failures.
            logger.warn(`Native validation failed for ${cacheKey}, disabling native for this session`);
            nativeDisabledSessions.add(cacheKey);
          }
        } catch {
          // Native not available — fall through to JS
        }
      }

      // JS fallback pipeline — dispatch to Worker Thread to avoid blocking main process
      if (!usedNative) {
        try {
          sessionDetail = await sessionParserPool.parse({
            projectsDir: projectScanner.getProjectsDir(),
            sessionPath: projectScanner.getSessionPath(safeProjectId, safeSessionId),
            projectId: safeProjectId,
            sessionId: safeSessionId,
            fsType,
            session,
          });
        } catch (workerError) {
          // Worker failed (timeout, crash, etc.) — fall back to inline blocking parse
          logger.warn('Worker parse failed, falling back to inline:', workerError);
          const parsedSession = await sessionParser.parseSession(safeProjectId, safeSessionId);
          const subagents = await subagentResolver.resolveSubagents(
            safeProjectId,
            safeSessionId,
            parsedSession.taskCalls,
            parsedSession.messages
          );
          session.hasSubagents = subagents.length > 0;
          sessionDetail = chunkBuilder.buildSessionDetail(
            session,
            parsedSession.messages,
            subagents
          );
        }
      }

      // Cache JS pipeline results only — native results skip cache so any
      // rendering failures on the next request will fall back to JS pipeline.
      if (sessionDetail && !usedNative) {
        dataCache.set(cacheKey, sessionDetail);
      }
    }

    if (!sessionDetail) {
      return null;
    }

    // Strip raw messages before IPC transfer — the renderer never uses them.
    // Only chunks (with semantic steps) and process summaries cross the boundary.
    // This cuts IPC serialization + renderer heap by ~50-60%.
    return {
      ...sessionDetail,
      messages: [],
      processes: sessionDetail.processes.map((p) => ({ ...p, messages: [] })),
      // Only report native pipeline when Rust actually handled full chunking.
      _nativePipeline: usedNative ? Date.now() : false,
    };
  } catch (error) {
    logger.error(`Error in get-session-detail for ${projectId}/${sessionId}:`, error);
    return null;
  }
}

/**
 * Handler for 'get-session-groups' IPC call.
 * Gets conversation groups for a session using the new buildGroups API.
 * This is an alternative to chunks that provides a simpler, more natural grouping.
 */
async function handleGetSessionGroups(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<ConversationGroup[]> {
  try {
    const validatedProject = validateProjectId(projectId);
    const validatedSession = validateSessionId(sessionId);
    if (!validatedProject.valid || !validatedSession.valid) {
      logger.error(
        `get-session-groups rejected: ${validatedProject.error ?? validatedSession.error ?? 'Invalid parameters'}`
      );
      return [];
    }
    const { sessionParser, subagentResolver, chunkBuilder } = registry.getActive();
    const safeProjectId = validatedProject.value!;
    const safeSessionId = validatedSession.value!;

    // Parse session messages
    const parsedSession = await sessionParser.parseSession(safeProjectId, safeSessionId);

    // Resolve subagents
    const subagents = await subagentResolver.resolveSubagents(
      safeProjectId,
      safeSessionId,
      parsedSession.taskCalls,
      parsedSession.messages
    );

    // Build conversation groups using the new API
    const groups = chunkBuilder.buildGroups(parsedSession.messages, subagents);

    return groups;
  } catch (error) {
    logger.error(`Error in get-session-groups for ${projectId}/${sessionId}:`, error);
    return [];
  }
}

/**
 * Handler for 'get-session-metrics' IPC call.
 * Gets metrics for a session without full detail.
 */
async function handleGetSessionMetrics(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<SessionMetrics | null> {
  try {
    const validatedProject = validateProjectId(projectId);
    const validatedSession = validateSessionId(sessionId);
    if (!validatedProject.valid || !validatedSession.valid) {
      return null;
    }
    const { sessionParser, dataCache } = registry.getActive();
    const safeProjectId = validatedProject.value!;
    const safeSessionId = validatedSession.value!;

    // Try to get from cache first
    const cacheKey = DataCache.buildKey(safeProjectId, safeSessionId);
    const cached = dataCache.get(cacheKey);

    if (cached) {
      return cached.metrics;
    }

    // Parse session to get metrics
    const parsedSession = await sessionParser.parseSession(safeProjectId, safeSessionId);
    return parsedSession.metrics;
  } catch (error) {
    logger.error(`Error in get-session-metrics for ${projectId}/${sessionId}:`, error);
    return null;
  }
}

/**
 * Handler for 'get-waterfall-data' IPC call.
 * Builds waterfall chart data for a session.
 */
async function handleGetWaterfallData(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<WaterfallData | null> {
  try {
    const detail = await handleGetSessionDetail(_event, projectId, sessionId);
    if (!detail) {
      return null;
    }

    const { chunkBuilder } = registry.getActive();
    return chunkBuilder.buildWaterfallData(detail.chunks, detail.processes);
  } catch (error) {
    logger.error(`Error in get-waterfall-data for ${projectId}/${sessionId}:`, error);
    return null;
  }
}
