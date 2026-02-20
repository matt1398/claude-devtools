/**
 * HTTP-based implementation of ElectronAPI for browser mode.
 *
 * Replaces Electron IPC with fetch() for request/response and
 * EventSource (SSE) for real-time events. Allows the renderer
 * to run in a regular browser connected to an HTTP server.
 */

import type {
  AppConfig,
  ClaudeMdFileInfo,
  ClaudeRootFolderSelection,
  ClaudeRootInfo,
  ConfigAPI,
  ContextInfo,
  ConversationGroup,
  ElectronAPI,
  FileChangeEvent,
  HttpServerAPI,
  HttpServerStatus,
  NotificationsAPI,
  NotificationTrigger,
  PaginatedSessionsResult,
  Project,
  RepositoryGroup,
  SearchSessionsResult,
  Session,
  SessionAPI,
  SessionDetail,
  SessionMetrics,
  SessionsByIdsOptions,
  SessionsPaginationOptions,
  SshAPI,
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionStatus,
  SshLastConnection,
  SubagentDetail,
  TriggerTestResult,
  UpdaterAPI,
  WaterfallData,
  WslClaudeRootCandidate,
} from '@shared/types';
import type { LocalDataRoot, SshDataRoot } from '@shared/types/roots';

export class HttpAPIClient implements ElectronAPI {
  private baseUrl: string;
  private eventSource: EventSource | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event callbacks have varying signatures
  private eventListeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.initEventSource();
  }

  // ---------------------------------------------------------------------------
  // SSE event infrastructure
  // ---------------------------------------------------------------------------

  private initEventSource(): void {
    this.eventSource = new EventSource(`${this.baseUrl}/api/events`);
    this.eventSource.onopen = () => console.log('[HttpAPIClient] SSE connected');
    this.eventSource.onerror = () => {
      // Auto-reconnect is built into EventSource
      console.warn('[HttpAPIClient] SSE connection error, will reconnect...');
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- event callbacks have varying signatures
  private addEventListener(channel: string, callback: (...args: any[]) => void): () => void {
    if (!this.eventListeners.has(channel)) {
      this.eventListeners.set(channel, new Set());
      // Register SSE listener for this channel once
      this.eventSource?.addEventListener(channel, ((event: MessageEvent) => {
        const data: unknown = JSON.parse(event.data as string);
        const listeners = this.eventListeners.get(channel);
        listeners?.forEach((cb) => cb(data));
      }) as EventListener);
    }
    this.eventListeners.get(channel)!.add(callback);

    return () => {
      this.eventListeners.get(channel)?.delete(callback);
    };
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * JSON reviver that converts ISO 8601 date strings back to Date objects.
   * Electron IPC preserves Date instances via structured clone, but HTTP JSON
   * serialization turns them into strings. This restores them so that
   * `.getTime()` and other Date methods work in the renderer.
   */
  // eslint-disable-next-line security/detect-unsafe-regex -- anchored pattern with bounded quantifier; no backtracking risk
  private static readonly ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?$/;

  private static reviveDates(_key: string, value: unknown): unknown {
    if (typeof value === 'string' && HttpAPIClient.ISO_DATE_RE.test(value)) {
      const d = new Date(value);
      if (!isNaN(d.getTime())) return d;
    }
    return value;
  }

  private async parseJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      const parsed = JSON.parse(text) as { error?: string };
      throw new Error(parsed.error ?? `HTTP ${res.status}`);
    }
    return JSON.parse(text, (key, value) => HttpAPIClient.reviveDates(key, value)) as T;
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, { signal: controller.signal });
      return this.parseJson<T>(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return this.parseJson<T>(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async del<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return this.parseJson<T>(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async put<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      return this.parseJson<T>(res);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------------------------------------------------------------------------
  // Core session/project APIs
  // ---------------------------------------------------------------------------

  getAppVersion = (): Promise<string> => this.get<string>('/api/version');

  getProjects = (): Promise<Project[]> => this.get<Project[]>('/api/projects');

  getSessions = (projectId: string): Promise<Session[]> =>
    this.get<Session[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions`);

  getSessionsPaginated = (
    projectId: string,
    cursor: string | null,
    limit?: number,
    options?: SessionsPaginationOptions
  ): Promise<PaginatedSessionsResult> => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    if (options?.includeTotalCount === false) params.set('includeTotalCount', 'false');
    if (options?.prefilterAll === false) params.set('prefilterAll', 'false');
    if (options?.metadataLevel) params.set('metadataLevel', options.metadataLevel);
    const qs = params.toString();
    const encodedId = encodeURIComponent(projectId);
    const path = `/api/projects/${encodedId}/sessions-paginated`;
    return this.get<PaginatedSessionsResult>(qs ? `${path}?${qs}` : path);
  };

  getCombinedSessionsPaginated = (
    cursor: string | null,
    limit?: number
  ): Promise<PaginatedSessionsResult> => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    const queryString = params.toString();
    const path = '/api/sessions/combined';
    return this.get<PaginatedSessionsResult>(queryString ? `${path}?${queryString}` : path);
  };

  searchSessions = (
    projectId: string,
    query: string,
    maxResults?: number
  ): Promise<SearchSessionsResult> => {
    const params = new URLSearchParams({ q: query });
    if (maxResults) params.set('maxResults', String(maxResults));
    return this.get<SearchSessionsResult>(
      `/api/projects/${encodeURIComponent(projectId)}/search?${params}`
    );
  };

  getSessionDetail = (projectId: string, sessionId: string): Promise<SessionDetail | null> =>
    this.get<SessionDetail | null>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`
    );

  getSessionMetrics = (projectId: string, sessionId: string): Promise<SessionMetrics | null> =>
    this.get<SessionMetrics | null>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/metrics`
    );

  getWaterfallData = (projectId: string, sessionId: string): Promise<WaterfallData | null> =>
    this.get<WaterfallData | null>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/waterfall`
    );

  getSubagentDetail = (
    projectId: string,
    sessionId: string,
    subagentId: string
  ): Promise<SubagentDetail | null> =>
    this.get<SubagentDetail | null>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}`
    );

  getSessionGroups = (projectId: string, sessionId: string): Promise<ConversationGroup[]> =>
    this.get<ConversationGroup[]>(
      `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/groups`
    );

  getSessionsByIds = (
    projectId: string,
    sessionIds: string[],
    options?: SessionsByIdsOptions
  ): Promise<Session[]> =>
    this.post<Session[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions-by-ids`, {
      sessionIds,
      metadataLevel: options?.metadataLevel,
    });

  // ---------------------------------------------------------------------------
  // Repository grouping
  // ---------------------------------------------------------------------------

  getRepositoryGroups = (): Promise<RepositoryGroup[]> =>
    this.get<RepositoryGroup[]>('/api/repository-groups');

  getWorktreeSessions = (worktreeId: string): Promise<Session[]> =>
    this.get<Session[]>(`/api/worktrees/${encodeURIComponent(worktreeId)}/sessions`);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  validatePath = (
    relativePath: string,
    projectPath: string
  ): Promise<{ exists: boolean; isDirectory?: boolean }> =>
    this.post<{ exists: boolean; isDirectory?: boolean }>('/api/validate/path', {
      relativePath,
      projectPath,
    });

  validateMentions = (
    mentions: { type: 'path'; value: string }[],
    projectPath: string
  ): Promise<Record<string, boolean>> =>
    this.post<Record<string, boolean>>('/api/validate/mentions', { mentions, projectPath });

  // ---------------------------------------------------------------------------
  // CLAUDE.md reading
  // ---------------------------------------------------------------------------

  readClaudeMdFiles = (projectRoot: string): Promise<Record<string, ClaudeMdFileInfo>> =>
    this.post<Record<string, ClaudeMdFileInfo>>('/api/read-claude-md', { projectRoot });

  readDirectoryClaudeMd = (dirPath: string): Promise<ClaudeMdFileInfo> =>
    this.post<ClaudeMdFileInfo>('/api/read-directory-claude-md', { dirPath });

  readMentionedFile = (
    absolutePath: string,
    projectRoot: string,
    maxTokens?: number
  ): Promise<ClaudeMdFileInfo | null> =>
    this.post<ClaudeMdFileInfo | null>('/api/read-mentioned-file', {
      absolutePath,
      projectRoot,
      maxTokens,
    });

  // ---------------------------------------------------------------------------
  // Notifications (nested API)
  // ---------------------------------------------------------------------------

  notifications: NotificationsAPI = {
    get: (options) =>
      this.get(
        `/api/notifications?${new URLSearchParams(
          options
            ? {
                limit: String(options.limit ?? 20),
                offset: String(options.offset ?? 0),
              }
            : {}
        )}`
      ),
    markRead: (id) => this.post(`/api/notifications/${encodeURIComponent(id)}/read`),
    markAllRead: () => this.post('/api/notifications/read-all'),
    delete: (id) => this.del(`/api/notifications/${encodeURIComponent(id)}`),
    clear: () => this.del('/api/notifications'),
    getUnreadCount: () => this.get('/api/notifications/unread-count'),
    // IPC signature: (event: unknown, error: unknown) => void
    onNew: (callback) =>
      this.addEventListener('notification:new', (data: unknown) => callback(null, data)),
    // IPC signature: (event: unknown, payload: { total; unreadCount }) => void
    onUpdated: (callback) =>
      this.addEventListener('notification:updated', (data: unknown) =>
        callback(null, data as { total: number; unreadCount: number })
      ),
    // IPC signature: (event: unknown, data: unknown) => void
    onClicked: (callback) =>
      this.addEventListener('notification:clicked', (data: unknown) => callback(null, data)),
  };

  // ---------------------------------------------------------------------------
  // Config (nested API)
  // ---------------------------------------------------------------------------

  config: ConfigAPI = {
    get: async (): Promise<AppConfig> => {
      const result = await this.get<{ success: boolean; data?: AppConfig; error?: string }>(
        '/api/config'
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to get config');
      return result.data!;
    },
    update: async (section: string, data: object): Promise<AppConfig> => {
      const result = await this.post<{ success: boolean; data?: AppConfig; error?: string }>(
        '/api/config/update',
        { section, data }
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to update config');
      return result.data!;
    },
    addRoot: async (
      root: Omit<LocalDataRoot, 'id' | 'order'> | Omit<SshDataRoot, 'id' | 'order'>
    ): Promise<AppConfig> => {
      const result = await this.post<{ success: boolean; data?: AppConfig; error?: string }>(
        '/api/roots',
        root
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to add root');
      return result.data!;
    },
    updateRoot: async (
      rootId: string,
      updates: Partial<Omit<LocalDataRoot, 'id'>> | Partial<Omit<SshDataRoot, 'id'>>
    ): Promise<AppConfig> => {
      const result = await this.put<{ success: boolean; data?: AppConfig; error?: string }>(
        `/api/roots/${encodeURIComponent(rootId)}`,
        updates
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to update root');
      return result.data!;
    },
    removeRoot: async (rootId: string): Promise<AppConfig> => {
      const result = await this.del<{ success: boolean; data?: AppConfig; error?: string }>(
        `/api/roots/${encodeURIComponent(rootId)}`
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to remove root');
      return result.data!;
    },
    reorderRoots: async (rootIdsInOrder: string[]): Promise<AppConfig> => {
      const result = await this.post<{ success: boolean; data?: AppConfig; error?: string }>(
        '/api/roots/reorder',
        { rootIdsInOrder }
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to reorder roots');
      return result.data!;
    },
    addIgnoreRegex: async (pattern: string): Promise<AppConfig> => {
      await this.post('/api/config/ignore-regex', { pattern });
      return this.config.get();
    },
    removeIgnoreRegex: async (pattern: string): Promise<AppConfig> => {
      await this.del('/api/config/ignore-regex', { pattern });
      return this.config.get();
    },
    addIgnoreRepository: async (repositoryId: string): Promise<AppConfig> => {
      await this.post('/api/config/ignore-repository', { repositoryId });
      return this.config.get();
    },
    removeIgnoreRepository: async (repositoryId: string): Promise<AppConfig> => {
      await this.del('/api/config/ignore-repository', { repositoryId });
      return this.config.get();
    },
    snooze: async (minutes: number): Promise<AppConfig> => {
      await this.post('/api/config/snooze', { minutes });
      return this.config.get();
    },
    clearSnooze: async (): Promise<AppConfig> => {
      await this.post('/api/config/clear-snooze');
      return this.config.get();
    },
    addTrigger: async (trigger): Promise<AppConfig> => {
      await this.post('/api/config/triggers', trigger);
      return this.config.get();
    },
    updateTrigger: async (triggerId: string, updates): Promise<AppConfig> => {
      await this.put(`/api/config/triggers/${encodeURIComponent(triggerId)}`, updates);
      return this.config.get();
    },
    removeTrigger: async (triggerId: string): Promise<AppConfig> => {
      await this.del(`/api/config/triggers/${encodeURIComponent(triggerId)}`);
      return this.config.get();
    },
    getTriggers: async (): Promise<NotificationTrigger[]> => {
      const result = await this.get<{ success: boolean; data?: NotificationTrigger[] }>(
        '/api/config/triggers'
      );
      return result.data ?? [];
    },
    testTrigger: async (trigger: NotificationTrigger): Promise<TriggerTestResult> => {
      const result = await this.post<{
        success: boolean;
        data?: TriggerTestResult;
        error?: string;
      }>(`/api/config/triggers/${encodeURIComponent(trigger.id)}/test`, trigger);
      if (!result.success) throw new Error(result.error ?? 'Failed to test trigger');
      return result.data!;
    },
    selectFolders: async (): Promise<string[]> => {
      console.warn('[HttpAPIClient] selectFolders is not available in browser mode');
      return [];
    },
    selectClaudeRootFolder: async (_rootId?: string): Promise<ClaudeRootFolderSelection | null> => {
      console.warn('[HttpAPIClient] selectClaudeRootFolder is not available in browser mode');
      return null;
    },
    getRootInfo: async (rootId: string): Promise<ClaudeRootInfo> => {
      const result = await this.get<{ success: boolean; data?: ClaudeRootInfo; error?: string }>(
        `/api/roots/${encodeURIComponent(rootId)}/info`
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to get root info');
      return result.data!;
    },
    getClaudeRootInfo: async (): Promise<ClaudeRootInfo> => {
      const config = await this.config.get();
      const activeRoot =
        config.roots.items.find((root) => root.id === config.roots.activeRootId) ??
        config.roots.items[0];
      const fallbackPath =
        activeRoot?.type === 'local' ? (activeRoot.claudeRootPath ?? '~/.claude') : '~/.claude';
      return {
        defaultPath: fallbackPath,
        resolvedPath: fallbackPath,
        customPath: activeRoot?.type === 'local' ? activeRoot.claudeRootPath : null,
      };
    },
    findWslClaudeRoots: async (): Promise<WslClaudeRootCandidate[]> => {
      console.warn('[HttpAPIClient] findWslClaudeRoots is not available in browser mode');
      return [];
    },
    openInEditor: async (): Promise<void> => {
      console.warn('[HttpAPIClient] openInEditor is not available in browser mode');
    },
    pinSession: (projectId: string, sessionId: string): Promise<void> =>
      this.post('/api/config/pin-session', { projectId, sessionId }),
    unpinSession: (projectId: string, sessionId: string): Promise<void> =>
      this.post('/api/config/unpin-session', { projectId, sessionId }),
    hideSession: (projectId: string, sessionId: string): Promise<void> =>
      this.post('/api/config/hide-session', { projectId, sessionId }),
    unhideSession: (projectId: string, sessionId: string): Promise<void> =>
      this.post('/api/config/unhide-session', { projectId, sessionId }),
    hideSessions: (projectId: string, sessionIds: string[]): Promise<void> =>
      this.post('/api/config/hide-sessions', { projectId, sessionIds }),
    unhideSessions: (projectId: string, sessionIds: string[]): Promise<void> =>
      this.post('/api/config/unhide-sessions', { projectId, sessionIds }),
  };

  // ---------------------------------------------------------------------------
  // Session navigation
  // ---------------------------------------------------------------------------

  session: SessionAPI = {
    scrollToLine: (sessionId: string, lineNumber: number): Promise<void> =>
      this.post('/api/session/scroll-to-line', { sessionId, lineNumber }),
  };

  // ---------------------------------------------------------------------------
  // Zoom (browser fallbacks)
  // ---------------------------------------------------------------------------

  getZoomFactor = async (): Promise<number> => 1.0;

  onZoomFactorChanged = (_callback: (zoomFactor: number) => void): (() => void) => {
    // No-op in browser mode — zoom is managed by the browser itself
    return () => {};
  };

  // ---------------------------------------------------------------------------
  // File change events (via SSE)
  // ---------------------------------------------------------------------------

  onFileChange = (callback: (event: FileChangeEvent) => void): (() => void) =>
    this.addEventListener('file-change', callback);

  onTodoChange = (callback: (event: FileChangeEvent) => void): (() => void) =>
    this.addEventListener('todo-change', callback);

  setCombinedWatchers = async (enabled: boolean): Promise<void> => {
    await this.post<{ success: true }>('/api/contexts/combined-watchers', { enabled });
  };

  // ---------------------------------------------------------------------------
  // Shell operations (browser fallbacks)
  // ---------------------------------------------------------------------------

  openPath = async (
    _targetPath: string,
    _projectRoot?: string
  ): Promise<{ success: boolean; error?: string }> => {
    console.warn('[HttpAPIClient] openPath is not available in browser mode');
    return { success: false, error: 'Not available in browser mode' };
  };

  openExternal = async (url: string): Promise<{ success: boolean; error?: string }> => {
    window.open(url, '_blank');
    return { success: true };
  };

  windowControls = {
    minimize: async (): Promise<void> => {},
    maximize: async (): Promise<void> => {},
    close: async (): Promise<void> => {},
    isMaximized: async (): Promise<boolean> => false,
  };

  // ---------------------------------------------------------------------------
  // Updater (browser no-ops)
  // ---------------------------------------------------------------------------

  updater: UpdaterAPI = {
    check: async (): Promise<void> => {
      console.warn('[HttpAPIClient] updater not available in browser mode');
    },
    download: async (): Promise<void> => {
      console.warn('[HttpAPIClient] updater not available in browser mode');
    },
    install: async (): Promise<void> => {
      console.warn('[HttpAPIClient] updater not available in browser mode');
    },
    onStatus: (_callback): (() => void) => {
      return () => {};
    },
  };

  // ---------------------------------------------------------------------------
  // SSH
  // ---------------------------------------------------------------------------

  ssh: SshAPI = {
    connect: async (config: SshConnectionConfig, rootId?: string): Promise<SshConnectionStatus> => {
      const result = await this.post<{
        success: boolean;
        data?: SshConnectionStatus;
        error?: string;
      }>('/api/ssh/connect', { config, rootId });
      if (!result.success) throw new Error(result.error ?? 'Failed to connect SSH');
      return result.data!;
    },
    disconnect: async (): Promise<SshConnectionStatus> => {
      const result = await this.post<{
        success: boolean;
        data?: SshConnectionStatus;
        error?: string;
      }>('/api/ssh/disconnect');
      if (!result.success) throw new Error(result.error ?? 'Failed to disconnect SSH');
      return result.data!;
    },
    getState: (): Promise<SshConnectionStatus> => this.get('/api/ssh/state'),
    test: async (config: SshConnectionConfig): Promise<{ success: boolean; error?: string }> => {
      const result = await this.post<{
        success: boolean;
        data?: { success: boolean; error?: string };
        error?: string;
      }>('/api/ssh/test', config);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return result.data ?? { success: false, error: 'Unknown SSH test failure' };
    },
    getConfigHosts: async (): Promise<SshConfigHostEntry[]> => {
      const result = await this.get<{ success: boolean; data?: SshConfigHostEntry[] }>(
        '/api/ssh/config-hosts'
      );
      return result.data ?? [];
    },
    resolveHost: async (alias: string): Promise<SshConfigHostEntry | null> => {
      const result = await this.post<{
        success: boolean;
        data?: SshConfigHostEntry | null;
      }>('/api/ssh/resolve-host', { alias });
      return result.data ?? null;
    },
    saveLastConnection: (config: SshLastConnection): Promise<void> =>
      this.post('/api/ssh/save-last-connection', config),
    getLastConnection: async (): Promise<SshLastConnection | null> => {
      const result = await this.get<{ success: boolean; data?: SshLastConnection | null }>(
        '/api/ssh/last-connection'
      );
      return result.data ?? null;
    },
    // IPC signature: (event: unknown, status: SshConnectionStatus) => void
    onStatus: (callback): (() => void) =>
      this.addEventListener('ssh:status', (data: unknown) =>
        callback(null, data as SshConnectionStatus)
      ),
  };

  // ---------------------------------------------------------------------------
  // Context API
  // ---------------------------------------------------------------------------

  context = {
    list: (): Promise<ContextInfo[]> => this.get<ContextInfo[]>('/api/contexts'),
    getActive: async (): Promise<string> => {
      const res = await this.get<{ contextId: string }>('/api/contexts/active');
      return res.contextId;
    },
    switch: (contextId: string): Promise<{ contextId: string }> =>
      this.post<{ contextId: string }>('/api/contexts/switch', { contextId }),
    onChanged: (callback: (event: unknown, data: ContextInfo) => void): (() => void) =>
      this.addEventListener('context:changed', (data: unknown) =>
        callback(null, data as ContextInfo)
      ),
  };

  // HTTP Server API — in browser mode, server is already running (we're using it)
  httpServer: HttpServerAPI = {
    start: (): Promise<HttpServerStatus> =>
      Promise.resolve({ running: true, port: parseInt(new URL(this.baseUrl).port, 10) }),
    stop: (): Promise<HttpServerStatus> => {
      console.warn('[HttpAPIClient] Cannot stop HTTP server from browser mode');
      return Promise.resolve({ running: true, port: parseInt(new URL(this.baseUrl).port, 10) });
    },
    getStatus: (): Promise<HttpServerStatus> =>
      Promise.resolve({ running: true, port: parseInt(new URL(this.baseUrl).port, 10) }),
  };
}
