/**
 * Store index - combines all slices and exports the unified store.
 */

import { api } from '@renderer/api';
import { create } from 'zustand';

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
import { createSubagentMessageCacheSlice } from './slices/subagentMessageCacheSlice';
import { createSubagentSlice } from './slices/subagentSlice';
import { createTabSlice } from './slices/tabSlice';
import { createTabUISlice } from './slices/tabUISlice';
import { createUISlice } from './slices/uiSlice';
import { createUpdateSlice } from './slices/updateSlice';

import type { DetectedError } from '../types/data';
import type { AppState } from './types';
import type { UpdaterStatus } from '@shared/types';

// =============================================================================
// Store Creation
// =============================================================================

export const useStore = create<AppState>()((...args) => ({
  ...createProjectSlice(...args),
  ...createRepositorySlice(...args),
  ...createSessionSlice(...args),
  ...createSessionDetailSlice(...args),
  ...createSubagentSlice(...args),
  ...createSubagentMessageCacheSlice(...args),
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
  const lastKnownSizes = new Map<string, number>();
  /**
   * Tracks when each session's refresh last *executed* (not scheduled).
   * Used to enforce a minimum cooldown between actual refresh cycles.
   * During streaming, the adaptive debounce (100ms for small deltas) would
   * otherwise fire 10 refreshes/second, each creating a full IPC roundtrip +
   * JSONL parse + conversation transformation → 3-6 GB/min allocations that
   * outpace GC → unbounded renderer memory growth → crash at 3.4 GB.
   *
   * A 3 s cooldown floor reduces this to ~0.3/sec (20× fewer allocations)
   * while keeping the UI visually responsive for humans.
   */
  const lastRefreshTimestamps = new Map<string, number>();
  const REFRESH_COOLDOWN_MS = 3000;
  /** When renderer heap exceeds this, double the cooldown to ease GC pressure. */
  const MEMORY_PRESSURE_THRESHOLD_MB = 1500;
  /** When renderer heap exceeds this, skip refreshes entirely (only manual Ctrl+R). */
  const MEMORY_CRITICAL_THRESHOLD_MB = 2500;
  const SESSION_REFRESH_DEBOUNCE_MS = 150;
  const PROJECT_REFRESH_DEBOUNCE_MS = 300;

  /** Check renderer memory pressure via Chrome-specific performance.memory API. */
  function getRendererHeapMB(): number {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
    return mem?.usedJSHeapSize ? Math.round(mem.usedJSHeapSize / (1024 * 1024)) : 0;
  }
  const getBaseProjectId = (projectId: string | null | undefined): string | null => {
    if (!projectId) return null;
    const separatorIndex = projectId.indexOf('::');
    return separatorIndex >= 0 ? projectId.slice(0, separatorIndex) : projectId;
  };

  const scheduleSessionRefresh = (
    projectId: string,
    sessionId: string,
    fileSize?: number
  ): void => {
    const key = `${projectId}/${sessionId}`;
    // Throttle (not trailing debounce): keep at most one pending refresh per session.
    if (pendingSessionRefreshTimers.has(key)) {
      return;
    }

    // Memory pressure gate: skip auto-refresh entirely when renderer heap is
    // critically high. The user can still force-refresh with Ctrl+R.
    const heapMB = getRendererHeapMB();
    if (heapMB > MEMORY_CRITICAL_THRESHOLD_MB) {
      return; // Refuse to allocate more — GC needs breathing room
    }

    // Delta-based adaptive debounce: use file size change to estimate refresh urgency.
    // Small changes (1-2 messages) refresh near-instantly; large changes (bulk writes)
    // debounce longer to avoid GC pressure from re-transforming huge conversations.
    let debounceMs = SESSION_REFRESH_DEBOUNCE_MS; // 150ms default
    if (fileSize != null) {
      const isFirstEvent = !lastKnownSizes.has(key);
      const lastSize = lastKnownSizes.get(key) ?? 0;
      const delta = fileSize - lastSize;
      lastKnownSizes.set(key, fileSize);

      // First event for a session: seed baseline and use default debounce
      // instead of treating the full file size as a huge delta.
      if (!isFirstEvent) {
        if (delta < 0) {
          // File shrunk (compaction, truncation, atomic rewrite) — refresh immediately
          // and reset baseline so subsequent growth deltas are measured correctly.
          debounceMs = 100;
          lastKnownSizes.set(key, fileSize);
        } else if (delta === 0) {
          debounceMs = 0; // No change — skip
        } else {
          debounceMs =
            delta < 5000
              ? 100 // Small (~1-2 messages): near-instant
              : delta < 50000
                ? 500 // Medium: 500ms
                : delta < 200000
                  ? 2000 // Large: 2s
                  : 5000; // Very large: 5s
        }
      }
    }

    if (debounceMs <= 0) return; // Skip if no change

    // Enforce minimum cooldown between actual refresh executions.
    // If the last refresh for this session fired recently, push the timer
    // forward so it fires at the cooldown boundary instead of immediately.
    // Under memory pressure (>1.5 GB heap), double the cooldown to ease GC.
    const cooldown = heapMB > MEMORY_PRESSURE_THRESHOLD_MB
      ? REFRESH_COOLDOWN_MS * 2
      : REFRESH_COOLDOWN_MS;
    const lastFired = lastRefreshTimestamps.get(key) ?? 0;
    const elapsed = Date.now() - lastFired;
    if (elapsed < cooldown) {
      debounceMs = Math.max(debounceMs, cooldown - elapsed);
    }

    const timer = setTimeout(() => {
      pendingSessionRefreshTimers.delete(key);
      lastRefreshTimestamps.set(key, Date.now());
      // Prune timestamps map to prevent unbounded growth
      if (lastRefreshTimestamps.size > 200) {
        const entries = [...lastRefreshTimestamps.entries()];
        lastRefreshTimestamps.clear();
        for (const [k, v] of entries.slice(-100)) lastRefreshTimestamps.set(k, v);
      }
      const state = useStore.getState();
      void state.refreshSessionInPlace(projectId, sessionId);
    }, debounceMs);
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
  const isSessionVisibleInAnyPane = (sessionId: string): boolean => {
    const { paneLayout } = useStore.getState();
    return paneLayout.panes.some(
      (pane) =>
        pane.activeTabId != null &&
        pane.tabs.some(
          (tab) =>
            tab.id === pane.activeTabId && tab.type === 'session' && tab.sessionId === sessionId
        )
    );
  };

  // Listen for task-list file changes to refresh currently viewed session metadata
  if (api.onTodoChange) {
    const cleanup = api.onTodoChange((event) => {
      if (!event.sessionId || event.type === 'unlink') {
        return;
      }

      const state = useStore.getState();
      const isViewingSession =
        state.selectedSessionId === event.sessionId || isSessionVisibleInAnyPane(event.sessionId);

      if (isViewingSession) {
        // Find the project ID from any pane's tab that shows this session
        const allTabs = state.getAllPaneTabs();
        const sessionTab = allTabs.find(
          (t) => t.type === 'session' && t.sessionId === event.sessionId
        );
        if (sessionTab?.projectId) {
          scheduleSessionRefresh(sessionTab.projectId, event.sessionId);
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
      // Skip unlink events
      if (event.type === 'unlink') {
        return;
      }

      const state = useStore.getState();
      const selectedProjectId = state.selectedProjectId;
      const selectedProjectBaseId = getBaseProjectId(selectedProjectId);
      const eventProjectBaseId = getBaseProjectId(event.projectId);
      const matchesSelectedProject =
        !!selectedProjectId &&
        (eventProjectBaseId == null || selectedProjectBaseId === eventProjectBaseId);
      const isTopLevelSessionEvent = !event.isSubagent;
      const isUnknownSessionInSidebar =
        event.sessionId == null ||
        !state.sessions.some((session) => session.id === event.sessionId);
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

      // Refresh the project list when a file change arrives from a project
      // not currently in our projects array — this handles brand-new projects.
      if (event.projectId && isTopLevelSessionEvent) {
        const knownProjectIds = new Set(state.projects.map((p) => p.id));
        const eventBaseId = getBaseProjectId(event.projectId);
        const isNewProject =
          eventBaseId != null && !knownProjectIds.has(event.projectId) &&
          ![...knownProjectIds].some((id) => getBaseProjectId(id) === eventBaseId);
        if (isNewProject) {
          void state.fetchProjects();
        }
      }

      // Keep opened session view in sync on content changes.
      // Some local writers emit rename/add for in-place updates, so include "add".
      if ((event.type === 'change' || event.type === 'add') && selectedProjectId) {
        const activeSessionId = state.selectedSessionId;
        const eventSessionId = event.sessionId;
        const isViewingEventSession =
          !!eventSessionId &&
          (activeSessionId === eventSessionId || isSessionVisibleInAnyPane(eventSessionId));
        const shouldFallbackRefreshActiveSession =
          matchesSelectedProject && !eventSessionId && !!activeSessionId;
        const sessionIdToRefresh =
          (isViewingEventSession ? eventSessionId : null) ??
          (shouldFallbackRefreshActiveSession ? activeSessionId : null);

        if (sessionIdToRefresh) {
          // Use event.projectId as authoritative source — it identifies the project
          // that actually changed, not the one currently selected in the UI.
          // Fixes: new sessions in non-selected projects never auto-loading.
          const refreshProjectId =
            event.projectId ??
            state.getAllPaneTabs().find(
              (tab) => tab.type === 'session' && tab.sessionId === sessionIdToRefresh
            )?.projectId ??
            selectedProjectId;

          scheduleSessionRefresh(refreshProjectId, sessionIdToRefresh, event.fileSize);
        }
      }
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Listen for Ctrl+R / Cmd+R session refresh from main process (fixes #85)
  if (api.onSessionRefresh) {
    const cleanup = api.onSessionRefresh(() => {
      const state = useStore.getState();
      const activeTabId = state.activeTabId;
      const activeTab = activeTabId ? state.openTabs.find((t) => t.id === activeTabId) : null;
      if (activeTab?.type === 'session' && activeTab.projectId && activeTab.sessionId) {
        void Promise.all([
          state.refreshSessionInPlace(activeTab.projectId, activeTab.sessionId),
          state.fetchSessions(activeTab.projectId),
        ]).then(() => {
          window.dispatchEvent(new CustomEvent('session-refresh-scroll-bottom'));
        });
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
  // NOTE: Only syncs connection status here. Data fetching is handled by
  // connectionSlice.connectSsh/disconnectSsh and contextSlice.switchContext.
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
      const { id } = data as { id: string; type: string };
      const currentContextId = useStore.getState().activeContextId;
      if (id !== currentContextId) {
        // Main process switched context externally (e.g., SSH disconnect)
        // Trigger renderer-side context switch to sync state
        void useStore.getState().switchContext(id);
      }
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Periodically prune lastKnownSizes to prevent unbounded growth.
  // Entries older than 30 minutes are unlikely to be needed for delta estimation.
  const PRUNE_INTERVAL_MS = 10 * 60_000; // every 10 minutes
  const MAX_LAST_KNOWN_SIZE_ENTRIES = 500;
  const pruneInterval = setInterval(() => {
    if (lastKnownSizes.size > MAX_LAST_KNOWN_SIZE_ENTRIES) {
      // Keep only the most recent half — Map iteration order is insertion order
      const entries = [...lastKnownSizes.entries()];
      const keep = entries.slice(entries.length - Math.floor(MAX_LAST_KNOWN_SIZE_ENTRIES / 2));
      lastKnownSizes.clear();
      for (const [k, v] of keep) lastKnownSizes.set(k, v);
    }
  }, PRUNE_INTERVAL_MS);

  // Return cleanup function
  return () => {
    clearInterval(pruneInterval);
    for (const timer of pendingSessionRefreshTimers.values()) {
      clearTimeout(timer);
    }
    pendingSessionRefreshTimers.clear();
    for (const timer of pendingProjectRefreshTimers.values()) {
      clearTimeout(timer);
    }
    pendingProjectRefreshTimers.clear();
    lastKnownSizes.clear();
    cleanupFns.forEach((fn) => fn());
  };
}
