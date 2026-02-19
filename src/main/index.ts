/**
 * Main process entry point for claude-devtools.
 *
 * Responsibilities:
 * - Initialize Electron app and main window
 * - Set up IPC handlers for data access
 * - Initialize ServiceContextRegistry with local context
 * - Start file watcher for live updates
 * - Manage application lifecycle
 */

import { DEFAULT_LOCAL_ROOT_ID, getLocalContextId } from '@main/utils/contextIds';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEV_SERVER_PORT,
  getTrafficLightPositionForZoom,
  WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL,
} from '@shared/constants';
import { createLogger } from '@shared/utils/logger';
import { app, BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';

import { initializeIpcHandlers, removeIpcHandlers } from './ipc/handlers';
import {
  getAutoDetectedClaudeBasePath,
  setClaudeBasePathOverride,
} from './utils/pathDecoder';

// Window icon path for non-mac platforms.
const getWindowIconPath = (): string | undefined => {
  const isDev = process.env.NODE_ENV === 'development';
  const candidates = isDev
    ? [join(process.cwd(), 'resources/icon.png')]
    : [
        join(process.resourcesPath, 'resources/icon.png'),
        join(__dirname, '../../resources/icon.png'),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

const logger = createLogger('App');
// IPC channel constants (duplicated from @preload to avoid boundary violation)
const SSH_STATUS = 'ssh:status';
const CONTEXT_CHANGED = 'context:changed';
const HTTP_SERVER_START = 'httpServer:start';
const HTTP_SERVER_STOP = 'httpServer:stop';
const HTTP_SERVER_GET_STATUS = 'httpServer:getStatus';

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection in main process:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in main process:', error);
});

import { HttpServer } from './services/infrastructure/HttpServer';
import {
  configManager,
  LocalFileSystemProvider,
  NotificationManager,
  ServiceContext,
  ServiceContextRegistry,
  SshConnectionManager,
  UpdaterService,
} from './services';

import type { DataRoot, LocalDataRoot } from '@shared/types/roots';

// =============================================================================
// Application State
// =============================================================================

let mainWindow: BrowserWindow | null = null;

// Service registry and global services
let contextRegistry: ServiceContextRegistry;
let notificationManager: NotificationManager;
let updaterService: UpdaterService;
let sshConnectionManager: SshConnectionManager;
let httpServer: HttpServer;

// File watcher event cleanup functions
let fileChangeCleanup: (() => void) | null = null;
let todoChangeCleanup: (() => void) | null = null;

/**
 * Resolve production renderer index path.
 * Main bundle lives in dist-electron/main, while renderer lives in out/renderer.
 */
function getRendererIndexPath(): string {
  const candidates = [
    join(__dirname, '../../out/renderer/index.html'),
    join(__dirname, '../renderer/index.html'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function resolveLocalRootBasePath(root: LocalDataRoot): string {
  return root.claudeRootPath ?? getAutoDetectedClaudeBasePath();
}

function buildLocalContext(root: LocalDataRoot): ServiceContext {
  const claudeBasePath = resolveLocalRootBasePath(root);
  const projectsDir = join(claudeBasePath, 'projects');
  const todosDir = join(claudeBasePath, 'todos');

  return new ServiceContext({
    id: getLocalContextId(root.id),
    type: 'local',
    rootId: root.id,
    rootName: root.name,
    fsProvider: new LocalFileSystemProvider(),
    projectsDir,
    todosDir,
  });
}

/**
 * Wires file watcher events from a ServiceContext to the renderer and HTTP SSE clients.
 * Cleans up previous listeners before adding new ones.
 */
function wireFileWatcherEvents(context: ServiceContext): void {
  logger.info(`Wiring FileWatcher events for context: ${context.id}`);

  // Clean up previous listeners
  if (fileChangeCleanup) {
    fileChangeCleanup();
    fileChangeCleanup = null;
  }
  if (todoChangeCleanup) {
    todoChangeCleanup();
    todoChangeCleanup = null;
  }

  // Wire file-change events to renderer and HTTP SSE
  const fileChangeHandler = (event: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-change', event);
    }
    httpServer?.broadcast('file-change', event);
  };
  context.fileWatcher.on('file-change', fileChangeHandler);
  fileChangeCleanup = () => context.fileWatcher.off('file-change', fileChangeHandler);

  // Forward checklist-change events to renderer and HTTP SSE (mirrors file-change pattern above)
  const todoChangeHandler = (event: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('todo-change', event);
    }
    httpServer?.broadcast('todo-change', event);
  };
  context.fileWatcher.on('todo-change', todoChangeHandler);
  todoChangeCleanup = () => context.fileWatcher.off('todo-change', todoChangeHandler);

  logger.info(`FileWatcher events wired for context: ${context.id}`);
}

/**
 * Handles mode switch requests from the HTTP server.
 * Switches the active context back to local when requested.
 */
async function handleModeSwitch(mode: 'local' | 'ssh'): Promise<void> {
  if (mode === 'local') {
    const config = configManager.getConfig();
    const localRoot =
      config.roots.items.find(
        (root): root is LocalDataRoot =>
          root.type === 'local' && root.id === config.roots.activeRootId
      ) ??
      config.roots.items.find((root): root is LocalDataRoot => root.type === 'local');
    if (!localRoot) {
      return;
    }

    const targetContextId = getLocalContextId(localRoot.id);
    if (contextRegistry.getActiveContextId() === targetContextId) {
      if (config.roots.activeRootId !== localRoot.id) {
        configManager.setActiveRoot(localRoot.id);
      }
      return;
    }

    const { current } = contextRegistry.switch(targetContextId);
    configManager.setActiveRoot(localRoot.id);
    onContextSwitched(current);
  }
}

/**
 * Re-wires file watcher events only. No renderer notification.
 * Used for renderer-initiated switches where the renderer already handles state.
 */
export function rewireContextEvents(context: ServiceContext): void {
  const root = configManager.getRoot(context.rootId);
  setClaudeBasePathOverride(root?.type === 'local' ? root.claudeRootPath : null);
  if (notificationManager) {
    context.fileWatcher.setNotificationManager(notificationManager);
  }
  wireFileWatcherEvents(context);
}

/**
 * Full callback: re-wire + notify renderer.
 * Used for external/unexpected switches (e.g., HTTP server mode switch).
 */
function onContextSwitched(context: ServiceContext): void {
  context.startFileWatcher();
  rewireContextEvents(context);

  // Notify renderer of context change
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(SSH_STATUS, sshConnectionManager.getStatus());
    mainWindow.webContents.send(CONTEXT_CHANGED, {
      id: context.id,
      type: context.type,
      rootId: context.rootId,
      rootName: context.rootName,
      connected: true,
    });
  }
}

function handleClaudeRootPathUpdated(_claudeRootPath: string | null): void {
  reconfigureRootContext(DEFAULT_LOCAL_ROOT_ID);
}

function reconfigureRootContext(rootId: string): void {
  try {
    const root = configManager.getRoot(rootId);
    if (root?.type !== 'local') {
      return;
    }

    const contextId = getLocalContextId(root.id);
    const currentContext = contextRegistry.get(contextId);
    if (!currentContext) {
      return;
    }

    const wasActive = contextRegistry.getActiveContextId() === contextId;
    if (wasActive) {
      currentContext.stopFileWatcher();
    }

    const replacementContext = buildLocalContext(root);
    if (notificationManager) {
      replacementContext.fileWatcher.setNotificationManager(notificationManager);
    }
    contextRegistry.replaceContext(contextId, replacementContext);
    if (wasActive) {
      rewireContextEvents(replacementContext);
      replacementContext.startFileWatcher();
    }
  } catch (error) {
    logger.error(`Failed to reconfigure context for root ${rootId}:`, error);
  }
}

function handleRootAdded(root: DataRoot): void {
  if (root.type !== 'local') {
    return;
  }

  const contextId = getLocalContextId(root.id);
  if (contextRegistry.has(contextId)) {
    return;
  }

  const context = buildLocalContext(root);
  contextRegistry.registerContext(context);
}

function handleRootRemoved(rootId: string): void {
  const context = contextRegistry.getByRootId(rootId);
  if (!context) {
    return;
  }
  const wasActive = contextRegistry.getActiveContextId() === context.id;

  if (context.type === 'ssh' && contextRegistry.getActiveContextId() === context.id) {
    sshConnectionManager.disconnect();
  }

  contextRegistry.destroy(context.id);
  const active = contextRegistry.getActive();
  if (wasActive) {
    onContextSwitched(active);
  } else {
    rewireContextEvents(active);
  }
}

function handleRootUpdated(root: DataRoot): void {
  if (root.type !== 'local') {
    return;
  }

  reconfigureRootContext(root.id);
}

function handleRootActivated(rootId: string): void {
  const root = configManager.getRoot(rootId);
  if (!root) {
    return;
  }

  if (root.type === 'local') {
    const targetContextId = getLocalContextId(root.id);
    const currentContext = contextRegistry.getActive();
    if (!contextRegistry.has(targetContextId)) {
      logger.warn(`Cannot activate local root "${root.id}": context not found`);
      return;
    }

    if (currentContext.id === targetContextId) {
      rewireContextEvents(currentContext);
      return;
    }

    if (currentContext.type === 'ssh') {
      sshConnectionManager.disconnect();
    }

    const { current } = contextRegistry.switch(targetContextId);
    if (currentContext.type === 'ssh' && contextRegistry.has(currentContext.id)) {
      contextRegistry.destroy(currentContext.id);
    }
    onContextSwitched(current);
    return;
  }

  const sshContext = contextRegistry.getByRootId(root.id);
  if (!sshContext) {
    return;
  }

  if (contextRegistry.getActiveContextId() === sshContext.id) {
    rewireContextEvents(sshContext);
    return;
  }

  const { current } = contextRegistry.switch(sshContext.id);
  onContextSwitched(current);
}

/**
 * Initializes all services.
 */
function initializeServices(): void {
  logger.info('Initializing services...');

  // Initialize SSH connection manager
  sshConnectionManager = new SshConnectionManager();

  // Create ServiceContextRegistry
  contextRegistry = new ServiceContextRegistry();
  const startupConfig = configManager.getConfig();
  const localRoots = startupConfig.roots.items
    .filter((root): root is LocalDataRoot => root.type === 'local')
    .sort((a, b) => a.order - b.order);
  if (localRoots.length === 0) {
    throw new Error('No local roots configured');
  }

  for (const localRoot of localRoots) {
    const context = buildLocalContext(localRoot);
    contextRegistry.registerContext(context);
  }

  const activeRoot =
    startupConfig.roots.items.find((root) => root.id === startupConfig.roots.activeRootId) ??
    localRoots[0];
  const activeLocalRoot = activeRoot.type === 'local' ? activeRoot : localRoots[0];
  const activeContextId = getLocalContextId(activeLocalRoot.id);

  if (contextRegistry.getActiveContextId() !== activeContextId) {
    contextRegistry.switch(activeContextId);
  } else {
    contextRegistry.getActive().startFileWatcher();
  }

  const initialContext = contextRegistry.get(activeContextId) ?? contextRegistry.getActive();
  logger.info(`Projects directory: ${initialContext.projectScanner.getProjectsDir()}`);

  // Initialize notification manager (singleton, not context-scoped)
  notificationManager = NotificationManager.getInstance();
  initialContext.fileWatcher.setNotificationManager(notificationManager);
  wireFileWatcherEvents(initialContext);

  // Initialize updater service
  updaterService = new UpdaterService();
  httpServer = new HttpServer();

  // Initialize IPC handlers with registry
  initializeIpcHandlers(contextRegistry, updaterService, sshConnectionManager, {
    rewire: rewireContextEvents,
    full: onContextSwitched,
    onClaudeRootPathUpdated: handleClaudeRootPathUpdated,
    onRootAdded: handleRootAdded,
    onRootRemoved: handleRootRemoved,
    onRootUpdated: handleRootUpdated,
    onRootActivated: handleRootActivated,
  });

  // HTTP Server control IPC handlers
  ipcMain.handle(HTTP_SERVER_START, async () => {
    try {
      if (httpServer.isRunning()) {
        return { success: true, data: { running: true, port: httpServer.getPort() } };
      }
      await startHttpServer(handleModeSwitch);
      // Persist the enabled state
      configManager.updateConfig('httpServer', { enabled: true, port: httpServer.getPort() });
      return { success: true, data: { running: true, port: httpServer.getPort() } };
    } catch (error) {
      logger.error('Failed to start HTTP server via IPC:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start server',
      };
    }
  });

  ipcMain.handle(HTTP_SERVER_STOP, async () => {
    try {
      await httpServer.stop();
      // Persist the disabled state
      configManager.updateConfig('httpServer', { enabled: false });
      return { success: true, data: { running: false, port: httpServer.getPort() } };
    } catch (error) {
      logger.error('Failed to stop HTTP server via IPC:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop server',
      };
    }
  });

  ipcMain.handle(HTTP_SERVER_GET_STATUS, () => {
    return { running: httpServer.isRunning(), port: httpServer.getPort() };
  });

  // Forward SSH state changes to renderer and HTTP SSE clients
  sshConnectionManager.on('state-change', (status: unknown) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(SSH_STATUS, status);
    }
    httpServer.broadcast('ssh:status', status);
  });

  // Forward notification events to HTTP SSE clients
  notificationManager.on('notification-new', (notification: unknown) => {
    httpServer.broadcast('notification:new', notification);
  });
  notificationManager.on('notification-updated', (data: unknown) => {
    httpServer.broadcast('notification:updated', data);
  });
  notificationManager.on('notification-clicked', (data: unknown) => {
    httpServer.broadcast('notification:clicked', data);
  });

  // Start HTTP server if enabled in config
  const appConfig = configManager.getConfig();
  if (appConfig.httpServer?.enabled) {
    void startHttpServer(handleModeSwitch);
  }

  logger.info('Services initialized successfully');
}

