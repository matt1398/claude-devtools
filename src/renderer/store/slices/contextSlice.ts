/**
 * Context Slice - Manages context switching lifecycle.
 *
 * Orchestrates snapshot capture/restore for instant workspace switching
 * between local and SSH contexts, with IndexedDB persistence and TTL.
 */

import { api } from '@renderer/api';
import { contextStorage } from '@renderer/services/contextStorage';

import { getFullResetState } from '../utils/stateResetHelpers';

import type { AppState } from '../types';
import type { ContextSnapshot } from '@renderer/services/contextStorage';
import type { Project, RepositoryGroup } from '@renderer/types/data';
import type { Pane } from '@renderer/types/panes';
import type { ContextInfo, SshConnectionConfig } from '@shared/types/api';
import type { StateCreator } from 'zustand';

// =============================================================================
// Slice Interface
// =============================================================================

export interface ContextSlice {
  // State
  activeContextId: string; // 'local' initially
  isContextSwitching: boolean; // true during switch transition
  targetContextId: string | null; // context being switched to
  contextSnapshotsReady: boolean; // true after initial IndexedDB check
  availableContexts: ContextInfo[]; // list of all available contexts (local + SSH)

  // Actions
  switchContext: (targetContextId: string, sshCredentials?: Partial<SshConnectionConfig>) => Promise<void>;
  initializeContextSystem: () => Promise<void>;
  fetchAvailableContexts: () => Promise<void>;
  deleteSnapshot: (rootId: string) => Promise<void>;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get empty context state for fresh contexts.
 * Returns state with empty arrays, null selections, and default dashboard tab.
 */
function getEmptyContextState(): Partial<AppState> {
  return {
    ...getFullResetState(),
    projects: [],
    repositoryGroups: [],
    sessions: [],
    pinnedSessionIds: [],
    notifications: [],
    unreadCount: 0,
    openTabs: [],
    activeTabId: null,
    selectedTabIds: [],
    activeProjectId: null,
    paneLayout: {
      panes: [
        {
          id: 'pane-default',
          tabs: [],
          activeTabId: null,
          selectedTabIds: [],
          widthFraction: 1,
        },
      ],
      focusedPaneId: 'pane-default',
    },
  };
}

/**
 * Validate snapshot against fresh data from target context.
 * Filters invalid tabs, selections, and ensures at-least-one-pane invariant.
 */
function validateSnapshot(
  snapshot: ContextSnapshot,
  freshProjects: Project[],
  freshRepoGroups: RepositoryGroup[]
): Partial<AppState> {
  const validProjectIds = new Set(freshProjects.map((p) => p.id));
  const validWorktreeIds = new Set(freshRepoGroups.flatMap((rg) => rg.worktrees.map((w) => w.id)));

  // Validate selectedProjectId
  const selectedProjectId =
    snapshot.selectedProjectId && validProjectIds.has(snapshot.selectedProjectId)
      ? snapshot.selectedProjectId
      : null;

  // Validate selectedRepositoryId and selectedWorktreeId
  const selectedRepositoryId = snapshot.selectedRepositoryId; // repos may differ but allow graceful fallback
  const selectedWorktreeId =
    snapshot.selectedWorktreeId && validWorktreeIds.has(snapshot.selectedWorktreeId)
      ? snapshot.selectedWorktreeId
      : null;

  // Validate tabs — filter out session tabs referencing invalid projects
  const validTabs = snapshot.openTabs.filter((tab) => {
    if (tab.type === 'session' && tab.projectId) {
      return validProjectIds.has(tab.projectId) || validWorktreeIds.has(tab.projectId);
    }
    return true; // Keep dashboard and non-session tabs
  });

  // Validate activeTabId
  let activeTabId = snapshot.activeTabId;
  if (activeTabId && !validTabs.find((t) => t.id === activeTabId)) {
    activeTabId = validTabs[0]?.id ?? null;
  }

  // Validate pane layout tabs
  const validatedPanes = snapshot.paneLayout.panes
    .map((pane) => {
      const paneTabs = pane.tabs.filter((tab) => {
        if (tab.type === 'session' && tab.projectId) {
          return validProjectIds.has(tab.projectId) || validWorktreeIds.has(tab.projectId);
        }
        return true;
      });
      const paneActiveId = paneTabs.find((t) => t.id === pane.activeTabId)
        ? pane.activeTabId
        : (paneTabs[0]?.id ?? null);
      return {
        ...pane,
        tabs: paneTabs,
        activeTabId: paneActiveId,
        selectedTabIds: pane.selectedTabIds.filter((id) => paneTabs.some((t) => t.id === id)),
      };
    })
    .filter((pane) => pane.tabs.length > 0); // Remove empty panes

  // Ensure at least one pane exists
  const finalPanes: Pane[] =
    validatedPanes.length > 0
      ? validatedPanes
      : [
          {
            id: 'pane-default',
            tabs: [],
            activeTabId: null,
            selectedTabIds: [],
            widthFraction: 1,
          },
        ];

  return {
    // Restored from snapshot (use fresh data for projects/repoGroups)
    projects: freshProjects,
    selectedProjectId,
    repositoryGroups: freshRepoGroups,
    selectedRepositoryId,
    selectedWorktreeId,
    viewMode: snapshot.viewMode,
    sessions: snapshot.sessions,
    selectedSessionId: snapshot.selectedSessionId,
    sessionsCursor: snapshot.sessionsCursor,
    sessionsHasMore: snapshot.sessionsHasMore,
    sessionsTotalCount: snapshot.sessionsTotalCount,
    pinnedSessionIds: snapshot.pinnedSessionIds,
    notifications: snapshot.notifications,
    unreadCount: snapshot.unreadCount,
    openTabs: validTabs,
    activeTabId,
    selectedTabIds: snapshot.selectedTabIds.filter((id) => validTabs.some((t) => t.id === id)),
    activeProjectId:
      snapshot.activeProjectId &&
      (validProjectIds.has(snapshot.activeProjectId) ||
        validWorktreeIds.has(snapshot.activeProjectId))
        ? snapshot.activeProjectId
        : selectedProjectId,
    paneLayout: {
      panes: finalPanes,
      focusedPaneId: finalPanes.find((p) => p.id === snapshot.paneLayout.focusedPaneId)
        ? snapshot.paneLayout.focusedPaneId
        : finalPanes[0].id,
    },
    sidebarCollapsed: snapshot.sidebarCollapsed,
  };
}

/**
 * Capture current context state as a snapshot.
 * Excludes transient state (loading flags, errors, search, Maps/Sets).
 */
function captureSnapshot(state: AppState, contextId: string): ContextSnapshot {
  return {
    // Data state
    projects: state.projects,
    selectedProjectId: state.selectedProjectId,
    repositoryGroups: state.repositoryGroups,
    selectedRepositoryId: state.selectedRepositoryId,
    selectedWorktreeId: state.selectedWorktreeId,
    viewMode: state.viewMode,
    sessions: state.sessions,
    selectedSessionId: state.selectedSessionId,
    sessionsCursor: state.sessionsCursor,
    sessionsHasMore: state.sessionsHasMore,
    sessionsTotalCount: state.sessionsTotalCount,
    pinnedSessionIds: state.pinnedSessionIds,
    notifications: state.notifications,
    unreadCount: state.unreadCount,

    // Tab/pane state
    openTabs: state.openTabs,
    activeTabId: state.activeTabId,
    selectedTabIds: state.selectedTabIds,
    activeProjectId: state.activeProjectId,
    paneLayout: state.paneLayout,

    // UI state
    sidebarCollapsed: state.sidebarCollapsed,

    // Metadata
    _metadata: {
      contextId,
      capturedAt: Date.now(),
      version: 1,
    },
  };
}

function findContextById(contexts: ContextInfo[], contextId: string): ContextInfo | null {
  return contexts.find((context) => context.id === contextId) ?? null;
}

function getSnapshotRootId(contexts: ContextInfo[], contextId: string): string {
  return findContextById(contexts, contextId)?.rootId ?? contextId;
}

function toConnectionMode(context: ContextInfo | null): 'local' | 'ssh' {
  return context?.type === 'ssh' ? 'ssh' : 'local';
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createContextSlice: StateCreator<AppState, [], [], ContextSlice> = (set, get) => ({
  // Initial state
  activeContextId: 'local',
  isContextSwitching: false,
  targetContextId: null,
  contextSnapshotsReady: false,
  availableContexts: [
    {
      id: 'local',
      type: 'local' as const,
      rootId: 'default-local',
      rootName: 'Local',
      connected: true,
    },
  ],

  // Initialize context system (called once on app mount)
  initializeContextSystem: async () => {
    try {
      // Check IndexedDB availability
      const available = await contextStorage.isAvailable();
      if (available) {
        // Clean up expired snapshots
        void contextStorage.cleanupExpired();
        const config = await api.config.get();
        const validRootIds = new Set(config.roots.items.map((root) => root.id));
        void contextStorage.cleanupUnknownSnapshots(validRootIds);
      }

      // Fetch active context from main process
      const activeContextId = await api.context.getActive();

      // Fetch available contexts before setting mode
      const availableContexts = await api.context.list();
      const activeContext = findContextById(availableContexts, activeContextId);

      set({
        contextSnapshotsReady: true,
        activeContextId,
        availableContexts,
        connectionMode: toConnectionMode(activeContext),
      });

      try {
        const config = await api.config.get();
        await get().initCombinedModeFromConfig(config);
      } catch (initError) {
        console.error('[contextSlice] Failed to initialize combined mode:', initError);
      }
    } catch (error) {
      console.error('[contextSlice] Failed to initialize context system:', error);
      set({ contextSnapshotsReady: true }); // Continue anyway
    }
  },

  // Fetch list of available contexts (local + SSH)
  fetchAvailableContexts: async () => {
    try {
      const contexts = await api.context.list();
      const activeContext = findContextById(contexts, get().activeContextId);
      set({
        availableContexts: contexts,
        connectionMode: toConnectionMode(activeContext),
      });

      // Auto-disable combined mode if contexts drop below 2.
      // Uses forceDisableCombinedMode to bypass the toggling guard — if a toggle
      // is in-flight when a root is removed, toggleCombinedMode would no-op.
      if (get().combinedModeEnabled && contexts.length < 2) {
        void get().forceDisableCombinedMode();
      }
    } catch (error) {
      console.error('[contextSlice] Failed to fetch available contexts:', error);
      // Fallback to local-only
      set({
        availableContexts: [
          {
            id: 'local',
            type: 'local',
            rootId: 'default-local',
            rootName: 'Local',
            connected: true,
          },
        ],
        connectionMode: 'local',
      });
    }
  },

  // Switch to a different context
  switchContext: async (
    targetContextId: string,
    sshCredentials?: Partial<SshConnectionConfig>
  ) => {
    const state = get();

    // Early return if already on target context
    if (targetContextId === state.activeContextId) {
      return;
    }

    // Re-entrancy guard: prevent concurrent switch races from overlapping events
    if (state.isContextSwitching) {
      return;
    }

    set({
      isContextSwitching: true,
      targetContextId,
    });

    const sourceContextId = state.activeContextId;
    const sourceContext = findContextById(state.availableContexts, sourceContextId);
    const targetContext = findContextById(state.availableContexts, targetContextId);
    if (!targetContext) {
      set({
        isContextSwitching: false,
        targetContextId: null,
      });
      return;
    }

    const sourceSnapshot = captureSnapshot(state, state.activeContextId);
    const sourceRootId = getSnapshotRootId(state.availableContexts, state.activeContextId);
    const targetRootId = targetContext.rootId;

    let didSwitchMainContext = false;
    try {
      await contextStorage.saveSnapshot(sourceRootId, sourceSnapshot);

      if (targetContext.type === 'ssh') {
        const config = await api.config.get();
        const sshRoot = config.roots.items.find(
          (root): root is Extract<(typeof config.roots.items)[number], { type: 'ssh' }> =>
            root.id === targetContext.rootId && root.type === 'ssh'
        );
        if (!sshRoot) {
          throw new Error(`SSH root not found: ${targetContext.rootName}`);
        }

        const profile = config.ssh?.profiles.find((item) => item.id === sshRoot.sshProfileId);
        if (!profile) {
          throw new Error(`SSH profile not found for root "${targetContext.rootName}"`);
        }

        const profileConfig: SshConnectionConfig = {
          host: profile.host,
          port: profile.port,
          username: profile.username,
          authMethod: profile.authMethod,
          privateKeyPath: profile.privateKeyPath,
        };
        const connectConfig: SshConnectionConfig = {
          ...profileConfig,
          ...sshCredentials,
        };

        get().setConnectionStatus('connecting', connectConfig.host, null);
        const status = await api.ssh.connect(
          connectConfig,
          targetContext.rootId
        );
        get().setConnectionStatus(status.state, status.host, status.error);
        if (status.state !== 'connected') {
          throw new Error(status.error ?? `Failed to connect to ${targetContext.rootName}`);
        }
        const savedConnection = {
          host: connectConfig.host,
          port: connectConfig.port,
          username: connectConfig.username,
          authMethod: connectConfig.authMethod,
          privateKeyPath: connectConfig.privateKeyPath,
        };
        set({ lastSshConfig: savedConnection });
        void api.ssh.saveLastConnection(savedConnection);
      } else if (sourceContext?.type === 'ssh') {
        const status = await api.ssh.disconnect();
        get().setConnectionStatus(status.state, status.host, status.error);
      }

      await api.context.switch(targetContextId);
      didSwitchMainContext = true;
      const targetSnapshot = await contextStorage.loadSnapshot(targetRootId);

      // Step 2: Apply cached snapshot immediately for instant visual feedback
      if (targetSnapshot) {
        set({
          projects: targetSnapshot.projects,
          repositoryGroups: targetSnapshot.repositoryGroups,
          selectedProjectId: targetSnapshot.selectedProjectId,
          selectedRepositoryId: targetSnapshot.selectedRepositoryId,
          selectedWorktreeId: targetSnapshot.selectedWorktreeId,
          viewMode: targetSnapshot.viewMode,
          sessions: targetSnapshot.sessions,
          selectedSessionId: targetSnapshot.selectedSessionId,
          sessionsCursor: targetSnapshot.sessionsCursor,
          sessionsHasMore: targetSnapshot.sessionsHasMore,
          sessionsTotalCount: targetSnapshot.sessionsTotalCount,
          pinnedSessionIds: targetSnapshot.pinnedSessionIds,
          notifications: targetSnapshot.notifications,
          unreadCount: targetSnapshot.unreadCount,
          openTabs: targetSnapshot.openTabs,
          activeTabId: targetSnapshot.activeTabId,
          selectedTabIds: targetSnapshot.selectedTabIds,
          activeProjectId: targetSnapshot.activeProjectId,
          paneLayout: targetSnapshot.paneLayout,
          sidebarCollapsed: targetSnapshot.sidebarCollapsed,
          // Finalize switch — overlay disappears, user sees cached data instantly
          activeContextId: targetContextId,
          connectionMode: toConnectionMode(targetContext),
          isContextSwitching: false,
          targetContextId: null,
        });
      } else {
        set({
          ...getEmptyContextState(),
          activeContextId: targetContextId,
          connectionMode: toConnectionMode(targetContext),
          isContextSwitching: false,
          targetContextId: null,
        });
      }

      // Step 3: Fetch fresh data in background (slow over SSH)
      // Wrapped in try/catch so fetch failures don't wipe valid snapshot data.
      // IPC handlers return [] on SSH scan failure — we must guard against that.
      try {
        const [freshProjects, freshRepoGroups] = await Promise.all([
          api.getProjects(),
          api.getRepositoryGroups(),
        ]);

        if (get().activeContextId !== targetContextId) {
          return;
        }

        if (targetSnapshot) {
          // Guard: don't overwrite snapshot data if fetch returned empty
          // (likely transient SSH scan failure, not genuinely empty workspace)
          const snapshotHadData =
            targetSnapshot.projects.length > 0 || targetSnapshot.repositoryGroups.length > 0;
          const freshIsEmpty = freshProjects.length === 0 && freshRepoGroups.length === 0;

          if (snapshotHadData && freshIsEmpty) {
            console.warn(
              '[contextSlice] Background fetch returned empty but snapshot had data — keeping snapshot'
            );
          } else {
            set(validateSnapshot(targetSnapshot, freshProjects, freshRepoGroups));
          }
        } else {
          // No cache (first visit) — populate freshly loaded data
          set({
            projects: freshProjects,
            repositoryGroups: freshRepoGroups,
          });
        }
      } catch (fetchError) {
        console.error('[contextSlice] Background data refresh failed:', fetchError);
        // Keep snapshot data as fallback — don't wipe user's view
        if (!targetSnapshot) {
          // Keep empty state established above if no snapshot exists.
        }
      }

      // Step 4: Fetch notifications in background
      void get().fetchAvailableContexts();
      void get().fetchNotifications();
      if (get().combinedModeEnabled) {
        void get().fetchCombinedSessionsInitial().catch(() => undefined);
      }
    } catch (error) {
      console.error('[contextSlice] Failed to switch context:', error);
      const message = error instanceof Error ? error.message : String(error);
      const sourceWasSsh = sourceContext?.type === 'ssh';

      if (didSwitchMainContext && !sourceWasSsh) {
        try {
          await api.context.switch(sourceContextId);
        } catch (rollbackError) {
          console.error('[contextSlice] Failed to rollback main-process context switch:', rollbackError);
        }
      }

      if (targetContext.type === 'ssh') {
        try {
          const status = await api.ssh.disconnect();
          get().setConnectionStatus(status.state, status.host, status.error);
        } catch {
          // noop: best-effort rollback cleanup
        }
      }

      if (sourceWasSsh) {
        const localFallback = state.availableContexts.find((context) => context.type === 'local');

        if (localFallback) {
          try {
            await api.context.switch(localFallback.id);
          } catch (fallbackSwitchError) {
            console.error(
              '[contextSlice] Failed to align main-process context to local fallback:',
              fallbackSwitchError
            );
          }

          const fallbackSnapshot = await contextStorage.loadSnapshot(localFallback.rootId);
          if (fallbackSnapshot) {
            set({
              projects: fallbackSnapshot.projects,
              repositoryGroups: fallbackSnapshot.repositoryGroups,
              selectedProjectId: fallbackSnapshot.selectedProjectId,
              selectedRepositoryId: fallbackSnapshot.selectedRepositoryId,
              selectedWorktreeId: fallbackSnapshot.selectedWorktreeId,
              viewMode: fallbackSnapshot.viewMode,
              sessions: fallbackSnapshot.sessions,
              selectedSessionId: fallbackSnapshot.selectedSessionId,
              sessionsCursor: fallbackSnapshot.sessionsCursor,
              sessionsHasMore: fallbackSnapshot.sessionsHasMore,
              sessionsTotalCount: fallbackSnapshot.sessionsTotalCount,
              pinnedSessionIds: fallbackSnapshot.pinnedSessionIds,
              notifications: fallbackSnapshot.notifications,
              unreadCount: fallbackSnapshot.unreadCount,
              openTabs: fallbackSnapshot.openTabs,
              activeTabId: fallbackSnapshot.activeTabId,
              selectedTabIds: fallbackSnapshot.selectedTabIds,
              activeProjectId: fallbackSnapshot.activeProjectId,
              paneLayout: fallbackSnapshot.paneLayout,
              sidebarCollapsed: fallbackSnapshot.sidebarCollapsed,
              activeContextId: localFallback.id,
              connectionMode: 'local',
              connectionError: message,
              isContextSwitching: false,
              targetContextId: null,
            });
          } else {
            set({
              ...getEmptyContextState(),
              activeContextId: localFallback.id,
              connectionMode: 'local',
              connectionError: message,
              isContextSwitching: false,
              targetContextId: null,
            });
          }

          try {
            const [freshProjects, freshRepoGroups] = await Promise.all([
              api.getProjects(),
              api.getRepositoryGroups(),
            ]);

            if (get().activeContextId !== localFallback.id) {
              return;
            }

            if (fallbackSnapshot) {
              const snapshotHadData =
                fallbackSnapshot.projects.length > 0 || fallbackSnapshot.repositoryGroups.length > 0;
              const freshIsEmpty = freshProjects.length === 0 && freshRepoGroups.length === 0;

              if (snapshotHadData && freshIsEmpty) {
                console.warn(
                  '[contextSlice] Local fallback refresh returned empty but snapshot had data — keeping snapshot'
                );
              } else {
                set(validateSnapshot(fallbackSnapshot, freshProjects, freshRepoGroups));
              }
            } else {
              set({
                projects: freshProjects,
                repositoryGroups: freshRepoGroups,
              });
            }
          } catch (fetchError) {
            console.error('[contextSlice] Local fallback data refresh failed:', fetchError);
          }
        } else {
          set({
            connectionMode: 'local',
            connectionError: message,
            isContextSwitching: false,
            targetContextId: null,
          });
        }
        void get().fetchAvailableContexts();
        void get().fetchNotifications();
        return;
      }

      set({
        ...validateSnapshot(
          sourceSnapshot,
          sourceSnapshot.projects,
          sourceSnapshot.repositoryGroups
        ),
        activeContextId: state.activeContextId,
        connectionMode: toConnectionMode(sourceContext),
        connectionError: message,
        isContextSwitching: false,
        targetContextId: null,
      });
      void get().fetchAvailableContexts();
    }
  },

  deleteSnapshot: async (rootId: string) => {
    await contextStorage.deleteSnapshot(rootId);
  },
});
