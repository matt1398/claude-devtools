/**
 * Standalone (non-Electron) entry point for claude-devtools.
 *
 * Runs the HTTP server + API without Electron, suitable for Docker
 * or any headless/remote environment. The renderer is served as
 * static files over HTTP.
 *
 * Environment variables:
 * - HOST: Bind address (default '0.0.0.0')
 * - PORT: Listen port (default 3456)
 * - CLAUDE_ROOT: Path to .claude directory (default ~/.claude)
 * - CORS_ORIGIN: CORS origin policy (default '*')
 */

import { createLogger } from '@shared/utils/logger';

import { HttpServer } from './services/infrastructure/HttpServer';
import {
  getProjectsBasePath,
  getTodosBasePath,
  setClaudeBasePathOverride,
} from './utils/pathDecoder';
import { LocalFileSystemProvider, NotificationManager, ServiceContext } from './services';

import type { HttpServices } from './http';
import type { SshConnectionManager } from './services/infrastructure/SshConnectionManager';
import type { UpdaterService } from './services/infrastructure/UpdaterService';

const logger = createLogger('Standalone');

// =============================================================================
// Configuration
// =============================================================================

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = parseInt(process.env.PORT ?? '3456', 10);
const CLAUDE_ROOT = process.env.CLAUDE_ROOT;

// Default CORS to allow all in standalone mode (Docker isolation replaces CORS)
if (!process.env.CORS_ORIGIN) {
  process.env.CORS_ORIGIN = '*';
}

// =============================================================================
// Stub services (Electron-only features unavailable in standalone)
// =============================================================================

/** No-op UpdaterService stub — auto-updater requires Electron. */
const updaterServiceStub = {
  checkForUpdates: async () => {},
  downloadUpdate: async () => {},
  quitAndInstall: () => {},
  setMainWindow: () => {},
} as unknown as UpdaterService;

/** No-op SshConnectionManager stub — SSH is managed per-user in the Electron app. */
const sshConnectionManagerStub = {
  getStatus: () => ({
    state: 'disconnected' as const,
    host: null,
    error: null,
    remoteProjectsPath: null,
  }),
  getProvider: () => new LocalFileSystemProvider(),
  isRemote: () => false,
  connect: async () => {},
  disconnect: () => {},
  testConnection: async () => ({ success: false, error: 'SSH not available in standalone mode' }),
  getConfigHosts: async () => [],
  resolveHostConfig: async () => null,
  dispose: () => {},
  on: () => sshConnectionManagerStub,
  off: () => sshConnectionManagerStub,
  emit: () => false,
} as unknown as SshConnectionManager;

// =============================================================================
// Application State
// =============================================================================

let localContext: ServiceContext;
let notificationManager: NotificationManager;
let httpServer: HttpServer;

// =============================================================================
// Lifecycle
// =============================================================================

async function start(): Promise<void> {
  logger.info('Starting standalone server...');

  // Apply Claude root override if set
  if (CLAUDE_ROOT) {
    setClaudeBasePathOverride(CLAUDE_ROOT);
    logger.info(`Using CLAUDE_ROOT: ${CLAUDE_ROOT}`);
  }

  const projectsDir = getProjectsBasePath();
  const todosDir = getTodosBasePath();

  logger.info(`Projects directory: ${projectsDir}`);
  logger.info(`Todos directory: ${todosDir}`);

  // Create local context (the only context in standalone mode)
  localContext = new ServiceContext({
    id: 'local',
    type: 'local',
    fsProvider: new LocalFileSystemProvider(),
    projectsDir,
    todosDir,
  });
  localContext.start();

  // Initialize notification manager
  notificationManager = NotificationManager.getInstance();
  localContext.fileWatcher.setNotificationManager(notificationManager);

  // Create HTTP server
  httpServer = new HttpServer();

  // Wire file watcher events to SSE broadcast
  localContext.fileWatcher.on('file-change', (event: unknown) => {
    httpServer.broadcast('file-change', event);
  });
  localContext.fileWatcher.on('todo-change', (event: unknown) => {
    httpServer.broadcast('todo-change', event);
  });

  // Forward notification events to SSE
  notificationManager.on('notification-new', (notification: unknown) => {
    httpServer.broadcast('notification:new', notification);
  });
  notificationManager.on('notification-updated', (data: unknown) => {
    httpServer.broadcast('notification:updated', data);
  });
  notificationManager.on('notification-clicked', (data: unknown) => {
    httpServer.broadcast('notification:clicked', data);
  });

  // Build services for HTTP routes
  const services: HttpServices = {
    projectScanner: localContext.projectScanner,
    sessionParser: localContext.sessionParser,
    subagentResolver: localContext.subagentResolver,
    chunkBuilder: localContext.chunkBuilder,
    dataCache: localContext.dataCache,
    updaterService: updaterServiceStub,
    sshConnectionManager: sshConnectionManagerStub,
  };

  // No-op mode switch handler (no SSH in standalone)
  const modeSwitchHandler = async (): Promise<void> => {};

  // Start the server
  const port = await httpServer.start(services, modeSwitchHandler, PORT, HOST);
  logger.info(`Standalone server running at http://${HOST}:${port}`);
  logger.info('Open in your browser to view Claude Code sessions');
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');

  if (httpServer?.isRunning()) {
    await httpServer.stop();
  }

  if (localContext) {
    localContext.dispose();
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

// =============================================================================
// Signal Handlers
// =============================================================================

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
});

// =============================================================================
// Start
// =============================================================================

void start();
