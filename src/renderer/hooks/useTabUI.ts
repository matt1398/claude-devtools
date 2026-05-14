/**
 * useTabUI - Hook for accessing per-tab UI state.
 *
 * This hook combines the TabUIContext (for tabId) with the tabUISlice (for state/actions).
 * It provides a simple interface for components to access their tab-specific UI state.
 *
 * IMPORTANT: This hook subscribes to `tabUIStates` directly to ensure proper reactivity.
 * Using getter functions (like isContextPanelVisibleForTab) in useMemo doesn't work
 * because the function reference doesn't change when the underlying state changes.
 *
 * Usage:
 * ```tsx
 * const { isAIGroupExpanded, toggleAIGroupExpansion } = useTabUI();
 *
 * // Check if a group is expanded in THIS tab
 * if (isAIGroupExpanded(groupId)) { ... }
 *
 * // Toggle expansion in THIS tab only
 * toggleAIGroupExpansion(groupId);
 * ```
 */

import { useCallback, useMemo } from 'react';

import { useTabIdOptional } from '@renderer/contexts/useTabUIContext';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

// =============================================================================
// Types
// =============================================================================

interface UseTabUIReturn {
  tabId: string | null;
  isAIGroupExpanded: (aiGroupId: string) => boolean;
  toggleAIGroupExpansion: (aiGroupId: string) => void;
  expandAIGroup: (aiGroupId: string) => void;
  expandAllAIGroups: (aiGroupIds: string[]) => void;
  expandAllSignal: number;
  triggerExpandAll: () => void;
  getExpandedDisplayItemIds: (aiGroupId: string) => Set<string>;
  toggleDisplayItemExpansion: (aiGroupId: string, itemId: string) => void;
  expandDisplayItem: (aiGroupId: string, itemId: string) => void;
  expandMany: (aiGroupId: string, itemIds: string[], subagentIds: string[]) => void;
  isSubagentTraceExpanded: (subagentId: string) => boolean;
  toggleSubagentTraceExpansion: (subagentId: string) => void;
  expandSubagentTrace: (subagentId: string) => void;
  isContextPanelVisible: boolean;
  setContextPanelVisible: (visible: boolean) => void;
  selectedContextPhase: number | null;
  setSelectedContextPhase: (phase: number | null) => void;
  savedScrollTop: number | undefined;
  saveScrollPosition: (scrollTop: number) => void;
  initializeTabUI: () => void;
}

// =============================================================================
// Main Hook
// =============================================================================

/**
 * Hook for accessing per-tab UI state and actions.
 *
 * @returns Object containing per-tab state getters and actions
 */
