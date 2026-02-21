/**
 * HTTP route handlers for Session Operations.
 *
 * Routes:
 * - GET /api/projects/:projectId/sessions - List sessions
 * - GET /api/projects/:projectId/sessions-paginated - Paginated sessions
 * - GET /api/projects/:projectId/sessions/:sessionId - Full session detail
 * - GET /api/projects/:projectId/sessions/:sessionId/groups - Conversation groups
 * - GET /api/projects/:projectId/sessions/:sessionId/metrics - Session metrics
 * - GET /api/projects/:projectId/sessions/:sessionId/waterfall - Waterfall data
 */

import { createLogger } from '@shared/utils/logger';

import { coercePageLimit, validateProjectId, validateSessionId } from '../ipc/guards';
import { DataCache } from '../services';
import {
  decodeCombinedCursor,
  isContextExhausted,
  mergeCombinedResults,
} from '../utils/combinedSessionsMerge';

import type { GlobalSessionFileInfo } from '../services/discovery/ProjectScanner';
import type { PaginatedSessionsResult, Session } from '../types';
import type { SessionsByIdsOptions, SessionsPaginationOptions } from '../types';
import type { ContextFetchResult } from '../utils/combinedSessionsMerge';
import type { CombinedWatcherManager } from '../utils/combinedWatcherManager';
import type { HttpServices } from './index';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:sessions');

