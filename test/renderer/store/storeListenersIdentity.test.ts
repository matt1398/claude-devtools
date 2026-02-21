import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI, type MockElectronAPI } from '../../mocks/electronAPI';

import type { Tab } from '../../../src/renderer/types/tabs';

describe('store listener identity matching', () => {
  let mockAPI: MockElectronAPI;
  let cleanupListeners: (() => void) | null = null;
  let onFileChange: ((event: Record<string, unknown>) => void) | null = null;
  let onTodoChange: ((event: Record<string, unknown>) => void) | null = null;
  let initializeNotificationListeners: (() => () => void) | null = null;
  let useStore: (typeof import('../../../src/renderer/store/index'))['useStore'] | null = null;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();

    mockAPI = installMockElectronAPI();
    mockAPI.onFileChange.mockImplementation((callback) => {
      onFileChange = callback as (event: Record<string, unknown>) => void;
      return () => {
        onFileChange = null;
      };
    });
    mockAPI.onTodoChange.mockImplementation((callback) => {
      onTodoChange = callback as (event: Record<string, unknown>) => void;
      return () => {
        onTodoChange = null;
      };
    });

    const storeModule = await import('../../../src/renderer/store/index');
    initializeNotificationListeners = storeModule.initializeNotificationListeners;
    useStore = storeModule.useStore;
  });

  afterEach(() => {
    cleanupListeners?.();
    cleanupListeners = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses full identity for file-change session refresh targeting', () => {
    if (!useStore || !initializeNotificationListeners) {
      throw new Error('Store module not initialized');
    }

    const refreshSessionInPlace = vi.fn().mockResolvedValue(undefined);
    const visibleProject1Tab: Tab = {
      id: 'tab-project-1',
      type: 'session',
      sessionId: 'shared-session',
      projectId: 'project-1',
      contextId: 'ctx-a',
      label: 'Project 1 Session',
      createdAt: 1,
    };

    useStore.setState({
      refreshSessionInPlace,
      refreshSessionsInPlace: vi.fn().mockResolvedValue(undefined),
      refreshCombinedSessionsInPlace: vi.fn().mockResolvedValue(undefined),
      fetchNotifications: vi.fn().mockResolvedValue(undefined),
      combinedModeEnabled: true,
      activeContextId: 'ctx-a',
      selectedProjectId: 'project-1',
      selectedSessionId: null,
      paneLayout: {
        panes: [
          {
            id: 'pane-default',
            tabs: [visibleProject1Tab],
            activeTabId: visibleProject1Tab.id,
            selectedTabIds: [],
            widthFraction: 1,
          },
        ],
        focusedPaneId: 'pane-default',
      },
      openTabs: [visibleProject1Tab],
      activeTabId: visibleProject1Tab.id,
      combinedSessions: [],
    } as never);

    cleanupListeners = initializeNotificationListeners();
    expect(onFileChange).toBeTypeOf('function');

    onFileChange?.({
      type: 'change',
      path: '/home/testuser/event.jsonl',
      projectId: 'project-2',
      sessionId: 'shared-session',
      isSubagent: false,
      contextId: 'ctx-a',
    });

    vi.advanceTimersByTime(200);

    expect(refreshSessionInPlace).not.toHaveBeenCalled();
  });

  it('matches context-enriched todo events to contextless tabs in single-context mode', () => {
    if (!useStore || !initializeNotificationListeners) {
      throw new Error('Store module not initialized');
    }

    const refreshSessionInPlace = vi.fn().mockResolvedValue(undefined);
    const visibleContextlessTab: Tab = {
      id: 'tab-session',
      type: 'session',
      sessionId: 'session-1',
      projectId: 'project-1',
      label: 'Session 1',
      createdAt: 1,
    };

    useStore.setState({
      refreshSessionInPlace,
      refreshSessionsInPlace: vi.fn().mockResolvedValue(undefined),
      refreshCombinedSessionsInPlace: vi.fn().mockResolvedValue(undefined),
      fetchNotifications: vi.fn().mockResolvedValue(undefined),
      combinedModeEnabled: false,
      activeContextId: 'ctx-local',
      selectedProjectId: 'project-other',
      selectedSessionId: 'different-session',
      paneLayout: {
        panes: [
          {
            id: 'pane-default',
            tabs: [visibleContextlessTab],
            activeTabId: visibleContextlessTab.id,
            selectedTabIds: [],
            widthFraction: 1,
          },
        ],
        focusedPaneId: 'pane-default',
      },
      openTabs: [visibleContextlessTab],
      activeTabId: visibleContextlessTab.id,
    } as never);

    cleanupListeners = initializeNotificationListeners();
    expect(onTodoChange).toBeTypeOf('function');

    onTodoChange?.({
      type: 'change',
      path: '/home/testuser/todo-session-1.json',
      projectId: 'project-1',
      sessionId: 'session-1',
      isSubagent: false,
      contextId: 'ctx-local',
    });

    vi.advanceTimersByTime(200);

    expect(refreshSessionInPlace).toHaveBeenCalledWith('project-1', 'session-1');
  });
});
