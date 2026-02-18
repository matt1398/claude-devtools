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
  sidebarCollapsed: boolean;
  pendingSearchQuery: string | null;

  // Actions
  openCommandPalette: (query?: string) => void;
  closeCommandPalette: () => void;
  clearPendingSearchQuery: () => void;
  toggleSidebar: () => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set) => ({
  // Initial state
  commandPaletteOpen: false,
  sidebarCollapsed: false,
  pendingSearchQuery: null,

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

  // Sidebar actions
  toggleSidebar: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
  },
});
