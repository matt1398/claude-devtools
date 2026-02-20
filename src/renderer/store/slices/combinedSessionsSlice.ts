/**
 * Combined sessions slice - manages merged multi-context sidebar sessions.
 */

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { Session } from '@renderer/types/data';
import type { AppConfig } from '@shared/types';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:combinedSessions');

const PAGE_SIZE = 20;

function getSessionIdentityKey(session: Session): string {
  const contextId = session.contextId ?? '';
  return `${contextId}::${session.projectId}::${session.id}`;
}

export interface CombinedSessionsSlice {
  combinedModeEnabled: boolean;
  combinedModeToggling: boolean;
  combinedSessions: Session[];
  combinedSessionsCursor: string | null;
  combinedSessionsHasMore: boolean;
  combinedSessionsLoading: boolean;
  combinedSessionsLoadingMore: boolean;

  toggleCombinedMode: () => Promise<void>;
  /** Force-disable combined mode, bypassing the toggling guard. Used for lifecycle events
   *  (e.g., root removal) that must disable combined mode even during an in-flight toggle. */
  forceDisableCombinedMode: () => Promise<void>;
  fetchCombinedSessionsInitial: () => Promise<void>;
  fetchCombinedSessionsMore: () => Promise<void>;
  refreshCombinedSessionsInPlace: () => Promise<void>;
  initCombinedModeFromConfig: (config: AppConfig) => Promise<void>;
}

