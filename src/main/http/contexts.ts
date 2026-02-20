import { createLogger } from '@shared/utils/logger';

import { ConfigManager } from '../services';
import { getContextIdForRoot, getRootIdForContextId } from '../utils/contextIds';

import type { ServiceContext, ServiceContextRegistry } from '../services';
import type { ContextInfo } from '@shared/types';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:contexts');

export function registerContextRoutes(
  app: FastifyInstance,
  contextRegistry: ServiceContextRegistry,
  onContextSwitched?: (context: ServiceContext) => void,
  onSetCombinedWatchers?: (enabled: boolean) => void
): void {
  const configManager = ConfigManager.getInstance();

  app.get('/api/contexts', async (): Promise<ContextInfo[]> => {
    try {
      const config = configManager.getConfig();
      const sortedRoots = [...config.roots.items].sort((a, b) => a.order - b.order);
      return sortedRoots.map((root) => {
        const contextId = getContextIdForRoot(root, config.ssh.profiles);
        return {
          id: contextId,
          type: root.type,
          rootId: root.id,
          rootName: root.name,
          connected: contextRegistry.has(contextId),
        };
      });
    } catch (error) {
      logger.error('Error in GET /api/contexts:', error);
      return [];
    }
  });

  app.get('/api/contexts/active', async (): Promise<{ contextId: string }> => {
    try {
      return { contextId: contextRegistry.getActiveContextId() };
    } catch (error) {
      logger.error('Error in GET /api/contexts/active:', error);
      return { contextId: 'local' };
    }
  });

  app.post<{ Body: { contextId: string } }>(
    '/api/contexts/switch',
    async (request, reply): Promise<{ contextId: string } | { error: string }> => {
      try {
        const contextId = request.body?.contextId;
        if (typeof contextId !== 'string' || contextId.trim().length === 0) {
          return reply.status(400).send({ error: 'contextId is required' });
        }

        const { current } = contextRegistry.switch(contextId);
        const config = configManager.getConfig();
        const rootId = getRootIdForContextId(contextId, config.roots.items, config.ssh.profiles);
        if (rootId) {
          configManager.setActiveRoot(rootId);
        }
        onContextSwitched?.(current);
        logger.info(`HTTP context switch: ${current.id}`);
        return { contextId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Error in POST /api/contexts/switch:', message);
        return reply.status(400).send({ error: message });
      }
    }
  );

  app.post<{ Body: { enabled: boolean } }>(
    '/api/contexts/combined-watchers',
    async (request, reply): Promise<{ success: true } | { error: string }> => {
      try {
        if (typeof request.body?.enabled !== 'boolean') {
          return reply.status(400).send({ error: 'enabled must be a boolean' });
        }
        if (!onSetCombinedWatchers) {
          return reply
            .status(400)
            .send({ error: 'Combined watchers are unavailable in this mode' });
        }
        onSetCombinedWatchers(request.body.enabled);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Error in POST /api/contexts/combined-watchers:', message);
        return reply.status(400).send({ error: message });
      }
    }
  );
}
