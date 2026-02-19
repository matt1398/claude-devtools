/**
 * IPC Handlers - Orchestrates domain-specific handler modules.
 *
 * This module initializes and registers all IPC handlers from domain modules:
 * - projects.ts: Project listing and repository groups
 * - sessions.ts: Session operations and pagination
 * - search.ts: Session search functionality
 * - subagents.ts: Subagent detail retrieval
 * - validation.ts: Path validation and scroll handling
 * - utility.ts: Shell operations and file reading
 * - notifications.ts: Notification management
 * - config.ts: App configuration
 * - ssh.ts: SSH connection management
 */

import { createLogger } from '@shared/utils/logger';
import { ipcMain } from 'electron';

import { initializeConfigHandlers, registerConfigHandlers, removeConfigHandlers } from './config';
import {
  initializeContextHandlers,
  registerContextHandlers,
  removeContextHandlers,
} from './context';

const logger = createLogger('IPC:handlers');
import { registerNotificationHandlers, removeNotificationHandlers } from './notifications';
import {
  initializeProjectHandlers,
  registerProjectHandlers,
  removeProjectHandlers,
} from './projects';
import { initializeSearchHandlers, registerSearchHandlers, removeSearchHandlers } from './search';
import {
  initializeSessionHandlers,
  registerSessionHandlers,
  removeSessionHandlers,
} from './sessions';
import { initializeSshHandlers, registerSshHandlers, removeSshHandlers } from './ssh';
import {
  initializeSubagentHandlers,
  registerSubagentHandlers,
  removeSubagentHandlers,
} from './subagents';
import {
  initializeUpdaterHandlers,
  registerUpdaterHandlers,
  removeUpdaterHandlers,
} from './updater';
import { registerUtilityHandlers, removeUtilityHandlers } from './utility';
import { registerValidationHandlers, removeValidationHandlers } from './validation';
import { registerWindowHandlers, removeWindowHandlers } from './window';

import type {
  ServiceContext,
  ServiceContextRegistry,
  SshConnectionManager,
  UpdaterService,
} from '../services';
import type { DataRoot } from '@shared/types';

/**
 * Initializes IPC handlers with service registry.
 */
export function initializeIpcHandlers(
  registry: ServiceContextRegistry,
  updater: UpdaterService,
  sshManager: SshConnectionManager,
  contextCallbacks: {
    rewire: (context: ServiceContext) => void;
    full: (context: ServiceContext) => void;
    onClaudeRootPathUpdated: (claudeRootPath: string | null) => Promise<void> | void;
    onRootAdded: (root: DataRoot) => Promise<void> | void;
    onRootRemoved: (rootId: string) => Promise<void> | void;
    onRootUpdated: (root: DataRoot) => Promise<void> | void;
    onRootActivated: (rootId: string) => Promise<void> | void;
  }
): void {
  // Initialize domain handlers with registry
  initializeProjectHandlers(registry);
  initializeSessionHandlers(registry);
  initializeSearchHandlers(registry);
  initializeSubagentHandlers(registry);
  initializeUpdaterHandlers(updater);
  initializeSshHandlers(sshManager, registry, contextCallbacks.rewire);
  initializeContextHandlers(registry, contextCallbacks.rewire);
  initializeConfigHandlers({
    onClaudeRootPathUpdated: contextCallbacks.onClaudeRootPathUpdated,
    onRootAdded: contextCallbacks.onRootAdded,
    onRootRemoved: contextCallbacks.onRootRemoved,
    onRootUpdated: contextCallbacks.onRootUpdated,
    onRootActivated: contextCallbacks.onRootActivated,
  });

  // Register all handlers
  registerProjectHandlers(ipcMain);
  registerSessionHandlers(ipcMain);
  registerSearchHandlers(ipcMain);
  registerSubagentHandlers(ipcMain);
  registerValidationHandlers(ipcMain);
  registerUtilityHandlers(ipcMain);
  registerNotificationHandlers(ipcMain);
  registerConfigHandlers(ipcMain);
  registerUpdaterHandlers(ipcMain);
  registerSshHandlers(ipcMain);
  registerContextHandlers(ipcMain);
  registerWindowHandlers(ipcMain);

  logger.info('All handlers registered');
}

/**
 * Removes all IPC handlers.
 * Should be called when shutting down.
 */
export function removeIpcHandlers(): void {
  removeProjectHandlers(ipcMain);
  removeSessionHandlers(ipcMain);
  removeSearchHandlers(ipcMain);
  removeSubagentHandlers(ipcMain);
  removeValidationHandlers(ipcMain);
  removeUtilityHandlers(ipcMain);
  removeNotificationHandlers(ipcMain);
  removeConfigHandlers(ipcMain);
  removeUpdaterHandlers(ipcMain);
  removeSshHandlers(ipcMain);
  removeContextHandlers(ipcMain);
  removeWindowHandlers(ipcMain);

  logger.info('All handlers removed');
}