export function useTabUI(): UseTabUIReturn {
  // Get tabId from context (null if not in a tab)
  const tabId = useTabIdOptional();

  // Subscribe to tabUIStates MAP directly for reactivity
  // This ensures re-renders when any tab state changes
  const tabUIStates = useStore((s) => s.tabUIStates);

  // Get the current tab's state (derived from subscribed state)
  const tabState = useMemo(() => {
    if (!tabId) return null;
    return tabUIStates.get(tabId) ?? null;
  }, [tabId, tabUIStates]);

  // Get all tab UI actions from store (these are stable function references)
  const {
    toggleAIGroupExpansionForTab,
    expandAIGroupForTab,
    expandAllAIGroupsForTab,
    triggerExpandAllForTab,
    toggleDisplayItemExpansionForTab,
    expandDisplayItemForTab,
    expandManyForTab,
    toggleSubagentTraceExpansionForTab,
    expandSubagentTraceForTab,
    setContextPanelVisibleForTab,
    setSelectedContextPhaseForTab,
    saveScrollPositionForTab,
    initTabUIState,
  } = useStore(
    useShallow((s) => ({
      toggleAIGroupExpansionForTab: s.toggleAIGroupExpansionForTab,
      expandAIGroupForTab: s.expandAIGroupForTab,
      expandAllAIGroupsForTab: s.expandAllAIGroupsForTab,
      triggerExpandAllForTab: s.triggerExpandAllForTab,
      toggleDisplayItemExpansionForTab: s.toggleDisplayItemExpansionForTab,
      expandDisplayItemForTab: s.expandDisplayItemForTab,
      expandManyForTab: s.expandManyForTab,
      toggleSubagentTraceExpansionForTab: s.toggleSubagentTraceExpansionForTab,
      expandSubagentTraceForTab: s.expandSubagentTraceForTab,
      setContextPanelVisibleForTab: s.setContextPanelVisibleForTab,
      setSelectedContextPhaseForTab: s.setSelectedContextPhaseForTab,
      saveScrollPositionForTab: s.saveScrollPositionForTab,
      initTabUIState: s.initTabUIState,
    }))
  );

  // ==========================================================================
  // Derived state from tabState (reactive!)
  // ==========================================================================

  // AI Group expansion - check directly from tabState
  const isAIGroupExpanded = useCallback(
    (aiGroupId: string): boolean => {
      return tabState?.expandedAIGroupIds.has(aiGroupId) ?? false;
    },
    [tabState]
  );

  const toggleAIGroupExpansion = useCallback(
    (aiGroupId: string): void => {
      if (!tabId) return;
      toggleAIGroupExpansionForTab(tabId, aiGroupId);
    },
    [tabId, toggleAIGroupExpansionForTab]
  );

  const expandAIGroup = useCallback(
    (aiGroupId: string): void => {
      if (!tabId) return;
      expandAIGroupForTab(tabId, aiGroupId);
    },
    [tabId, expandAIGroupForTab]
  );

  const expandAllAIGroups = useCallback(
    (aiGroupIds: string[]): void => {
      if (!tabId) return;
      expandAllAIGroupsForTab(tabId, aiGroupIds);
    },
    [tabId, expandAllAIGroupsForTab]
  );

  const expandAllSignal = tabState?.expandAllSignal ?? 0;

  const triggerExpandAll = useCallback((): void => {
    if (!tabId) return;
    triggerExpandAllForTab(tabId);
  }, [tabId, triggerExpandAllForTab]);

  // Display item expansion - derive from tabState
  const getExpandedDisplayItemIds = useCallback(
    (aiGroupId: string): Set<string> => {
      return tabState?.expandedDisplayItemIds.get(aiGroupId) ?? new Set<string>();
    },
    [tabState]
  );

  const toggleDisplayItemExpansion = useCallback(
    (aiGroupId: string, itemId: string): void => {
      if (!tabId) return;
      toggleDisplayItemExpansionForTab(tabId, aiGroupId, itemId);
    },
    [tabId, toggleDisplayItemExpansionForTab]
  );

  const expandDisplayItem = useCallback(
    (aiGroupId: string, itemId: string): void => {
      if (!tabId) return;
      expandDisplayItemForTab(tabId, aiGroupId, itemId);
    },
    [tabId, expandDisplayItemForTab]
  );

  const expandMany = useCallback(
    (aiGroupId: string, itemIds: string[], subagentIds: string[]): void => {
      if (!tabId) return;
      expandManyForTab(tabId, aiGroupId, itemIds, subagentIds);
    },
    [tabId, expandManyForTab]
  );

  // Subagent trace expansion - derive from tabState
  const isSubagentTraceExpanded = useCallback(
    (subagentId: string): boolean => {
      return tabState?.expandedSubagentTraceIds.has(subagentId) ?? false;
    },
    [tabState]
  );

  const toggleSubagentTraceExpansion = useCallback(
    (subagentId: string): void => {
      if (!tabId) return;
      toggleSubagentTraceExpansionForTab(tabId, subagentId);
    },
    [tabId, toggleSubagentTraceExpansionForTab]
  );

  const expandSubagentTrace = useCallback(
    (subagentId: string): void => {
      if (!tabId) return;
      expandSubagentTraceForTab(tabId, subagentId);
    },
    [tabId, expandSubagentTraceForTab]
  );

  // Context panel - derive directly from tabState (reactive!)
  const isContextPanelVisible = tabState?.showContextPanel ?? false;

  const setContextPanelVisible = useCallback(
    (visible: boolean): void => {
      if (!tabId) return;
      setContextPanelVisibleForTab(tabId, visible);
    },
    [tabId, setContextPanelVisibleForTab]
  );

  // Context phase selection - derive from tabState
  const selectedContextPhase = tabState?.selectedContextPhase ?? null;

  const setSelectedContextPhase = useCallback(
    (phase: number | null): void => {
      if (!tabId) return;
      setSelectedContextPhaseForTab(tabId, phase);
    },
    [tabId, setSelectedContextPhaseForTab]
  );

  // Scroll position - derive from tabState
  const savedScrollTop = tabState?.savedScrollTop;

  const saveScrollPosition = useCallback(
    (scrollTop: number): void => {
      if (!tabId) return;
      saveScrollPositionForTab(tabId, scrollTop);
    },
    [tabId, saveScrollPositionForTab]
  );

  // Initialize tab UI state (call once when tab is mounted)
  const initializeTabUI = useCallback((): void => {
    if (!tabId) return;
    initTabUIState(tabId);
  }, [tabId, initTabUIState]);

  return {
    // Current tab ID
    tabId,

    // AI Group expansion
    isAIGroupExpanded,
    toggleAIGroupExpansion,
    expandAIGroup,
    expandAllAIGroups,
    expandAllSignal,
    triggerExpandAll,

    // Display item expansion
    getExpandedDisplayItemIds,
    toggleDisplayItemExpansion,
    expandDisplayItem,
    expandMany,

    // Subagent trace expansion
    isSubagentTraceExpanded,
    toggleSubagentTraceExpansion,
    expandSubagentTrace,

    // Context panel
    isContextPanelVisible,
    setContextPanelVisible,

    // Context phase selection
    selectedContextPhase,
    setSelectedContextPhase,

    // Scroll position
    savedScrollTop,
    saveScrollPosition,

    // Initialization
    initializeTabUI,
  };
}
