/**
 * Shared state reset helpers to eliminate duplicated reset blocks across slices.
 *
 * These return partial state objects that can be spread into Zustand `set()` calls.
 */

import type { AppState } from '../types';

/**
 * Reset session-related state (sessions list, detail, pagination, context stats).
 * Used when switching projects, worktrees, or repositories.
 */
export function getSessionResetState(): Partial<AppState> {
  return {
    selectedSessionId: null,
    sessionDetail: null,
    sessionContextStats: null,
    sessions: [],
    sessionsError: null,
    sessionsCursor: null,
    sessionsHasMore: false,
    sessionsTotalCount: 0,
    sessionsLoadingMore: false,
  };
}

/**
 * Reset expansion Maps/Sets that accumulate entries per session.
 * Used when switching sessions to prevent unbounded growth over long uptime.
 */
export function getConversationExpansionResetState(): Partial<AppState> {
  return {
    aiGroupExpansionLevels: new Map(),
    expandedStepIds: new Set(),
    expandedDisplayItemIds: new Map(),
    expandedAIGroupIds: new Set(),
    activeDetailItem: null,
  };
}

/**
 * Full state reset (session + project + repository + conversation).
 * Used when closing all tabs or resetting to initial state.
 */
export function getFullResetState(): Partial<AppState> {
  return {
    ...getSessionResetState(),
    ...getConversationExpansionResetState(),
    selectedRepositoryId: null,
    selectedWorktreeId: null,
    selectedProjectId: null,
    activeProjectId: null,
    conversation: null,
    visibleAIGroupId: null,
    selectedAIGroup: null,
    sessionClaudeMdStats: null,
  };
}
