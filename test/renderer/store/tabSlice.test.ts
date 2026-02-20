/**
 * Tab slice unit tests.
 * Tests tab state management including deduplication, forceNewTab, scroll position,
 * and the unified navigation request model.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI, type MockElectronAPI } from '../../mocks/electronAPI';

import { createTestStore, type TestStore } from './storeTestUtils';

import type { TabNavigationRequest } from '../../../src/renderer/types/tabs';

describe('tabSlice', () => {
  let store: TestStore;
  let mockAPI: MockElectronAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    mockAPI = installMockElectronAPI();
    store = createTestStore();

    // Mock crypto.randomUUID for predictable tab IDs
    let uuidCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `test-uuid-${++uuidCounter}`,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('openTab', () => {
    describe('deduplication', () => {
      it('should focus existing tab when opening same session', () => {
        // Open initial session tab
        store.getState().openTab({
          type: 'session',
          sessionId: 'session-1',
          projectId: 'project-1',
          label: 'First Session',
        });

        const initialTabId = store.getState().activeTabId;
        expect(store.getState().openTabs).toHaveLength(1);

        // Open another tab
        store.getState().openTab({
          type: 'session',
          sessionId: 'session-2',
          projectId: 'project-1',
          label: 'Second Session',
        });

        expect(store.getState().openTabs).toHaveLength(2);
        expect(store.getState().activeTabId).not.toBe(initialTabId);

        // Try to open session-1 again - should deduplicate
        store.getState().openTab({
          type: 'session',
          sessionId: 'session-1',
          projectId: 'project-1',
          label: 'First Session Again',
        });

        expect(store.getState().openTabs).toHaveLength(2);
        expect(store.getState().activeTabId).toBe(initialTabId);
      });

      it('should bypass deduplication when forceNewTab is true', () => {
        // Open initial session tab
        store.getState().openTab({
          type: 'session',
          sessionId: 'session-1',
          projectId: 'project-1',
          label: 'First Session',
        });

        const initialTabId = store.getState().activeTabId;
        expect(store.getState().openTabs).toHaveLength(1);

        // Open same session with forceNewTab
        store.getState().openTab(
          {
            type: 'session',
            sessionId: 'session-1',
            projectId: 'project-1',
            label: 'First Session (New Tab)',
          },
          { forceNewTab: true }
        );

        // Should have 2 tabs now, both for the same session
        expect(store.getState().openTabs).toHaveLength(2);
        expect(store.getState().activeTabId).not.toBe(initialTabId);

        // Both tabs should have the same sessionId
        const sessionTabs = store.getState().openTabs.filter((t) => t.sessionId === 'session-1');
        expect(sessionTabs).toHaveLength(2);
      });

      it('should not deduplicate dashboard tabs', () => {
        store.getState().openDashboard();
        store.getState().openDashboard();

        expect(store.getState().openTabs).toHaveLength(2);
        expect(store.getState().openTabs.filter((t) => t.type === 'dashboard')).toHaveLength(2);
      });

      it('should treat same sessionId in different projects as distinct in combined mode', () => {
        store.setState({ combinedModeEnabled: true });

        store.getState().openTab({
          type: 'session',
          sessionId: 'shared-session',
          projectId: 'project-1',
          label: 'Shared Session A',
        });
        store.getState().openTab({
          type: 'session',
          sessionId: 'shared-session',
          projectId: 'project-2',
          label: 'Shared Session B',
        });

        expect(store.getState().openTabs).toHaveLength(2);
      });

      it('should treat same sessionId/projectId in different contexts as distinct in combined mode', () => {
        store.setState({ combinedModeEnabled: true });

        store.getState().openTab({
          type: 'session',
          sessionId: 'shared-session',
          projectId: 'project-1',
          contextId: 'local',
          label: 'Local Session',
        });
        store.getState().openTab({
          type: 'session',
          sessionId: 'shared-session',
          projectId: 'project-1',
          contextId: 'ssh-context',
          label: 'Remote Session',
        });

        expect(store.getState().openTabs).toHaveLength(2);
        // Opening the same context+project+session again should dedup
        store.getState().openTab({
          type: 'session',
          sessionId: 'shared-session',
          projectId: 'project-1',
          contextId: 'local',
          label: 'Local Session Again',
        });
        expect(store.getState().openTabs).toHaveLength(2);
      });

      it('should skip combined-mode dedupe when contextId is missing', () => {
        store.setState({ combinedModeEnabled: true });

        store.getState().openTab({
          type: 'session',
          sessionId: 'shared-session',
          projectId: 'project-1',
          label: 'Unknown Context A',
        });
        const firstTabId = store.getState().activeTabId;

        store.getState().openTab({
          type: 'session',
          sessionId: 'shared-session',
          projectId: 'project-1',
          label: 'Unknown Context B',
        });

        expect(store.getState().openTabs).toHaveLength(2);
        expect(store.getState().activeTabId).not.toBe(firstTabId);
      });

      it('should prioritize replaceActiveTab over deduplication', () => {
        store.getState().openTab({
          type: 'session',
          sessionId: 'session-1',
          projectId: 'project-1',
          label: 'Session 1',
        });
        const firstTabId = store.getState().activeTabId;

        store.getState().openTab({
          type: 'session',
          sessionId: 'session-2',
          projectId: 'project-1',
          label: 'Session 2',
        });
        const secondTabId = store.getState().activeTabId;

        store.getState().openTab(
          {
            type: 'session',
            sessionId: 'session-1',
            projectId: 'project-1',
            label: 'Session 1 (Replace)',
          },
          { replaceActiveTab: true }
        );

        expect(store.getState().activeTabId).toBe(secondTabId);
        expect(store.getState().activeTabId).not.toBe(firstTabId);
        expect(store.getState().openTabs).toHaveLength(2);
        expect(store.getState().openTabs.map((tab) => tab.sessionId)).toEqual([
          'session-1',
          'session-1',
        ]);
      });
    });

    describe('dashboard replacement', () => {
      it('should replace active dashboard tab when opening session', () => {
        store.getState().openDashboard();
        const dashboardTabId = store.getState().activeTabId;

        store.getState().openTab({
          type: 'session',
          sessionId: 'session-1',
          projectId: 'project-1',
          label: 'Session 1',
        });

        expect(store.getState().openTabs).toHaveLength(1);
        // Tab should keep same ID (position preserved)
        expect(store.getState().activeTabId).toBe(dashboardTabId);
        // But now it's a session tab
        expect(store.getState().openTabs[0].type).toBe('session');
        expect(store.getState().openTabs[0].sessionId).toBe('session-1');
      });
    });

    describe('label truncation', () => {
      it('should truncate labels longer than 50 characters', () => {
        const longLabel = 'A'.repeat(60);

        store.getState().openTab({
          type: 'session',
          sessionId: 'session-1',
          projectId: 'project-1',
          label: longLabel,
        });

        const tab = store.getState().openTabs[0];
        expect(tab.label).toHaveLength(50);
        expect(tab.label.endsWith('…')).toBe(true);
      });
    });
  });

  describe('closeTab', () => {
    it('should focus adjacent tab when closing active tab', () => {
      // Open 3 tabs
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Tab 1',
      });

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-2',
        projectId: 'project-1',
        label: 'Tab 2',
      });
      const tab2Id = store.getState().activeTabId;

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-3',
        projectId: 'project-1',
        label: 'Tab 3',
      });
      const tab3Id = store.getState().activeTabId;

      // Close tab 3 (active tab)
      store.getState().closeTab(tab3Id!);

      // Should focus tab 2 (previous tab)
      expect(store.getState().openTabs).toHaveLength(2);
      expect(store.getState().activeTabId).toBe(tab2Id);
    });

    it('should reset state when all tabs closed', () => {
      // Setup some state
      store.setState({
        selectedProjectId: 'project-1',
        selectedSessionId: 'session-1',
      });

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Tab 1',
      });
      const tabId = store.getState().activeTabId;

      store.getState().closeTab(tabId!);

      expect(store.getState().openTabs).toHaveLength(0);
      expect(store.getState().activeTabId).toBeNull();
      expect(store.getState().selectedProjectId).toBeNull();
      expect(store.getState().selectedSessionId).toBeNull();
    });
  });

  describe('setActiveTab', () => {
    it('should update activeTabId', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });
      const tab1Id = store.getState().activeTabId;

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-2',
        projectId: 'project-1',
        label: 'Session 2',
      });

      // Switch back to first tab
      store.getState().setActiveTab(tab1Id!);

      expect(store.getState().activeTabId).toBe(tab1Id);
    });

    it('should preserve sidebar state for non-session tabs', () => {
      // Setup initial state with projects data so setActiveTab can find the project
      store.setState({
        selectedProjectId: 'project-1',
        selectedSessionId: 'session-1',
        projects: [
          { id: 'project-1', name: 'Project 1', path: '/path/1', sessions: ['session-1'] },
          { id: 'project-2', name: 'Project 2', path: '/path/2', sessions: ['session-2'] },
        ] as never[],
      });

      // Open session-2 tab first (this doesn't call setActiveTab, just sets activeTabId)
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-2',
        projectId: 'project-2',
        label: 'Session 2',
      });
      const sessionTabId = store.getState().activeTabId;

      // Manually call setActiveTab to sync sidebar state (simulating user click)
      store.getState().setActiveTab(sessionTabId!);
      expect(store.getState().selectedProjectId).toBe('project-2');

      // Open dashboard tab
      store.getState().openDashboard();
      const dashboardTabId = store.getState().activeTabId;

      // Switch to dashboard (should preserve sidebar state)
      store.getState().setActiveTab(dashboardTabId!);

      expect(store.getState().activeTabId).toBe(dashboardTabId);
      // Sidebar state should be preserved (not cleared) when switching to dashboard
      expect(store.getState().selectedProjectId).toBe('project-2');
    });

    it('should switch context and refetch when activating a tab in another context', async () => {
      store.setState({
        combinedModeEnabled: true,
        activeContextId: 'local',
        selectedProjectId: 'project-1',
        selectedSessionId: 'shared-session',
        projects: [
          { id: 'project-1', name: 'Project 1', path: '/path/1', sessions: ['shared-session'] },
        ] as never[],
      } as never);

      const switchContext = vi.fn((contextId: string) => {
        store.setState({ activeContextId: contextId } as never);
        return Promise.resolve();
      });
      const fetchSessionDetail = vi.fn().mockResolvedValue(undefined);
      store.setState({ switchContext, fetchSessionDetail } as never);

      store.getState().openTab({
        type: 'session',
        sessionId: 'shared-session',
        projectId: 'project-1',
        contextId: 'local',
        label: 'Local Session',
      });

      store.getState().openTab({
        type: 'session',
        sessionId: 'shared-session',
        projectId: 'project-1',
        contextId: 'ssh-context',
        label: 'Remote Session',
      });
      const remoteTabId = store.getState().activeTabId;

      store.getState().setActiveTab(remoteTabId!);
      await Promise.resolve();
      await Promise.resolve();

      expect(switchContext).toHaveBeenCalledWith('ssh-context');
      expect(fetchSessionDetail).toHaveBeenCalledWith('project-1', 'shared-session', remoteTabId);
    });

    it('should refetch when sessionId matches but project differs', () => {
      store.setState({
        combinedModeEnabled: true,
        selectedProjectId: 'project-1',
        selectedSessionId: 'shared-session',
        projects: [
          { id: 'project-1', name: 'Project 1', path: '/path/1', sessions: ['shared-session'] },
          { id: 'project-2', name: 'Project 2', path: '/path/2', sessions: ['shared-session'] },
        ] as never[],
      } as never);

      const fetchSessionDetail = vi.fn().mockResolvedValue(undefined);
      store.setState({ fetchSessionDetail } as never);

      store.getState().openTab({
        type: 'session',
        sessionId: 'shared-session',
        projectId: 'project-1',
        label: 'Project 1',
      });

      store.getState().openTab({
        type: 'session',
        sessionId: 'shared-session',
        projectId: 'project-2',
        label: 'Project 2',
      });
      const project2TabId = store.getState().activeTabId;

      store.getState().setActiveTab(project2TabId!);

      expect(fetchSessionDetail).toHaveBeenCalledWith('project-2', 'shared-session', project2TabId);
    });

    it('should ignore stale async activation continuation after a newer tab click', async () => {
      store.setState({
        combinedModeEnabled: true,
        activeContextId: 'local',
        selectedProjectId: null,
        selectedSessionId: null,
        projects: [
          { id: 'project-1', name: 'Project 1', path: '/path/1', sessions: ['session-a'] },
          { id: 'project-2', name: 'Project 2', path: '/path/2', sessions: ['session-b'] },
        ] as never[],
      } as never);

      let resolveSwitchContext: (() => void) | null = null;
      const switchContext = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveSwitchContext = () => {
              store.setState({ activeContextId: 'ssh-context' } as never);
              resolve();
            };
          })
      );
      const fetchSessionDetail = vi.fn().mockResolvedValue(undefined);
      store.setState({ switchContext, fetchSessionDetail } as never);

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-a',
        projectId: 'project-1',
        contextId: 'ssh-context',
        label: 'Session A',
      });
      const tabAId = store.getState().activeTabId;

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-b',
        projectId: 'project-2',
        contextId: 'local',
        label: 'Session B',
      });
      const tabBId = store.getState().activeTabId;

      // Click A (starts async context switch), then quickly click B.
      store.getState().setActiveTab(tabAId!);
      store.getState().setActiveTab(tabBId!);

      resolveSwitchContext?.();
      await Promise.resolve();
      await Promise.resolve();

      expect(store.getState().activeTabId).toBe(tabBId);
      expect(store.getState().selectedSessionId).toBe('session-b');
      expect(fetchSessionDetail).toHaveBeenCalledWith('project-2', 'session-b', tabBId);
      expect(fetchSessionDetail).not.toHaveBeenCalledWith('project-1', 'session-a', tabAId);
    });

    it('should ignore stale continuation when active tab id is reused via replaceActiveTab', async () => {
      store.setState({
        combinedModeEnabled: true,
        activeContextId: 'local',
        selectedProjectId: null,
        selectedSessionId: null,
        projects: [
          { id: 'project-1', name: 'Project 1', path: '/path/1', sessions: ['session-a'] },
          { id: 'project-2', name: 'Project 2', path: '/path/2', sessions: ['session-b'] },
        ] as never[],
      } as never);

      let resolveSwitchContext: (() => void) | null = null;
      const switchContext = vi.fn((contextId: string) => {
        if (contextId === 'ssh-context') {
          return new Promise<void>((resolve) => {
            resolveSwitchContext = () => {
              store.setState({ activeContextId: 'ssh-context' } as never);
              resolve();
            };
          });
        }
        store.setState({ activeContextId: contextId } as never);
        return Promise.resolve();
      });
      const fetchSessionDetail = vi.fn().mockResolvedValue(undefined);
      store.setState({ switchContext, fetchSessionDetail } as never);

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-a',
        projectId: 'project-1',
        contextId: 'ssh-context',
        label: 'Session A',
      });
      const reusedTabId = store.getState().activeTabId;

      // Start async activation for Session A (requires context switch).
      store.getState().setActiveTab(reusedTabId!);

      // Reuse the same tab id for Session B before Session A activation resolves.
      store.getState().openTab(
        {
          type: 'session',
          sessionId: 'session-b',
          projectId: 'project-2',
          contextId: 'local',
          label: 'Session B',
        },
        { replaceActiveTab: true }
      );
      store.getState().setActiveTab(reusedTabId!);

      resolveSwitchContext?.();
      await Promise.resolve();
      await Promise.resolve();

      const activeTab = store.getState().getActiveTab();
      expect(activeTab?.type).toBe('session');
      expect(activeTab?.sessionId).toBe('session-b');
      expect(activeTab?.projectId).toBe('project-2');
      expect(fetchSessionDetail).toHaveBeenCalledWith('project-2', 'session-b', reusedTabId);
      expect(fetchSessionDetail).not.toHaveBeenCalledWith('project-1', 'session-a', reusedTabId);
    });
  });

  describe('saveTabScrollPosition', () => {
    it('should save scroll position for a tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });
      const tabId = store.getState().activeTabId!;

      // Initially undefined
      expect(store.getState().openTabs[0].savedScrollTop).toBeUndefined();

      // Save scroll position
      store.getState().saveTabScrollPosition(tabId, 500);

      expect(store.getState().openTabs[0].savedScrollTop).toBe(500);
    });

    it('should only update the specified tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });
      const tab1Id = store.getState().activeTabId!;

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-2',
        projectId: 'project-1',
        label: 'Session 2',
      });

      // Save scroll position for tab 1
      store.getState().saveTabScrollPosition(tab1Id, 300);

      // Tab 1 should have scroll position, tab 2 should not
      const tab1 = store.getState().openTabs.find((t) => t.id === tab1Id);
      const tab2 = store.getState().openTabs.find((t) => t.id !== tab1Id);

      expect(tab1?.savedScrollTop).toBe(300);
      expect(tab2?.savedScrollTop).toBeUndefined();
    });
  });

  describe('setTabContextPanelVisible', () => {
    it('should set context panel visibility for a tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });
      const tabId = store.getState().activeTabId!;

      // Initially undefined
      expect(store.getState().openTabs[0].showContextPanel).toBeUndefined();

      // Set to true
      store.getState().setTabContextPanelVisible(tabId, true);
      expect(store.getState().openTabs[0].showContextPanel).toBe(true);

      // Set to false
      store.getState().setTabContextPanelVisible(tabId, false);
      expect(store.getState().openTabs[0].showContextPanel).toBe(false);
    });

    it('should only update the specified tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });
      const tab1Id = store.getState().activeTabId!;

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-2',
        projectId: 'project-1',
        label: 'Session 2',
      });

      // Set context panel visible for tab 1
      store.getState().setTabContextPanelVisible(tab1Id, true);

      // Tab 1 should have context panel visible, tab 2 should not
      const tab1 = store.getState().openTabs.find((t) => t.id === tab1Id);
      const tab2 = store.getState().openTabs.find((t) => t.id !== tab1Id);

      expect(tab1?.showContextPanel).toBe(true);
      expect(tab2?.showContextPanel).toBeUndefined();
    });
  });

  describe('enqueueTabNavigation', () => {
    it('should set pendingNavigation on the tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });

      const tabId = store.getState().activeTabId!;
      const request: TabNavigationRequest = {
        id: 'nav-1',
        kind: 'error',
        source: 'notification',
        highlight: 'red',
        payload: {
          errorId: 'error-1',
          errorTimestamp: 12345,
          toolUseId: 'tool-1',
          lineNumber: 42,
        },
      };

      store.getState().enqueueTabNavigation(tabId, request);

      const tab = store.getState().openTabs[0];
      expect(tab.pendingNavigation).toEqual(request);
    });

    it('should replace existing pendingNavigation with new request', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });

      const tabId = store.getState().activeTabId!;
      const request1: TabNavigationRequest = {
        id: 'nav-1',
        kind: 'error',
        source: 'notification',
        highlight: 'red',
        payload: { errorId: 'e1', errorTimestamp: 100 },
      };
      const request2: TabNavigationRequest = {
        id: 'nav-2',
        kind: 'error',
        source: 'notification',
        highlight: 'red',
        payload: { errorId: 'e2', errorTimestamp: 200 },
      };

      store.getState().enqueueTabNavigation(tabId, request1);
      store.getState().enqueueTabNavigation(tabId, request2);

      const tab = store.getState().openTabs[0];
      expect(tab.pendingNavigation?.id).toBe('nav-2');
    });

    it('should only update the specified tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });
      const tab1Id = store.getState().activeTabId!;

      store.getState().openTab({
        type: 'session',
        sessionId: 'session-2',
        projectId: 'project-1',
        label: 'Session 2',
      });

      const request: TabNavigationRequest = {
        id: 'nav-1',
        kind: 'search',
        source: 'commandPalette',
        highlight: 'yellow',
        payload: { query: 'test', messageTimestamp: 1234, matchedText: 'match' },
      };

      store.getState().enqueueTabNavigation(tab1Id, request);

      const tab1 = store.getState().openTabs.find((t) => t.id === tab1Id);
      const tab2 = store.getState().openTabs.find((t) => t.id !== tab1Id);
      expect(tab1?.pendingNavigation).toEqual(request);
      expect(tab2?.pendingNavigation).toBeUndefined();
    });
  });

  describe('consumeTabNavigation', () => {
    it('should clear pendingNavigation and set lastConsumedNavigationId', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });

      const tabId = store.getState().activeTabId!;
      const request: TabNavigationRequest = {
        id: 'nav-1',
        kind: 'error',
        source: 'notification',
        highlight: 'red',
        payload: { errorId: 'error-1', errorTimestamp: 12345 },
      };

      store.getState().enqueueTabNavigation(tabId, request);
      expect(store.getState().openTabs[0].pendingNavigation).toBeDefined();

      store.getState().consumeTabNavigation(tabId, 'nav-1');

      const tab = store.getState().openTabs[0];
      expect(tab.pendingNavigation).toBeUndefined();
      expect(tab.lastConsumedNavigationId).toBe('nav-1');
    });

    it('should not clear if requestId does not match', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });

      const tabId = store.getState().activeTabId!;
      const request: TabNavigationRequest = {
        id: 'nav-1',
        kind: 'error',
        source: 'notification',
        highlight: 'red',
        payload: { errorId: 'error-1', errorTimestamp: 12345 },
      };

      store.getState().enqueueTabNavigation(tabId, request);
      store.getState().consumeTabNavigation(tabId, 'wrong-id');

      // Should still have pendingNavigation since IDs don't match
      const tab = store.getState().openTabs[0];
      expect(tab.pendingNavigation).toEqual(request);
    });
  });

  describe('isSessionOpen', () => {
    it('should return true if session is open in any tab', () => {
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });

      expect(store.getState().isSessionOpen('session-1')).toBe(true);
      expect(store.getState().isSessionOpen('session-2')).toBe(false);
    });
  });

  describe('navigateToSession', () => {
    it('should open new tab if session not already open', () => {
      mockAPI.getSessionDetail.mockResolvedValue({
        session: { id: 'session-1' },
        chunks: [],
      } as never);

      store.getState().navigateToSession('project-1', 'session-1', false);

      expect(store.getState().openTabs).toHaveLength(1);
      expect(store.getState().openTabs[0].sessionId).toBe('session-1');
    });

    it('should focus existing tab with search navigation request', () => {
      // First open the session
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });
      const existingTabId = store.getState().activeTabId;

      // Open another tab to switch away
      store.getState().openDashboard();

      // Navigate to same session with search context
      store.getState().navigateToSession('project-1', 'session-1', true, {
        query: 'test query',
        messageTimestamp: 1234567890,
        matchedText: 'matched text',
      });

      // Should focus existing tab
      expect(store.getState().activeTabId).toBe(existingTabId);
      // Should have a pending search navigation request
      const tab = store.getState().openTabs.find((t) => t.id === existingTabId);
      expect(tab?.pendingNavigation?.kind).toBe('search');
      expect(tab?.pendingNavigation?.payload).toEqual({
        query: 'test query',
        messageTimestamp: 1234567890,
        matchedText: 'matched text',
      });
    });

    it('should enqueue search navigation on new tab', () => {
      mockAPI.getSessionDetail.mockResolvedValue({
        session: { id: 'session-1' },
        chunks: [],
      } as never);

      store.getState().navigateToSession('project-1', 'session-1', false, {
        query: 'find me',
        messageTimestamp: 9999,
        matchedText: 'found',
      });

      const tab = store.getState().openTabs[0];
      expect(tab.pendingNavigation?.kind).toBe('search');
      expect(tab.pendingNavigation?.source).toBe('commandPalette');
      expect(tab.pendingNavigation?.highlight).toBe('yellow');
    });

    it('should not reuse tabs across projects in combined mode', () => {
      store.setState({ combinedModeEnabled: true });
      store.getState().openTab({
        type: 'session',
        sessionId: 'shared-session',
        projectId: 'project-1',
        label: 'Shared Session A',
      });
      const initialTabId = store.getState().activeTabId;

      store.getState().navigateToSession('project-2', 'shared-session');

      expect(store.getState().openTabs).toHaveLength(2);
      expect(store.getState().activeTabId).not.toBe(initialTabId);
    });
  });
});
