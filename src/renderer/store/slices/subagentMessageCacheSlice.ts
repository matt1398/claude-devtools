/**
 * Subagent message cache slice.
 *
 * Holds lazily-loaded subagent message bodies in the renderer so that
 * `SubagentItem` doesn't have to call `getSubagentMessages` again every
 * time it remounts. Sized small (10 entries) because each entry holds a
 * full subagent transcript.
 *
 * Single-flight: concurrent `loadSubagentMessages(id)` calls coalesce —
 * the first call kicks off the IPC, subsequent calls await the same
 * Promise and return the same array.
 *
 * This is a per-renderer cache layered on top of the main-process
 * `SubagentMessageCache` (which survives across renderer reloads).
 */

import { api } from '@renderer/api';

import type { AppState } from '../types';
import type { ParsedMessage } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

const MAX_CACHE_ENTRIES = 10;

interface CacheEntry {
  messages: ParsedMessage[];
  /** Insertion order for LRU. Higher = more recent. */
  touchedAt: number;
}

export interface SubagentMessageCacheSlice {
  /** Map id (subagentId) → loaded messages. */
  subagentMessageCache: Map<string, CacheEntry>;
  /** Subagent ids whose IPC fetch is in flight. */
  loadingSubagentIds: Set<string>;
  /** Per-id error from the most recent fetch attempt. */
  subagentMessageErrors: Map<string, string>;

  /**
   * Get cached messages without triggering a fetch. Returns null on miss.
   * Used by hooks that need to read the current cache state.
   */
  getCachedSubagentMessages: (subagentId: string) => ParsedMessage[] | null;

  /**
   * Lazy-load messages for a subagent. Coalesces concurrent calls into one
   * IPC. Returns the same array for repeated calls (single-flight).
   * Side-effect: updates `subagentMessageCache`, `loadingSubagentIds`,
   * `subagentMessageErrors` so subscribers re-render at the right moments.
   */
  loadSubagentMessages: (
    projectId: string,
    sessionId: string,
    subagentId: string
  ) => Promise<ParsedMessage[]>;

  /** Drop every cached entry whose subagent belongs to the given session. */
  invalidateSubagentMessagesForSession: (sessionId: string) => void;

  /** Clear the entire cache (e.g., on context switch). */
  clearSubagentMessageCache: () => void;
}

// Module-level Promise dedupe map. Lives outside Zustand state because
// Promises don't serialize cleanly and we don't want subscribers to
// re-render every time a Promise resolves elsewhere.
const inflightPromises = new Map<string, Promise<ParsedMessage[]>>();

let touchCounter = 0;

export const createSubagentMessageCacheSlice: StateCreator<
  AppState,
  [],
  [],
  SubagentMessageCacheSlice
> = (set, get) => ({
  subagentMessageCache: new Map(),
  loadingSubagentIds: new Set(),
  subagentMessageErrors: new Map(),

  getCachedSubagentMessages: (subagentId) => {
    const entry = get().subagentMessageCache.get(subagentId);
    return entry ? entry.messages : null;
  },

  loadSubagentMessages: async (projectId, sessionId, subagentId) => {
    // Cache hit → return immediately, no IPC, no state change.
    const cached = get().subagentMessageCache.get(subagentId);
    if (cached) {
      return cached.messages;
    }

    // Single-flight: another caller already fetching this subagent.
    const existing = inflightPromises.get(subagentId);
    if (existing) {
      return existing;
    }

    // Start fresh fetch.
    const promise = (async (): Promise<ParsedMessage[]> => {
      // Mark loading and clear any previous error for this id.
      set((state) => {
        const nextLoading = new Set(state.loadingSubagentIds);
        nextLoading.add(subagentId);
        const nextErrors = new Map(state.subagentMessageErrors);
        nextErrors.delete(subagentId);
        return { loadingSubagentIds: nextLoading, subagentMessageErrors: nextErrors };
      });

      try {
        const messages = await api.getSubagentMessages(projectId, sessionId, subagentId);

        // Insert into cache with LRU eviction.
        set((state) => {
          const nextCache = new Map(state.subagentMessageCache);
          if (nextCache.size >= MAX_CACHE_ENTRIES && !nextCache.has(subagentId)) {
            // Evict the entry with the smallest touchedAt (oldest).
            let oldestKey: string | null = null;
            let oldestTouched = Infinity;
            for (const [k, v] of nextCache) {
              if (v.touchedAt < oldestTouched) {
                oldestTouched = v.touchedAt;
                oldestKey = k;
              }
            }
            if (oldestKey !== null) nextCache.delete(oldestKey);
          }
          nextCache.set(subagentId, { messages, touchedAt: ++touchCounter });

          const nextLoading = new Set(state.loadingSubagentIds);
          nextLoading.delete(subagentId);

          return { subagentMessageCache: nextCache, loadingSubagentIds: nextLoading };
        });

        return messages;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set((state) => {
          const nextLoading = new Set(state.loadingSubagentIds);
          nextLoading.delete(subagentId);
          const nextErrors = new Map(state.subagentMessageErrors);
          nextErrors.set(subagentId, message);
          return { loadingSubagentIds: nextLoading, subagentMessageErrors: nextErrors };
        });
        // Return empty so callers that can't propagate errors still get
        // an array; the error is exposed via subagentMessageErrors.
        return [];
      } finally {
        inflightPromises.delete(subagentId);
      }
    })();

    inflightPromises.set(subagentId, promise);
    return promise;
  },

  invalidateSubagentMessagesForSession: (_sessionId) => {
    // We only key by subagentId in the cache (no session in the key), so
    // a coarse clear is correct: when any session refreshes we drop all
    // cached subagent bodies. The cache is small so this is cheap.
    set({
      subagentMessageCache: new Map(),
      subagentMessageErrors: new Map(),
    });
  },

  clearSubagentMessageCache: () => {
    inflightPromises.clear();
    set({
      subagentMessageCache: new Map(),
      loadingSubagentIds: new Set(),
      subagentMessageErrors: new Map(),
    });
  },
});
