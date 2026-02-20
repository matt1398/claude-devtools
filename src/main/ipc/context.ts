/**
 * Context IPC Handlers - Manages context switching and listing.
 *
 * Channels:
 * - context:list - List all available contexts (local + SSH)
 * - context:getActive - Get current active context ID
 * - context:switch - Switch to a different context
 */

import { configManager } from '@main/services';
import { getContextIdForRoot, getRootIdForContextId } from '@main/utils/contextIds';
import { createLogger } from '@shared/utils/logger';

// Channel constants (mirrored from preload/constants/ipcChannels.ts to respect module boundaries)
const CONTEXT_LIST = 'context:list';
const CONTEXT_GET_ACTIVE = 'context:getActive';
const CONTEXT_SWITCH = 'context:switch';
const SET_COMBINED_WATCHERS = 'set-combined-watchers';

import type { ServiceContext, ServiceContextRegistry } from '../services';
import type { CombinedWatcherManager } from '@main/utils/combinedWatcherManager';
import type { IpcMain } from 'electron';

const logger = createLogger('IPC:context');

// =============================================================================
// Module State
// =============================================================================

let registry: ServiceContextRegistry;
let onContextRewire: (context: ServiceContext) => void;
let combinedWatcherManager: CombinedWatcherManager | null = null;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize context handlers with required services.
 * @param contextRegistry - The service context registry
 * @param onRewire - Rewire-only callback (no renderer notification) for renderer-initiated switches
 */
export function initializeContextHandlers(
  contextRegistry: ServiceContextRegistry,
  onRewire: (context: ServiceContext) => void,
  watcherManager?: CombinedWatcherManager
): void {
  registry = contextRegistry;
  onContextRewire = onRewire;
  combinedWatcherManager = watcherManager ?? null;
}

// =============================================================================
// Handler Registration
// =============================================================================

export function registerContextHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(CONTEXT_LIST, async () => {
    try {
      const config = configManager.getConfig();
      const sortedRoots = [...config.roots.items].sort((a, b) => a.order - b.order);
      const contexts = sortedRoots.map((root) => {
        const contextId = getContextIdForRoot(root, config.ssh.profiles);
        return {
          id: contextId,
          type: root.type,
          rootId: root.id,
          rootName: root.name,
          connected: registry.has(contextId),
        };
      });
      return { success: true, data: contexts };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to list contexts:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(CONTEXT_GET_ACTIVE, async () => {
    try {
      const activeContextId = registry.getActiveContextId();
      return { success: true, data: activeContextId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to get active context:', message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(CONTEXT_SWITCH, async (_event, contextId: string) => {
    try {
      // Switch to the new context
      const { current } = registry.switch(contextId);

      const config = configManager.getConfig();
      const rootId = getRootIdForContextId(contextId, config.roots.items, config.ssh.profiles);
      if (rootId) {
        configManager.setActiveRoot(rootId);
      }

      // Re-wire file watcher events only (no renderer notification — renderer initiated this switch)
      onContextRewire(current);

      return { success: true, data: { contextId } };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Context switch to "${contextId}" failed:`, message);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(SET_COMBINED_WATCHERS, async (_event, enabled: boolean) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    if (!combinedWatcherManager) {
      throw new Error('Combined watcher manager is not available');
    }
    if (enabled) {
      combinedWatcherManager.enable();
    } else {
      combinedWatcherManager.disable();
    }
  });

  logger.info('Context handlers registered');
}

export function removeContextHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler(CONTEXT_LIST);
  ipcMain.removeHandler(CONTEXT_GET_ACTIVE);
  ipcMain.removeHandler(CONTEXT_SWITCH);
  ipcMain.removeHandler(SET_COMBINED_WATCHERS);
}
