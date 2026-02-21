/**
 * HTTP route handlers for App Configuration.
 *
 * Routes:
 * - GET /api/config - Get full config
 * - POST /api/config/update - Update config section
 * - POST /api/config/ignore-regex - Add ignore pattern
 * - DELETE /api/config/ignore-regex - Remove ignore pattern
 * - POST /api/config/ignore-repository - Add ignored repository
 * - DELETE /api/config/ignore-repository - Remove ignored repository
 * - POST /api/config/snooze - Set snooze
 * - POST /api/config/clear-snooze - Clear snooze
 * - POST /api/config/triggers - Add trigger
 * - PUT /api/config/triggers/:triggerId - Update trigger
 * - DELETE /api/config/triggers/:triggerId - Remove trigger
 * - GET /api/config/triggers - Get all triggers
 * - POST /api/config/triggers/:triggerId/test - Test trigger
 * - POST /api/config/pin-session - Pin session
 * - POST /api/config/unpin-session - Unpin session
 * - POST /api/config/select-folders - No-op in browser
 * - POST /api/config/open-in-editor - No-op in browser
 */

import { getErrorMessage } from '@shared/utils/errorHandling';
import { createLogger } from '@shared/utils/logger';

import { validateConfigUpdatePayload } from '../ipc/configValidation';
import { validateTriggerId } from '../ipc/guards';
import {
  type AppConfig,
  ConfigManager,
  type NotificationTrigger,
  type TriggerContentType,
  type TriggerMatchField,
  type TriggerMode,
  type TriggerTokenType,
} from '../services';
import { getAutoDetectedClaudeBasePath } from '../utils/pathDecoder';
import {
  applyRootLifecycleCallbacks,
  type RootLifecycleCallbacks,
} from '../utils/rootLifecycleCallbacks';

import type { TriggerColor } from '@shared/constants/triggerColors';
import type { LocalDataRoot, SshDataRoot } from '@shared/types';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:config');

interface ConfigResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

interface RegisterConfigRouteOptions {
  mode?: 'electron' | 'standalone';
  rootLifecycleCallbacks?: RootLifecycleCallbacks;
  onClaudeRootPathUpdated?: (claudeRootPath: string | null) => Promise<void> | void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateAddRootPayload(
  payload: unknown
): payload is Omit<LocalDataRoot, 'id' | 'order'> | Omit<SshDataRoot, 'id' | 'order'> {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.type !== 'local' && payload.type !== 'ssh') {
    return false;
  }
  if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
    return false;
  }
  if (payload.type === 'local') {
    return !(
      Object.prototype.hasOwnProperty.call(payload, 'claudeRootPath') &&
      payload.claudeRootPath !== null &&
      typeof payload.claudeRootPath !== 'string'
    );
  }

  if (typeof payload.sshProfileId !== 'string' || payload.sshProfileId.trim().length === 0) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'remoteClaudeRootPath') &&
    payload.remoteClaudeRootPath !== null &&
    typeof payload.remoteClaudeRootPath !== 'string'
  ) {
    return false;
  }
  return true;
}

function validateUpdateRootPayload(
  payload: unknown
): payload is Partial<Omit<LocalDataRoot, 'id'>> | Partial<Omit<SshDataRoot, 'id'>> {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'name') &&
    (typeof payload.name !== 'string' || payload.name.trim().length === 0)
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'type') &&
    payload.type !== 'local' &&
    payload.type !== 'ssh'
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'claudeRootPath') &&
    payload.claudeRootPath !== null &&
    typeof payload.claudeRootPath !== 'string'
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'sshProfileId') &&
    (typeof payload.sshProfileId !== 'string' || payload.sshProfileId.trim().length === 0)
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'remoteClaudeRootPath') &&
    payload.remoteClaudeRootPath !== null &&
    typeof payload.remoteClaudeRootPath !== 'string'
  ) {
    return false;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'order') &&
    (typeof payload.order !== 'number' || !Number.isInteger(payload.order))
  ) {
    return false;
  }
  return true;
}