/**
 * Starts the HTTP sidecar server with services from the active context.
 */
async function startHttpServer(
  modeSwitchHandler: (mode: 'local' | 'ssh') => Promise<void>
): Promise<void> {
  try {
    const config = configManager.getConfig();
    const services = {
      get projectScanner() {
        return contextRegistry.getActive().projectScanner;
      },
      get sessionParser() {
        return contextRegistry.getActive().sessionParser;
      },
      get subagentResolver() {
        return contextRegistry.getActive().subagentResolver;
      },
      get chunkBuilder() {
        return contextRegistry.getActive().chunkBuilder;
      },
      get dataCache() {
        return contextRegistry.getActive().dataCache;
      },
      contextRegistry,
      updaterService,
      sshConnectionManager,
    };
    const port = await httpServer.start(
      services,
      modeSwitchHandler,
      config.httpServer?.port ?? 3456,
      '127.0.0.1',
      {
        mode: 'electron',
        rootLifecycleCallbacks: {
          onRootAdded: handleRootAdded,
          onRootUpdated: handleRootUpdated,
          onRootRemoved: handleRootRemoved,
          onRootActivated: handleRootActivated,
        },
        onClaudeRootPathUpdated: handleClaudeRootPathUpdated,
        onContextSwitched,
      }
    );
    logger.info(`HTTP sidecar server running on port ${port}`);
  } catch (error) {
    logger.error('Failed to start HTTP server:', error);
  }
}

