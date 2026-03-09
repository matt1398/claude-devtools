/**
 * Project slice - manages project list state and selection.
 */

import { api } from '@renderer/api';

import { getSessionResetState } from '../utils/stateResetHelpers';

import type { AppState } from '../types';
import type { Project, Session } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

// =============================================================================
// Slice Interface
// =============================================================================

export interface SessionCacheEntry {
  sessions: Session[];
  cursor: string | null;
  hasMore: boolean;
  totalCount: number;
  timestamp: number;
}

export interface ProjectSlice {
  // State
  projects: Project[];
  selectedProjectId: string | null;
  projectsLoading: boolean;
  projectsError: string | null;
  _sessionCache: Map<string, SessionCacheEntry>;

  // Actions
  fetchProjects: () => Promise<void>;
  selectProject: (id: string) => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => ({
  // Initial state
  projects: [],
  selectedProjectId: null,
  projectsLoading: false,
  projectsError: null,
  _sessionCache: new Map(),

  // Fetch all projects from main process
  fetchProjects: async () => {
    set({ projectsLoading: true, projectsError: null });
    try {
      const projects = await api.getProjects();
      // Sort by most recent session (descending)
      const sorted = [...projects].sort(
        (a, b) => (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0)
      );
      set({ projects: sorted, projectsLoading: false });
    } catch (error) {
      set({
        projectsError: error instanceof Error ? error.message : 'Failed to fetch projects',
        projectsLoading: false,
      });
    }
  },

  // Select a project and fetch its sessions (paginated)
  selectProject: (id: string) => {
    const cached = get()._sessionCache.get(id);

    if (cached) {
      set({
        selectedProjectId: id,
        sidebarCollapsed: false,
        sessions: cached.sessions,
        sessionsCursor: cached.cursor,
        sessionsHasMore: cached.hasMore,
        sessionsTotalCount: cached.totalCount,
        sessionsLoading: false,
        sessionsError: null,
        selectedSessionId: null,
        sessionDetail: null,
        sessionContextStats: null,
        sessionDetailError: null,
      });
    } else {
      set({
        selectedProjectId: id,
        sidebarCollapsed: false,
        ...getSessionResetState(),
      });
    }

    // Always fetch fresh data (background refresh when cached)
    void get().fetchSessionsInitial(id);
  },
});
