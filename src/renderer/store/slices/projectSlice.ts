/**
 * Project slice - manages project list state and selection.
 */

import { api } from '@renderer/api';

import { getSessionResetState } from '../utils/stateResetHelpers';

import type { AppState } from '../types';
import type { Project } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

// =============================================================================
// Slice Interface
// =============================================================================

export interface ProjectSlice {
  // State
  projects: Project[];
  selectedProjectId: string | null;
  projectsLoading: boolean;
  projectsError: string | null;

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
    set({
      selectedProjectId: id,
      sidebarCollapsed: false, // Ensure session list is visible when a project is selected
      ...getSessionResetState(),
    });

    // Fetch sessions for this project (paginated)
    void get().fetchSessionsInitial(id);
  },
});
