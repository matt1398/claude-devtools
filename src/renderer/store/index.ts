/**
 * Store index - combines all slices and exports the unified store.
 */

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';
import { create } from 'zustand';

import { createConfigSlice } from './slices/configSlice';
import { createConnectionSlice } from './slices/connectionSlice';
import { createContextSlice } from './slices/contextSlice';
import { createConversationSlice } from './slices/conversationSlice';
import { createFilterSlice } from './slices/filterSlice';
import { createMemorySlice } from './slices/memorySlice';
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
import type { UpdaterStatus } from '@shared/types';

const logger = createLogger('Store');

// =============================================================================
// Store Creation
// =============================================================================

export const useStore = create<AppState>()((...args) => ({
  ...createProjectSlice(...args),
  ...createRepositorySlice(...args),
  ...createSessionSlice(...args),
  ...createSessionDetailSlice(...args),
  ...createSubagentSlice(...args),
  ...createConversationSlice(...args),
  ...createTabSlice(...args),
  ...createTabUISlice(...args),
  ...createFilterSlice(...args),
  ...createPaneSlice(...args),
  ...createUISlice(...args),
  ...createNotificationSlice(...args),
  ...createConfigSlice(...args),
  ...createConnectionSlice(...args),
  ...createContextSlice(...args),
  ...createUpdateSlice(...args),
  ...createMemorySlice(...args),
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
  // Diagnostic: how often the incremental append path gave up and fell back to a
  // full re-parse. Deltas for sessions that aren't open are counted too, so this
  // is only meaningful as a trend, not an absolute.
  let appendFallbackCount = 0;
  const pendingSessionRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pendingProjectRefreshTimers = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; dueAt: number }
  >();
  const SESSION_REFRESH_DEBOUNCE_MS = 150;
  const PROJECT_REFRESH_DEBOUNCE_MS = 300;
  // A `change` to a session already in the sidebar only moves row metadata
  // (timestamps, counts, and the transcript-derived status dot), so these coalesce
  // on a slow window instead of refetching the page every ~300ms while a session
  // streams. New/unknown sessions still use the fast window above. Trade-off: the
  // sidebar dot can lag by up to this long — the chat pane stays current via
  // `terminal-state-change`, but only when the wezterm hook is installed.
  const KNOWN_SESSION_PROJECT_REFRESH_MS = 2000;
  // The session the user is actively looking at (focused pane's active tab /
  // selectedSessionId) gets a much shorter debounce than background sessions so
  // its chat window feels near-instant. A small floor is kept for very long
  // focused sessions to avoid thrashing the full-file re-parse in main.
  const FOCUSED_SESSION_REFRESH_DEBOUNCE_MS = 75;
  const FOCUSED_SESSION_REFRESH_DEBOUNCE_LARGE_MS = 200;
  // When a session is being kept live by incremental `session-append` deltas, the
  // parallel file-change-driven full refetch is redundant (and pays the very re-parse
  // the append path exists to avoid). If an append was applied within this window, skip
  // the scheduled full refresh; if deltas stop or a gap forces a fallback, the refresh
  // resumes naturally on the next file-change.
  const APPEND_REFRESH_GRACE_MS = 1500;
  const lastAppendAppliedAt = new Map<string, number>();
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

    // Adaptive debounce: large sessions refresh less frequently to coalesce
    // burst file-change events and amortize React re-render cost over a wider
    // window. Uses the TARGET session's cached totalAIGroups so a long session
    // in another pane doesn't force the active short session to the default.
    //
    // The IPC handler short-circuits no-op refreshes via fingerprint matching,
    // so frequent refreshes are cheap when nothing changed. These values are
    // tuned for the cost of a *real* update (incremental transform + zustand
    // setState + re-render), not for raw call frequency.
    const state = useStore.getState();
    const tabData = Object.values(state.tabSessionData).find(
      (td) => td?.sessionDetail?.session?.id === sessionId
    );
    const aiGroupCount =
      tabData?.conversation?.totalAIGroups ??
      (state.conversation?.items ?? []).filter((i) => i.type === 'ai').length;

    // Is this the session the user is actively viewing? The focused pane's
    // active tab (getActiveTab) or the global selectedSessionId both count, so
    // the chat window in front of the user updates fastest while background
    // sessions in other tabs/panes stay coalesced by the adaptive schedule.
    const activeTab = state.getActiveTab();
    const isFocusedSession =
      state.selectedSessionId === sessionId ||
      (activeTab?.type === 'session' && activeTab.sessionId === sessionId);

    const debounceMs = isFocusedSession
      ? aiGroupCount > 500
        ? FOCUSED_SESSION_REFRESH_DEBOUNCE_LARGE_MS // 200ms floor for huge focused sessions
        : FOCUSED_SESSION_REFRESH_DEBOUNCE_MS // 75ms — near-instant for the viewed session
      : aiGroupCount > 500
        ? 1000 // 1s ceiling for very long sessions
        : aiGroupCount > 200
          ? 500 // 500ms for long sessions
          : aiGroupCount > 100
            ? 300 // 300ms for moderate sessions
            : SESSION_REFRESH_DEBOUNCE_MS; // 150ms default

    const timer = setTimeout(() => {
      pendingSessionRefreshTimers.delete(key);
      // Skip the full refetch if the live append path already keeps this session current.
      if (Date.now() - (lastAppendAppliedAt.get(sessionId) ?? 0) < APPEND_REFRESH_GRACE_MS) {
        return;
      }
      const latestState = useStore.getState();
      void latestState.refreshSessionInPlace(projectId, sessionId);
    }, debounceMs);
    pendingSessionRefreshTimers.set(key, timer);
  };

  const scheduleProjectRefresh = (
    projectId: string,
    delayMs: number = PROJECT_REFRESH_DEBOUNCE_MS
  ): void => {
    // Compare DEADLINES, not delays. What matters is when the refresh lands: a
    // 300ms request arriving 1.9s into a pending 2s timer would, on a delay
    // comparison, cancel it and reschedule 200ms LATER than doing nothing.
    // Rescheduling is only ever right if it pulls the refresh earlier.
    const dueAt = Date.now() + delayMs;
    const existing = pendingProjectRefreshTimers.get(projectId);
    if (existing) {
      if (existing.dueAt <= dueAt) {
        return;
      }
      clearTimeout(existing.timer);
    }
    // Note: same-priority events do NOT extend the window — the deadline check
    // above returns early — so this coalesces as a throttle, not a debounce.
    const timer = setTimeout(() => {
      pendingProjectRefreshTimers.delete(projectId);
      const state = useStore.getState();
      void state.refreshSessionsInPlace(projectId);
    }, delayMs);
    pendingProjectRefreshTimers.set(projectId, { timer, dueAt });
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
      const state = useStore.getState();
      const selectedProjectId = state.selectedProjectId;
      const selectedProjectBaseId = getBaseProjectId(selectedProjectId);
      const eventProjectBaseId = getBaseProjectId(event.projectId);

      // A deleted session must leave the sidebar. This is the precise signal for
      // it; the periodic page-1 refresh can only reconcile deletions inside the
      // first page, so without this a removed session outside that window would
      // linger for the life of the process.
      if (event.type === 'unlink') {
        if (!event.isSubagent && event.sessionId) {
          useStore.getState().removeSessionFromList(event.sessionId);
        }
        return;
      }
      // A projectId-less event no longer counts as "the selected project changed".
      // Terminal-state writes used to arrive here with no projectId and matched
      // unconditionally, so every prompt submit and tool call refetched the sidebar
      // page. Those now come over `terminal-state-change` instead, and the only
      // remaining `file-change` emitter always sets projectId. Note this also
      // disables the projectId-less fallback refresh further down.
      const matchesSelectedProject =
        !!selectedProjectId && selectedProjectBaseId === eventProjectBaseId;
      const isTopLevelSessionEvent = !event.isSubagent;
      const isUnknownSessionInSidebar =
        event.sessionId == null ||
        !state.sessions.some((session) => session.id === event.sessionId);
      const shouldRefreshSidebar =
        isTopLevelSessionEvent &&
        matchesSelectedProject &&
        (isUnknownSessionInSidebar || event.type === 'change' || event.type === 'add');

      // Refresh sidebar session list when a new session appears or an existing session updates.
      if (shouldRefreshSidebar) {
        if (matchesSelectedProject && selectedProjectId) {
          // A known session merely growing is cosmetic for the sidebar; coalesce it
          // on the slow window so a streaming session doesn't drive the list.
          const isKnownSessionUpdate = !isUnknownSessionInSidebar && event.type === 'change';
          scheduleProjectRefresh(
            selectedProjectId,
            isKnownSessionUpdate ? KNOWN_SESSION_PROJECT_REFRESH_MS : PROJECT_REFRESH_DEBOUNCE_MS
          );
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
          const allTabs = state.getAllPaneTabs();
          const visibleSessionTab = allTabs.find(
            (tab) => tab.type === 'session' && tab.sessionId === sessionIdToRefresh
          );
          const refreshProjectId = visibleSessionTab?.projectId ?? selectedProjectId;

          // Use refreshSessionInPlace to avoid flickering and preserve UI state
          scheduleSessionRefresh(refreshProjectId, sessionIdToRefresh);
        }
      }
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Listen for live terminal-state changes (wezterm hook). Patched straight into
  // state — no refetch, no fingerprint check. This is what makes the chat pane's
  // "Thinking…" indicator appear the moment a prompt is submitted, before Claude
  // has written anything to the JSONL.
  if (api.onTerminalStateChange) {
    const cleanup = api.onTerminalStateChange((event) => {
      if (!event?.sessionId) {
        return;
      }
      useStore.getState().applyTerminalStateChange(event);
    });
    if (typeof cleanup === 'function') {
      cleanupFns.push(cleanup);
    }
  }

  // Listen for incremental session-append deltas (open-session live updates).
  // Applied in place with no getSessionDetail re-fetch; on any inconsistency we fall
  // back to the existing full-refresh path.
  if (api.onSessionAppend) {
    const cleanup = api.onSessionAppend((event) => {
      if (!event?.sessionId) {
        return;
      }
      const handled = useStore.getState().applySessionAppend(event);
      if (handled) {
        lastAppendAppliedAt.set(event.sessionId, Date.now());
        return;
      }
      // Fallback: the session isn't open in any pane, the delta didn't line up with
      // our baseline (gap/overlap, typically after the tailer re-anchored), or the
      // payload was malformed. Falls back to the debounced full refetch, which
      // no-ops if the session isn't being viewed.
      //
      // A steady stream of these means the live path has quietly degraded to full
      // re-parses — the exact cost the append path exists to avoid. Reported at
      // `error` because `warn` is suppressed in production builds, and only on
      // threshold crossings because the failure mode is itself a burst.
      appendFallbackCount += 1;
      if (appendFallbackCount === 5 || appendFallbackCount % 50 === 0) {
        logger.error(
          `session-append degraded: ${appendFallbackCount} fallbacks to full refetch ` +
            `(latest ${event.sessionId}). Check SessionTailer baseline retention.`
        );
      }
      const state = useStore.getState();
      const sessionTab = state
        .getAllPaneTabs()
        .find((t) => t.type === 'session' && t.sessionId === event.sessionId);
      const projectId = sessionTab?.projectId ?? event.projectId ?? state.selectedProjectId;
      if (projectId) {
        scheduleSessionRefresh(projectId, event.sessionId);
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

  // Listen for memory directory changes so the sidebar re-reads MEMORY.md
  // and any expanded entries when the user edits them externally.
  if (api.memory?.onChanged) {
    const cleanup = api.memory.onChanged((data) => {
      const projectId = data?.projectId;
      if (!projectId) return;
      const state = useStore.getState();
      // Only refresh if the user is actually viewing that project's memory.
      const baseProjectId = getBaseProjectId(state.selectedProjectId);
      if (baseProjectId !== projectId) return;
      void state.refreshMemoryForProject(projectId);
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

  // Return cleanup function
  return () => {
    for (const timer of pendingSessionRefreshTimers.values()) {
      clearTimeout(timer);
    }
    pendingSessionRefreshTimers.clear();
    for (const { timer } of pendingProjectRefreshTimers.values()) {
      clearTimeout(timer);
    }
    pendingProjectRefreshTimers.clear();
    cleanupFns.forEach((fn) => fn());
  };
}
