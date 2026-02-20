/**
 * Store index - combines all slices and exports the unified store.
 */

import { api } from '@renderer/api';
import { create } from 'zustand';

import { createCombinedSessionsSlice } from './slices/combinedSessionsSlice';
import { createConfigSlice } from './slices/configSlice';
import { createConnectionSlice } from './slices/connectionSlice';
import { createContextSlice } from './slices/contextSlice';
import { createConversationSlice } from './slices/conversationSlice';
import { createNotificationSlice } from './slices/notificationSlice';
import { createPaneSlice } from './slices/paneSlice';
import { createProjectSlice } from './slices/projectSlice';
import { createRepositorySlice } from './slices/repositorySlice';
import { createSessionDetailSlice } from './slices/sessionDetailSlice';
import { createSessionSlice } from './slices/sessionSlice';
import { createSubagentSlice } from './slices/subagentSlice';
import { createTabSlice } from './slices/tabSlice';
import { createTabUISlice } from './slices/tabUISlice';
import { createUISlice } from './slices/uiSlice';
import { createUpdateSlice } from './slices/updateSlice';

import type { DetectedError } from '../types/data';
import type { AppState } from './types';
import type { Tab } from '@renderer/types/tabs';
import type { ContextInfo, UpdaterStatus } from '@shared/types';

// =============================================================================
// Store Creation
// =============================================================================

export const useStore = create<AppState>()((...args) => ({
  ...createProjectSlice(...args),
  ...createRepositorySlice(...args),
  ...createCombinedSessionsSlice(...args),
  ...createSessionSlice(...args),
  ...createSessionDetailSlice(...args),
  ...createSubagentSlice(...args),
  ...createConversationSlice(...args),
  ...createTabSlice(...args),
  ...createTabUISlice(...args),
  ...createPaneSlice(...args),
  ...createUISlice(...args),
  ...createNotificationSlice(...args),
  ...createConfigSlice(...args),
  ...createConnectionSlice(...args),
  ...createContextSlice(...args),
  ...createUpdateSlice(...args),
}));

// =============================================================================
// Re-exports
// =============================================================================

// =============================================================================
// Store Initialization - Subscribe to IPC Events
// =============================================================================

/**
 * Initialize notification event listeners and fetch initial notification count.
 * Call this once when the app starts (e.g., in App.tsx useEffect).
 */
