/**
 * HTTP route handlers for Utility Operations.
 *
 * Routes:
 * - GET /api/version - App version
 * - POST /api/read-claude-md - Read CLAUDE.md files
 * - POST /api/read-directory-claude-md - Read directory CLAUDE.md
 * - POST /api/read-mentioned-file - Read mentioned file
 * - POST /api/open-path - No-op in browser
 * - POST /api/open-external - No-op in browser
 */

import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

import { type ClaudeMdFileInfo, readAgentConfigs, readAllClaudeMdFiles, readDirectoryClaudeMd } from '../services';
import { validateFilePath } from '../utils/pathValidation';
import { countTokens } from '../utils/tokenizer';

import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:utility');

export function registerUtilityRoutes(app: FastifyInstance): void {
  // App version
  app.get('/api/version', async () => {
    try {
      // Read version from package.json (works in both Electron and Node)
      const pkgPath = path.resolve(__dirname, '../../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version: string };
      return pkg.version;
    } catch {
      return '0.0.0';
    }
  });

  // Read CLAUDE.md files
  app.post<{ Body: { projectRoot: string } }>('/api/read-claude-md', async (request) => {
    try {
      const { projectRoot } = request.body;
      const result = await readAllClaudeMdFiles(projectRoot);
      const files: Record<string, ClaudeMdFileInfo> = {};
      result.files.forEach((info, key) => {
        files[key] = info;
      });
      return files;
    } catch (error) {
      logger.error('Error in POST /api/read-claude-md:', error);
      return {};
    }
  });

  // Read directory CLAUDE.md
  app.post<{ Body: { dirPath: string } }>('/api/read-directory-claude-md', async (request) => {
    try {
      const { dirPath } = request.body;
      const info = await readDirectoryClaudeMd(dirPath);
      return info;
    } catch (error) {
      logger.error('Error in POST /api/read-directory-claude-md:', error);
      return {
        path: request.body.dirPath,
        exists: false,
        charCount: 0,
        estimatedTokens: 0,
      };
    }
  });

  // Read mentioned file
  app.post<{ Body: { absolutePath: string; projectRoot: string; maxTokens?: number } }>(
    '/api/read-mentioned-file',
    async (request) => {
      try {
        const { absolutePath, projectRoot, maxTokens = 25000 } = request.body;

        const validation = validateFilePath(absolutePath, projectRoot || null);
        if (!validation.valid) {
          return null;
        }

        const safePath = validation.normalizedPath!;

        if (!fs.existsSync(safePath)) {
          return null;
        }

        const stats = fs.statSync(safePath);
        if (!stats.isFile()) {
          return null;
        }

        const content = fs.readFileSync(safePath, 'utf8');
        const estimatedTokens = countTokens(content);

        if (estimatedTokens > maxTokens) {
          return null;
        }

        return {
          path: safePath,
          exists: true,
          charCount: content.length,
          estimatedTokens,
        };
      } catch (error) {
        logger.error(
          `Error in POST /api/read-mentioned-file for ${request.body.absolutePath}:`,
          error
        );
        return null;
      }
    }
  );

  // Open path - no-op in browser mode
  app.post('/api/open-path', async () => {
    return { success: false, error: 'Not available in browser mode' };
  });

  // Open external - no-op in browser mode
  app.post<{ Body: { url: string } }>('/api/open-external', async () => {
    return { success: false, error: 'Not available in browser mode' };
  });

  // Read agent configs
  app.post<{ Body: { projectRoot: string } }>('/api/read-agent-configs', async (request) => {
    try {
      const { projectRoot } = request.body;
      return await readAgentConfigs(projectRoot);
    } catch (error) {
      logger.error('Error in POST /api/read-agent-configs:', error);
      return {};
    }
  });
}
