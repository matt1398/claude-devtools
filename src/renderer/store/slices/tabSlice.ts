/**
 * Tab slice - manages tab state and actions.
 *
 * Facade pattern: All tab mutations operate on the paneLayout and sync
 * root-level openTabs/activeTabId/selectedTabIds from the focused pane
 * for backward compatibility.
 */

import {
  createSearchNavigationRequest,
  findTabBySession,
  findTabBySessionAndProject,
  truncateLabel,
} from '@renderer/types/tabs';

import {
  findPane,
  findPaneByTabId,
  getAllTabs,
  removePane as removePaneHelper,
  syncFocusedPaneState,
  updatePane,
} from '../utils/paneHelpers';
import { getFullResetState } from '../utils/stateResetHelpers';

import type { AppState, SearchNavigationContext } from '../types';
import type { PaneLayout } from '@renderer/types/panes';
import type { OpenTabOptions, Tab, TabInput, TabNavigationRequest } from '@renderer/types/tabs';
import type { StateCreator } from 'zustand';

// =============================================================================
// Slice Interface
// =============================================================================

export interface TabSlice {
  // State (synced from focused pane for backward compat)
  openTabs: Tab[];
  activeTabId: string | null;
  selectedTabIds: string[];

  // Project context state
  activeProjectId: string | null;

  // Actions
  openTab: (tab: TabInput, options?: OpenTabOptions) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  openDashboard: () => void;
  openSessionReport: (sourceTabId: string) => void;
  getActiveTab: () => Tab | null;
  isSessionOpen: (sessionId: string) => boolean;
  enqueueTabNavigation: (tabId: string, request: TabNavigationRequest) => void;
  consumeTabNavigation: (tabId: string, requestId: string) => void;
  saveTabScrollPosition: (tabId: string, scrollTop: number) => void;

  // Project context actions
  setActiveProject: (projectId: string) => void;

  // Per-tab UI state actions
  setTabContextPanelVisible: (tabId: string, visible: boolean) => void;
  updateTabLabel: (tabId: string, label: string) => void;

  // Multi-select actions
  setSelectedTabIds: (ids: string[]) => void;
  clearTabSelection: () => void;

  // Bulk close actions
  closeOtherTabs: (tabId: string) => void;
  closeTabsToRight: (tabId: string) => void;
  closeAllTabs: () => void;
  closeTabs: (tabIds: string[]) => void;

