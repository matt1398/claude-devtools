/**
 * Filter slice - GLOBAL per-type chat filter selection.
 *
 * Unlike the per-tab UI state in tabUISlice, the filter-chip selection is a single
 * global choice shared across every session/tab AND persisted to localStorage so it
 * survives app restarts. Toggling a chip in one session immediately affects the filter
 * everywhere.
 *
 * The hidden set is stored as `Set<string>` in memory (empty = all types shown, matching
 * the historical default) and serialized to a `string[]` for localStorage (Sets don't
 * JSON-serialize). Types are kept as plain strings to avoid coupling the store to the
 * renderer-local FilterType union.
 */

import type { AppState } from '../types';
import type { StateCreator } from 'zustand';

// =============================================================================
// Persistence
// =============================================================================

/** localStorage key holding the JSON-serialized array of HIDDEN filter types. */
export const HIDDEN_FILTER_TYPES_STORAGE_KEY = 'devtools.hiddenFilterTypes';

/**
 * Hydrate the hidden-types set from localStorage. Returns an empty set (all types shown)
 * when absent or malformed, preserving the historical default.
 */
function loadHiddenFilterTypes(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_FILTER_TYPES_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set<string>();
  }
}

/** Persist the hidden-types set to localStorage as a string[] (best-effort). */
function persistHiddenFilterTypes(hidden: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_FILTER_TYPES_STORAGE_KEY, JSON.stringify([...hidden]));
  } catch {
    // Ignore quota / unavailable-storage errors — filtering still works in-memory.
  }
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface FilterSlice {
  /**
   * Which per-type filter chips are HIDDEN globally (by FilterType string).
   * Empty = all item types shown. Shared across all sessions/tabs and persisted.
   */
  globalHiddenFilterTypes: Set<string>;

  /** Toggle a single filter type's visibility globally. */
  toggleGlobalFilterType: (filterType: string) => void;

  /** Replace the global hidden filter-type set. */
  setGlobalHiddenFilterTypes: (hidden: Set<string>) => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createFilterSlice: StateCreator<AppState, [], [], FilterSlice> = (set, get) => ({
  globalHiddenFilterTypes: loadHiddenFilterTypes(),

  toggleGlobalFilterType: (filterType: string) => {
    const newHidden = new Set(get().globalHiddenFilterTypes);
    if (newHidden.has(filterType)) {
      newHidden.delete(filterType);
    } else {
      newHidden.add(filterType);
    }
    persistHiddenFilterTypes(newHidden);
    set({ globalHiddenFilterTypes: newHidden });
  },

  setGlobalHiddenFilterTypes: (hidden: Set<string>) => {
    const newHidden = new Set(hidden);
    persistHiddenFilterTypes(newHidden);
    set({ globalHiddenFilterTypes: newHidden });
  },
});
