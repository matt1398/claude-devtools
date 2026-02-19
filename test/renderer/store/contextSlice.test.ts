import { create, type StateCreator } from 'zustand';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createConnectionSlice } from '../../../src/renderer/store/slices/connectionSlice';
import { createContextSlice } from '../../../src/renderer/store/slices/contextSlice';

import type { ConnectionSlice } from '../../../src/renderer/store/slices/connectionSlice';
import type { ContextSlice } from '../../../src/renderer/store/slices/contextSlice';
import type { ContextSnapshot } from '../../../src/renderer/services/contextStorage';
import type { ContextInfo } from '../../../src/shared/types/api';

const { snapshotMap, mockApi, contextStorageMock } = vi.hoisted(() => {
  const map = new Map<string, ContextSnapshot>();

  const api = {
    config: {
      get: vi.fn(),
    },
    ssh: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      saveLastConnection: vi.fn(),
    },
    context: {
      switch: vi.fn(),
      list: vi.fn(),
      getActive: vi.fn(),
    },
    getProjects: vi.fn(),
    getRepositoryGroups: vi.fn(),
  };

  const contextStorage = {
    saveSnapshot: vi.fn(),
    loadSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
    cleanupExpired: vi.fn(),
    cleanupUnknownSnapshots: vi.fn(),
    isAvailable: vi.fn(),
  };

  return { snapshotMap: map, mockApi: api, contextStorageMock: contextStorage };
});

vi.mock('@renderer/api', () => ({
  api: mockApi,
}));

vi.mock('@renderer/services/contextStorage', () => ({
  contextStorage: contextStorageMock,
}));

type ContextTestState = ContextSlice &
  ConnectionSlice & {
    projects: Array<{ id: string }>;
    selectedProjectId: string | null;
    repositoryGroups: Array<{ id: string; worktrees: Array<{ id: string }> }>;
    selectedRepositoryId: string | null;
    selectedWorktreeId: string | null;
    viewMode: 'project' | 'search';
    sessions: Array<{ id: string }>;
    selectedSessionId: string | null;
    sessionsCursor: string | null;
    sessionsHasMore: boolean;
    sessionsTotalCount: number;
    pinnedSessionIds: string[];
    notifications: Array<{ id: string }>;
    unreadCount: number;
    openTabs: Array<{ id: string; type: 'session'; sessionId: string; projectId: string; label: string }>;
    activeTabId: string | null;
    selectedTabIds: string[];
    activeProjectId: string | null;
    paneLayout: {
      panes: Array<{
        id: string;
        tabs: Array<{ id: string; type: 'session'; sessionId: string; projectId: string; label: string }>;
        activeTabId: string | null;
        selectedTabIds: string[];
        widthFraction: number;
      }>;
      focusedPaneId: string;
    };
    sidebarCollapsed: boolean;
    fetchNotifications: ReturnType<typeof vi.fn<() => Promise<void>>>;
  };

const contextSliceCreator = createContextSlice as unknown as StateCreator<ContextTestState>;
const connectionSliceCreator = createConnectionSlice as unknown as StateCreator<ContextTestState>;

const LOCAL_CONTEXT: ContextInfo = {
  id: 'local',
  type: 'local',
  rootId: 'default-local',
  rootName: 'Local',
  connected: true,
};

const LOCAL_WORK_CONTEXT: ContextInfo = {
  id: 'local-work',
  type: 'local',
  rootId: 'local-work-root',
  rootName: 'Work',
  connected: true,
};

const SSH_CONTEXT_A: ContextInfo = {
  id: 'ssh-example-aaaa1111',
  type: 'ssh',
  rootId: 'ssh-root-a',
  rootName: 'Remote A',
  connected: true,
};

const SSH_CONTEXT_B: ContextInfo = {
  id: 'ssh-example-bbbb2222',
  type: 'ssh',
  rootId: 'ssh-root-b',
  rootName: 'Remote B',
  connected: true,
};

