/**
 * Pane slice - manages multi-pane split layout state and actions.
 * Each pane has its own tab bar, active tab, and selected tabs.
 */

import { MAX_PANES } from '@renderer/types/panes';
import { generateUUID } from '@renderer/utils/stringUtils';

import {
  createEmptyPane,
  findPane,
  findPaneByTabId,
  getAllTabs,
  insertPane,
  removePane,
  syncFocusedPaneState,
  updatePane,
} from '../utils/paneHelpers';

import type { AppState } from '../types';
import type { PaneLayout } from '@renderer/types/panes';
import type { Tab } from '@renderer/types/tabs';
import type { StateCreator } from 'zustand';

// =============================================================================
// Slice Interface
// =============================================================================

export interface PaneSlice {
  // State
  paneLayout: PaneLayout;

  // Pane lifecycle
  focusPane: (paneId: string) => void;
  splitPane: (sourcePaneId: string, tabId: string, direction: 'left' | 'right') => void;
  closePane: (paneId: string) => void;

  // Tab movement
  moveTabToPane: (
    tabId: string,
    sourcePaneId: string,
    targetPaneId: string,
    insertIndex?: number
  ) => void;
  moveTabToNewPane: (
    tabId: string,
    sourcePaneId: string,
    adjacentPaneId: string,
    direction: 'left' | 'right'
  ) => void;
  reorderTabInPane: (paneId: string, fromIndex: number, toIndex: number) => void;

  // Resize
  resizePanes: (paneId: string, newWidthFraction: number) => void;

