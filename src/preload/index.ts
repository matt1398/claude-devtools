import { WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL } from '@shared/constants';
import { contextBridge, ipcRenderer } from 'electron';

import {
  CONTEXT_CHANGED,
  CONTEXT_GET_ACTIVE,
  CONTEXT_LIST,
  CONTEXT_SWITCH,
  HTTP_SERVER_GET_STATUS,
  HTTP_SERVER_START,
  HTTP_SERVER_STOP,
  SSH_CONNECT,
  SSH_DISCONNECT,
  SSH_GET_CONFIG_HOSTS,
  SSH_GET_LAST_CONNECTION,
  SSH_GET_STATE,
  SSH_RESOLVE_HOST,
  SSH_SAVE_LAST_CONNECTION,
  SSH_STATUS,
  SSH_TEST,
  UPDATER_CHECK,
  UPDATER_DOWNLOAD,
  UPDATER_INSTALL,
  UPDATER_STATUS,
  WINDOW_CLOSE,
  WINDOW_IS_MAXIMIZED,
  WINDOW_MAXIMIZE,
  WINDOW_MINIMIZE,
} from './constants/ipcChannels';
import {
  CONFIG_ADD_IGNORE_REGEX,
  CONFIG_ADD_IGNORE_REPOSITORY,
  CONFIG_ADD_TRIGGER,
  CONFIG_CLEAR_SNOOZE,
  CONFIG_FIND_WSL_CLAUDE_ROOTS,
  CONFIG_GET,
  CONFIG_GET_CLAUDE_ROOT_INFO,
  CONFIG_GET_TRIGGERS,
  CONFIG_HIDE_SESSION,
  CONFIG_HIDE_SESSIONS,
  CONFIG_OPEN_IN_EDITOR,
  CONFIG_PIN_SESSION,
  CONFIG_REMOVE_IGNORE_REGEX,
  CONFIG_REMOVE_IGNORE_REPOSITORY,
  CONFIG_REMOVE_TRIGGER,
  CONFIG_SELECT_CLAUDE_ROOT_FOLDER,
  CONFIG_SELECT_FOLDERS,
  CONFIG_SNOOZE,
  CONFIG_TEST_TRIGGER,
  CONFIG_UNHIDE_SESSION,
  CONFIG_UNHIDE_SESSIONS,
  CONFIG_UNPIN_SESSION,
  CONFIG_UPDATE,
  CONFIG_UPDATE_TRIGGER,
} from './constants/ipcChannels';

import type {
  AppConfig,
  ClaudeRootFolderSelection,
  ClaudeRootInfo,
  ContextInfo,
  ElectronAPI,
  HttpServerStatus,
  NotificationTrigger,
  SessionsByIdsOptions,
  SessionsPaginationOptions,
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionStatus,
  SshLastConnection,
  TriggerTestResult,
  WslClaudeRootCandidate,
} from '@shared/types';

// =============================================================================
// IPC Result Types and Helpers
// =============================================================================

/**
 * Standard IPC result structure returned by main process handlers.
 * All config-related IPC calls return this shape.
 */
interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface IpcFileChangePayload {
  type: 'add' | 'change' | 'unlink';
  path: string;
  projectId?: string;
  sessionId?: string;
  isSubagent: boolean;
}

/**
 * Type-safe IPC invoker for operations that return IpcResult<T>.
 * Throws an Error if the IPC call fails, otherwise returns the typed data.
 */
async function invokeIpcWithResult<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>;
  if (!result.success) {
    throw new Error(result.error ?? 'Unknown error');
  }
  return result.data as T;
}

// Keep latest zoom factor cached even before renderer UI subscribes.
let currentZoomFactor = 1;
ipcRenderer.on(
  WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL,
  (_event: Electron.IpcRendererEvent, zoomFactor: unknown) => {
    if (typeof zoomFactor === 'number' && Number.isFinite(zoomFactor)) {
      currentZoomFactor = zoomFactor;
    }
  }
);

