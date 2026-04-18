/**
 * HTTP route handlers for Subagent Operations.
 *
 * Routes:
 * - GET /api/projects/:projectId/sessions/:sessionId/subagents/:subagentId
 *     → Subagent detail (drill-down modal payload).
 * - GET /api/projects/:projectId/sessions/:sessionId/subagents/:subagentId/messages
 *     → Lazy-load full message body for inline expansion. Mirrors the IPC
 *       handler so browser mode works the same as Electron mode.
 */

import { createLogger } from '@shared/utils/logger';
import * as path from 'path';

import { validateProjectId, validateSessionId, validateSubagentId } from '../ipc/guards';
import { SubagentMessageCache } from '../services/infrastructure/SubagentMessageCache';
import { buildSubagentsPath } from '../utils/pathDecoder';

import type { HttpServices } from './index';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:subagents');

export function registerSubagentRoutes(app: FastifyInstance, services: HttpServices): void {
  app.get<{ Params: { projectId: string; sessionId: string; subagentId: string } }>(
    '/api/projects/:projectId/sessions/:sessionId/subagents/:subagentId',
    async (request) => {
      try {
        const validatedProject = validateProjectId(request.params.projectId);
        const validatedSession = validateSessionId(request.params.sessionId);
        const validatedSubagent = validateSubagentId(request.params.subagentId);
        if (!validatedProject.valid || !validatedSession.valid || !validatedSubagent.valid) {
          logger.error(
            `GET subagent-detail rejected: ${
              validatedProject.error ??
              validatedSession.error ??
              validatedSubagent.error ??
              'Invalid parameters'
            }`
          );
          return null;
        }

        const safeProjectId = validatedProject.value!;
        const safeSessionId = validatedSession.value!;
        const safeSubagentId = validatedSubagent.value!;

        const cacheKey = `subagent-${safeProjectId}-${safeSessionId}-${safeSubagentId}`;

        // Check cache first
        let subagentDetail = services.dataCache.getSubagent(cacheKey);
        if (subagentDetail) {
          return subagentDetail;
        }

        const fsProvider = services.projectScanner.getFileSystemProvider();
        const projectsDir = services.projectScanner.getProjectsDir();

        const builtDetail = await services.chunkBuilder.buildSubagentDetail(
          safeProjectId,
          safeSessionId,
          safeSubagentId,
          services.sessionParser,
          services.subagentResolver,
          fsProvider,
          projectsDir
        );

        if (!builtDetail) {
          logger.error(`Subagent not found: ${safeSubagentId}`);
          return null;
        }

        subagentDetail = builtDetail;
        services.dataCache.setSubagent(cacheKey, subagentDetail);

        return subagentDetail;
      } catch (error) {
        logger.error(`Error in GET subagent-detail for ${request.params.subagentId}:`, error);
        return null;
      }
    }
  );

  // Lazy-load subagent message bodies (mirrors the IPC handler).
  app.get<{ Params: { projectId: string; sessionId: string; subagentId: string } }>(
    '/api/projects/:projectId/sessions/:sessionId/subagents/:subagentId/messages',
    async (request) => {
      try {
        const validatedProject = validateProjectId(request.params.projectId);
        const validatedSession = validateSessionId(request.params.sessionId);
        const validatedSubagent = validateSubagentId(request.params.subagentId);
        if (!validatedProject.valid || !validatedSession.valid || !validatedSubagent.valid) {
          logger.error(
            `GET subagent-messages rejected: ${
              validatedProject.error ??
              validatedSession.error ??
              validatedSubagent.error ??
              'Invalid parameters'
            }`
          );
          return [];
        }
        const safeProjectId = validatedProject.value!;
        const safeSessionId = validatedSession.value!;
        const safeSubagentId = validatedSubagent.value!;

        const cacheKey = SubagentMessageCache.buildKey(
          safeProjectId,
          safeSessionId,
          safeSubagentId
        );
        const cached = services.subagentMessageCache.get(cacheKey);
        if (cached) {
          return cached;
        }

        // Layout: {projectsDir}/{baseProjectId}/{sessionId}/subagents/agent-X.jsonl
        const projectsDir = services.projectScanner.getProjectsDir();
        const subagentsDir = buildSubagentsPath(projectsDir, safeProjectId, safeSessionId);
        const subagentPath = path.join(subagentsDir, `agent-${safeSubagentId}.jsonl`);

        const parsed = await services.sessionParser.parseSessionFile(subagentPath);
        services.subagentMessageCache.set(cacheKey, parsed.messages);
        return parsed.messages;
      } catch (error) {
        logger.error(`Error in GET subagent-messages for ${request.params.subagentId}:`, error);
        return [];
      }
    }
  );
}