  // Navigation actions
  navigateToSession: (
    projectId: string,
    sessionId: string,
    fromSearch?: boolean,
    searchContext?: SearchNavigationContext
  ) => void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Sync root-level state from the focused pane.
 */
function syncFromLayout(layout: PaneLayout): Record<string, unknown> {
  const synced = syncFocusedPaneState(layout);
  return {
    paneLayout: layout,
    openTabs: synced.openTabs,
    activeTabId: synced.activeTabId,
    selectedTabIds: synced.selectedTabIds,
  };
}

/**
 * Update a tab in whichever pane contains it, returning the new layout.
 */
function updateTabInLayout(
  layout: PaneLayout,
  tabId: string,
  updater: (tab: Tab) => Tab
): PaneLayout {
  const pane = findPaneByTabId(layout, tabId);
  if (!pane) return layout;
  return updatePane(layout, {
    ...pane,
    tabs: pane.tabs.map((t) => (t.id === tabId ? updater(t) : t)),
  });
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createTabSlice: StateCreator<AppState, [], [], TabSlice> = (set, get) => ({
  // Initial state (synced from focused pane)
  openTabs: [],
  activeTabId: null,
  selectedTabIds: [],

  // Project context state
  activeProjectId: null,

  // Open a tab in the focused pane, or focus existing if sessionId matches (within focused pane)
  openTab: (tab: TabInput, options?: OpenTabOptions) => {
    const state = get();
    const { paneLayout } = state;
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    // If opening a session tab, check for duplicates first (unless forceNewTab)
    if (tab.type === 'session' && tab.sessionId && !options?.forceNewTab) {
      // Check across ALL panes for dedup
      const allTabs = getAllTabs(paneLayout);
      const existing = findTabBySession(allTabs, tab.sessionId);
      if (existing) {
        // Focus existing tab (which will also focus its pane)
        state.setActiveTab(existing.id);
        return;
      }

      // Replace active tab if replaceActiveTab option is set or active tab is a dashboard
      const activeTab = focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId);
      if (activeTab && (options?.replaceActiveTab || activeTab.type === 'dashboard')) {
        // Cleanup old tab's state if it was a session tab
        if (activeTab.type === 'session') {
          state.cleanupTabUIState(activeTab.id);
          state.cleanupTabSessionData(activeTab.id);
        }

        const replacementTab: Tab = {
          ...tab,
          id: activeTab.id,
          label: truncateLabel(tab.label),
          createdAt: Date.now(),
        };

        const updatedPane = {
          ...focusedPane,
          tabs: focusedPane.tabs.map((t) => (t.id === activeTab.id ? replacementTab : t)),
          activeTabId: replacementTab.id,
        };
        const newLayout = updatePane(paneLayout, updatedPane);
        set(syncFromLayout(newLayout));
        return;
      }
    }

    // Create new tab with generated id and timestamp
    const newTab: Tab = {
      ...tab,
      id: crypto.randomUUID(),
      label: truncateLabel(tab.label),
      createdAt: Date.now(),
    };

    const updatedPane = {
      ...focusedPane,
      tabs: [...focusedPane.tabs, newTab],
      activeTabId: newTab.id,
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  // Close a tab by ID in whichever pane contains it
  closeTab: (tabId: string) => {
    const state = get();
    const { paneLayout } = state;
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const index = pane.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    // Cleanup per-tab UI state and session data
    state.cleanupTabUIState(tabId);
    state.cleanupTabSessionData(tabId);

    const newTabs = pane.tabs.filter((t) => t.id !== tabId);

    // Determine new active tab within this pane
    let newActiveId = pane.activeTabId;
    if (pane.activeTabId === tabId) {
      newActiveId = newTabs[index]?.id ?? newTabs[index - 1]?.id ?? null;
    }

    // If pane becomes empty and it's not the only pane, close the pane
    if (newTabs.length === 0 && paneLayout.panes.length > 1) {
      state.closePane(pane.id);
      return;
    }

    // If all tabs across all panes are gone, reset to initial state
    const allOtherTabs = paneLayout.panes.filter((p) => p.id !== pane.id).flatMap((p) => p.tabs);
    if (newTabs.length === 0 && allOtherTabs.length === 0) {
      const updatedPane = { ...pane, tabs: [], activeTabId: null, selectedTabIds: [] };
      const newLayout = updatePane(paneLayout, updatedPane);
      set({
        ...syncFromLayout(newLayout),
        ...getFullResetState(),
      });
      return;
    }

    const updatedPane = {
      ...pane,
      tabs: newTabs,
      activeTabId: newActiveId,
      selectedTabIds: pane.selectedTabIds.filter((id) => id !== tabId),
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));

    // Sync sidebar state for the newly active tab (project, repository, sessions)
    if (newActiveId) {
      get().setActiveTab(newActiveId);
    }
  },

  // Switch focus to an existing tab
  // Also syncs sidebar state for session tabs to match the tab's project/session
  setActiveTab: (tabId: string) => {
    const state = get();
    const { paneLayout } = state;

    // Find which pane contains this tab
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Update pane's activeTabId and focus the pane
    const updatedPane = { ...pane, activeTabId: tabId };
    let newLayout = updatePane(paneLayout, updatedPane);
    newLayout = { ...newLayout, focusedPaneId: pane.id };
    set(syncFromLayout(newLayout));

    // For session tabs, sync sidebar state to match
    if (tab.type === 'session' && tab.sessionId && tab.projectId) {
      const sessionId = tab.sessionId;
      const projectId = tab.projectId;
      const sessionChanged = state.selectedSessionId !== sessionId;

      // Check if per-tab data is already cached
      const cachedTabData = state.tabSessionData[tabId];
      const hasCachedData = cachedTabData?.conversation != null;

      // Find the repository and worktree containing this session
      let foundRepo: string | null = null;
      let foundWorktree: string | null = null;

      for (const repo of state.repositoryGroups) {
        for (const wt of repo.worktrees) {
          if (wt.sessions.includes(sessionId)) {
            foundRepo = repo.id;
            foundWorktree = wt.id;
            break;
          }
        }
        if (foundRepo) break;
      }

      if (foundRepo && foundWorktree) {
        const worktreeChanged = state.selectedWorktreeId !== foundWorktree;
        set({
          selectedRepositoryId: foundRepo,
          selectedWorktreeId: foundWorktree,
          selectedSessionId: sessionId,
          activeProjectId: foundWorktree,
          selectedProjectId: foundWorktree,
        });
        if (worktreeChanged) {
          void get().fetchSessionsInitial(foundWorktree);
        }
        if (sessionChanged) {
          if (hasCachedData) {
            // Swap global state from per-tab cache (no re-fetch)
            set({
              sessionDetail: cachedTabData.sessionDetail,
              conversation: cachedTabData.conversation,
              conversationLoading: false,
              sessionDetailLoading: false,
              sessionDetailError: null,
              sessionClaudeMdStats: cachedTabData.sessionClaudeMdStats,
              sessionContextStats: cachedTabData.sessionContextStats,
              sessionPhaseInfo: cachedTabData.sessionPhaseInfo,
              visibleAIGroupId: cachedTabData.visibleAIGroupId,
              selectedAIGroup: cachedTabData.selectedAIGroup,
            });
          } else {
            void get().fetchSessionDetail(foundWorktree, sessionId, tabId);
          }
        }
        return;
      }

      // Fallback: search in flat projects
      const project = state.projects.find(
        (p) => p.id === projectId || p.sessions.includes(sessionId)
      );
      if (project) {
        const projectChanged = state.selectedProjectId !== project.id;
        set({
          activeProjectId: project.id,
          selectedProjectId: project.id,
          selectedSessionId: sessionId,
        });
        if (projectChanged) {
          void get().fetchSessionsInitial(project.id);
        }
        if (sessionChanged) {
          if (hasCachedData) {
            // Swap global state from per-tab cache (no re-fetch)
            set({
              sessionDetail: cachedTabData.sessionDetail,
              conversation: cachedTabData.conversation,
              conversationLoading: false,
              sessionDetailLoading: false,
              sessionDetailError: null,
              sessionClaudeMdStats: cachedTabData.sessionClaudeMdStats,
              sessionContextStats: cachedTabData.sessionContextStats,
              sessionPhaseInfo: cachedTabData.sessionPhaseInfo,
              visibleAIGroupId: cachedTabData.visibleAIGroupId,
              selectedAIGroup: cachedTabData.selectedAIGroup,
            });
          } else {
            void get().fetchSessionDetail(project.id, sessionId, tabId);
          }
        }
        return;
      }
    }
  },

  // Open a new dashboard tab in the focused pane
  openDashboard: () => {
    const state = get();
    const { paneLayout } = state;
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    const newTab: Tab = {
      id: crypto.randomUUID(),
      type: 'dashboard',
      label: 'Dashboard',
      createdAt: Date.now(),
    };

    const updatedPane = {
      ...focusedPane,
      tabs: [...focusedPane.tabs, newTab],
      activeTabId: newTab.id,
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  // Open a session report tab based on a source session tab
  openSessionReport: (sourceTabId: string) => {
    const state = get();
    const allTabs = getAllTabs(state.paneLayout);
    const sourceTab = allTabs.find((t) => t.id === sourceTabId);
    if (sourceTab?.type !== 'session') return;
    if (!sourceTab.sessionId || !sourceTab.projectId) return;

    const tabData = state.tabSessionData[sourceTabId];
    const firstMsg = tabData?.sessionDetail?.session.firstMessage;
    const label = firstMsg
      ? `Report: ${firstMsg.slice(0, 30)}${firstMsg.length > 30 ? '…' : ''}`
      : 'Session Report';

    state.openTab({
      type: 'report',
      label,
      projectId: sourceTab.projectId,
      sessionId: sourceTab.sessionId,
    });
  },

  // Get the currently active tab (from the focused pane)
  getActiveTab: () => {
    const state = get();
    const focusedPane = findPane(state.paneLayout, state.paneLayout.focusedPaneId);
    if (!focusedPane?.activeTabId) return null;
    return focusedPane.tabs.find((t) => t.id === focusedPane.activeTabId) ?? null;
  },

  // Check if a session is already open in any pane
  isSessionOpen: (sessionId: string) => {
    const allTabs = getAllTabs(get().paneLayout);
    return allTabs.some((t) => t.type === 'session' && t.sessionId === sessionId);
  },

  // Enqueue a navigation request on a tab (in whichever pane contains it)
  enqueueTabNavigation: (tabId: string, request: TabNavigationRequest) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) => ({
      ...tab,
      pendingNavigation: request,
    }));
    set(syncFromLayout(newLayout));
  },

  // Mark a navigation request as consumed
  consumeTabNavigation: (tabId: string, requestId: string) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) =>
      tab.pendingNavigation?.id === requestId
        ? { ...tab, pendingNavigation: undefined, lastConsumedNavigationId: requestId }
        : tab
    );
    set(syncFromLayout(newLayout));
  },

  // Save scroll position for a tab
  saveTabScrollPosition: (tabId: string, scrollTop: number) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) => ({
      ...tab,
      savedScrollTop: scrollTop,
    }));
    set(syncFromLayout(newLayout));
  },

  // Update a tab's label (used by sessionDetailSlice after fetching session data)
  updateTabLabel: (tabId: string, label: string) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) => ({
      ...tab,
      label,
    }));
    set(syncFromLayout(newLayout));
  },

  // Set context panel visibility for a specific tab
  setTabContextPanelVisible: (tabId: string, visible: boolean) => {
    const { paneLayout } = get();
    const newLayout = updateTabInLayout(paneLayout, tabId, (tab) => ({
      ...tab,
      showContextPanel: visible,
    }));
    set(syncFromLayout(newLayout));
  },

  // Set multi-selected tab IDs (within the focused pane)
  setSelectedTabIds: (ids: string[]) => {
    const { paneLayout } = get();
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    const updatedPane = { ...focusedPane, selectedTabIds: ids };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  // Clear multi-selection in the focused pane
  clearTabSelection: () => {
    const { paneLayout } = get();
    const focusedPane = findPane(paneLayout, paneLayout.focusedPaneId);
    if (!focusedPane) return;

    const updatedPane = { ...focusedPane, selectedTabIds: [] };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));
  },

  // Close all tabs except the specified one (within the pane containing the tab)
  closeOtherTabs: (tabId: string) => {
    const state = get();
    const { paneLayout } = state;
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const tabsToClose = pane.tabs.filter((t) => t.id !== tabId);
    for (const tab of tabsToClose) {
      state.cleanupTabUIState(tab.id);
    }

    const keepTab = pane.tabs.find((t) => t.id === tabId);
    if (!keepTab) return;

    const updatedPane = {
      ...pane,
      tabs: [keepTab],
      activeTabId: tabId,
      selectedTabIds: [],
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));

    // Sync sidebar state for the remaining tab
    get().setActiveTab(tabId);
  },

  // Close all tabs to the right (within the pane containing the tab)
  closeTabsToRight: (tabId: string) => {
    const state = get();
    const { paneLayout } = state;
    const pane = findPaneByTabId(paneLayout, tabId);
    if (!pane) return;

    const index = pane.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return;

    const tabsToClose = pane.tabs.slice(index + 1);
    for (const tab of tabsToClose) {
      state.cleanupTabUIState(tab.id);
    }

    const newTabs = pane.tabs.slice(0, index + 1);
    const activeStillExists = newTabs.some((t) => t.id === pane.activeTabId);
    const newActiveId = activeStillExists ? pane.activeTabId : tabId;
    const updatedPane = {
      ...pane,
      tabs: newTabs,
      activeTabId: newActiveId,
      selectedTabIds: [],
    };
    const newLayout = updatePane(paneLayout, updatedPane);
    set(syncFromLayout(newLayout));

    // Sync sidebar state for the active tab
    if (newActiveId) {
      get().setActiveTab(newActiveId);
    }
  },

  // Close all tabs across all panes, reset to initial state
  closeAllTabs: () => {
    const state = get();
    const allTabs = getAllTabs(state.paneLayout);
    for (const tab of allTabs) {
      state.cleanupTabUIState(tab.id);
      state.cleanupTabSessionData(tab.id);
    }

    // Reset to single empty pane
    const defaultPaneId = state.paneLayout.panes[0]?.id ?? 'pane-default';
    const newLayout: PaneLayout = {
      panes: [
        {
          id: defaultPaneId,
          tabs: [],
          activeTabId: null,
          selectedTabIds: [],
          widthFraction: 1,
        },
      ],
      focusedPaneId: defaultPaneId,
    };

    set({
      ...syncFromLayout(newLayout),
      ...getFullResetState(),
    });
  },

  // Close multiple tabs by ID (within the pane containing them)
  closeTabs: (tabIds: string[]) => {
    const state = get();
    const idSet = new Set(tabIds);

    // Cleanup UI state and session data
    for (const id of idSet) {
      state.cleanupTabUIState(id);
      state.cleanupTabSessionData(id);
    }

    // Group tabs by pane for batch removal
    let { paneLayout } = state;
    const panesToRemove: string[] = [];

    for (const pane of paneLayout.panes) {
      const remainingTabs = pane.tabs.filter((t) => !idSet.has(t.id));

      if (remainingTabs.length === pane.tabs.length) continue; // No tabs removed from this pane

      if (remainingTabs.length === 0 && paneLayout.panes.length > 1) {
        panesToRemove.push(pane.id);
        continue;
      }

      // Determine new active tab
      let newActiveId = pane.activeTabId;
      if (newActiveId && idSet.has(newActiveId)) {
        const oldIndex = pane.tabs.findIndex((t) => t.id === newActiveId);
        newActiveId = null;
        for (let i = oldIndex; i < pane.tabs.length; i++) {
          if (!idSet.has(pane.tabs[i].id)) {
            newActiveId = pane.tabs[i].id;
            break;
          }
        }
        if (!newActiveId) {
          for (let i = oldIndex - 1; i >= 0; i--) {
            if (!idSet.has(pane.tabs[i].id)) {
              newActiveId = pane.tabs[i].id;
              break;
            }
          }
        }
        newActiveId = newActiveId ?? remainingTabs[0]?.id ?? null;
      }

      paneLayout = updatePane(paneLayout, {
        ...pane,
        tabs: remainingTabs,
        activeTabId: newActiveId,
        selectedTabIds: pane.selectedTabIds.filter((id) => !idSet.has(id)),
      });
    }

    // Check if ALL tabs are now gone
    const allRemainingTabs = getAllTabs(paneLayout);
    if (allRemainingTabs.length === 0) {
      state.closeAllTabs();
      return;
    }

    // Remove empty panes
    for (const paneId of panesToRemove) {
      paneLayout = removePaneHelper(paneLayout, paneId);
    }

    set(syncFromLayout(paneLayout));

    // Sync sidebar state for the new active tab
    const newActiveTabId = get().activeTabId;
    if (newActiveTabId) {
      get().setActiveTab(newActiveTabId);
    }
  },

  // Set active project and fetch its sessions
  setActiveProject: (projectId: string) => {
    set({ activeProjectId: projectId });
    get().selectProject(projectId);
  },

  // Navigate to a session (from search or other sources)
  navigateToSession: (
    projectId: string,
    sessionId: string,
    fromSearch = false,
    searchContext?: SearchNavigationContext
  ) => {
    const state = get();

    // Check if session tab is already open in any pane
    const allTabs = getAllTabs(state.paneLayout);
    const existingTab =
      findTabBySessionAndProject(allTabs, sessionId, projectId) ??
      findTabBySession(allTabs, sessionId);

    if (existingTab) {
      // Focus existing tab via setActiveTab for proper sidebar sync
      state.setActiveTab(existingTab.id);

      // Enqueue search navigation if search context provided
      if (searchContext) {
        const searchPayload = {
          query: searchContext.query,
          messageTimestamp: searchContext.messageTimestamp,
          matchedText: searchContext.matchedText,
          ...(searchContext.targetGroupId !== undefined
            ? { targetGroupId: searchContext.targetGroupId }
            : {}),
          ...(searchContext.targetMatchIndexInItem !== undefined
            ? { targetMatchIndexInItem: searchContext.targetMatchIndexInItem }
            : {}),
          ...(searchContext.targetMatchStartOffset !== undefined
            ? { targetMatchStartOffset: searchContext.targetMatchStartOffset }
            : {}),
          ...(searchContext.targetMessageUuid !== undefined
            ? { targetMessageUuid: searchContext.targetMessageUuid }
            : {}),
        };
        const navRequest = createSearchNavigationRequest({
          ...searchPayload,
        });
        state.enqueueTabNavigation(existingTab.id, navRequest);
      }
    } else {
      // Open the session in a new tab
      state.openTab({
        type: 'session',
        label: 'Loading...',
        projectId,
        sessionId,
        fromSearch,
      });

      // Enqueue search navigation on the newly created tab
      if (searchContext) {
        const newState = get();
        const newTabId = newState.activeTabId;
        if (newTabId) {
          // Re-focus tab via setActiveTab for proper sidebar sync
          state.setActiveTab(newTabId);

          const searchPayload = {
            query: searchContext.query,
            messageTimestamp: searchContext.messageTimestamp,
            matchedText: searchContext.matchedText,
            ...(searchContext.targetGroupId !== undefined
              ? { targetGroupId: searchContext.targetGroupId }
              : {}),
            ...(searchContext.targetMatchIndexInItem !== undefined
              ? { targetMatchIndexInItem: searchContext.targetMatchIndexInItem }
              : {}),
            ...(searchContext.targetMatchStartOffset !== undefined
              ? { targetMatchStartOffset: searchContext.targetMatchStartOffset }
              : {}),
            ...(searchContext.targetMessageUuid !== undefined
              ? { targetMessageUuid: searchContext.targetMessageUuid }
              : {}),
          };
          const navRequest = createSearchNavigationRequest({
            ...searchPayload,
          });
          state.enqueueTabNavigation(newTabId, navRequest);
        }
      }

      // Fetch session detail for the new tab (with tabId for per-tab data)
      const newTabIdForFetch = get().activeTabId ?? undefined;
      void state.fetchSessionDetail(projectId, sessionId, newTabIdForFetch);
    }
  },
});