  // Queries
  getPaneForTab: (tabId: string) => string | null;
  getAllPaneTabs: () => Tab[];
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Sync root-level openTabs/activeTabId/selectedTabIds from the focused pane.
 * This maintains backward compatibility for consumers that read root-level state.
 */
function syncRootState(layout: PaneLayout): Record<string, unknown> {
  const synced = syncFocusedPaneState(layout);
  return {
    paneLayout: layout,
    openTabs: synced.openTabs,
    activeTabId: synced.activeTabId,
    selectedTabIds: synced.selectedTabIds,
  };
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createPaneSlice: StateCreator<AppState, [], [], PaneSlice> = (set, get) => ({
  // Initial state: single pane (populated by tabSlice init or first openTab)
  paneLayout: {
    panes: [
      {
        id: 'pane-default',
        tabs: [],
        activeTabId: null,
        selectedTabIds: [],
        widthFraction: 1,
      },
    ],
    focusedPaneId: 'pane-default',
  },

  focusPane: (paneId: string) => {
    const state = get();
    const { paneLayout } = state;
    if (paneLayout.focusedPaneId === paneId) return;

    const pane = findPane(paneLayout, paneId);
    if (!pane) return;

    const newLayout: PaneLayout = { ...paneLayout, focusedPaneId: paneId };
    set(syncRootState(newLayout));

    // Trigger sidebar sync for the focused pane's active tab
    if (pane.activeTabId) {
      get().setActiveTab(pane.activeTabId);
    }
  },

  splitPane: (sourcePaneId: string, tabId: string, direction: 'left' | 'right') => {
    const state = get();
    const { paneLayout } = state;

    if (paneLayout.panes.length >= MAX_PANES) return;

    const sourcePane = findPane(paneLayout, sourcePaneId);
    if (!sourcePane) return;

    const tab = sourcePane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Remove tab from source pane
    const newSourceTabs = sourcePane.tabs.filter((t) => t.id !== tabId);
    let newSourceActiveTabId = sourcePane.activeTabId;
    if (sourcePane.activeTabId === tabId) {
      // Focus adjacent tab in source
      const oldIndex = sourcePane.tabs.findIndex((t) => t.id === tabId);
      newSourceActiveTabId = newSourceTabs[oldIndex]?.id ?? newSourceTabs[oldIndex - 1]?.id ?? null;
    }

    const updatedSource = {
      ...sourcePane,
      tabs: newSourceTabs,
      activeTabId: newSourceActiveTabId,
      selectedTabIds: sourcePane.selectedTabIds.filter((id) => id !== tabId),
    };

    // Create new pane with the tab
    const newPaneId = generateUUID();
    const newPane = {
      ...createEmptyPane(newPaneId),
      tabs: [tab],
      activeTabId: tab.id,
    };

    // Update layout
    let newLayout = updatePane(paneLayout, updatedSource);

    // If source pane is now empty, remove it
    if (newSourceTabs.length === 0 && paneLayout.panes.length > 1) {
      newLayout = removePane(newLayout, sourcePaneId);
    }

    newLayout = insertPane(
      newLayout,
      updatedSource.id !== sourcePaneId ? paneLayout.panes[0].id : sourcePaneId,
      newPane,
      direction
    );
    newLayout = { ...newLayout, focusedPaneId: newPaneId };

    set(syncRootState(newLayout));

    // Sync sidebar for the new pane's active tab
    if (tab.type === 'session') {
      get().setActiveTab(tab.id);
    }
  },

  closePane: (paneId: string) => {
    const state = get();
    const { paneLayout } = state;

    if (paneLayout.panes.length <= 1) return; // Can't close the last pane

    const pane = findPane(paneLayout, paneId);
    if (!pane) return;

    // Cleanup tab UI state for all tabs in the pane
    for (const tab of pane.tabs) {
      state.cleanupTabUIState(tab.id);
    }

    const newLayout = removePane(paneLayout, paneId);
    set(syncRootState(newLayout));

    // Sync sidebar for the newly focused pane
    const focusedPane = findPane(newLayout, newLayout.focusedPaneId);
    if (focusedPane?.activeTabId) {
      get().setActiveTab(focusedPane.activeTabId);
    }
  },

  moveTabToPane: (
    tabId: string,
    sourcePaneId: string,
    targetPaneId: string,
    insertIndex?: number
  ) => {
    const state = get();
    const { paneLayout } = state;

    if (sourcePaneId === targetPaneId) return;

    const sourcePane = findPane(paneLayout, sourcePaneId);
    const targetPane = findPane(paneLayout, targetPaneId);
    if (!sourcePane || !targetPane) return;

    const tab = sourcePane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Remove from source
    const newSourceTabs = sourcePane.tabs.filter((t) => t.id !== tabId);
    let newSourceActiveTabId = sourcePane.activeTabId;
    if (sourcePane.activeTabId === tabId) {
      const oldIndex = sourcePane.tabs.findIndex((t) => t.id === tabId);
      newSourceActiveTabId = newSourceTabs[oldIndex]?.id ?? newSourceTabs[oldIndex - 1]?.id ?? null;
    }

    // Add to target at insertion index
    const newTargetTabs = [...targetPane.tabs];
    if (insertIndex !== undefined && insertIndex >= 0 && insertIndex <= newTargetTabs.length) {
      newTargetTabs.splice(insertIndex, 0, tab);
    } else {
      newTargetTabs.push(tab);
    }

    let newLayout = updatePane(paneLayout, {
      ...sourcePane,
      tabs: newSourceTabs,
      activeTabId: newSourceActiveTabId,
      selectedTabIds: sourcePane.selectedTabIds.filter((id) => id !== tabId),
    });
    newLayout = updatePane(newLayout, {
      ...targetPane,
      tabs: newTargetTabs,
      activeTabId: tab.id,
    });

    // Auto-close source pane if it's empty and not the sole pane
    if (newSourceTabs.length === 0 && newLayout.panes.length > 1) {
      newLayout = removePane(newLayout, sourcePaneId);
    }

    // Focus the target pane
    newLayout = { ...newLayout, focusedPaneId: targetPaneId };

    set(syncRootState(newLayout));
  },

  moveTabToNewPane: (
    tabId: string,
    sourcePaneId: string,
    adjacentPaneId: string,
    direction: 'left' | 'right'
  ) => {
    const state = get();
    const { paneLayout } = state;

    if (paneLayout.panes.length >= MAX_PANES) return;

    const sourcePane = findPane(paneLayout, sourcePaneId);
    if (!sourcePane) return;

    const tab = sourcePane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Remove from source
    const newSourceTabs = sourcePane.tabs.filter((t) => t.id !== tabId);
    let newSourceActiveTabId = sourcePane.activeTabId;
    if (sourcePane.activeTabId === tabId) {
      const oldIndex = sourcePane.tabs.findIndex((t) => t.id === tabId);
      newSourceActiveTabId = newSourceTabs[oldIndex]?.id ?? newSourceTabs[oldIndex - 1]?.id ?? null;
    }

    const newPaneId = generateUUID();
    const newPane = {
      ...createEmptyPane(newPaneId),
      tabs: [tab],
      activeTabId: tab.id,
    };

    let newLayout = updatePane(paneLayout, {
      ...sourcePane,
      tabs: newSourceTabs,
      activeTabId: newSourceActiveTabId,
      selectedTabIds: sourcePane.selectedTabIds.filter((id) => id !== tabId),
    });

    // Auto-close source pane if it's empty and not the sole pane
    if (newSourceTabs.length === 0 && newLayout.panes.length > 1) {
      newLayout = removePane(newLayout, sourcePaneId);
    }

    newLayout = insertPane(newLayout, adjacentPaneId, newPane, direction);
    newLayout = { ...newLayout, focusedPaneId: newPaneId };

    set(syncRootState(newLayout));
  },

  reorderTabInPane: (paneId: string, fromIndex: number, toIndex: number) => {
    const { paneLayout } = get();
    const pane = findPane(paneLayout, paneId);
    if (!pane) return;

    if (fromIndex < 0 || fromIndex >= pane.tabs.length) return;
    if (toIndex < 0 || toIndex >= pane.tabs.length) return;
    if (fromIndex === toIndex) return;

    const newTabs = [...pane.tabs];
    const [moved] = newTabs.splice(fromIndex, 1);
    newTabs.splice(toIndex, 0, moved);

    const newLayout = updatePane(paneLayout, { ...pane, tabs: newTabs });
    set(syncRootState(newLayout));
  },

  resizePanes: (paneId: string, newWidthFraction: number) => {
    const { paneLayout } = get();
    const paneIndex = paneLayout.panes.findIndex((p) => p.id === paneId);
    if (paneIndex === -1 || paneIndex >= paneLayout.panes.length - 1) return;

    const MIN_FRACTION = 0.1;
    const clamped = Math.max(
      MIN_FRACTION,
      Math.min(1 - MIN_FRACTION * (paneLayout.panes.length - 1), newWidthFraction)
    );
    const currentPane = paneLayout.panes[paneIndex];
    const nextPane = paneLayout.panes[paneIndex + 1];
    const combinedWidth = currentPane.widthFraction + nextPane.widthFraction;
    const nextWidth = combinedWidth - clamped;

    if (nextWidth < MIN_FRACTION) return;

    const newPanes = paneLayout.panes.map((p, i) => {
      if (i === paneIndex) return { ...p, widthFraction: clamped };
      if (i === paneIndex + 1) return { ...p, widthFraction: nextWidth };
      return p;
    });

    set({ paneLayout: { ...paneLayout, panes: newPanes } });
  },

  getPaneForTab: (tabId: string) => {
    const pane = findPaneByTabId(get().paneLayout, tabId);
    return pane?.id ?? null;
  },

  getAllPaneTabs: () => {
    return getAllTabs(get().paneLayout);
  },
});
