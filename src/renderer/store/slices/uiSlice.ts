/**
 * UI slice - manages command palette and sidebar state.
 */

import type { AppState } from '../types';
import type { StateCreator } from 'zustand';

// =============================================================================
// Slice Interface
// =============================================================================

export interface UISlice {
  // State
  commandPaletteOpen: boolean;
  pendingProjectsQuery: string | null;
  pendingSearchQuery: string | null;
  sidebarCollapsed: boolean;

  // Actions
  clearPendingProjectsQuery: () => void;
  clearPendingSearchQuery: () => void;
  closeCommandPalette: () => void;
  openCommandPalette: (query?: string) => void;
  setPendingProjectsQuery: (query: string) => void;
  toggleSidebar: () => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set) => ({
  // Initial state
  commandPaletteOpen: false,
  pendingProjectsQuery: null,
  pendingSearchQuery: null,
  sidebarCollapsed: false,

  // Command palette actions
  openCommandPalette: (query?: string) => {
    set({ commandPaletteOpen: true, pendingSearchQuery: query ?? null });
  },

  closeCommandPalette: () => {
    set({ commandPaletteOpen: false });
  },

  clearPendingSearchQuery: () => {
    set({ pendingSearchQuery: null });
  },

  // Projects query actions
  setPendingProjectsQuery: (query: string) => {
    set({ pendingProjectsQuery: query });
  },

  clearPendingProjectsQuery: () => {
    set({ pendingProjectsQuery: null });
  },

  // Sidebar actions
  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },
});