/**
 * Shuts down all services.
 */
function shutdownServices(): void {
  logger.info('Shutting down services...');

  // Stop HTTP server
  if (httpServer?.isRunning()) {
    void httpServer.stop();
  }

  // Clean up file watcher event listeners
  if (fileChangeCleanup) {
    fileChangeCleanup();
    fileChangeCleanup = null;
  }
  if (todoChangeCleanup) {
    todoChangeCleanup();
    todoChangeCleanup = null;
  }

  // Dispose all contexts (including local)
  if (contextRegistry) {
    contextRegistry.dispose();
  }

  // Dispose SSH connection manager
  if (sshConnectionManager) {
    sshConnectionManager.dispose();
  }

  // Remove IPC handlers
  removeIpcHandlers();

  logger.info('Services shut down successfully');
}

/**
 * Update native traffic-light position and notify renderer of the current zoom factor.
 */
function syncTrafficLightPosition(win: BrowserWindow): void {
  const zoomFactor = win.webContents.getZoomFactor();
  const position = getTrafficLightPositionForZoom(zoomFactor);
  // setWindowButtonPosition is macOS-only (traffic light buttons)
  if (process.platform === 'darwin') {
    win.setWindowButtonPosition(position);
  }
  win.webContents.send(WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL, zoomFactor);
}

