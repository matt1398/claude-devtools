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

import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  DEV_SERVER_PORT,
  getTrafficLightPositionForZoom,
  WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL,
} from '@shared/constants';
import { createLogger } from '@shared/utils/logger';
import { app, BrowserWindow, ipcMain } from 'electron';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { homedir, totalmem } from 'os';
import { join } from 'path';

/**
 * Append a timestamped entry to ~/.claude/claude-devtools-crash.log.
 * Uses sync I/O because crashes may happen in unstable states.
 */
function writeCrashLog(label: string, details: Record<string, unknown>): void {
  try {
    const dir = join(homedir(), '.claude');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const logPath = join(dir, 'claude-devtools-crash.log');
    const entry =
      `[${new Date().toISOString()}] ${label}\n` +
      Object.entries(details)
        .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('\n') +
      '\n\n';
    appendFileSync(logPath, entry, 'utf-8');
  } catch {
    // Best-effort — don't throw during crash handling
  }
}

import { initializeIpcHandlers, removeIpcHandlers } from './ipc/handlers';
import { getProjectsBasePath, getTodosBasePath } from './utils/pathDecoder';

// Dynamic renderer heap limit — proportional to system RAM so low-end devices
// are not starved.  50% of total RAM, clamped to [2 GB, 4 GB].
// Must run before app.whenReady() so the flag is picked up by the renderer.
const totalMB = Math.floor(totalmem() / (1024 * 1024));
const heapMB = Math.min(4096, Math.max(2048, Math.floor(totalMB * 0.5)));
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${heapMB}`);

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
  writeCrashLog('UNHANDLED_REJECTION (main)', {
    reason: reason instanceof Error ? reason.stack ?? reason.message : String(reason),
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception in main process:', error);
  writeCrashLog('UNCAUGHT_EXCEPTION (main)', {
    message: error.message,
    stack: error.stack ?? '',
  });
});

import { HttpServer } from './services/infrastructure/HttpServer';
import {
  configManager,
  configManagerPromise,
  LocalFileSystemProvider,
  NotificationManager,
  ServiceContext,
  ServiceContextRegistry,
  SshConnectionManager,
  UpdaterService,
} from './services';

// =============================================================================
// Application State
// =============================================================================

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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
  if (mode === 'local' && contextRegistry.getActiveContextId() !== 'local') {
    const { current } = contextRegistry.switch('local');
    onContextSwitched(current);
  }
}

/**
 * Re-wires file watcher events only. No renderer notification.
 * Used for renderer-initiated switches where the renderer already handles state.
 */
export function rewireContextEvents(context: ServiceContext): void {
  wireFileWatcherEvents(context);
}

/**
 * Full callback: re-wire + notify renderer.
 * Used for external/unexpected switches (e.g., HTTP server mode switch).
 */
function onContextSwitched(context: ServiceContext): void {
  rewireContextEvents(context);

  // Notify renderer of context change
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(SSH_STATUS, sshConnectionManager.getStatus());
    mainWindow.webContents.send(CONTEXT_CHANGED, {
      id: context.id,
      type: context.type,
    });
  }
}

/**
 * Rebuilds the local ServiceContext using the current configured Claude root paths.
 * Called when general.claudeRootPath changes.
 */
function reconfigureLocalContextForClaudeRoot(): void {
  try {
    const currentLocal = contextRegistry.get('local');
    if (!currentLocal) {
      logger.error('Cannot reconfigure local context: local context not found');
      return;
    }

    const wasLocalActive = contextRegistry.getActiveContextId() === 'local';
    const projectsDir = getProjectsBasePath();
    const todosDir = getTodosBasePath();

    logger.info(`Reconfiguring local context: projectsDir=${projectsDir}, todosDir=${todosDir}`);

    if (wasLocalActive) {
      currentLocal.stopFileWatcher();
    }

    const replacementLocal = new ServiceContext({
      id: 'local',
      type: 'local',
      fsProvider: new LocalFileSystemProvider(),
      projectsDir,
      todosDir,
    });

    if (notificationManager) {
      replacementLocal.fileWatcher.setNotificationManager(notificationManager);
    }
    replacementLocal.start();

    if (!wasLocalActive) {
      replacementLocal.stopFileWatcher();
    }

    contextRegistry.replaceContext('local', replacementLocal);

    if (wasLocalActive) {
      wireFileWatcherEvents(replacementLocal);
    }
  } catch (error) {
    logger.error('Failed to reconfigure local context for Claude root change:', error);
  }
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

  const localProjectsDir = getProjectsBasePath();
  const localTodosDir = getTodosBasePath();

  // Create local context
  const localContext = new ServiceContext({
    id: 'local',
    type: 'local',
    fsProvider: new LocalFileSystemProvider(),
    projectsDir: localProjectsDir,
    todosDir: localTodosDir,
  });

  // Register and start local context
  contextRegistry.registerContext(localContext);
  localContext.start();

  logger.info(`Projects directory: ${localContext.projectScanner.getProjectsDir()}`);

  // Initialize notification manager (singleton, not context-scoped)
  notificationManager = NotificationManager.getInstance();

  // Set notification manager on local context's file watcher
  localContext.fileWatcher.setNotificationManager(notificationManager);

  // Wire file watcher events for local context
  wireFileWatcherEvents(localContext);

  // Initialize updater service
  updaterService = new UpdaterService();
  httpServer = new HttpServer();

  // Initialize IPC handlers with registry
  initializeIpcHandlers(contextRegistry, updaterService, sshConnectionManager, {
    rewire: rewireContextEvents,
    full: onContextSwitched,
    onClaudeRootPathUpdated: (_claudeRootPath: string | null) => {
      reconfigureLocalContextForClaudeRoot();
    },
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
    return { success: true, data: { running: httpServer.isRunning(), port: httpServer.getPort() } };
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
    const activeContext = contextRegistry.getActive();
    const port = await httpServer.start(
      {
        projectScanner: activeContext.projectScanner,
        sessionParser: activeContext.sessionParser,
        subagentResolver: activeContext.subagentResolver,
        chunkBuilder: activeContext.chunkBuilder,
        dataCache: activeContext.dataCache,
        subagentMessageCache: activeContext.subagentMessageCache,
        updaterService,
        sshConnectionManager,
      },
      modeSwitchHandler,
      config.httpServer?.port ?? 3456
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
  const iconPath = isMac ? undefined : getWindowIconPath();
  const useNativeTitleBar = !isMac && configManager.getConfig().general.useNativeTitleBar;
  mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
    backgroundColor: '#1a1a1a',
    ...(useNativeTitleBar ? {} : { titleBarStyle: 'hidden' as const }),
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

    if (input.type !== 'keyDown') return;

    // Intercept Ctrl+R / Cmd+R to prevent Chromium's built-in page reload,
    // then notify the renderer via IPC so it can refresh the session (fixes #58, #85).
    // We must preventDefault here because Chromium handles Ctrl+R at the browser
    // engine level, which also blocks the keydown from reaching the renderer —
    // hence the IPC bridge.
    if ((input.control || input.meta) && !input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      mainWindow.webContents.send('session:refresh');
      return;
    }
    // Also block Ctrl+Shift+R (hard reload)
    if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault();
      return;
    }

    if (!input.meta) return;

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

  // Handle renderer process crashes with retry cap to prevent crash loops.
  // Only auto-reload for recoverable reasons (crashed, oom, memory-eviction).
  // After 3 failures within 60s, stop reloading to avoid infinite loops.
  let crashCount = 0;
  let crashWindowStart = Date.now();
  const MAX_CRASHES = 3;
  const CRASH_WINDOW_MS = 60_000;
  const RECOVERABLE_REASONS = new Set(['crashed', 'oom', 'memory-eviction']);

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const memUsage = process.memoryUsage();
    logger.error('Renderer process gone:', details.reason, details.exitCode);
    writeCrashLog('RENDERER_PROCESS_GONE', {
      reason: details.reason,
      exitCode: details.exitCode,
      mainProcessRssMB: Math.round(memUsage.rss / 1024 / 1024),
      mainProcessHeapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      mainProcessHeapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      uptime: `${Math.round(process.uptime())}s`,
    });

    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    if (!RECOVERABLE_REASONS.has(details.reason)) return;

    // Reset crash counter if outside window
    const now = Date.now();
    if (now - crashWindowStart > CRASH_WINDOW_MS) {
      crashCount = 0;
      crashWindowStart = now;
    }
    crashCount++;

    if (crashCount > MAX_CRASHES) {
      logger.error(
        `Renderer crashed ${crashCount} times in ${CRASH_WINDOW_MS / 1000}s — not reloading`
      );
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      void mainWindow.loadURL(`http://localhost:${DEV_SERVER_PORT}`);
    } else {
      void mainWindow.loadFile(getRendererIndexPath());
    }
  });

  // Log renderer console errors (captures uncaught errors from the renderer process).
  // ResizeObserver loop errors are benign Chromium noise — skip them to keep the log clean.
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    // level 3 = error
    if (level >= 3) {
      if (message.includes('ResizeObserver loop')) return;
      writeCrashLog('RENDERER_CONSOLE_ERROR', {
        message,
        source: `${sourceId}:${line}`,
      });
    }
  });

  // Proactive unresponsive recovery.
  // When the renderer freezes, the Linux desktop environment (GNOME/KDE) may show its
  // own "Force Quit" dialog and kill the entire process tree. We race that by
  // force-reloading the renderer after UNRESPONSIVE_RELOAD_MS. If the renderer
  // becomes responsive again before the timer fires, we cancel the reload.
  // Capped at MAX_UNRESPONSIVE_RELOADS within UNRESPONSIVE_WINDOW_MS to prevent
  // infinite reload loops when a large session freezes the renderer on every load.
  const UNRESPONSIVE_RELOAD_MS = 10_000;
  const MAX_UNRESPONSIVE_RELOADS = 3;
  const UNRESPONSIVE_WINDOW_MS = 120_000; // 2 minutes
  let unresponsiveTimer: ReturnType<typeof setTimeout> | null = null;
  let unresponsiveReloadCount = 0;
  let unresponsiveWindowStart = Date.now();

  mainWindow.on('unresponsive', () => {
    const memUsage = process.memoryUsage();
    logger.error('Renderer became unresponsive');
    writeCrashLog('RENDERER_UNRESPONSIVE', {
      note: 'Window stopped responding — will force-reload in 10s unless it recovers',
      mainProcessRssMB: Math.round(memUsage.rss / 1024 / 1024),
      mainProcessHeapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      mainProcessHeapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      uptime: `${Math.round(process.uptime())}s`,
    });

    // Don't stack multiple timers
    if (unresponsiveTimer) return;

    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null;
      if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;

      // Reset counter if outside the window
      const now = Date.now();
      if (now - unresponsiveWindowStart > UNRESPONSIVE_WINDOW_MS) {
        unresponsiveReloadCount = 0;
        unresponsiveWindowStart = now;
      }
      unresponsiveReloadCount++;

      if (unresponsiveReloadCount > MAX_UNRESPONSIVE_RELOADS) {
        logger.error(
          `Renderer unresponsive ${unresponsiveReloadCount} times in ${UNRESPONSIVE_WINDOW_MS / 1000}s — not reloading`
        );
        writeCrashLog('RENDERER_RELOAD_CAP_REACHED', {
          reason: `${unresponsiveReloadCount} unresponsive reloads in ${UNRESPONSIVE_WINDOW_MS / 1000}s`,
          uptime: `${Math.round(process.uptime())}s`,
        });
        return;
      }

      logger.error('Renderer still unresponsive after 10s — force-reloading');
      writeCrashLog('RENDERER_FORCE_RELOAD', {
        reason: 'Unresponsive timeout expired',
        attempt: unresponsiveReloadCount,
        uptime: `${Math.round(process.uptime())}s`,
      });

      if (process.env.NODE_ENV === 'development') {
        void mainWindow.loadURL(`http://localhost:${DEV_SERVER_PORT}`);
      } else {
        void mainWindow.loadFile(getRendererIndexPath());
      }
    }, UNRESPONSIVE_RELOAD_MS);
  });

  mainWindow.on('responsive', () => {
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer);
      unresponsiveTimer = null;
      logger.info('Renderer became responsive again — cancelled force-reload');
    }
  });

  // Set main window reference for notification manager and updater
  if (notificationManager) {
    notificationManager.setMainWindow(mainWindow);
  }
  if (updaterService) {
    updaterService.setMainWindow(mainWindow);
  }

  // Periodic memory monitoring via app.getAppMetrics().
  // Logs all-process memory every 5 minutes so we have data leading up to crashes.
  // Warns when the renderer exceeds 2 GB.
  const MEMORY_CHECK_INTERVAL_MS = 5 * 60_000;
  const RENDERER_MEMORY_WARNING_KB = 2048 * 1024; // 2 GB in KB
  const memoryMonitorInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const metrics = app.getAppMetrics();
      const mainMem = process.memoryUsage();
      const mainRssMB = Math.round(mainMem.rss / 1024 / 1024);
      const mainHeapMB = Math.round(mainMem.heapUsed / 1024 / 1024);

      // Find the renderer process (type 'Tab' or matching the window's pid)
      const rendererPid = mainWindow.webContents.getOSProcessId();
      const rendererMetric = metrics.find((m) => m.pid === rendererPid);
      const rendererMemKB = rendererMetric?.memory?.workingSetSize ?? 0;
      const rendererMB = Math.round(rendererMemKB / 1024);

      logger.info(
        `Memory: renderer=${rendererMB}MB, main RSS=${mainRssMB}MB heap=${mainHeapMB}MB, uptime=${Math.round(process.uptime())}s`
      );

      if (rendererMemKB > RENDERER_MEMORY_WARNING_KB) {
        writeCrashLog('RENDERER_MEMORY_WARNING', {
          rendererMB,
          mainRssMB,
          mainHeapMB,
          uptime: `${Math.round(process.uptime())}s`,
        });
      }
    } catch {
      // Renderer might be crashed/reloading — skip this check
    }
  }, MEMORY_CHECK_INTERVAL_MS);
  memoryMonitorInterval.unref(); // Don't prevent app exit

  logger.info('Main window created');
}

/**
 * Application ready handler.
 */
void app.whenReady().then(async () => {
  logger.info('App ready, initializing...');
  try {
    // Wait for config to finish loading from disk before using it
    await configManagerPromise;

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
 * Before quit handler - set flag and cleanup services.
 */
app.on('before-quit', () => {
  isQuitting = true;
  shutdownServices();
});
