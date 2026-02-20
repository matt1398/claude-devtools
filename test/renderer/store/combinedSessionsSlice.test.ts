import { create, type StateCreator } from 'zustand';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCombinedSessionsSlice } from '../../../src/renderer/store/slices/combinedSessionsSlice';

import type { CombinedSessionsSlice } from '../../../src/renderer/store/slices/combinedSessionsSlice';
import type { Session } from '../../../src/renderer/types/data';
import type { AppConfig, ContextInfo } from '../../../src/shared/types';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    setCombinedWatchers: vi.fn(),
    getCombinedSessionsPaginated: vi.fn(),
    config: {
      update: vi.fn(),
    },
  },
}));

vi.mock('@renderer/api', () => ({
  api: mockApi,
}));

type CombinedSliceTestState = CombinedSessionsSlice & {
  availableContexts: ContextInfo[];
  selectedProjectId: string | null;
  fetchSessionsInitial: (projectId: string) => Promise<void>;
};

const combinedSliceCreator =
  createCombinedSessionsSlice as unknown as StateCreator<CombinedSliceTestState>;

const mockFetchSessionsInitial = vi.fn().mockResolvedValue(undefined);

function createCombinedStore(
  availableContexts: ContextInfo[],
  selectedProjectId: string | null = null
) {
  return create<CombinedSliceTestState>()((...args) => ({
    availableContexts,
    selectedProjectId,
    fetchSessionsInitial: mockFetchSessionsInitial,
    ...combinedSliceCreator(...args),
  }));
}

function buildSession(
  id: string,
  projectId: string,
  createdAt: number,
  contextId?: string
): Session {
  return {
    id,
    projectId,
    projectPath: '/home/testuser/project',
    createdAt,
    hasSubagents: false,
    messageCount: 1,
    ...(contextId ? { contextId } : {}),
  };
}

