/**
 * Conversation slice - manages expansion states, chart mode, search, and detail popover.
 */

import { findLastOutput } from '@renderer/utils/aiGroupEnhancer';

import type { AppState, SearchMatch } from '../types';
import type { AIGroupExpansionLevel } from '@renderer/types/groups';
import type { SessionConversation } from '@renderer/types/groups';
import type { StateCreator } from 'zustand';

// =============================================================================
// Types
// =============================================================================

type DetailItemType = 'thinking' | 'text' | 'linked-tool' | 'subagent';

/** Maximum number of search matches to track. Beyond this, results are capped. */
const MAX_SEARCH_MATCHES = 500;

const isSearchDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem('search-debug') === '1' ||
      (window as { __searchDebug?: boolean }).__searchDebug === true
    );
  } catch {
    return false;
  }
};

export interface ActiveDetailItem {
  aiGroupId: string;
  itemId: string;
  type: DetailItemType;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface ConversationSlice {
  // Expansion states
  aiGroupExpansionLevels: Map<string, AIGroupExpansionLevel>;
  expandedStepIds: Set<string>;
  /** Display item expansion state per AI group - persists across refreshes */
  expandedDisplayItemIds: Map<string, Set<string>>;
  /** AI group expanded/collapsed state - persists across refreshes */
  expandedAIGroupIds: Set<string>;

  // Detail popover state
  activeDetailItem: ActiveDetailItem | null;

  // Search state
  searchQuery: string;
  searchVisible: boolean;
  searchResultCount: number;
  currentSearchIndex: number;
  searchMatches: SearchMatch[];
  /** True when total matches exceeded the cap and results were truncated */
  searchResultsCapped: boolean;
  /** Item IDs that contain at least one search match — used by components to skip re-renders */
  searchMatchItemIds: Set<string>;

  // Auto-expand state for search results
  /** AI group IDs that should be expanded to show search results */
  searchExpandedAIGroupIds: Set<string>;
  /** Subagent IDs within AI groups that should show their execution trace */
  searchExpandedSubagentIds: Set<string>;
  /** Current search result's display item ID for precise expansion (e.g., "thinking-0") */
  searchCurrentDisplayItemId: string | null;
  /** Current search result's item ID within subagent trace (e.g., "subagent-thinking-0") */
  searchCurrentSubagentItemId: string | null;

  // Actions
  setAIGroupExpansion: (aiGroupId: string, level: AIGroupExpansionLevel) => void;
  toggleStepExpansion: (stepId: string) => void;
  /** Toggle expansion of a display item within an AI group */
  toggleDisplayItemExpansion: (aiGroupId: string, itemId: string) => void;
  /** Get expanded display item IDs for an AI group */
  getExpandedDisplayItemIds: (aiGroupId: string) => Set<string>;
  /** Toggle AI group expanded/collapsed state */
  toggleAIGroupExpansion: (aiGroupId: string) => void;

  // Detail popover actions
  showDetailPopover: (
    aiGroupId: string,
    itemId: string,
    type: 'thinking' | 'text' | 'linked-tool' | 'subagent'
  ) => void;
  hideDetailPopover: () => void;

  // Search actions
  setSearchQuery: (query: string, conversationOverride?: SessionConversation | null) => void;
  /** Canonicalize search matches from currently rendered mark elements (DOM order) */
  syncSearchMatchesWithRendered: (
    renderedMatches: { itemId: string; matchIndexInItem: number }[]
  ) => void;
  /** Select a specific search match by item ID and in-item match index */
  selectSearchMatch: (itemId: string, matchIndexInItem: number) => boolean;
  showSearch: () => void;
  hideSearch: () => void;
  nextSearchResult: () => void;
  previousSearchResult: () => void;
  /** Expand AI groups and subagents needed to show the current search result */
  expandForCurrentSearchResult: () => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createConversationSlice: StateCreator<AppState, [], [], ConversationSlice> = (
  set,
  get
) => ({
  // Initial state
  aiGroupExpansionLevels: new Map(),
  expandedStepIds: new Set(),
  expandedDisplayItemIds: new Map(),
  expandedAIGroupIds: new Set(),

  ganttChartMode: 'timeline',

  activeDetailItem: null,

  // Search state (initial values)
  searchQuery: '',
  searchVisible: false,
  searchResultCount: 0,
  currentSearchIndex: -1,
  searchMatches: [],
  searchResultsCapped: false,
  searchMatchItemIds: new Set(),

  // Auto-expand state for search results (initial values)
  searchExpandedAIGroupIds: new Set(),
  searchExpandedSubagentIds: new Set(),
  searchCurrentDisplayItemId: null,
  searchCurrentSubagentItemId: null,

  // Set expansion level for a specific AI Group
  setAIGroupExpansion: (aiGroupId: string, level: AIGroupExpansionLevel) => {
    const state = get();
    const newLevels = new Map(state.aiGroupExpansionLevels);
    newLevels.set(aiGroupId, level);
    set({ aiGroupExpansionLevels: newLevels });
  },

  // Toggle expansion state for a semantic step
  toggleStepExpansion: (stepId: string) => {
    const state = get();
    const newExpandedStepIds = new Set(state.expandedStepIds);
    if (newExpandedStepIds.has(stepId)) {
      newExpandedStepIds.delete(stepId);
    } else {
      newExpandedStepIds.add(stepId);
    }
    set({ expandedStepIds: newExpandedStepIds });
  },

  // Toggle expansion of a display item within an AI group
  toggleDisplayItemExpansion: (aiGroupId: string, itemId: string) => {
    const state = get();
    const newMap = new Map(state.expandedDisplayItemIds);
    const currentSet = newMap.get(aiGroupId) ?? new Set<string>();
    const newSet = new Set(currentSet);

    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }

    newMap.set(aiGroupId, newSet);
    set({ expandedDisplayItemIds: newMap });
  },

  // Get expanded display item IDs for an AI group
  getExpandedDisplayItemIds: (aiGroupId: string) => {
    const state = get();
    return state.expandedDisplayItemIds.get(aiGroupId) ?? new Set<string>();
  },

  // Toggle AI group expanded/collapsed state
  toggleAIGroupExpansion: (aiGroupId: string) => {
    const state = get();
    const newSet = new Set(state.expandedAIGroupIds);
    if (newSet.has(aiGroupId)) {
      newSet.delete(aiGroupId);
    } else {
      newSet.add(aiGroupId);
    }
    set({ expandedAIGroupIds: newSet });
  },

  // Show detail popover
  showDetailPopover: (
    aiGroupId: string,
    itemId: string,
    type: 'thinking' | 'text' | 'linked-tool' | 'subagent'
  ) => {
    set({
      activeDetailItem: {
        aiGroupId,
        itemId,
        type,
      },
    });
  },

  // Hide detail popover
  hideDetailPopover: () => {
    set({ activeDetailItem: null });
  },

  // Search actions

  setSearchQuery: (query: string, conversationOverride?: SessionConversation | null) => {
    const conversation = conversationOverride ?? get().conversation;

    if (!query.trim() || !conversation) {
      if (isSearchDebugEnabled()) {
        console.info('[search] clear', { query });
      }
      set({
        searchQuery: query,
        searchResultCount: 0,
        currentSearchIndex: -1,
        searchMatches: [],
        searchResultsCapped: false,
        searchMatchItemIds: new Set(),
        searchCurrentDisplayItemId: null,
        searchCurrentSubagentItemId: null,
      });
      return;
    }

    // Build search matches by scanning conversation.
    // Plain indexOf search — no markdown parsing. Match counts may differ
    // slightly from rendered highlights; syncSearchMatchesWithRendered corrects this.
    const matches: SearchMatch[] = [];
    const lowerQuery = query.toLowerCase();
    let globalIndex = 0;
    let capped = false;

    // Count occurrences of lowerQuery in text using plain indexOf
    const addPlainTextMatches = (
      text: string,
      itemId: string,
      itemType: 'user' | 'ai',
      displayItemId?: string
    ): void => {
      if (capped) return;
      const lowerText = text.toLowerCase();
      let pos = 0;
      let matchIndexInItem = 0;
      while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
        if (matches.length >= MAX_SEARCH_MATCHES) {
          capped = true;
          return;
        }
        matches.push({
          itemId,
          itemType,
          matchIndexInItem,
          globalIndex,
          displayItemId,
        });
        matchIndexInItem++;
        globalIndex++;
        pos += lowerQuery.length;
      }
    };

    for (const item of conversation.items) {
      if (capped) break;
      if (item.type === 'user') {
        const text = item.group.content.rawText ?? item.group.content.text ?? '';
        addPlainTextMatches(text, item.group.id, 'user');
      } else if (item.type === 'ai') {
        const aiGroup = item.group;
        const itemId = aiGroup.id;
        const lastOutput = findLastOutput(aiGroup.steps, aiGroup.isOngoing ?? false);

        if (lastOutput?.type === 'text' && lastOutput.text) {
          addPlainTextMatches(lastOutput.text, itemId, 'ai', 'lastOutput');
        }
      }
    }

    if (isSearchDebugEnabled()) {
      const sample = matches.slice(0, 10).map((match) => ({
        itemId: match.itemId,
        itemType: match.itemType,
        matchIndexInItem: match.matchIndexInItem,
        globalIndex: match.globalIndex,
      }));
      const counts = matches.reduce<Record<string, number>>((acc, match) => {
        acc[`${match.itemType}:${match.itemId}`] =
          (acc[`${match.itemType}:${match.itemId}`] ?? 0) + 1;
        return acc;
      }, {});
      console.info('[search] query', query, 'matches', matches.length);
      console.info('[search] counts', counts);
      console.info('[search] sample', sample);
    }

    // Build set of item IDs that have matches — components use this to skip re-renders
    const matchItemIds = new Set<string>();
    for (const match of matches) {
      matchItemIds.add(match.itemId);
    }

    set({
      searchQuery: query,
      searchResultCount: matches.length,
      currentSearchIndex: matches.length > 0 ? 0 : -1,
      searchMatches: matches,
      searchResultsCapped: capped,
      searchMatchItemIds: matchItemIds,
    });
  },

  syncSearchMatchesWithRendered: (renderedMatches) => {
    const state = get();
    if (!state.searchQuery.trim()) return;

    const dedupedRendered: { itemId: string; matchIndexInItem: number }[] = [];
    const seen = new Set<string>();
    for (const rendered of renderedMatches) {
      const key = `${rendered.itemId}:${rendered.matchIndexInItem}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedRendered.push(rendered);
    }

    const oldMatches = state.searchMatches;
    const sameLength = oldMatches.length === dedupedRendered.length;
    const sameContent =
      sameLength &&
      oldMatches.every(
        (match, index) =>
          match.itemId === dedupedRendered[index]?.itemId &&
          match.matchIndexInItem === dedupedRendered[index]?.matchIndexInItem
      );
    if (sameContent) return;

    const oldMatchMap = new Map<string, SearchMatch>();
    for (const match of oldMatches) {
      oldMatchMap.set(`${match.itemId}:${match.matchIndexInItem}`, match);
    }

    const nextMatches: SearchMatch[] = dedupedRendered.map((rendered, index) => {
      const key = `${rendered.itemId}:${rendered.matchIndexInItem}`;
      const previous = oldMatchMap.get(key);
      const inferredItemType = rendered.itemId.startsWith('user-') ? 'user' : 'ai';
      return {
        itemId: rendered.itemId,
        itemType: previous?.itemType ?? inferredItemType,
        matchIndexInItem: rendered.matchIndexInItem,
        globalIndex: index,
        displayItemId: previous?.displayItemId,
      };
    });

    const oldCurrentMatch =
      state.currentSearchIndex >= 0 ? oldMatches[state.currentSearchIndex] : undefined;
    let newCurrentIndex = -1;
    if (oldCurrentMatch) {
      newCurrentIndex = nextMatches.findIndex(
        (match) =>
          match.itemId === oldCurrentMatch.itemId &&
          match.matchIndexInItem === oldCurrentMatch.matchIndexInItem
      );
    }

    if (newCurrentIndex < 0) {
      if (nextMatches.length === 0) {
        newCurrentIndex = -1;
      } else if (state.currentSearchIndex < 0) {
        newCurrentIndex = 0;
      } else {
        newCurrentIndex = Math.min(state.currentSearchIndex, nextMatches.length - 1);
      }
    }

    if (isSearchDebugEnabled()) {
      console.info('[search] sync-rendered', {
        parsedCount: oldMatches.length,
        renderedCount: nextMatches.length,
        currentBefore: state.currentSearchIndex,
        currentAfter: newCurrentIndex,
      });
    }

    set({
      searchMatches: nextMatches,
      searchResultCount: nextMatches.length,
      currentSearchIndex: newCurrentIndex,
    });
  },

  showSearch: () => {
    set({ searchVisible: true });
  },

  selectSearchMatch: (itemId: string, matchIndexInItem: number) => {
    const state = get();
    const targetIndex = state.searchMatches.findIndex(
      (match) => match.itemId === itemId && match.matchIndexInItem === matchIndexInItem
    );

    if (targetIndex < 0) {
      return false;
    }

    set({ currentSearchIndex: targetIndex });
    get().expandForCurrentSearchResult();
    return true;
  },

  hideSearch: () => {
    set({
      searchVisible: false,
      searchQuery: '',
      searchResultCount: 0,
      currentSearchIndex: -1,
      searchMatches: [],
      searchResultsCapped: false,
      searchMatchItemIds: new Set(),
      searchExpandedAIGroupIds: new Set(),
      searchExpandedSubagentIds: new Set(),
      searchCurrentDisplayItemId: null,
      searchCurrentSubagentItemId: null,
    });
  },

  nextSearchResult: () => {
    const state = get();
    if (state.searchResultCount > 0) {
      const nextIndex = (state.currentSearchIndex + 1) % state.searchResultCount;
      set({ currentSearchIndex: nextIndex });
      // Auto-expand any collapsed sections containing the result
      get().expandForCurrentSearchResult();
      if (isSearchDebugEnabled()) {
        const match = get().searchMatches[nextIndex];
        console.info('[search] next', {
          index: nextIndex,
          itemId: match?.itemId,
          matchIndexInItem: match?.matchIndexInItem,
        });
      }
    }
  },

  previousSearchResult: () => {
    const state = get();
    if (state.searchResultCount > 0) {
      const prevIndex = state.currentSearchIndex - 1;
      const newIndex = prevIndex < 0 ? state.searchResultCount - 1 : prevIndex;
      set({ currentSearchIndex: newIndex });
      // Auto-expand any collapsed sections containing the result
      get().expandForCurrentSearchResult();
      if (isSearchDebugEnabled()) {
        const match = get().searchMatches[newIndex];
        console.info('[search] prev', {
          index: newIndex,
          itemId: match?.itemId,
          matchIndexInItem: match?.matchIndexInItem,
        });
      }
    }
  },

  expandForCurrentSearchResult: () => {
    const state = get();
    const { currentSearchIndex, searchMatches } = state;

    if (currentSearchIndex < 0 || searchMatches.length === 0) return;

    const currentMatch = searchMatches[currentSearchIndex];
    if (!currentMatch) return;

    // For AI group matches, track the display item ID for highlighting
    // Since we only search lastOutput text (always visible), no expansion needed
    if (currentMatch.itemType === 'ai') {
      set({
        searchCurrentDisplayItemId: currentMatch.displayItemId ?? null,
        searchCurrentSubagentItemId: null,
      });
    } else {
      // For user matches, clear display item IDs
      set({
        searchCurrentDisplayItemId: null,
        searchCurrentSubagentItemId: null,
      });
    }
  },
});
