/**
 * HTTP route handlers for SSH Connection Management.
 *
 * Routes:
 * - POST /api/ssh/connect - Connect to SSH host
 * - POST /api/ssh/disconnect - Disconnect SSH
 * - GET /api/ssh/state - Get connection state
 * - POST /api/ssh/test - Test connection
 * - GET /api/ssh/config-hosts - Get SSH config hosts
 * - POST /api/ssh/resolve-host - Resolve host config
 * - POST /api/ssh/save-last-connection - Save last connection
 * - GET /api/ssh/last-connection - Get last connection
 */

import {
  DEFAULT_LOCAL_ROOT_ID,
  getContextIdForRoot,
  getLocalContextId,
  getSshContextId,
} from '@main/utils/contextIds';
import { resolveRemoteWorkspacePaths } from '@main/utils/sshPaths';
import { createLogger } from '@shared/utils/logger';

import { ConfigManager, ServiceContext } from '../services';

import type { ServiceContextRegistry } from '../services';
import type {
  SshConnectionConfig,
  SshConnectionManager,
} from '../services/infrastructure/SshConnectionManager';
import type { SshLastConnection } from '@shared/types';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:ssh');

export function registerSshRoutes(
  app: FastifyInstance,
  connectionManager: SshConnectionManager,
  contextRegistry: ServiceContextRegistry,
  modeSwitchCallback: (mode: 'local' | 'ssh') => Promise<void>,
  onContextSwitched?: (context: ServiceContext) => void
): void {
  const configManager = ConfigManager.getInstance();

  // Connect
  app.post<{ Body: { config: SshConnectionConfig; rootId?: string } }>(
    '/api/ssh/connect',
    async (request) => {
      try {
        const previousActiveContextId = contextRegistry.getActiveContextId();

        await connectionManager.connect(request.body.config);

        const appConfig = configManager.getConfig();
        const targetRoot =
          typeof request.body.rootId === 'string'
            ? appConfig.roots.items.find((root) => root.id === request.body.rootId)
            : null;

        const provider = connectionManager.getProvider();
        const resolvedRemoteRootPath =
          targetRoot?.type === 'ssh' ? targetRoot.remoteClaudeRootPath : null;
        const { remoteProjectsPath, remoteTodosPath } = resolveRemoteWorkspacePaths(
          resolvedRemoteRootPath,
          connectionManager.getRemoteProjectsPath()
        );

        const contextId =
          targetRoot?.type === 'ssh'
            ? getContextIdForRoot(targetRoot, appConfig.ssh.profiles)
            : getSshContextId(request.body.config.host, request.body.rootId ?? 'adhoc-root');

        if (contextRegistry.has(contextId)) {
          logger.info(`Destroying existing SSH context: ${contextId}`);
          contextRegistry.destroy(contextId);
        }

        const sshContext = new ServiceContext({
          id: contextId,
          type: 'ssh',
          rootId: targetRoot?.type === 'ssh' ? targetRoot.id : request.body.rootId ?? 'adhoc-root',
          rootName: targetRoot?.type === 'ssh' ? targetRoot.name : request.body.config.host,
          fsProvider: provider,
          projectsDir: remoteProjectsPath,
          todosDir: remoteTodosPath,
        });

        contextRegistry.registerContext(sshContext);
        contextRegistry.switch(contextId);

        if (targetRoot?.type === 'ssh') {
          configManager.setActiveRoot(targetRoot.id);
        }

        if (
          previousActiveContextId.startsWith('ssh-') &&
          previousActiveContextId !== contextId &&
          contextRegistry.has(previousActiveContextId)
        ) {
          contextRegistry.destroy(previousActiveContextId);
        }

        if (onContextSwitched) {
          onContextSwitched(sshContext);
        } else {
          await modeSwitchCallback('ssh');
        }

        return { success: true, data: connectionManager.getStatus() };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('SSH connect failed:', message);
        return { success: false, error: message };
      }
    }
  );

  // Disconnect
  app.post('/api/ssh/disconnect', async () => {
    try {
      const currentContextId = contextRegistry.getActiveContextId();
      const isSshContext = currentContextId.startsWith('ssh-');

      connectionManager.disconnect();

      if (isSshContext) {
        const appConfig = configManager.getConfig();
        const localRoot =
          appConfig.roots.items.find(
            (root) => root.id === DEFAULT_LOCAL_ROOT_ID && root.type === 'local'
          ) ??
          appConfig.roots.items.find((root) => root.type === 'local');
        const fallbackLocalContextId = localRoot ? getLocalContextId(localRoot.id) : 'local';

        if (contextRegistry.has(fallbackLocalContextId)) {
          contextRegistry.switch(fallbackLocalContextId);
          if (localRoot) {
            configManager.setActiveRoot(localRoot.id);
          }

          const sshContextIds = contextRegistry
            .list()
            .filter((context) => context.type === 'ssh')
            .map((context) => context.id);
          for (const sshContextId of sshContextIds) {
            if (contextRegistry.has(sshContextId)) {
              contextRegistry.destroy(sshContextId);
            }
          }

          if (onContextSwitched) {
            onContextSwitched(contextRegistry.getActive());
          } else {
            await modeSwitchCallback('local');
          }
        } else {
          await modeSwitchCallback('local');
        }
      } else {
        await modeSwitchCallback('local');
      }

      return { success: true, data: connectionManager.getStatus() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('SSH disconnect failed:', message);
      return { success: false, error: message };
    }
  });

  // Get state
  app.get('/api/ssh/state', async () => {
    return connectionManager.getStatus();
  });

  // Test connection
  app.post<{ Body: SshConnectionConfig }>('/api/ssh/test', async (request) => {
    try {
      const result = await connectionManager.testConnection(request.body);
      return { success: true, data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  // Get config hosts
  app.get('/api/ssh/config-hosts', async () => {
    try {
      const hosts = await connectionManager.getConfigHosts();
      return { success: true, data: hosts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get SSH config hosts:', message);
      return { success: true, data: [] };
    }
  });

  // Resolve host
  app.post<{ Body: { alias: string } }>('/api/ssh/resolve-host', async (request) => {
    try {
      const entry = await connectionManager.resolveHostConfig(request.body.alias);
      return { success: true, data: entry };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Failed to resolve SSH host "${request.body.alias}":`, message);
      return { success: true, data: null };
    }
  });

  // Save last connection
  app.post<{ Body: SshLastConnection }>('/api/ssh/save-last-connection', async (request) => {
    try {
      const config = request.body;
      configManager.updateConfig('ssh', {
        lastConnection: {
          host: config.host,
          port: config.port,
          username: config.username,
          authMethod: config.authMethod,
          privateKeyPath: config.privateKeyPath,
        },
      });
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to save SSH connection:', message);
      return { success: false, error: message };
    }
  });

  // Get last connection
  app.get('/api/ssh/last-connection', async () => {
    try {
      const config = configManager.getConfig();
      return { success: true, data: config.ssh.lastConnection };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get last SSH connection:', message);
      return { success: true, data: null };
    }
  });
}