export function initializeNotificationListeners(): () => void {
  const cleanupFns: (() => void)[] = [];
  const pendingSessionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingProjectRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let pendingCombinedRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const SESSION_REFRESH_DEBOUNCE_MS = 150;
  const PROJECT_REFRESH_DEBOUNCE_MS = 300;
  const COMBINED_REFRESH_DEBOUNCE_MS = 1000;
  const getBaseProjectId = (projectId: string | null | undefined): string | null => {
    if (!projectId) return null;
    const separatorIndex = projectId.indexOf('::');
    return separatorIndex >= 0 ? projectId.slice(0, separatorIndex) : projectId;
  };

  const scheduleSessionRefresh = (projectId: string, sessionId: string): void => {
    const key = `${projectId}/${sessionId}`;
    // Throttle (not trailing debounce): keep at most one pending refresh per session.
    // Debounce can delay updates indefinitely while the file is continuously appended.
    if (pendingSessionRefreshTimers.has(key)) {
      return;
    }
    const timer = setTimeout(() => {
      pendingSessionRefreshTimers.delete(key);
      const state = useStore.getState();
      void state.refreshSessionInPlace(projectId, sessionId);
    }, SESSION_REFRESH_DEBOUNCE_MS);
    pendingSessionRefreshTimers.set(key, timer);
  };

  const scheduleProjectRefresh = (projectId: string): void => {
    const existingTimer = pendingProjectRefreshTimers.get(projectId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = setTimeout(() => {
      pendingProjectRefreshTimers.delete(projectId);
      const state = useStore.getState();
      void state.refreshSessionsInPlace(projectId);
    }, PROJECT_REFRESH_DEBOUNCE_MS);
    pendingProjectRefreshTimers.set(projectId, timer);
  };

  const scheduleCombinedRefresh = (): void => {
    if (pendingCombinedRefreshTimer) {
      clearTimeout(pendingCombinedRefreshTimer);
    }
    pendingCombinedRefreshTimer = setTimeout(() => {
      pendingCombinedRefreshTimer = null;
      const state = useStore.getState();
      void state.refreshCombinedSessionsInPlace();
    }, COMBINED_REFRESH_DEBOUNCE_MS);
  };

  // Listen for new notifications from main process
  if (api.notifications?.onNew) {
    const cleanup = api.notifications.onNew((_event: unknown, error: unknown) => {
      // Cast the error to DetectedError type
      const notification = error as DetectedError;
      if (notification?.id) {
        // Keep list in sync immediately; unread count is synced via notification:updated/fetch.
        useStore.setState((state) => {
          if (state.notifications.some((n) => n.id === notification.id)) {
            return {};
          }
          return { notifications: [notification, ...state.notifications].slice(0, 200) };
        });
      }
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Listen for notification updates from main process
  if (api.notifications?.onUpdated) {
    const cleanup = api.notifications.onUpdated(
      (_event: unknown, payload: { total: number; unreadCount: number }) => {
        const unreadCount =
          typeof payload.unreadCount === 'number' && Number.isFinite(payload.unreadCount)
            ? Math.max(0, Math.floor(payload.unreadCount))
            : 0;
        useStore.setState({ unreadCount });
      }
    );
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Navigate to error when user clicks a native OS notification
  if (api.notifications?.onClicked) {
    const cleanup = api.notifications.onClicked((_event: unknown, data: unknown) => {
      const error = data as DetectedError;
      if (error?.id && error?.sessionId && error?.projectId) {
        useStore.getState().navigateToError(error);
      }
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Fetch after listeners are attached so startup events do not get overwritten by a stale response.
  void useStore.getState().fetchNotifications();

  /**
   * Check if a session is visible in any pane (not just the focused pane's active tab).
   * This ensures file change and task-list listeners refresh sessions shown in any split pane.
   */
  const doesSessionTabMatchEventIdentity = (
    tab: {
      id: string;
      type: string;
      sessionId?: string;
      projectId?: string;
      contextId?: string;
    },
    sessionId: string,
    projectId?: string,
    contextId?: string,
    combinedModeEnabled = false
  ): boolean =>
    tab.type === 'session' &&
    tab.sessionId === sessionId &&
    (projectId == null || tab.projectId === projectId) &&
    (!contextId ||
      tab.contextId === contextId ||
      (!combinedModeEnabled && tab.contextId == null));

  const getVisibleSessionTab = (
    sessionId: string,
    projectId?: string,
    contextId?: string,
    combinedModeEnabled = false
  ): Tab | null => {
    const { paneLayout } = useStore.getState();
    for (const pane of paneLayout.panes) {
      if (!pane.activeTabId) {
        continue;
      }
      const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId);
      if (
        activeTab &&
        doesSessionTabMatchEventIdentity(
          activeTab,
          sessionId,
          projectId,
          contextId,
          combinedModeEnabled
        )
      ) {
        return activeTab;
      }
    }
    return null;
  };
  const isSessionVisibleInAnyPane = (
    sessionId: string,
    projectId?: string,
    contextId?: string,
    combinedModeEnabled = false
  ): boolean => getVisibleSessionTab(sessionId, projectId, contextId, combinedModeEnabled) !== null;

  // Listen for task-list file changes to refresh currently viewed session metadata
  if (api.onTodoChange) {
    const cleanup = api.onTodoChange((event) => {
      if (!event.sessionId || event.type === 'unlink') {
        return;
      }
      const sessionId = event.sessionId;

      const state = useStore.getState();
      const isActiveContextEvent = !event.contextId || event.contextId === state.activeContextId;
      // Skip non-active-context events entirely — session detail refresh requires
      // the active context's scanner, so cross-context task-list refreshes would
      // target the wrong backend. In combined mode, the detail will refresh when
      // the user opens/switches to that session's context.
      if (!isActiveContextEvent) {
        return;
      }

      const selectedSessionMatchesIdentity =
        state.selectedSessionId === sessionId &&
        (event.projectId == null || state.selectedProjectId === event.projectId) &&
        (!state.combinedModeEnabled || !event.contextId || state.activeContextId === event.contextId);
      const visibleSessionTab = getVisibleSessionTab(
        sessionId,
        event.projectId,
        event.contextId,
        state.combinedModeEnabled
      );
      const isViewingSession = selectedSessionMatchesIdentity || visibleSessionTab !== null;

      if (isViewingSession) {
        // Find a matching session tab identity across panes (active or background)
        const canDisambiguateByEventIdentity = event.projectId != null || !!event.contextId;
        const allTabs = state.getAllPaneTabs();
        const sessionTab = canDisambiguateByEventIdentity
          ? allTabs.find((t) =>
              doesSessionTabMatchEventIdentity(
                t,
                sessionId,
                event.projectId,
                event.contextId,
                state.combinedModeEnabled
              )
            )
          : null;
        const projectIdForRefresh =
          visibleSessionTab?.projectId ??
          (selectedSessionMatchesIdentity ? state.selectedProjectId : null) ??
          sessionTab?.projectId ??
          event.projectId;
        if (projectIdForRefresh) {
          scheduleSessionRefresh(projectIdForRefresh, sessionId);
        }
      }

      // Refresh project sessions list if applicable
      const activeTab = state.getActiveTab();
      const activeProjectId =
        activeTab?.type === 'session' && typeof activeTab.projectId === 'string'
          ? activeTab.projectId
          : null;
      if (activeProjectId && activeProjectId === state.selectedProjectId) {
        scheduleProjectRefresh(activeProjectId);
      }
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Listen for file changes to auto-refresh current session and detect new sessions
  if (api.onFileChange) {
    const cleanup = api.onFileChange((event) => {
      const state = useStore.getState();

      // Combined mode: handle all event types including unlink (for ghost session cleanup).
      // Must run before the single-context unlink guard below.
      if (state.combinedModeEnabled && event.contextId && !event.isSubagent) {
        if (event.type === 'add' || event.type === 'change' || event.type === 'unlink') {
          scheduleCombinedRefresh();
        }
      }

      // Skip unlink events for single-context handling
      if (event.type === 'unlink') {
        return;
      }

      const isActiveContextEvent = !event.contextId || event.contextId === state.activeContextId;
      if (!isActiveContextEvent) {
        return;
      }

      const selectedProjectId = state.selectedProjectId;
      const selectedProjectBaseId = getBaseProjectId(selectedProjectId);
      const eventProjectBaseId = getBaseProjectId(event.projectId);
      const matchesSelectedProject =
        !!selectedProjectId &&
        (eventProjectBaseId == null || selectedProjectBaseId === eventProjectBaseId);
      const isTopLevelSessionEvent = !event.isSubagent;
      const isUnknownSessionInSidebar =
        event.sessionId == null ||
        (state.combinedModeEnabled
          ? !state.combinedSessions.some(
              (session) =>
                session.id === event.sessionId &&
                session.projectId === event.projectId &&
                (!event.contextId || session.contextId === event.contextId)
            )
          : !state.sessions.some((session) => session.id === event.sessionId));
      const shouldRefreshForPotentialNewSession =
        isTopLevelSessionEvent &&
        matchesSelectedProject &&
        isUnknownSessionInSidebar &&
        (event.type === 'add' || (state.connectionMode === 'local' && event.type === 'change'));

      // Refresh sidebar session list only when a truly new top-level session appears.
      // Local fs.watch can report "change" before/without "add" for newly created files.
      if (shouldRefreshForPotentialNewSession) {
        if (matchesSelectedProject && selectedProjectId) {
          scheduleProjectRefresh(selectedProjectId);
        }
      }

      // Keep opened session view in sync on content changes.
      // Some local writers emit rename/add for in-place updates, so include "add".
      if ((event.type === 'change' || event.type === 'add') && selectedProjectId) {
        const activeSessionId = state.selectedSessionId;
        const eventSessionId = event.sessionId;
        const selectedSessionMatchesIdentity =
          !!eventSessionId &&
          state.selectedSessionId === eventSessionId &&
          (event.projectId == null || state.selectedProjectId === event.projectId) &&
          (!state.combinedModeEnabled ||
            !event.contextId ||
            state.activeContextId === event.contextId);
        const visibleEventSessionTab =
          eventSessionId != null
            ? getVisibleSessionTab(
                eventSessionId,
                event.projectId,
                event.contextId,
                state.combinedModeEnabled
              )
            : null;
        const isViewingEventSession =
          !!eventSessionId &&
          (selectedSessionMatchesIdentity ||
            isSessionVisibleInAnyPane(
              eventSessionId,
              event.projectId,
              event.contextId,
              state.combinedModeEnabled
            ));
        const shouldFallbackRefreshActiveSession =
          matchesSelectedProject && !eventSessionId && !!activeSessionId;
        const sessionIdToRefresh =
          (isViewingEventSession ? eventSessionId : null) ??
          (shouldFallbackRefreshActiveSession ? activeSessionId : null);

        if (sessionIdToRefresh) {
          const allTabs = state.getAllPaneTabs();
          const matchingSessionTab =
            eventSessionId != null
              ? allTabs.find((tab) =>
                  doesSessionTabMatchEventIdentity(
                    tab,
                    eventSessionId,
                    event.projectId,
                    event.contextId,
                    state.combinedModeEnabled
                  )
                )
              : null;
          const refreshProjectId =
            visibleEventSessionTab?.projectId ??
            (selectedSessionMatchesIdentity ? state.selectedProjectId : null) ??
            matchingSessionTab?.projectId ??
            event.projectId ??
            selectedProjectId;

          // Use refreshSessionInPlace to avoid flickering and preserve UI state
          scheduleSessionRefresh(refreshProjectId, sessionIdToRefresh);
        }
      }
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Listen for updater status events from main process
  if (api.updater?.onStatus) {
    const cleanup = api.updater.onStatus((_event: unknown, status: unknown) => {
      const s = status as UpdaterStatus;
      switch (s.type) {
        case 'checking':
          useStore.setState({ updateStatus: 'checking' });
          break;
        case 'available':
          useStore.setState({
            updateStatus: 'available',
            availableVersion: s.version ?? null,
            releaseNotes: s.releaseNotes ?? null,
            showUpdateDialog: true,
          });
          break;
        case 'not-available':
          useStore.setState({ updateStatus: 'not-available' });
          break;
        case 'downloading':
          useStore.setState({
            updateStatus: 'downloading',
            downloadProgress: s.progress?.percent ?? 0,
          });
          break;
        case 'downloaded':
          useStore.setState({
            updateStatus: 'downloaded',
            downloadProgress: 100,
            availableVersion: s.version ?? useStore.getState().availableVersion,
          });
          break;
        case 'error':
          useStore.setState({
            updateStatus: 'error',
            updateError: s.error ?? 'Unknown error',
          });
          break;
      }
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Listen for SSH connection status changes from main process
  // NOTE: Only syncs connection status here. Context switching and data fetching
  // are handled by contextSlice.switchContext.
  if (api.ssh?.onStatus) {
    const cleanup = api.ssh.onStatus((_event: unknown, status: unknown) => {
      const s = status as { state: string; host: string | null; error: string | null };
      useStore
        .getState()
        .setConnectionStatus(
          s.state as 'disconnected' | 'connecting' | 'connected' | 'error',
          s.host,
          s.error
        );
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Listen for context changes from main process (e.g., SSH disconnect)
  if (api.context?.onChanged) {
    const cleanup = api.context.onChanged((_event: unknown, data: unknown) => {
      const context = data as ContextInfo;
      const { id } = context;
      const currentContextId = useStore.getState().activeContextId;
      if (id !== currentContextId) {
        // Main process switched context externally (e.g., SSH disconnect)
        // Trigger renderer-side context switch to sync state
        void useStore.getState().switchContext(id);
      } else {
        useStore.setState({ connectionMode: context.type === 'ssh' ? 'ssh' : 'local' });
      }
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Return cleanup function
  return () => {
    for (const timer of pendingSessionRefreshTimers.values()) {
      clearTimeout(timer);
    }
    pendingSessionRefreshTimers.clear();
    for (const timer of pendingProjectRefreshTimers.values()) {
      clearTimeout(timer);
    }
    pendingProjectRefreshTimers.clear();
    if (pendingCombinedRefreshTimer) {
      clearTimeout(pendingCombinedRefreshTimer);
      pendingCombinedRefreshTimer = null;
    }
    cleanupFns.forEach((fn) => fn());
  };
}