/**
 * Creates the main application window.
 */
function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';
  const iconPath = isMac ? undefined : getWindowIconPath();
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    backgroundColor: '#1a1a1a',
    ...(isLinux ? {} : { titleBarStyle: 'hidden' as const }),
    ...(isMac && { trafficLightPosition: getTrafficLightPositionForZoom(1) }),
    title: 'claude-devtools',
  });

  // Load the renderer
  if (process.env.NODE_ENV === 'development') {
    void mainWindow.loadURL(`http://localhost:${DEV_SERVER_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    void mainWindow.loadFile(getRendererIndexPath()).catch((error: unknown) => {
      logger.error('Failed to load renderer entry HTML:', error);
    });
  }

  // Set traffic light position + notify renderer on first load, and auto-check for updates
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      syncTrafficLightPosition(mainWindow);
      // Auto-check for updates 3 seconds after window loads
      setTimeout(() => updaterService.checkForUpdates(), 3000);
    }
  });

  // Log top-level renderer load failures (helps diagnose blank/black window issues in packaged apps)
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) {
        logger.error(
          `Failed to load renderer (code=${errorCode}): ${errorDescription} - ${validatedURL}`
        );
      }
    }
  );

  // Sync traffic light position when zoom changes (Cmd+/-, Cmd+0)
  // zoom-changed event doesn't fire in Electron 40, so we detect zoom keys directly.
  // Also keeps zoom bounds within a practical readability range.
  const MIN_ZOOM_LEVEL = -3; // ~70%
  const MAX_ZOOM_LEVEL = 5;
  const ZOOM_IN_KEYS = new Set(['+', '=']);
  const ZOOM_OUT_KEYS = new Set(['-', '_']);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!input.meta || input.type !== 'keyDown') return;

    const currentLevel = mainWindow.webContents.getZoomLevel();

    // Block zoom-out beyond minimum
    if (ZOOM_OUT_KEYS.has(input.key) && currentLevel <= MIN_ZOOM_LEVEL) {
      event.preventDefault();
      return;
    }
    // Block zoom-in beyond maximum
    if (ZOOM_IN_KEYS.has(input.key) && currentLevel >= MAX_ZOOM_LEVEL) {
      event.preventDefault();
      return;
    }

    // For zoom keys (including Cmd+0 reset), defer sync until zoom is applied
    if (ZOOM_IN_KEYS.has(input.key) || ZOOM_OUT_KEYS.has(input.key) || input.key === '0') {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          syncTrafficLightPosition(mainWindow);
        }
      }, 100);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Clear main window references
    if (notificationManager) {
      notificationManager.setMainWindow(null);
    }
    if (updaterService) {
      updaterService.setMainWindow(null);
    }
  });

  // Handle renderer process crashes (render-process-gone replaces deprecated 'crashed' event)
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error('Renderer process gone:', details.reason, details.exitCode);
    // Could show an error dialog or attempt to reload the window
  });

  // Set main window reference for notification manager and updater
  if (notificationManager) {
    notificationManager.setMainWindow(mainWindow);
  }
  if (updaterService) {
    updaterService.setMainWindow(mainWindow);
  }

  logger.info('Main window created');
}

/**
 * Application ready handler.
 */
void app.whenReady().then(() => {
  logger.info('App ready, initializing...');
  try {
    // Initialize services first
    initializeServices();

    // Apply configuration settings
    const config = configManager.getConfig();

    // Apply launch at login setting
    app.setLoginItemSettings({
      openAtLogin: config.general.launchAtLogin,
    });

    // Apply dock visibility and icon (macOS)
    if (process.platform === 'darwin') {
      if (!config.general.showDockIcon) {
        app.dock?.hide();
      }
      // macOS app icon is already provided by the signed bundle (.icns)
      // so we avoid runtime setIcon calls that can fail and block startup.
    }

    // Then create window
    createWindow();

    // Listen for notification click events
    notificationManager.on('notification-clicked', (_error) => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (error) {
    logger.error('Startup initialization failed:', error);
    if (!mainWindow) {
      createWindow();
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

/**
 * All windows closed handler.
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Before quit handler - cleanup.
 */
app.on('before-quit', () => {
  shutdownServices();
});