function buildConfig(enabled: boolean): AppConfig {
  return {
    notifications: {
      enabled: true,
      soundEnabled: true,
      ignoredRegex: [],
      ignoredRepositories: [],
      snoozedUntil: null,
      snoozeMinutes: 30,
      includeSubagentErrors: true,
      triggers: [],
    },
    general: {
      launchAtLogin: false,
      showDockIcon: true,
      theme: 'dark',
      defaultTab: 'dashboard',
      claudeRootPath: null,
      combinedSessionsEnabled: enabled,
    },
    display: {
      showTimestamps: true,
      compactMode: false,
      syntaxHighlighting: true,
    },
    sessions: {
      pinnedSessions: {},
      hiddenSessions: {},
    },
    roots: {
      items: [
        {
          id: 'default-local',
          name: 'Local',
          type: 'local',
          claudeRootPath: null,
          order: 0,
        },
      ],
      activeRootId: 'default-local',
    },
    ssh: {
      lastConnection: null,
      autoReconnect: false,
      profiles: [],
      lastActiveContextId: 'local',
    },
    httpServer: {
      enabled: false,
      port: 3456,
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('combinedSessionsSlice', () => {
  const contexts: ContextInfo[] = [
    {
      id: 'local',
      type: 'local',
      rootId: 'default-local',
      rootName: 'Local',
      connected: true,
    },
    {
      id: 'ssh-context',
      type: 'ssh',
      rootId: 'ssh-root-1',
      rootName: 'Remote',
      connected: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.setCombinedWatchers.mockResolvedValue(undefined);
    mockApi.getCombinedSessionsPaginated.mockResolvedValue({
      sessions: [],
      nextCursor: null,
      hasMore: false,
      totalCount: 0,
    });
    mockApi.config.update.mockResolvedValue(buildConfig(false));
  });

  it('toggles combined mode on and fetches initial combined sessions', async () => {
    const store = createCombinedStore(contexts);
    const firstSession = buildSession('session-1', 'project-1', 1000, 'local');
    mockApi.getCombinedSessionsPaginated.mockResolvedValueOnce({
      sessions: [firstSession],
      nextCursor: 'cursor-1',
      hasMore: true,
      totalCount: 3,
    });

    await store.getState().toggleCombinedMode();

    expect(mockApi.setCombinedWatchers).toHaveBeenCalledWith(true);
    expect(mockApi.config.update).toHaveBeenCalledWith('general', {
      combinedSessionsEnabled: true,
    });
    expect(store.getState().combinedModeEnabled).toBe(true);
    expect(store.getState().combinedSessions).toEqual([firstSession]);
    expect(store.getState().combinedSessionsCursor).toBe('cursor-1');
    expect(store.getState().combinedSessionsHasMore).toBe(true);
  });

  it('persists combined mode only after initial fetch succeeds', async () => {
    const store = createCombinedStore(contexts);
    const deferred = createDeferred<{
      sessions: Session[];
      nextCursor: string | null;
      hasMore: boolean;
      totalCount: number;
    }>();
    mockApi.getCombinedSessionsPaginated.mockImplementationOnce(() => deferred.promise);

    const togglePromise = store.getState().toggleCombinedMode();
    expect(store.getState().combinedModeEnabled).toBe(true);
    expect(mockApi.config.update).not.toHaveBeenCalled();

    deferred.resolve({
      sessions: [buildSession('session-1', 'project-1', 1000, 'local')],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });
    await togglePromise;

    expect(mockApi.config.update).toHaveBeenCalledWith('general', {
      combinedSessionsEnabled: true,
    });
  });

  it('does not persist stale enable after force-disable races in-flight toggle-on', async () => {
    const store = createCombinedStore(contexts, 'project-A');
    const enableDeferred = createDeferred<void>();
    mockApi.setCombinedWatchers
      .mockImplementationOnce(() => enableDeferred.promise)
      .mockResolvedValue(undefined);

    const togglePromise = store.getState().toggleCombinedMode();
    expect(store.getState().combinedModeEnabled).toBe(true);

    await store.getState().forceDisableCombinedMode();
    expect(store.getState().combinedModeEnabled).toBe(false);
    expect(mockApi.config.update).toHaveBeenCalledWith('general', {
      combinedSessionsEnabled: false,
    });

    enableDeferred.resolve(undefined);
    await togglePromise;

    expect(mockApi.getCombinedSessionsPaginated).not.toHaveBeenCalled();
    expect(mockApi.config.update).not.toHaveBeenCalledWith('general', {
      combinedSessionsEnabled: true,
    });
  });

  it('does not enable combined mode when fewer than 2 contexts are available', async () => {
    const store = createCombinedStore([contexts[0]]);

    await store.getState().toggleCombinedMode();

    expect(store.getState().combinedModeEnabled).toBe(false);
    expect(mockApi.setCombinedWatchers).not.toHaveBeenCalled();
  });

  it('deduplicates appended sessions by contextId/projectId/sessionId', async () => {
    const store = createCombinedStore(contexts);
    const existing = buildSession('session-1', 'project-1', 1000, 'local');
    const duplicate = buildSession('session-1', 'project-1', 999, 'local');
    const unique = buildSession('session-1', 'project-1', 1001, 'ssh-context');

    store.setState({
      combinedModeEnabled: true,
      combinedSessions: [existing],
      combinedSessionsCursor: 'cursor-1',
      combinedSessionsHasMore: true,
    });

    mockApi.getCombinedSessionsPaginated.mockResolvedValueOnce({
      sessions: [duplicate, unique],
      nextCursor: null,
      hasMore: false,
      totalCount: 2,
    });

    await store.getState().fetchCombinedSessionsMore();

    expect(store.getState().combinedSessions).toHaveLength(2);
    expect(
      store
        .getState()
        .combinedSessions.map(
          (session) => `${session.contextId}:${session.projectId}:${session.id}`
        )
    ).toEqual(['local:project-1:session-1', 'ssh-context:project-1:session-1']);
    expect(store.getState().combinedSessionsLoadingMore).toBe(false);
  });

  it('isolates epoch checks per store instance', async () => {
    const storeA = createCombinedStore(contexts);
    const storeB = createCombinedStore(contexts);

    storeA.setState({ combinedModeEnabled: true });
    storeB.setState({
      combinedModeEnabled: true,
      combinedSessions: [buildSession('existing', 'project-1', 1000, 'local')],
      combinedSessionsCursor: 'cursor-1',
      combinedSessionsHasMore: true,
    });

    const deferred = createDeferred<{
      sessions: Session[];
      nextCursor: string | null;
      hasMore: boolean;
      totalCount: number;
    }>();

    mockApi.getCombinedSessionsPaginated
      .mockImplementationOnce(() => deferred.promise)
      .mockResolvedValueOnce({
        sessions: [buildSession('replacement', 'project-2', 2000, 'ssh-context')],
        nextCursor: null,
        hasMore: false,
        totalCount: 1,
      });

    const fetchMorePromise = storeB.getState().fetchCombinedSessionsMore();
    await storeA.getState().refreshCombinedSessionsInPlace();

    deferred.resolve({
      sessions: [buildSession('appended', 'project-1', 900, 'ssh-context')],
      nextCursor: null,
      hasMore: false,
      totalCount: 2,
    });
    await fetchMorePromise;

    expect(storeB.getState().combinedSessions.map((session) => session.id)).toEqual([
      'existing',
      'appended',
    ]);
    expect(storeB.getState().combinedSessionsLoadingMore).toBe(false);
  });

  it('keeps the latest in-place refresh result under concurrent refreshes', async () => {
    const store = createCombinedStore(contexts);
    store.setState({ combinedModeEnabled: true });

    const firstDeferred = createDeferred<{
      sessions: Session[];
      nextCursor: string | null;
      hasMore: boolean;
      totalCount: number;
    }>();
    const secondDeferred = createDeferred<{
      sessions: Session[];
      nextCursor: string | null;
      hasMore: boolean;
      totalCount: number;
    }>();

    mockApi.getCombinedSessionsPaginated
      .mockImplementationOnce(() => firstDeferred.promise)
      .mockImplementationOnce(() => secondDeferred.promise);

    const first = store.getState().refreshCombinedSessionsInPlace();
    const second = store.getState().refreshCombinedSessionsInPlace();

    secondDeferred.resolve({
      sessions: [buildSession('newest', 'project-1', 2000, 'local')],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });
    firstDeferred.resolve({
      sessions: [buildSession('stale', 'project-1', 1000, 'local')],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });

    await Promise.all([first, second]);
    expect(store.getState().combinedSessions[0]?.id).toBe('newest');
  });

  it('rolls back state and backend watchers when toggle-on fails mid-flight', async () => {
    const store = createCombinedStore(contexts);
    mockApi.setCombinedWatchers.mockResolvedValueOnce(undefined);
    mockApi.getCombinedSessionsPaginated.mockRejectedValueOnce(new Error('SSH timeout'));

    await store.getState().toggleCombinedMode();
    vi.mocked(console.error).mockClear();

    // State rolled back
    expect(store.getState().combinedModeEnabled).toBe(false);
    expect(store.getState().combinedModeToggling).toBe(false);
    expect(store.getState().combinedSessions).toEqual([]);

    // Backend rollback: setCombinedWatchers called with true (enable), then false (rollback)
    expect(mockApi.setCombinedWatchers).toHaveBeenCalledTimes(2);
    expect(mockApi.setCombinedWatchers).toHaveBeenNthCalledWith(1, true);
    expect(mockApi.setCombinedWatchers).toHaveBeenNthCalledWith(2, false);
    expect(mockApi.config.update).toHaveBeenCalledWith('general', {
      combinedSessionsEnabled: false,
    });
    expect(mockApi.config.update).not.toHaveBeenCalledWith('general', {
      combinedSessionsEnabled: true,
    });
  });

  it('still clears toggling flag when rollback itself fails', async () => {
    const store = createCombinedStore(contexts);
    mockApi.setCombinedWatchers
      .mockResolvedValueOnce(undefined) // enable succeeds
      .mockRejectedValueOnce(new Error('rollback failed')); // rollback fails
    mockApi.getCombinedSessionsPaginated.mockRejectedValueOnce(new Error('SSH timeout'));

    await store.getState().toggleCombinedMode();
    vi.mocked(console.error).mockClear();

    expect(store.getState().combinedModeEnabled).toBe(false);
    expect(store.getState().combinedModeToggling).toBe(false);
  });

  it('rejects concurrent toggle calls via combinedModeToggling guard', async () => {
    const store = createCombinedStore(contexts);
    const deferred = createDeferred<{
      sessions: Session[];
      nextCursor: string | null;
      hasMore: boolean;
      totalCount: number;
    }>();
    mockApi.getCombinedSessionsPaginated.mockImplementationOnce(() => deferred.promise);

    // First call starts toggling
    const first = store.getState().toggleCombinedMode();
    expect(store.getState().combinedModeToggling).toBe(true);

    // Second call is a no-op because toggling is in progress
    await store.getState().toggleCombinedMode();
    expect(mockApi.setCombinedWatchers).toHaveBeenCalledTimes(1);

    deferred.resolve({ sessions: [], nextCursor: null, hasMore: false, totalCount: 0 });
    await first;
    expect(store.getState().combinedModeToggling).toBe(false);
  });

  it('initializes combined mode from config only when enabled and enough contexts exist', async () => {
    const store = createCombinedStore(contexts);
    mockApi.getCombinedSessionsPaginated.mockResolvedValueOnce({
      sessions: [buildSession('session-1', 'project-1', 1000, 'local')],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });

    await store.getState().initCombinedModeFromConfig(buildConfig(true));

    expect(mockApi.setCombinedWatchers).toHaveBeenCalledWith(true);
    expect(store.getState().combinedModeEnabled).toBe(true);
    expect(store.getState().combinedSessions).toHaveLength(1);

    const singleContextStore = createCombinedStore([contexts[0]]);
    await singleContextStore.getState().initCombinedModeFromConfig(buildConfig(true));
    expect(singleContextStore.getState().combinedModeEnabled).toBe(false);
  });

  it('reloads per-project sessions when toggling combined mode off', async () => {
    const store = createCombinedStore(contexts, 'project-A');
    mockApi.getCombinedSessionsPaginated.mockResolvedValueOnce({
      sessions: [buildSession('s1', 'project-A', 1000, 'local')],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });

    // Toggle ON first
    await store.getState().toggleCombinedMode();
    expect(store.getState().combinedModeEnabled).toBe(true);
    mockFetchSessionsInitial.mockClear();

    // Toggle OFF — should reload per-project sessions
    await store.getState().toggleCombinedMode();
    expect(store.getState().combinedModeEnabled).toBe(false);
    expect(store.getState().combinedSessions).toEqual([]);
    expect(mockFetchSessionsInitial).toHaveBeenCalledWith('project-A');
  });

  it('forceDisableCombinedMode bypasses toggling guard and disables immediately', async () => {
    const store = createCombinedStore(contexts, 'project-B');
    mockApi.getCombinedSessionsPaginated.mockResolvedValueOnce({
      sessions: [buildSession('s1', 'project-B', 1000, 'local')],
      nextCursor: null,
      hasMore: false,
      totalCount: 1,
    });

    await store.getState().toggleCombinedMode();
    expect(store.getState().combinedModeEnabled).toBe(true);
    mockFetchSessionsInitial.mockClear();
    mockApi.setCombinedWatchers.mockClear();

    // Simulate in-flight toggle (would block toggleCombinedMode)
    store.setState({ combinedModeToggling: true });

    // forceDisableCombinedMode bypasses the guard
    await store.getState().forceDisableCombinedMode();

    expect(store.getState().combinedModeEnabled).toBe(false);
    expect(store.getState().combinedModeToggling).toBe(false);
    expect(store.getState().combinedSessions).toEqual([]);
    expect(mockApi.setCombinedWatchers).toHaveBeenCalledWith(false);
    expect(mockFetchSessionsInitial).toHaveBeenCalledWith('project-B');
  });

  it('forceDisableCombinedMode is a no-op when combined mode is already disabled', async () => {
    const store = createCombinedStore(contexts);
    expect(store.getState().combinedModeEnabled).toBe(false);

    await store.getState().forceDisableCombinedMode();

    expect(mockApi.setCombinedWatchers).not.toHaveBeenCalled();
  });

  it('reloads per-project sessions when toggle-on fails mid-flight', async () => {
    const store = createCombinedStore(contexts, 'project-A');
    mockApi.setCombinedWatchers.mockResolvedValueOnce(undefined);
    mockApi.getCombinedSessionsPaginated.mockRejectedValueOnce(new Error('SSH timeout'));
    mockFetchSessionsInitial.mockClear();

    await store.getState().toggleCombinedMode();
    vi.mocked(console.error).mockClear();

    // State rolled back
    expect(store.getState().combinedModeEnabled).toBe(false);
    // Per-project sessions reloaded after rollback
    expect(mockFetchSessionsInitial).toHaveBeenCalledWith('project-A');
  });

  it('clears combinedSessionsHasMore on zero-progress fetchMore to prevent infinite loop', async () => {
    const store = createCombinedStore(contexts);
    store.setState({
      combinedModeEnabled: true,
      combinedSessions: [buildSession('s1', 'project-1', 1000, 'local')],
      combinedSessionsCursor: 'cursor-1',
      combinedSessionsHasMore: true,
    });

    // Server returns no sessions but claims hasMore (persistent error on one context)
    mockApi.getCombinedSessionsPaginated.mockResolvedValueOnce({
      sessions: [],
      nextCursor: 'cursor-2',
      hasMore: true,
      totalCount: 5,
    });

    await store.getState().fetchCombinedSessionsMore();

    // hasMore cleared to break no-progress scroll loop
    expect(store.getState().combinedSessionsHasMore).toBe(false);
    expect(store.getState().combinedSessionsLoadingMore).toBe(false);
    // Existing sessions preserved
    expect(store.getState().combinedSessions).toHaveLength(1);
  });

  it('clears combinedSessionsHasMore on fetchMore error to prevent infinite scroll retry', async () => {
    const store = createCombinedStore(contexts);
    store.setState({
      combinedModeEnabled: true,
      combinedSessions: [buildSession('s1', 'project-1', 1000, 'local')],
      combinedSessionsCursor: 'cursor-1',
      combinedSessionsHasMore: true,
    });

    mockApi.getCombinedSessionsPaginated.mockRejectedValueOnce(new Error('SSH timeout'));

    await store.getState().fetchCombinedSessionsMore();
    vi.mocked(console.error).mockClear();

    // hasMore cleared to break the scroll-triggered retry loop
    expect(store.getState().combinedSessionsHasMore).toBe(false);
    expect(store.getState().combinedSessionsLoadingMore).toBe(false);
    // Existing sessions preserved
    expect(store.getState().combinedSessions).toHaveLength(1);
  });
});