export const createCombinedSessionsSlice: StateCreator<AppState, [], [], CombinedSessionsSlice> = (
  set,
  get
) => {
  /**
   * Per-store epoch counter for the combined session list. Bumped by operations that
   * replace the list (initial fetch, refresh, toggle-off). Async operations capture
   * the epoch before awaiting and discard results when it has advanced.
   */
  let combinedListEpoch = 0;

  return {
    combinedModeEnabled: false,
    combinedModeToggling: false,
    combinedSessions: [],
    combinedSessionsCursor: null,
    combinedSessionsHasMore: false,
    combinedSessionsLoading: false,
    combinedSessionsLoadingMore: false,

    toggleCombinedMode: async () => {
      if (get().combinedModeToggling) {
        return;
      }

      const wasEnabled = get().combinedModeEnabled;
      const newEnabled = !wasEnabled;

      if (newEnabled && get().availableContexts.length < 2) {
        return;
      }

      set({
        combinedModeToggling: true,
        combinedModeEnabled: newEnabled,
        // Clear multi-select state on mode change — stale session IDs from
        // one mode could be bulk-applied to the wrong project in the other.
        sidebarSelectedSessionIds: [],
        sidebarMultiSelectActive: false,
      });

      try {
        await api.setCombinedWatchers(newEnabled);

        // A lifecycle force-disable can overwrite the optimistic toggle state
        // while this async branch is in flight. Abort stale continuations.
        if (get().combinedModeEnabled !== newEnabled) {
          return;
        }

        if (newEnabled) {
          await get().fetchCombinedSessionsInitial();
        } else {
          // Bump epoch so any in-flight requests from the old session are discarded
          ++combinedListEpoch;
          set({
            combinedSessions: [],
            combinedSessionsCursor: null,
            combinedSessionsHasMore: false,
            combinedSessionsLoading: false,
            combinedSessionsLoadingMore: false,
          });
          // Reload per-project sessions to match current selectedProjectId,
          // which may have changed during combined mode (e.g., user clicked a
          // session from a different project).
          const projectId = get().selectedProjectId;
          if (projectId) {
            void get().fetchSessionsInitial(projectId);
          }
        }

        if (get().combinedModeEnabled !== newEnabled) {
          return;
        }

        void api.config
          .update('general', { combinedSessionsEnabled: newEnabled })
          .catch((error: unknown) => {
            logger.debug('Failed to persist combined mode config (best effort)', error);
          });
      } catch (error) {
        set({ combinedModeEnabled: wasEnabled });
        try {
          await api.setCombinedWatchers(wasEnabled);
        } catch (rollbackError) {
          logger.debug('Failed to rollback combined watcher mode', rollbackError);
        }
        void api.config
          .update('general', { combinedSessionsEnabled: wasEnabled })
          .catch((persistRollbackError: unknown) => {
            logger.debug(
              'Failed to rollback combined mode config (best effort)',
              persistRollbackError
            );
          });
        // If we failed to enable, restore per-project sessions so the sidebar
        // isn't left empty after the epoch bump inside fetchCombinedSessionsInitial.
        if (!wasEnabled) {
          const projectId = get().selectedProjectId;
          if (projectId) {
            void get().fetchSessionsInitial(projectId);
          }
        }
        logger.error('Failed to toggle combined mode:', error);
      } finally {
        set({ combinedModeToggling: false });
      }
    },

    forceDisableCombinedMode: async () => {
      if (!get().combinedModeEnabled) {
        return;
      }

      // Unconditionally disable — no toggling guard, no rollback.
      // Used when lifecycle events (root removal) require immediate shutdown.
      ++combinedListEpoch;
      set({
        combinedModeEnabled: false,
        combinedModeToggling: false,
        combinedSessions: [],
        combinedSessionsCursor: null,
        combinedSessionsHasMore: false,
        combinedSessionsLoading: false,
        combinedSessionsLoadingMore: false,
        sidebarSelectedSessionIds: [],
        sidebarMultiSelectActive: false,
      });

      try {
        await api.setCombinedWatchers(false);
      } catch (error) {
        logger.debug('Failed to disable combined watchers during force-disable:', error);
      }

      void api.config
        .update('general', { combinedSessionsEnabled: false })
        .catch((error: unknown) => {
          logger.debug('Failed to persist combined mode config (best effort)', error);
        });

      // Reload per-project sessions to match current selectedProjectId
      const projectId = get().selectedProjectId;
      if (projectId) {
        void get().fetchSessionsInitial(projectId);
      }
    },

    fetchCombinedSessionsInitial: async () => {
      const epoch = ++combinedListEpoch;
      // Don't clear combinedSessions — keep old data visible during fetch for smooth transition.
      // Only set loading flag; sessions are replaced atomically when new data arrives.
      set({
        combinedSessionsLoading: true,
        combinedSessionsLoadingMore: false,
      });

      try {
        const result = await api.getCombinedSessionsPaginated(null, PAGE_SIZE);

        if (combinedListEpoch !== epoch || !get().combinedModeEnabled) {
          // Stale — a newer request or toggle-off superseded us.
          // Don't clear loading if epoch advanced (newer request owns it).
          // But if combined mode was toggled off, the toggle-off path already cleared it.
          return;
        }

        set({
          combinedSessions: result.sessions,
          combinedSessionsCursor: result.nextCursor,
          combinedSessionsHasMore: result.hasMore,
          combinedSessionsLoading: false,
        });
      } catch (error) {
        if (combinedListEpoch !== epoch || !get().combinedModeEnabled) {
          return;
        }

        set({
          combinedSessionsLoading: false,
          combinedSessionsLoadingMore: false,
        });

        throw error;
      }
    },

    fetchCombinedSessionsMore: async () => {
      const state = get();
      if (
        !state.combinedModeEnabled ||
        !state.combinedSessionsHasMore ||
        !state.combinedSessionsCursor ||
        state.combinedSessionsLoadingMore ||
        state.combinedSessionsLoading
      ) {
        return;
      }

      const cursor = state.combinedSessionsCursor;
      const epoch = combinedListEpoch;
      set({ combinedSessionsLoadingMore: true });

      try {
        const result = await api.getCombinedSessionsPaginated(cursor, PAGE_SIZE);

        if (!get().combinedModeEnabled || combinedListEpoch !== epoch) {
          // List was replaced (initial fetch, refresh, or toggle-off) while in-flight — discard
          set({ combinedSessionsLoadingMore: false });
          return;
        }

        // Detect no-progress pages: server returns zero sessions but claims hasMore
        // (e.g., one context persistently errors while the healthy one is exhausted).
        // Clear hasMore to break the scroll-triggered retry loop. The next background
        // refresh (file-change debounce) will restore it correctly.
        const effectiveHasMore = result.sessions.length === 0 ? false : result.hasMore;

        set((prev) => {
          const existing = new Set(
            prev.combinedSessions.map((session) => getSessionIdentityKey(session))
          );
          const toAppend = result.sessions.filter((session) => {
            const key = getSessionIdentityKey(session);
            if (existing.has(key)) {
              return false;
            }
            existing.add(key);
            return true;
          });

          return {
            combinedSessions: [...prev.combinedSessions, ...toAppend],
            combinedSessionsCursor: result.nextCursor,
            combinedSessionsHasMore: effectiveHasMore,
            combinedSessionsLoadingMore: false,
          };
        });
      } catch (error) {
        logger.error('Failed to fetch more combined sessions:', error);
        // Clear hasMore to stop the scroll-triggered retry loop. The next
        // initial fetch or background refresh will restore hasMore correctly.
        set({ combinedSessionsLoadingMore: false, combinedSessionsHasMore: false });
      }
    },

    refreshCombinedSessionsInPlace: async () => {
      if (!get().combinedModeEnabled) {
        return;
      }

      const epoch = ++combinedListEpoch;
      try {
        const result = await api.getCombinedSessionsPaginated(null, PAGE_SIZE);
        if (combinedListEpoch !== epoch || !get().combinedModeEnabled) {
          return;
        }
        set({
          combinedSessions: result.sessions,
          combinedSessionsCursor: result.nextCursor,
          combinedSessionsHasMore: result.hasMore,
          // Clear loading flag in case we superseded an initial fetch that set it
          combinedSessionsLoading: false,
        });
      } catch {
        // Background refresh — ignore errors but clear loading flag in case we
        // superseded an initial fetch that set it (prevents stuck loading state).
        if (combinedListEpoch === epoch) {
          set({ combinedSessionsLoading: false });
        }
      }
    },

    initCombinedModeFromConfig: async (config: AppConfig) => {
      const enabledInConfig = config.general.combinedSessionsEnabled;
      if (!enabledInConfig || get().availableContexts.length < 2) {
        set({ combinedModeEnabled: false });
        return;
      }

      set({ combinedModeEnabled: true });
      try {
        await api.setCombinedWatchers(true);
        await get().fetchCombinedSessionsInitial();
      } catch (error) {
        logger.error('Failed to initialize combined mode from config:', error);
        ++combinedListEpoch;
        set({
          combinedModeEnabled: false,
          combinedSessions: [],
          combinedSessionsCursor: null,
          combinedSessionsHasMore: false,
          combinedSessionsLoading: false,
          combinedSessionsLoadingMore: false,
        });
        try {
          await api.setCombinedWatchers(false);
        } catch {
          // best effort cleanup
        }
      }
    },
  };
};