export function registerSessionRoutes(
  app: FastifyInstance,
  services: HttpServices,
  watcherManager?: CombinedWatcherManager
): void {
  // List sessions
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/sessions',
    async (request) => {
      try {
        const validated = validateProjectId(request.params.projectId);
        if (!validated.valid) {
          logger.error(`GET sessions rejected: ${validated.error ?? 'unknown'}`);
          return [];
        }

        const sessions = await services.projectScanner.listSessions(validated.value!);
        return sessions;
      } catch (error) {
        logger.error(`Error in GET sessions for ${request.params.projectId}:`, error);
        return [];
      }
    }
  );

  // Paginated sessions
  app.get<{
    Params: { projectId: string };
    Querystring: {
      cursor?: string;
      limit?: string;
      includeTotalCount?: string;
      prefilterAll?: string;
      metadataLevel?: 'light' | 'deep';
    };
  }>('/api/projects/:projectId/sessions-paginated', async (request) => {
    try {
      const validated = validateProjectId(request.params.projectId);
      if (!validated.valid) {
        logger.error(`GET sessions-paginated rejected: ${validated.error ?? 'unknown'}`);
        return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
      }

      const cursor = request.query.cursor || null;
      const limit = coercePageLimit(
        request.query.limit ? Number(request.query.limit) : undefined,
        20
      );
      const options: SessionsPaginationOptions = {
        includeTotalCount: request.query.includeTotalCount !== 'false',
        prefilterAll: request.query.prefilterAll !== 'false',
        metadataLevel: request.query.metadataLevel,
      };

      const result = await services.projectScanner.listSessionsPaginated(
        validated.value!,
        cursor,
        limit,
        options
      );
      return result;
    } catch (error) {
      logger.error(`Error in GET sessions-paginated for ${request.params.projectId}:`, error);
      return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
    }
  });

  app.get<{
    Querystring: { cursor?: string; limit?: string };
  }>('/api/sessions/combined', async (request): Promise<PaginatedSessionsResult> => {
    try {
      const safeLimit = coercePageLimit(
        request.query.limit ? Number(request.query.limit) : undefined,
        20
      );
      const perContextLimit = safeLimit + 5;
      const decodedComposite = decodeCombinedCursor(request.query.cursor ?? null);
      const contexts = services.contextRegistry.getAll();
      const cacheLimit = watcherManager?.getCacheTopK() ?? 0;

      const contextResults: ContextFetchResult[] = await Promise.all(
        contexts.map(async (context) => {
          // Skip contexts marked exhausted in the cursor map
          const rawCursor = decodedComposite?.perContext[context.id];
          const persistedTotalCount = decodedComposite?.perContextTotals?.[context.id] ?? 0;
          if (isContextExhausted(rawCursor)) {
            return {
              contextId: context.id,
              previousCursor: rawCursor ?? null,
              sessions: [] as Session[],
              nextCursor: null,
              hasMore: false,
              totalCount: persistedTotalCount,
            };
          }
          // Contexts absent from cursor map (new since cursor was built) start from page 1
          const contextCursor = rawCursor ?? null;
          try {
            let cachedFileInfos: GlobalSessionFileInfo[] | undefined;
            let cacheMayBeTruncated = false;
            if (watcherManager && contextCursor === null && perContextLimit <= cacheLimit) {
              const cached = await watcherManager.getCachedSessionFileInfos(context);
              if (cached && cached.length > 0) {
                cachedFileInfos = cached;
                cacheMayBeTruncated = cached.length === cacheLimit;
              }
            }

            const result = await context.projectScanner.listRecentSessionsGlobal(
              contextCursor,
              perContextLimit,
              'light',
              cachedFileInfos
            );
            let nextCursor = result.nextCursor;
            let hasMore = result.hasMore;

            // Top-K cache can be a prefix of the full corpus. If we hit the cache ceiling,
            // avoid marking this context exhausted until we page once without cache.
            if (
              cacheMayBeTruncated &&
              !hasMore &&
              nextCursor === null &&
              cachedFileInfos &&
              cachedFileInfos.length > 0
            ) {
              const tail = cachedFileInfos[cachedFileInfos.length - 1];
              nextCursor = Buffer.from(
                JSON.stringify({
                  timestamp: tail.mtimeMs,
                  sessionId: tail.sessionId,
                  projectId: tail.projectId,
                })
              ).toString('base64');
              hasMore = true;
            }
            return {
              contextId: context.id,
              previousCursor: contextCursor,
              sessions: result.sessions.map((session) => ({
                ...session,
                contextId: context.id,
                rootName: context.rootName,
                rootType: context.type,
              })),
              nextCursor,
              hasMore,
              totalCount: result.totalCount,
            };
          } catch (error) {
            logger.debug(`Combined HTTP fetch failed for context "${context.id}"`, error);
            return {
              contextId: context.id,
              previousCursor: contextCursor,
              sessions: [] as Session[],
              nextCursor: null,
              hasMore: false,
              totalCount: persistedTotalCount,
              errored: true,
            };
          }
        })
      );

      return mergeCombinedResults(contextResults, safeLimit);
    } catch (error) {
      logger.error('Error in GET /api/sessions/combined:', error);
      return { sessions: [], nextCursor: null, hasMore: false, totalCount: 0 };
    }
  });

  // Fetch sessions by IDs (for pinned sessions beyond paginated page)
  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/sessions-by-ids',
    async (request) => {
      try {
        const validated = validateProjectId(request.params.projectId);
        if (!validated.valid) {
          logger.error(`POST sessions-by-ids rejected: ${validated.error ?? 'unknown'}`);
          return [];
        }

        const { sessionIds } = request.body as { sessionIds?: string[] };
        if (!Array.isArray(sessionIds)) {
          logger.error('POST sessions-by-ids rejected: sessionIds must be an array');
          return [];
        }
        const { metadataLevel } = request.body as SessionsByIdsOptions;

        // Cap at 50 IDs
        const capped = sessionIds.slice(0, 50);

        // Validate each session ID
        const validIds: string[] = [];
        for (const id of capped) {
          const result = validateSessionId(id);
          if (result.valid) {
            validIds.push(result.value!);
          }
        }

        if (validIds.length === 0) {
          return [];
        }

        const fsType = services.projectScanner.getFileSystemProvider().type;
        const effectiveMetadataLevel = metadataLevel ?? (fsType === 'ssh' ? 'light' : 'deep');
        const results = await Promise.all(
          validIds.map((id) =>
            services.projectScanner.getSessionWithOptions(validated.value!, id, {
              metadataLevel: effectiveMetadataLevel,
            })
          )
        );

        return results.filter((s): s is NonNullable<typeof s> => s !== null);
      } catch (error) {
        logger.error(`Error in POST sessions-by-ids for ${request.params.projectId}:`, error);
        return [];
      }
    }
  );

  // Session detail
  app.get<{ Params: { projectId: string; sessionId: string } }>(
    '/api/projects/:projectId/sessions/:sessionId',
    async (request) => {
      try {
        const validatedProject = validateProjectId(request.params.projectId);
        const validatedSession = validateSessionId(request.params.sessionId);
        if (!validatedProject.valid || !validatedSession.valid) {
          logger.error(
            `GET session-detail rejected: ${validatedProject.error ?? validatedSession.error ?? 'unknown'}`
          );
          return null;
        }

        const safeProjectId = validatedProject.value!;
        const safeSessionId = validatedSession.value!;
        const cacheKey = DataCache.buildKey(safeProjectId, safeSessionId);

        // Check cache first
        let sessionDetail = services.dataCache.get(cacheKey);
        if (sessionDetail) {
          return sessionDetail;
        }

        const fsType = services.projectScanner.getFileSystemProvider().type;
        // In SSH mode, avoid an extra deep metadata scan before full parse.
        const session = await services.projectScanner.getSessionWithOptions(
          safeProjectId,
          safeSessionId,
          {
            metadataLevel: fsType === 'ssh' ? 'light' : 'deep',
          }
        );
        if (!session) {
          logger.error(`Session not found: ${safeSessionId}`);
          return null;
        }

        // Parse session messages
        const parsedSession = await services.sessionParser.parseSession(
          safeProjectId,
          safeSessionId
        );

        // Resolve subagents
        const subagents = await services.subagentResolver.resolveSubagents(
          safeProjectId,
          safeSessionId,
          parsedSession.taskCalls,
          parsedSession.messages
        );
        session.hasSubagents = subagents.length > 0;

        // Build session detail with chunks
        sessionDetail = services.chunkBuilder.buildSessionDetail(
          session,
          parsedSession.messages,
          subagents
        );

        // Cache the result
        services.dataCache.set(cacheKey, sessionDetail);

        return sessionDetail;
      } catch (error) {
        logger.error(
          `Error in GET session-detail for ${request.params.projectId}/${request.params.sessionId}:`,
          error
        );
        return null;
      }
    }
  );

  // Conversation groups
  app.get<{ Params: { projectId: string; sessionId: string } }>(
    '/api/projects/:projectId/sessions/:sessionId/groups',
    async (request) => {
      try {
        const validatedProject = validateProjectId(request.params.projectId);
        const validatedSession = validateSessionId(request.params.sessionId);
        if (!validatedProject.valid || !validatedSession.valid) {
          logger.error(
            `GET session-groups rejected: ${validatedProject.error ?? validatedSession.error ?? 'unknown'}`
          );
          return [];
        }

        const safeProjectId = validatedProject.value!;
        const safeSessionId = validatedSession.value!;

        const parsedSession = await services.sessionParser.parseSession(
          safeProjectId,
          safeSessionId
        );

        const subagents = await services.subagentResolver.resolveSubagents(
          safeProjectId,
          safeSessionId,
          parsedSession.taskCalls,
          parsedSession.messages
        );

        const groups = services.chunkBuilder.buildGroups(parsedSession.messages, subagents);
        return groups;
      } catch (error) {
        logger.error(
          `Error in GET session-groups for ${request.params.projectId}/${request.params.sessionId}:`,
          error
        );
        return [];
      }
    }
  );

  // Session metrics
  app.get<{ Params: { projectId: string; sessionId: string } }>(
    '/api/projects/:projectId/sessions/:sessionId/metrics',
    async (request) => {
      try {
        const validatedProject = validateProjectId(request.params.projectId);
        const validatedSession = validateSessionId(request.params.sessionId);
        if (!validatedProject.valid || !validatedSession.valid) {
          return null;
        }

        const safeProjectId = validatedProject.value!;
        const safeSessionId = validatedSession.value!;

        // Try cache first
        const cacheKey = DataCache.buildKey(safeProjectId, safeSessionId);
        const cached = services.dataCache.get(cacheKey);
        if (cached) {
          return cached.metrics;
        }

        const parsedSession = await services.sessionParser.parseSession(
          safeProjectId,
          safeSessionId
        );
        return parsedSession.metrics;
      } catch (error) {
        logger.error(
          `Error in GET session-metrics for ${request.params.projectId}/${request.params.sessionId}:`,
          error
        );
        return null;
      }
    }
  );

  // Waterfall data
  app.get<{ Params: { projectId: string; sessionId: string } }>(
    '/api/projects/:projectId/sessions/:sessionId/waterfall',
    async (request) => {
      try {
        const validatedProject = validateProjectId(request.params.projectId);
        const validatedSession = validateSessionId(request.params.sessionId);
        if (!validatedProject.valid || !validatedSession.valid) {
          return null;
        }

        const safeProjectId = validatedProject.value!;
        const safeSessionId = validatedSession.value!;
        const cacheKey = DataCache.buildKey(safeProjectId, safeSessionId);

        // Try cache first for session detail
        let detail = services.dataCache.get(cacheKey);

        if (!detail) {
          const session = await services.projectScanner.getSession(safeProjectId, safeSessionId);
          if (!session) return null;

          const parsedSession = await services.sessionParser.parseSession(
            safeProjectId,
            safeSessionId
          );
          const subagents = await services.subagentResolver.resolveSubagents(
            safeProjectId,
            safeSessionId,
            parsedSession.taskCalls,
            parsedSession.messages
          );

          detail = services.chunkBuilder.buildSessionDetail(
            session,
            parsedSession.messages,
            subagents
          );
          services.dataCache.set(cacheKey, detail);
        }

        return services.chunkBuilder.buildWaterfallData(detail.chunks, detail.processes);
      } catch (error) {
        logger.error(
          `Error in GET waterfall for ${request.params.projectId}/${request.params.sessionId}:`,
          error
        );
        return null;
      }
    }
  );
}