function buildConfig() {
  return {
    roots: {
      items: [
        { id: 'default-local', type: 'local', name: 'Local', claudeRootPath: null, order: 0 },
        { id: 'local-work-root', type: 'local', name: 'Work', claudeRootPath: null, order: 1 },
        {
          id: 'ssh-root-a',
          type: 'ssh',
          name: 'Remote A',
          sshProfileId: 'profile-a',
          remoteClaudeRootPath: null,
          order: 2,
        },
        {
          id: 'ssh-root-b',
          type: 'ssh',
          name: 'Remote B',
          sshProfileId: 'profile-b',
          remoteClaudeRootPath: null,
          order: 3,
        },
      ],
      activeRootId: 'default-local',
    },
    ssh: {
      profiles: [
        {
          id: 'profile-a',
          name: 'Remote A',
          host: 'example.com',
          port: 22,
          username: 'alice',
          authMethod: 'agent',
        },
        {
          id: 'profile-b',
          name: 'Remote B',
          host: 'example.com',
          port: 22,
          username: 'bob',
          authMethod: 'agent',
        },
      ],
    },
  };
}

function createContextStore(initial?: Partial<ContextTestState>) {
  const localTab = {
    id: 'tab-local',
    type: 'session' as const,
    sessionId: 'session-local',
    projectId: 'project-local',
    label: 'Local Session',
  };

  return create<ContextTestState>()((...args) => ({
    projects: [{ id: 'project-local' }],
    selectedProjectId: 'project-local',
    repositoryGroups: [],
    selectedRepositoryId: null,
    selectedWorktreeId: null,
    viewMode: 'project',
    sessions: [{ id: 'session-local' }],
    selectedSessionId: 'session-local',
    sessionsCursor: null,
    sessionsHasMore: false,
    sessionsTotalCount: 1,
    pinnedSessionIds: [],
    notifications: [],
    unreadCount: 0,
    openTabs: [localTab],
    activeTabId: localTab.id,
    selectedTabIds: [localTab.id],
    activeProjectId: 'project-local',
    paneLayout: {
      panes: [
        {
          id: 'pane-default',
          tabs: [localTab],
          activeTabId: localTab.id,
          selectedTabIds: [localTab.id],
          widthFraction: 1,
        },
      ],
      focusedPaneId: 'pane-default',
    },
    sidebarCollapsed: false,
    fetchNotifications: vi.fn().mockResolvedValue(undefined),
    ...connectionSliceCreator(...args),
    ...contextSliceCreator(...args),
    ...initial,
  }));
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

describe('contextSlice switchContext edge cases', () => {
  beforeEach(() => {
    snapshotMap.clear();
    vi.clearAllMocks();

    contextStorageMock.saveSnapshot.mockImplementation(async (rootId: string, snapshot: ContextSnapshot) => {
      snapshotMap.set(rootId, snapshot);
    });
    contextStorageMock.loadSnapshot.mockImplementation(async (rootId: string) => {
      return snapshotMap.get(rootId) ?? null;
    });
    contextStorageMock.deleteSnapshot.mockImplementation(async (rootId: string) => {
      snapshotMap.delete(rootId);
    });
    contextStorageMock.isAvailable.mockResolvedValue(true);
    contextStorageMock.cleanupExpired.mockResolvedValue(undefined);
    contextStorageMock.cleanupUnknownSnapshots.mockResolvedValue(undefined);

    mockApi.context.switch.mockImplementation(async (contextId: string) => ({ contextId }));
    mockApi.context.list.mockResolvedValue([LOCAL_CONTEXT, LOCAL_WORK_CONTEXT, SSH_CONTEXT_A, SSH_CONTEXT_B]);
    mockApi.context.getActive.mockResolvedValue(LOCAL_CONTEXT.id);

    mockApi.config.get.mockResolvedValue(buildConfig());

    mockApi.ssh.connect.mockImplementation(async (config: { host: string }) => ({
      state: 'connected',
      host: config.host,
      error: null,
      remoteProjectsPath: '/remote/projects',
    }));
    mockApi.ssh.disconnect.mockResolvedValue({
      state: 'disconnected',
      host: null,
      error: null,
      remoteProjectsPath: null,
    });
    mockApi.ssh.saveLastConnection.mockResolvedValue(undefined);

    mockApi.getProjects.mockResolvedValue([{ id: 'project-local' }, { id: 'project-ssh' }]);
    mockApi.getRepositoryGroups.mockResolvedValue([]);
  });

  it('rolls back state when SSH connect times out', async () => {
    mockApi.ssh.connect.mockRejectedValueOnce(new Error('Connection timeout'));

    const store = createContextStore({
      activeContextId: LOCAL_CONTEXT.id,
      availableContexts: [LOCAL_CONTEXT, SSH_CONTEXT_A],
    });
    const startingState = store.getState();

    await store.getState().switchContext(SSH_CONTEXT_A.id);

    const state = store.getState();
    expect(mockApi.context.switch).not.toHaveBeenCalled();
    expect(mockApi.ssh.disconnect).toHaveBeenCalledTimes(1);
    expect(state.activeContextId).toBe(startingState.activeContextId);
    expect(state.isContextSwitching).toBe(false);
    expect(state.targetContextId).toBeNull();
    expect(state.connectionError).toContain('Connection timeout');
    vi.mocked(console.error).mockClear();
  });

  it('passes SSH credentials override to connect when switching contexts', async () => {
    const store = createContextStore({
      activeContextId: LOCAL_CONTEXT.id,
      availableContexts: [LOCAL_CONTEXT, SSH_CONTEXT_A],
    });

    await store.getState().switchContext(SSH_CONTEXT_A.id, {
      host: 'override.example.com',
      port: 2200,
      username: 'carol',
      authMethod: 'password',
      password: 'secret',
      privateKeyPath: '/tmp/id_ed25519',
    });

    expect(mockApi.ssh.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'override.example.com',
        port: 2200,
        username: 'carol',
        authMethod: 'password',
        password: 'secret',
        privateKeyPath: '/tmp/id_ed25519',
      }),
      'ssh-root-a'
    );
  });

  it('guards against rapid double-switch re-entrancy', async () => {
    const deferred = createDeferred<{
      state: 'connected';
      host: string;
      error: null;
      remoteProjectsPath: string;
    }>();
    mockApi.ssh.connect.mockReturnValueOnce(deferred.promise);

    const store = createContextStore({
      activeContextId: LOCAL_CONTEXT.id,
      availableContexts: [LOCAL_CONTEXT, LOCAL_WORK_CONTEXT, SSH_CONTEXT_A],
    });

    const firstSwitch = store.getState().switchContext(SSH_CONTEXT_A.id);
    await Promise.resolve();
    await store.getState().switchContext(LOCAL_WORK_CONTEXT.id);

    expect(store.getState().targetContextId).toBe(SSH_CONTEXT_A.id);
    expect(mockApi.context.switch).not.toHaveBeenCalledWith(LOCAL_WORK_CONTEXT.id);

    deferred.resolve({
      state: 'connected',
      host: 'example.com',
      error: null,
      remoteProjectsPath: '/remote/projects',
    });
    await firstSwitch;

    expect(mockApi.ssh.connect).toHaveBeenCalledTimes(1);
    expect(mockApi.context.switch).toHaveBeenCalledTimes(1);
    expect(mockApi.context.switch).toHaveBeenCalledWith(SSH_CONTEXT_A.id);
    expect(store.getState().activeContextId).toBe(SSH_CONTEXT_A.id);
  });

  it('recovers from SSH failure and can switch to a different local root', async () => {
    mockApi.ssh.connect.mockResolvedValueOnce({
      state: 'error',
      host: 'example.com',
      error: 'Permission denied',
      remoteProjectsPath: null,
    });

    const store = createContextStore({
      activeContextId: LOCAL_CONTEXT.id,
      availableContexts: [LOCAL_CONTEXT, LOCAL_WORK_CONTEXT, SSH_CONTEXT_A],
    });

    await store.getState().switchContext(SSH_CONTEXT_A.id);
    vi.mocked(console.error).mockClear();
    await store.getState().switchContext(LOCAL_WORK_CONTEXT.id);

    expect(mockApi.context.switch).toHaveBeenCalledTimes(1);
    expect(mockApi.context.switch).toHaveBeenCalledWith(LOCAL_WORK_CONTEXT.id);
    expect(store.getState().activeContextId).toBe(LOCAL_WORK_CONTEXT.id);
    expect(store.getState().connectionMode).toBe('local');
  });

  it('handles two SSH roots on the same host without root-id collisions', async () => {
    const store = createContextStore({
      activeContextId: LOCAL_CONTEXT.id,
      availableContexts: [LOCAL_CONTEXT, SSH_CONTEXT_A, SSH_CONTEXT_B],
    });

    await store.getState().switchContext(SSH_CONTEXT_A.id);
    store.setState({
      projects: [{ id: 'project-ssh-a' }],
      selectedProjectId: 'project-ssh-a',
    });
    await store.getState().switchContext(SSH_CONTEXT_B.id);

    expect(mockApi.ssh.connect).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ host: 'example.com', username: 'alice' }),
      'ssh-root-a'
    );
    expect(mockApi.ssh.connect).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ host: 'example.com', username: 'bob' }),
      'ssh-root-b'
    );
    const savedRootIds = contextStorageMock.saveSnapshot.mock.calls.map(
      (call: [string, ContextSnapshot]) => call[0]
    );
    expect(savedRootIds).toContain('ssh-root-a');
    expect(SSH_CONTEXT_A.id).not.toBe(SSH_CONTEXT_B.id);
  });

  it('falls back to local when switching from SSH to SSH fails', async () => {
    mockApi.ssh.connect.mockResolvedValueOnce({
      state: 'error',
      host: 'example.com',
      error: 'Permission denied',
      remoteProjectsPath: null,
    });

    const store = createContextStore({
      activeContextId: SSH_CONTEXT_A.id,
      availableContexts: [LOCAL_CONTEXT, SSH_CONTEXT_A, SSH_CONTEXT_B],
      connectionMode: 'ssh',
    });

    await store.getState().switchContext(SSH_CONTEXT_B.id);

    const state = store.getState();
    expect(mockApi.context.switch).toHaveBeenCalledWith(LOCAL_CONTEXT.id);
    expect(state.activeContextId).toBe(LOCAL_CONTEXT.id);
    expect(state.connectionMode).toBe('local');
    expect(state.connectionError).toContain('Permission denied');
    expect(state.isContextSwitching).toBe(false);
    expect(state.targetContextId).toBeNull();
    vi.mocked(console.error).mockClear();
  });

  it('restores SSH snapshot on round-trip reconnect', async () => {
    const store = createContextStore({
      activeContextId: LOCAL_CONTEXT.id,
      availableContexts: [LOCAL_CONTEXT, SSH_CONTEXT_A],
    });

    await store.getState().switchContext(SSH_CONTEXT_A.id);

    const sshTab = {
      id: 'tab-ssh',
      type: 'session' as const,
      sessionId: 'session-ssh',
      projectId: 'project-ssh',
      label: 'SSH Session',
    };
    store.setState({
      projects: [{ id: 'project-ssh' }],
      selectedProjectId: 'project-ssh',
      sessions: [{ id: 'session-ssh' }],
      selectedSessionId: 'session-ssh',
      openTabs: [sshTab],
      activeTabId: sshTab.id,
      selectedTabIds: [sshTab.id],
      activeProjectId: 'project-ssh',
      paneLayout: {
        panes: [
          {
            id: 'pane-default',
            tabs: [sshTab],
            activeTabId: sshTab.id,
            selectedTabIds: [sshTab.id],
            widthFraction: 1,
          },
        ],
        focusedPaneId: 'pane-default',
      },
    });

    await store.getState().switchContext(LOCAL_CONTEXT.id);
    await store.getState().switchContext(SSH_CONTEXT_A.id);

    const state = store.getState();
    expect(mockApi.ssh.connect).toHaveBeenCalledTimes(2);
    expect(mockApi.ssh.disconnect).toHaveBeenCalledTimes(1);
    expect(state.activeContextId).toBe(SSH_CONTEXT_A.id);
    expect(state.activeTabId).toBe('tab-ssh');
    expect(state.selectedProjectId).toBe('project-ssh');
    expect(state.openTabs.map((tab) => tab.id)).toContain('tab-ssh');
  });

  it('switches cleanly from an active SSH root to local during root-removal flow', async () => {
    const store = createContextStore({
      activeContextId: LOCAL_CONTEXT.id,
      availableContexts: [LOCAL_CONTEXT, SSH_CONTEXT_A],
    });

    await store.getState().switchContext(SSH_CONTEXT_A.id);
    await store.getState().switchContext(LOCAL_CONTEXT.id);

    const state = store.getState();
    expect(mockApi.ssh.disconnect).toHaveBeenCalledTimes(1);
    expect(contextStorageMock.saveSnapshot).toHaveBeenCalledWith(
      'ssh-root-a',
      expect.objectContaining({
        _metadata: expect.objectContaining({ contextId: SSH_CONTEXT_A.id }),
      })
    );
    expect(state.activeContextId).toBe(LOCAL_CONTEXT.id);
    expect(state.connectionMode).toBe('local');
    expect(state.isContextSwitching).toBe(false);
  });
});
