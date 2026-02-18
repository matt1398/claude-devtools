/**
 * Mock for window.electronAPI used in tests.
 * Provides typed mocks for all IPC methods.
 */

import { vi } from 'vitest';

import type { Project, Session, SessionDetail } from '../../src/renderer/types/data';

export interface MockElectronAPI {
  onDeepLinkNavigate: ReturnType<typeof vi.fn>;
  getProjects: ReturnType<typeof vi.fn<() => Promise<Project[]>>>;
  getSessions: ReturnType<typeof vi.fn<(projectId: string) => Promise<Session[]>>>;
  getSessionsPaginated: ReturnType<
    typeof vi.fn<
      (
        projectId: string,
        cursor: string | null,
        limit?: number,
        options?: { includeTotalCount?: boolean; prefilterAll?: boolean }
      ) => Promise<{
        sessions: Session[];
        nextCursor: string | null;
        hasMore: boolean;
        totalCount: number;
      }>
    >
  >;
  getSessionDetail: ReturnType<
    typeof vi.fn<(projectId: string, sessionId: string) => Promise<SessionDetail | null>>
  >;
  getRepositoryGroups: ReturnType<typeof vi.fn>;
  getWorktreeSessions: ReturnType<typeof vi.fn>;
  getSubagentDetail: ReturnType<typeof vi.fn>;
  searchSessions: ReturnType<typeof vi.fn>;
  readClaudeMdFiles: ReturnType<typeof vi.fn>;
  readDirectoryClaudeMd: ReturnType<typeof vi.fn>;
  readMentionedFile: ReturnType<typeof vi.fn>;
  validateMentions: ReturnType<typeof vi.fn>;
  openPath: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
  notifications: {
    onNew: ReturnType<typeof vi.fn>;
    onUpdated: ReturnType<typeof vi.fn>;
    getUnread: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
    markAllAsRead: ReturnType<typeof vi.fn>;
    // Methods used by notificationSlice
    get: ReturnType<typeof vi.fn>;
    markRead: ReturnType<typeof vi.fn>;
    markAllRead: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  onFileChange: ReturnType<typeof vi.fn>;
  onTodoChange: ReturnType<typeof vi.fn>;
  config: {
    get: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    addIgnoreRegex: ReturnType<typeof vi.fn>;
    removeIgnoreRegex: ReturnType<typeof vi.fn>;
    addIgnoreRepository: ReturnType<typeof vi.fn>;
    removeIgnoreRepository: ReturnType<typeof vi.fn>;
    snooze: ReturnType<typeof vi.fn>;
    clearSnooze: ReturnType<typeof vi.fn>;
    addTrigger: ReturnType<typeof vi.fn>;
    updateTrigger: ReturnType<typeof vi.fn>;
    removeTrigger: ReturnType<typeof vi.fn>;
    getTriggers: ReturnType<typeof vi.fn>;
    testTrigger: ReturnType<typeof vi.fn>;
    selectFolders: ReturnType<typeof vi.fn>;
    selectClaudeRootFolder: ReturnType<typeof vi.fn>;
    getClaudeRootInfo: ReturnType<typeof vi.fn>;
    findWslClaudeRoots: ReturnType<typeof vi.fn>;
    openInEditor: ReturnType<typeof vi.fn>;
    pinSession: ReturnType<typeof vi.fn>;
    unpinSession: ReturnType<typeof vi.fn>;
  };
}

/**
 * Create a fresh mock electronAPI instance.
 */
export function createMockElectronAPI(): MockElectronAPI {
  return {
    onDeepLinkNavigate: vi.fn().mockReturnValue(() => undefined),
    getProjects: vi.fn().mockResolvedValue([]),
    getSessions: vi.fn().mockResolvedValue([]),
    getSessionsPaginated: vi.fn().mockResolvedValue({
      sessions: [],
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
    }),
    getSessionDetail: vi.fn().mockResolvedValue(null),
    getRepositoryGroups: vi.fn().mockResolvedValue([]),
    getWorktreeSessions: vi.fn().mockResolvedValue([]),
    getSubagentDetail: vi.fn().mockResolvedValue(null),
    searchSessions: vi.fn().mockResolvedValue({
      results: [],
      totalMatches: 0,
      sessionsSearched: 0,
      query: '',
    }),
    readClaudeMdFiles: vi.fn().mockResolvedValue({}),
    readDirectoryClaudeMd: vi.fn().mockResolvedValue({
      path: '',
      exists: false,
      charCount: 0,
      estimatedTokens: 0,
    }),
    readMentionedFile: vi.fn().mockResolvedValue(null),
    validateMentions: vi.fn().mockResolvedValue({}),
    openPath: vi.fn().mockResolvedValue({ success: true }),
    openExternal: vi.fn().mockResolvedValue({ success: true }),
    notifications: {
      onNew: vi.fn().mockReturnValue(() => undefined),
      onUpdated: vi.fn().mockReturnValue(() => undefined),
      getUnread: vi.fn().mockResolvedValue([]),
      markAsRead: vi.fn().mockResolvedValue(undefined),
      markAllAsRead: vi.fn().mockResolvedValue(undefined),
      // Methods used by notificationSlice
      get: vi.fn().mockResolvedValue({ notifications: [] }),
      markRead: vi.fn().mockResolvedValue(true),
      markAllRead: vi.fn().mockResolvedValue(true),
      delete: vi.fn().mockResolvedValue(true),
      clear: vi.fn().mockResolvedValue(true),
    },
    onFileChange: vi.fn().mockReturnValue(() => undefined),
    onTodoChange: vi.fn().mockReturnValue(() => undefined),
    config: {
      get: vi.fn().mockResolvedValue({
        notifications: {
          enabled: true,
          soundEnabled: true,
          ignoredRegex: [],
          ignoredRepositories: [],
          snoozedUntil: null,
          snoozeMinutes: 30,
          triggers: [],
        },
        general: {
          launchAtLogin: false,
          showDockIcon: true,
          theme: 'dark',
          defaultTab: 'dashboard',
          claudeRootPath: null,
        },
        display: {
          showTimestamps: true,
          compactMode: false,
          syntaxHighlighting: true,
        },
        sessions: {
          pinnedSessions: {},
        },
      }),
      update: vi.fn(),
      addIgnoreRegex: vi.fn(),
      removeIgnoreRegex: vi.fn(),
      addIgnoreRepository: vi.fn(),
      removeIgnoreRepository: vi.fn(),
      snooze: vi.fn(),
      clearSnooze: vi.fn(),
      addTrigger: vi.fn(),
      updateTrigger: vi.fn(),
      removeTrigger: vi.fn(),
      getTriggers: vi.fn().mockResolvedValue([]),
      testTrigger: vi.fn(),
      selectFolders: vi.fn().mockResolvedValue([]),
      selectClaudeRootFolder: vi.fn().mockResolvedValue(null),
      getClaudeRootInfo: vi.fn().mockResolvedValue({
        defaultPath: '~/.claude',
        resolvedPath: '~/.claude',
        customPath: null,
      }),
      findWslClaudeRoots: vi.fn().mockResolvedValue([]),
      openInEditor: vi.fn(),
      pinSession: vi.fn(),
      unpinSession: vi.fn(),
    },
  };
}

/**
 * Install mock electronAPI on window object.
 * Returns the mock instance for assertions.
 */
export function installMockElectronAPI(): MockElectronAPI {
  const mock = createMockElectronAPI();
  vi.stubGlobal('window', {
    ...window,
    electronAPI: mock,
  });
  return mock;
}