// =============================================================================
// Electron API Implementation
// =============================================================================

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI: ElectronAPI = {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getSessions: (projectId: string) => ipcRenderer.invoke('get-sessions', projectId),
  getSessionsPaginated: (
    projectId: string,
    cursor: string | null,
    limit?: number,
    options?: SessionsPaginationOptions
  ) => ipcRenderer.invoke('get-sessions-paginated', projectId, cursor, limit, options),
  searchSessions: (projectId: string, query: string, maxResults?: number) =>
    ipcRenderer.invoke('search-sessions', projectId, query, maxResults),
  getSessionDetail: (projectId: string, sessionId: string) =>
    ipcRenderer.invoke('get-session-detail', projectId, sessionId),
  getSessionMetrics: (projectId: string, sessionId: string) =>
    ipcRenderer.invoke('get-session-metrics', projectId, sessionId),
  getWaterfallData: (projectId: string, sessionId: string) =>
    ipcRenderer.invoke('get-waterfall-data', projectId, sessionId),
  getSubagentDetail: (projectId: string, sessionId: string, subagentId: string) =>
    ipcRenderer.invoke('get-subagent-detail', projectId, sessionId, subagentId),
  getSessionGroups: (projectId: string, sessionId: string) =>
    ipcRenderer.invoke('get-session-groups', projectId, sessionId),
  getSessionsByIds: (projectId: string, sessionIds: string[], options?: SessionsByIdsOptions) =>
    ipcRenderer.invoke('get-sessions-by-ids', projectId, sessionIds, options),

  // Repository grouping (worktree support)
  getRepositoryGroups: () => ipcRenderer.invoke('get-repository-groups'),
  getWorktreeSessions: (worktreeId: string) =>
    ipcRenderer.invoke('get-worktree-sessions', worktreeId),

  // Validation methods
  validatePath: (relativePath: string, projectPath: string) =>
    ipcRenderer.invoke('validate-path', relativePath, projectPath),
  validateMentions: (mentions: { type: 'path'; value: string }[], projectPath: string) =>
    ipcRenderer.invoke('validate-mentions', mentions, projectPath),

  // CLAUDE.md reading methods
  readClaudeMdFiles: (projectRoot: string) =>
    ipcRenderer.invoke('read-claude-md-files', projectRoot),
  readDirectoryClaudeMd: (dirPath: string) =>
    ipcRenderer.invoke('read-directory-claude-md', dirPath),
  readMentionedFile: (absolutePath: string, projectRoot: string, maxTokens?: number) =>
    ipcRenderer.invoke('read-mentioned-file', absolutePath, projectRoot, maxTokens),

  // Notifications API
  notifications: {
    get: (options?: { limit?: number; offset?: number }) =>
      ipcRenderer.invoke('notifications:get', options),
    markRead: (id: string) => ipcRenderer.invoke('notifications:markRead', id),
    markAllRead: () => ipcRenderer.invoke('notifications:markAllRead'),
    delete: (id: string) => ipcRenderer.invoke('notifications:delete', id),
    clear: () => ipcRenderer.invoke('notifications:clear'),
    getUnreadCount: () => ipcRenderer.invoke('notifications:getUnreadCount'),
    onNew: (callback: (event: unknown, error: unknown) => void): (() => void) => {
      ipcRenderer.on(
        'notification:new',
        callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
      );
      return (): void => {
        ipcRenderer.removeListener(
          'notification:new',
          callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
        );
      };
    },
    onUpdated: (
      callback: (event: unknown, payload: { total: number; unreadCount: number }) => void
    ): (() => void) => {
      ipcRenderer.on(
        'notification:updated',
        callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
      );
      return (): void => {
        ipcRenderer.removeListener(
          'notification:updated',
          callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
        );
      };
    },
    onClicked: (callback: (event: unknown, data: unknown) => void): (() => void) => {
      ipcRenderer.on(
        'notification:clicked',
        callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
      );
      return (): void => {
        ipcRenderer.removeListener(
          'notification:clicked',
          callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
        );
      };
    },
  },

  // Config API - uses typed helper to unwrap { success, data, error } responses
  config: {
    get: async (): Promise<AppConfig> => {
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    update: async (section: string, data: object): Promise<AppConfig> => {
      return invokeIpcWithResult<AppConfig>(CONFIG_UPDATE, section, data);
    },
    addIgnoreRegex: async (pattern: string): Promise<AppConfig> => {
      await invokeIpcWithResult<void>(CONFIG_ADD_IGNORE_REGEX, pattern);
      // Re-fetch config after mutation
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    removeIgnoreRegex: async (pattern: string): Promise<AppConfig> => {
      await invokeIpcWithResult<void>(CONFIG_REMOVE_IGNORE_REGEX, pattern);
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    addIgnoreRepository: async (repositoryId: string): Promise<AppConfig> => {
      await invokeIpcWithResult<void>(CONFIG_ADD_IGNORE_REPOSITORY, repositoryId);
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    removeIgnoreRepository: async (repositoryId: string): Promise<AppConfig> => {
      await invokeIpcWithResult<void>(CONFIG_REMOVE_IGNORE_REPOSITORY, repositoryId);
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    snooze: async (minutes: number): Promise<AppConfig> => {
      await invokeIpcWithResult<void>(CONFIG_SNOOZE, minutes);
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    clearSnooze: async (): Promise<AppConfig> => {
      await invokeIpcWithResult<void>(CONFIG_CLEAR_SNOOZE);
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    addTrigger: async (trigger: Omit<NotificationTrigger, 'isBuiltin'>): Promise<AppConfig> => {
      await invokeIpcWithResult<void>(CONFIG_ADD_TRIGGER, trigger);
      // Return updated config
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    updateTrigger: async (
      triggerId: string,
      updates: Partial<NotificationTrigger>
    ): Promise<AppConfig> => {
      await invokeIpcWithResult<void>(CONFIG_UPDATE_TRIGGER, triggerId, updates);
      // Return updated config
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    removeTrigger: async (triggerId: string): Promise<AppConfig> => {
      await invokeIpcWithResult<void>(CONFIG_REMOVE_TRIGGER, triggerId);
      // Return updated config
      return invokeIpcWithResult<AppConfig>(CONFIG_GET);
    },
    getTriggers: async (): Promise<NotificationTrigger[]> => {
      return invokeIpcWithResult<NotificationTrigger[]>(CONFIG_GET_TRIGGERS);
    },
    testTrigger: async (trigger: NotificationTrigger): Promise<TriggerTestResult> => {
      return invokeIpcWithResult<TriggerTestResult>(CONFIG_TEST_TRIGGER, trigger);
    },
    selectFolders: async (): Promise<string[]> => {
      return invokeIpcWithResult<string[]>(CONFIG_SELECT_FOLDERS);
    },
    selectClaudeRootFolder: async (): Promise<ClaudeRootFolderSelection | null> => {
      return invokeIpcWithResult<ClaudeRootFolderSelection | null>(
        CONFIG_SELECT_CLAUDE_ROOT_FOLDER
      );
    },
    getClaudeRootInfo: async (): Promise<ClaudeRootInfo> => {
      return invokeIpcWithResult<ClaudeRootInfo>(CONFIG_GET_CLAUDE_ROOT_INFO);
    },
    findWslClaudeRoots: async (): Promise<WslClaudeRootCandidate[]> => {
      return invokeIpcWithResult<WslClaudeRootCandidate[]>(CONFIG_FIND_WSL_CLAUDE_ROOTS);
    },
    openInEditor: async (): Promise<void> => {
      return invokeIpcWithResult<void>(CONFIG_OPEN_IN_EDITOR);
    },
    pinSession: async (projectId: string, sessionId: string): Promise<void> => {
      return invokeIpcWithResult<void>(CONFIG_PIN_SESSION, projectId, sessionId);
    },
    unpinSession: async (projectId: string, sessionId: string): Promise<void> => {
      return invokeIpcWithResult<void>(CONFIG_UNPIN_SESSION, projectId, sessionId);
    },
    hideSession: async (projectId: string, sessionId: string): Promise<void> => {
      return invokeIpcWithResult<void>(CONFIG_HIDE_SESSION, projectId, sessionId);
    },
    unhideSession: async (projectId: string, sessionId: string): Promise<void> => {
      return invokeIpcWithResult<void>(CONFIG_UNHIDE_SESSION, projectId, sessionId);
    },
    hideSessions: async (projectId: string, sessionIds: string[]): Promise<void> => {
      return invokeIpcWithResult<void>(CONFIG_HIDE_SESSIONS, projectId, sessionIds);
    },
    unhideSessions: async (projectId: string, sessionIds: string[]): Promise<void> => {
      return invokeIpcWithResult<void>(CONFIG_UNHIDE_SESSIONS, projectId, sessionIds);
    },
  },

  // Deep link navigation
  session: {
    scrollToLine: (sessionId: string, lineNumber: number) =>
      ipcRenderer.invoke('session:scrollToLine', sessionId, lineNumber),
  },

  // Zoom factor sync (used for traffic-light-safe layout)
  getZoomFactor: async (): Promise<number> => currentZoomFactor,
  onZoomFactorChanged: (callback: (zoomFactor: number) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, zoomFactor: unknown): void => {
      if (typeof zoomFactor !== 'number' || !Number.isFinite(zoomFactor)) return;
      currentZoomFactor = zoomFactor;
      callback(zoomFactor);
    };
    ipcRenderer.on(WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL, listener);
    return (): void => {
      ipcRenderer.removeListener(WINDOW_ZOOM_FACTOR_CHANGED_CHANNEL, listener);
    };
  },

  // File change events (real-time updates)
  onFileChange: (callback: (event: IpcFileChangePayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: IpcFileChangePayload): void =>
      callback(data);
    ipcRenderer.on('file-change', listener);
    return (): void => {
      ipcRenderer.removeListener('file-change', listener);
    };
  },

  // Shell operations
  openPath: (targetPath: string, projectRoot?: string) =>
    ipcRenderer.invoke('shell:openPath', targetPath, projectRoot),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  // Window controls (when title bar is hidden, e.g. Windows / Linux)
  windowControls: {
    minimize: () => ipcRenderer.invoke(WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(WINDOW_CLOSE),
    isMaximized: () => ipcRenderer.invoke(WINDOW_IS_MAXIMIZED) as Promise<boolean>,
  },

  onTodoChange: (callback: (event: IpcFileChangePayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: IpcFileChangePayload): void =>
      callback(data);
    ipcRenderer.on('todo-change', listener);
    return (): void => {
      ipcRenderer.removeListener('todo-change', listener);
    };
  },

  // Updater API
  updater: {
    check: () => ipcRenderer.invoke(UPDATER_CHECK),
    download: () => ipcRenderer.invoke(UPDATER_DOWNLOAD),
    install: () => ipcRenderer.invoke(UPDATER_INSTALL),
    onStatus: (callback: (event: unknown, status: unknown) => void): (() => void) => {
      ipcRenderer.on(
        UPDATER_STATUS,
        callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
      );
      return (): void => {
        ipcRenderer.removeListener(
          UPDATER_STATUS,
          callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
        );
      };
    },
  },

  // SSH API
  ssh: {
    connect: async (config: SshConnectionConfig): Promise<SshConnectionStatus> => {
      return invokeIpcWithResult<SshConnectionStatus>(SSH_CONNECT, config);
    },
    disconnect: async (): Promise<SshConnectionStatus> => {
      return invokeIpcWithResult<SshConnectionStatus>(SSH_DISCONNECT);
    },
    getState: async (): Promise<SshConnectionStatus> => {
      return invokeIpcWithResult<SshConnectionStatus>(SSH_GET_STATE);
    },
    test: async (config: SshConnectionConfig): Promise<{ success: boolean; error?: string }> => {
      return invokeIpcWithResult<{ success: boolean; error?: string }>(SSH_TEST, config);
    },
    getConfigHosts: async (): Promise<SshConfigHostEntry[]> => {
      return invokeIpcWithResult<SshConfigHostEntry[]>(SSH_GET_CONFIG_HOSTS);
    },
    resolveHost: async (alias: string): Promise<SshConfigHostEntry | null> => {
      return invokeIpcWithResult<SshConfigHostEntry | null>(SSH_RESOLVE_HOST, alias);
    },
    saveLastConnection: async (config: SshLastConnection): Promise<void> => {
      return invokeIpcWithResult<void>(SSH_SAVE_LAST_CONNECTION, config);
    },
    getLastConnection: async (): Promise<SshLastConnection | null> => {
      return invokeIpcWithResult<SshLastConnection | null>(SSH_GET_LAST_CONNECTION);
    },
    onStatus: (callback: (event: unknown, status: SshConnectionStatus) => void): (() => void) => {
      ipcRenderer.on(
        SSH_STATUS,
        callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
      );
      return (): void => {
        ipcRenderer.removeListener(
          SSH_STATUS,
          callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
        );
      };
    },
  },

  // Context API
  context: {
    list: async (): Promise<ContextInfo[]> => {
      return invokeIpcWithResult<ContextInfo[]>(CONTEXT_LIST);
    },
    getActive: async (): Promise<string> => {
      return invokeIpcWithResult<string>(CONTEXT_GET_ACTIVE);
    },
    switch: async (contextId: string): Promise<{ contextId: string }> => {
      return invokeIpcWithResult<{ contextId: string }>(CONTEXT_SWITCH, contextId);
    },
    onChanged: (callback: (event: unknown, data: ContextInfo) => void): (() => void) => {
      ipcRenderer.on(
        CONTEXT_CHANGED,
        callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
      );
      return (): void => {
        ipcRenderer.removeListener(
          CONTEXT_CHANGED,
          callback as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
        );
      };
    },
  },

  // HTTP Server API
  httpServer: {
    start: async (): Promise<HttpServerStatus> => {
      return invokeIpcWithResult<HttpServerStatus>(HTTP_SERVER_START);
    },
    stop: async (): Promise<HttpServerStatus> => {
      return invokeIpcWithResult<HttpServerStatus>(HTTP_SERVER_STOP);
    },
    getStatus: async (): Promise<HttpServerStatus> => {
      return invokeIpcWithResult<HttpServerStatus>(HTTP_SERVER_GET_STATUS);
    },
  },
};

// Use contextBridge to securely expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
