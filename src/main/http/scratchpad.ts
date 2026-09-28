/**
 * HTTP route handlers for the per-session Scratchpad viewer.
 *
 * Mirrors the read paths of the IPC surface. Opening files in the OS file
 * manager has no meaning for a browser client, so it is not exposed here.
 */

import { scratchpadReader } from '@main/services/discovery/ScratchpadReader';
import { createLogger } from '@shared/utils/logger';

import { validateScratchpadArgs } from '../ipc/guards';

import type { ScratchpadListResult, ScratchpadReadFileResult } from '@shared/types';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:scratchpad');

interface ScratchpadQuery {
  projectId?: string;
  sessionId?: string;
  path?: string;
}

export function registerScratchpadRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: ScratchpadQuery }>(
    '/api/scratchpad/list',
    async (request): Promise<ScratchpadListResult> => {
      const { projectId, sessionId, path } = request.query;
      const args = validateScratchpadArgs(projectId, sessionId, path);
      if (!args.valid) return { success: false, error: args.error };
      try {
        const listing = await scratchpadReader.list(
          args.projectId,
          args.sessionId,
          args.relativePath
        );
        return { success: true, ...listing };
      } catch (error) {
        logger.error('Error in GET /api/scratchpad/list:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  app.get<{ Querystring: ScratchpadQuery }>(
    '/api/scratchpad/file',
    async (request): Promise<ScratchpadReadFileResult> => {
      const { projectId, sessionId, path } = request.query;
      const args = validateScratchpadArgs(projectId, sessionId, path);
      if (!args.valid) return { success: false, error: args.error };
      try {
        const result = await scratchpadReader.readFile(
          args.projectId,
          args.sessionId,
          args.relativePath
        );
        return { success: true, ...result };
      } catch (error) {
        logger.error('Error in GET /api/scratchpad/file:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