export function registerConfigRoutes(
  app: FastifyInstance,
  options: RegisterConfigRouteOptions = {}
): void {
  const configManager = ConfigManager.getInstance();
  const mode = options.mode ?? 'electron';
  const rootLifecycleCallbacks = options.rootLifecycleCallbacks ?? {};
  const onClaudeRootPathUpdated = options.onClaudeRootPathUpdated ?? null;

  // Get full config
  app.get('/api/config', async () => {
    try {
      const config = configManager.getConfig();
      return { success: true, data: config };
    } catch (error) {
      logger.error('Error in GET /api/config:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Update config section
  app.post<{ Body: { section: unknown; data: unknown } }>('/api/config/update', async (request) => {
    try {
      const { section, data } = request.body;
      const validation = validateConfigUpdatePayload(section, data, configManager.getConfig());
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
      if (mode === 'standalone' && validation.section === 'roots') {
        return { success: false, error: 'Root CRUD is not supported in standalone mode' };
      }

      const isClaudeRootUpdate =
        validation.section === 'general' &&
        Object.prototype.hasOwnProperty.call(validation.data, 'claudeRootPath');
      const previousConfig = validation.section === 'roots' ? configManager.getConfig() : null;
      configManager.updateConfig(validation.section, validation.data);
      if (isClaudeRootUpdate && onClaudeRootPathUpdated) {
        const nextClaudeRootPath = (validation.data as { claudeRootPath?: string | null })
          .claudeRootPath;
        try {
          await onClaudeRootPathUpdated(nextClaudeRootPath ?? null);
        } catch (callbackError) {
          logger.error('Failed to apply updated Claude root path at runtime:', callbackError);
        }
      }
      const updatedConfig = configManager.getConfig();
      if (validation.section === 'roots' && previousConfig) {
        await applyRootLifecycleCallbacks(previousConfig, updatedConfig, rootLifecycleCallbacks);
      }
      return { success: true, data: updatedConfig };
    } catch (error) {
      logger.error('Error in POST /api/config/update:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  app.get('/api/roots', async (): Promise<ConfigResult<AppConfig['roots']['items']>> => {
    try {
      return { success: true, data: configManager.getRoots() };
    } catch (error) {
      logger.error('Error in GET /api/roots:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  app.get<{ Params: { rootId: string } }>(
    '/api/roots/:rootId/info',
    async (request): Promise<ConfigResult<{ defaultPath: string; resolvedPath: string; customPath: string | null }>> => {
      try {
        const root = configManager.getRoot(request.params.rootId);
        if (root?.type !== 'local') {
          return { success: false, error: `Local root not found: ${request.params.rootId}` };
        }

        const defaultPath = getAutoDetectedClaudeBasePath();
        const customPath = root.claudeRootPath;
        return {
          success: true,
          data: {
            defaultPath,
            resolvedPath: customPath ?? defaultPath,
            customPath,
          },
        };
      } catch (error) {
        logger.error(`Error in GET /api/roots/${request.params.rootId}/info:`, error);
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  app.post<{ Body: Omit<LocalDataRoot, 'id' | 'order'> | Omit<SshDataRoot, 'id' | 'order'> }>(
    '/api/roots',
    async (request) => {
    if (mode === 'standalone') {
      return { success: false, error: 'Root CRUD is not supported in standalone mode' };
    }
    try {
      if (!validateAddRootPayload(request.body)) {
        return { success: false, error: 'Invalid root payload' };
      }
      const previousIds = new Set(configManager.getRoots().map((root) => root.id));
      const updatedConfig = configManager.addRoot(request.body);
      if (rootLifecycleCallbacks.onRootAdded) {
        const added = updatedConfig.roots.items.find((root) => !previousIds.has(root.id));
        if (added) {
          await rootLifecycleCallbacks.onRootAdded(added);
        }
      }
      return { success: true, data: updatedConfig };
    } catch (error) {
      logger.error('Error in POST /api/roots:', error);
      return { success: false, error: getErrorMessage(error) };
    }
    }
  );

  app.put<{
    Params: { rootId: string };
    Body: Partial<Omit<LocalDataRoot, 'id'>> | Partial<Omit<SshDataRoot, 'id'>>;
  }>(
    '/api/roots/:rootId',
    async (request) => {
      if (mode === 'standalone') {
        return { success: false, error: 'Root CRUD is not supported in standalone mode' };
      }
      try {
        if (!validateUpdateRootPayload(request.body)) {
          return { success: false, error: 'Invalid root update payload' };
        }
        const updatedConfig = configManager.updateRoot(request.params.rootId, request.body);
        if (rootLifecycleCallbacks.onRootUpdated) {
          const updatedRoot = updatedConfig.roots.items.find((root) => root.id === request.params.rootId);
          if (updatedRoot) {
            await rootLifecycleCallbacks.onRootUpdated(updatedRoot);
          }
        }
        return { success: true, data: updatedConfig };
      } catch (error) {
        logger.error(`Error in PUT /api/roots/${request.params.rootId}:`, error);
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  app.delete<{ Params: { rootId: string } }>('/api/roots/:rootId', async (request) => {
    if (mode === 'standalone') {
      return { success: false, error: 'Root CRUD is not supported in standalone mode' };
    }
    try {
      const previousActiveRootId = configManager.getConfig().roots.activeRootId;
      const updatedConfig = configManager.removeRoot(request.params.rootId);
      if (rootLifecycleCallbacks.onRootRemoved) {
        await rootLifecycleCallbacks.onRootRemoved(request.params.rootId);
      }
      if (
        previousActiveRootId !== updatedConfig.roots.activeRootId &&
        rootLifecycleCallbacks.onRootActivated
      ) {
        await rootLifecycleCallbacks.onRootActivated(updatedConfig.roots.activeRootId);
      }
      return { success: true, data: updatedConfig };
    } catch (error) {
      logger.error(`Error in DELETE /api/roots/${request.params.rootId}:`, error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  app.post<{ Body: { rootIdsInOrder: string[] } }>('/api/roots/reorder', async (request) => {
    if (mode === 'standalone') {
      return { success: false, error: 'Root CRUD is not supported in standalone mode' };
    }
    try {
      const { rootIdsInOrder } = request.body;
      if (
        !Array.isArray(rootIdsInOrder) ||
        rootIdsInOrder.length === 0 ||
        !rootIdsInOrder.every((id) => typeof id === 'string')
      ) {
        return { success: false, error: 'rootIdsInOrder must be a non-empty array of strings' };
      }

      const updatedConfig = configManager.reorderRoots(rootIdsInOrder);
      return { success: true, data: updatedConfig };
    } catch (error) {
      logger.error('Error in POST /api/roots/reorder:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  app.post<{ Params: { rootId: string } }>('/api/roots/:rootId/activate', async (request) => {
    if (mode === 'standalone') {
      return { success: false, error: 'Root activation is not supported in standalone mode' };
    }
    try {
      const updatedConfig = configManager.setActiveRoot(request.params.rootId);
      if (rootLifecycleCallbacks.onRootActivated) {
        await rootLifecycleCallbacks.onRootActivated(request.params.rootId);
      }
      return { success: true, data: updatedConfig };
    } catch (error) {
      logger.error(`Error in POST /api/roots/${request.params.rootId}/activate:`, error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Add ignore regex
  app.post<{ Body: { pattern: string } }>('/api/config/ignore-regex', async (request) => {
    try {
      const { pattern } = request.body;
      if (!pattern || typeof pattern !== 'string') {
        return { success: false, error: 'Pattern is required and must be a string' };
      }

      try {
        new RegExp(pattern);
      } catch {
        return { success: false, error: 'Invalid regex pattern' };
      }

      configManager.addIgnoreRegex(pattern);
      return { success: true };
    } catch (error) {
      logger.error('Error in POST /api/config/ignore-regex:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Remove ignore regex
  app.delete<{ Body: { pattern: string } }>('/api/config/ignore-regex', async (request) => {
    try {
      const { pattern } = request.body;
      if (!pattern || typeof pattern !== 'string') {
        return { success: false, error: 'Pattern is required and must be a string' };
      }

      configManager.removeIgnoreRegex(pattern);
      return { success: true };
    } catch (error) {
      logger.error('Error in DELETE /api/config/ignore-regex:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Add ignore repository
  app.post<{ Body: { repositoryId: string } }>('/api/config/ignore-repository', async (request) => {
    try {
      const { repositoryId } = request.body;
      if (!repositoryId || typeof repositoryId !== 'string') {
        return { success: false, error: 'Repository ID is required and must be a string' };
      }

      configManager.addIgnoreRepository(repositoryId);
      return { success: true };
    } catch (error) {
      logger.error('Error in POST /api/config/ignore-repository:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Remove ignore repository
  app.delete<{ Body: { repositoryId: string } }>(
    '/api/config/ignore-repository',
    async (request) => {
      try {
        const { repositoryId } = request.body;
        if (!repositoryId || typeof repositoryId !== 'string') {
          return { success: false, error: 'Repository ID is required and must be a string' };
        }

        configManager.removeIgnoreRepository(repositoryId);
        return { success: true };
      } catch (error) {
        logger.error('Error in DELETE /api/config/ignore-repository:', error);
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  // Set snooze
  app.post<{ Body: { minutes: number } }>('/api/config/snooze', async (request) => {
    try {
      const { minutes } = request.body;
      if (typeof minutes !== 'number' || minutes <= 0 || minutes > 24 * 60) {
        return { success: false, error: 'Minutes must be a positive number' };
      }

      configManager.setSnooze(minutes);
      return { success: true };
    } catch (error) {
      logger.error('Error in POST /api/config/snooze:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Clear snooze
  app.post('/api/config/clear-snooze', async () => {
    try {
      configManager.clearSnooze();
      return { success: true };
    } catch (error) {
      logger.error('Error in POST /api/config/clear-snooze:', error);
      return { success: false, error: getErrorMessage(error) };
    }
  });

  // Add trigger
  app.post<{
    Body: {
      id: string;
      name: string;
      enabled: boolean;
      contentType: string;
      mode?: TriggerMode;
      requireError?: boolean;
      toolName?: string;
      matchField?: string;
      matchPattern?: string;
      ignorePatterns?: string[];
      tokenThreshold?: number;
      tokenType?: TriggerTokenType;
      repositoryIds?: string[];
      color?: string;
    };
  }>('/api/config/triggers', async (request) => {
    try {
      const trigger = request.body;
      if (!trigger.id || !trigger.name || !trigger.contentType) {
        return { success: false, error: 'Trigger must have id, name, and contentType' };
      }

      configManager.addTrigger({
        id: trigger.id,
        name: trigger.name,
        enabled: trigger.enabled,
        contentType: trigger.contentType as TriggerContentType,
        mode: trigger.mode ?? (trigger.requireError ? 'error_status' : 'content_match'),
        requireError: trigger.requireError,
        toolName: trigger.toolName,
        matchField: trigger.matchField as TriggerMatchField | undefined,
        matchPattern: trigger.matchPattern,
        ignorePatterns: trigger.ignorePatterns,
        tokenThreshold: trigger.tokenThreshold,
        tokenType: trigger.tokenType,
        repositoryIds: trigger.repositoryIds,
        color: trigger.color as TriggerColor | undefined,
        isBuiltin: false,
      });

      return { success: true };
    } catch (error) {
      logger.error('Error in POST /api/config/triggers:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add trigger',
      };
    }
  });

  // Update trigger
  app.put<{
    Params: { triggerId: string };
    Body: Partial<{
      name: string;
      enabled: boolean;
      contentType: string;
      requireError: boolean;
      toolName: string;
      matchField: string;
      matchPattern: string;
      ignorePatterns: string[];
      mode: TriggerMode;
      tokenThreshold: number;
      tokenType: TriggerTokenType;
      repositoryIds: string[];
      color: string;
    }>;
  }>('/api/config/triggers/:triggerId', async (request) => {
    try {
      const validated = validateTriggerId(request.params.triggerId);
      if (!validated.valid) {
        return { success: false, error: validated.error ?? 'Trigger ID is required' };
      }

      configManager.updateTrigger(validated.value!, request.body as Partial<NotificationTrigger>);
      return { success: true };
    } catch (error) {
      logger.error('Error in PUT /api/config/triggers:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update trigger',
      };
    }
  });

  // Remove trigger
  app.delete<{ Params: { triggerId: string } }>(
    '/api/config/triggers/:triggerId',
    async (request) => {
      try {
        const validated = validateTriggerId(request.params.triggerId);
        if (!validated.valid) {
          return { success: false, error: validated.error ?? 'Trigger ID is required' };
        }

        configManager.removeTrigger(validated.value!);
        return { success: true };
      } catch (error) {
        logger.error('Error in DELETE /api/config/triggers:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to remove trigger',
        };
      }
    }
  );

  // Get triggers
  app.get('/api/config/triggers', async () => {
    try {
      const triggers = configManager.getTriggers();
      return { success: true, data: triggers };
    } catch (error) {
      logger.error('Error in GET /api/config/triggers:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get triggers',
      };
    }
  });

  // Test trigger
  app.post<{ Params: { triggerId: string }; Body: NotificationTrigger }>(
    '/api/config/triggers/:triggerId/test',
    async (request) => {
      try {
        const { errorDetector } = await import('../services');
        const result = await errorDetector.testTrigger(request.body, 50);

        const errors = result.errors.map((error) => ({
          id: error.id,
          sessionId: error.sessionId,
          projectId: error.projectId,
          message: error.message,
          timestamp: error.timestamp,
          source: error.source,
          toolUseId: error.toolUseId,
          subagentId: error.subagentId,
          lineNumber: error.lineNumber,
          context: { projectName: error.context.projectName },
        }));

        return {
          success: true,
          data: { totalCount: result.totalCount, errors, truncated: result.truncated },
        };
      } catch (error) {
        logger.error('Error in POST /api/config/triggers/test:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test trigger',
        };
      }
    }
  );

  // Pin session
  app.post<{ Body: { projectId: string; sessionId: string } }>(
    '/api/config/pin-session',
    async (request) => {
      try {
        const { projectId, sessionId } = request.body;
        if (!projectId || typeof projectId !== 'string') {
          return { success: false, error: 'Project ID is required and must be a string' };
        }
        if (!sessionId || typeof sessionId !== 'string') {
          return { success: false, error: 'Session ID is required and must be a string' };
        }

        configManager.pinSession(projectId, sessionId);
        return { success: true };
      } catch (error) {
        logger.error('Error in POST /api/config/pin-session:', error);
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  // Unpin session
  app.post<{ Body: { projectId: string; sessionId: string } }>(
    '/api/config/unpin-session',
    async (request) => {
      try {
        const { projectId, sessionId } = request.body;
        if (!projectId || typeof projectId !== 'string') {
          return { success: false, error: 'Project ID is required and must be a string' };
        }
        if (!sessionId || typeof sessionId !== 'string') {
          return { success: false, error: 'Session ID is required and must be a string' };
        }

        configManager.unpinSession(projectId, sessionId);
        return { success: true };
      } catch (error) {
        logger.error('Error in POST /api/config/unpin-session:', error);
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  // Hide session
  app.post<{ Body: { projectId: string; sessionId: string } }>(
    '/api/config/hide-session',
    async (request) => {
      try {
        const { projectId, sessionId } = request.body;
        if (!projectId || typeof projectId !== 'string') {
          return { success: false, error: 'Project ID is required and must be a string' };
        }
        if (!sessionId || typeof sessionId !== 'string') {
          return { success: false, error: 'Session ID is required and must be a string' };
        }

        configManager.hideSession(projectId, sessionId);
        return { success: true };
      } catch (error) {
        logger.error('Error in POST /api/config/hide-session:', error);
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  // Unhide session
  app.post<{ Body: { projectId: string; sessionId: string } }>(
    '/api/config/unhide-session',
    async (request) => {
      try {
        const { projectId, sessionId } = request.body;
        if (!projectId || typeof projectId !== 'string') {
          return { success: false, error: 'Project ID is required and must be a string' };
        }
        if (!sessionId || typeof sessionId !== 'string') {
          return { success: false, error: 'Session ID is required and must be a string' };
        }

        configManager.unhideSession(projectId, sessionId);
        return { success: true };
      } catch (error) {
        logger.error('Error in POST /api/config/unhide-session:', error);
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  // Bulk hide sessions
  app.post<{ Body: { projectId: string; sessionIds: string[] } }>(
    '/api/config/hide-sessions',
    async (request) => {
      try {
        const { projectId, sessionIds } = request.body;
        if (!projectId || typeof projectId !== 'string') {
          return { success: false, error: 'Project ID is required and must be a string' };
        }
        if (!Array.isArray(sessionIds) || sessionIds.some((id) => typeof id !== 'string')) {
          return { success: false, error: 'Session IDs must be an array of strings' };
        }

        configManager.hideSessions(projectId, sessionIds);
        return { success: true };
      } catch (error) {
        logger.error('Error in POST /api/config/hide-sessions:', error);
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  // Bulk unhide sessions
  app.post<{ Body: { projectId: string; sessionIds: string[] } }>(
    '/api/config/unhide-sessions',
    async (request) => {
      try {
        const { projectId, sessionIds } = request.body;
        if (!projectId || typeof projectId !== 'string') {
          return { success: false, error: 'Project ID is required and must be a string' };
        }
        if (!Array.isArray(sessionIds) || sessionIds.some((id) => typeof id !== 'string')) {
          return { success: false, error: 'Session IDs must be an array of strings' };
        }

        configManager.unhideSessions(projectId, sessionIds);
        return { success: true };
      } catch (error) {
        logger.error('Error in POST /api/config/unhide-sessions:', error);
        return { success: false, error: getErrorMessage(error) };
      }
    }
  );

  // Select folders - no-op in browser mode
  app.post('/api/config/select-folders', async (): Promise<ConfigResult<string[]>> => {
    return { success: true, data: [] };
  });

  // Open in editor - no-op in browser mode
  app.post('/api/config/open-in-editor', async (): Promise<ConfigResult> => {
    return { success: true };
  });
}
