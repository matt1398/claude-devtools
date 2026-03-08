/**
 * TabUI slice unit tests.
 * Tests per-tab UI state isolation (expansion states, context panel, scroll position).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI, type MockElectronAPI } from '../../mocks/electronAPI';

import { createTestStore, type TestStore } from './storeTestUtils';

describe('tabUISlice', () => {
  let store: TestStore;
  let _mockAPI: MockElectronAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    _mockAPI = installMockElectronAPI();
    store = createTestStore();

    // Mock crypto.randomUUID for predictable tab IDs
    let uuidCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `test-uuid-${++uuidCounter}`,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('initTabUIState', () => {
    it('should initialize UI state for a new tab', () => {
      expect(store.getState().tabUIStates.size).toBe(0);

      store.getState().initTabUIState('tab-1');

      expect(store.getState().tabUIStates.size).toBe(1);
      expect(store.getState().tabUIStates.has('tab-1')).toBe(true);

      const tabState = store.getState().tabUIStates.get('tab-1');
      expect(tabState?.aiGroupsExpandedByDefault).toBe(true);
      expect(tabState?.toggledAIGroupIds.size).toBe(0);
      expect(tabState?.expandedDisplayItemIds.size).toBe(0);
      expect(tabState?.expandedSubagentTraceIds.size).toBe(0);
      expect(tabState?.showContextPanel).toBe(false);
      expect(tabState?.savedScrollTop).toBeUndefined();
    });

    it('should not reinitialize existing tab state', () => {
      store.getState().initTabUIState('tab-1');
      store.getState().toggleAIGroupExpansionForTab('tab-1', 'group-1');

      // Try to reinitialize
      store.getState().initTabUIState('tab-1');

      // Toggle overrode the default (expanded→collapsed), reinit should not reset it
      expect(store.getState().isAIGroupExpandedForTab('tab-1', 'group-1')).toBe(false);
    });
  });

  describe('cleanupTabUIState', () => {
    it('should remove UI state for a tab', () => {
      store.getState().initTabUIState('tab-1');
      store.getState().initTabUIState('tab-2');
      expect(store.getState().tabUIStates.size).toBe(2);

      store.getState().cleanupTabUIState('tab-1');

      expect(store.getState().tabUIStates.size).toBe(1);
      expect(store.getState().tabUIStates.has('tab-1')).toBe(false);
      expect(store.getState().tabUIStates.has('tab-2')).toBe(true);
    });

    it('should do nothing if tab does not exist', () => {
      store.getState().initTabUIState('tab-1');

      store.getState().cleanupTabUIState('nonexistent');

      expect(store.getState().tabUIStates.size).toBe(1);
    });
  });

  describe('AI Group expansion - per-tab isolation', () => {
    it('should toggle AI group expansion for specific tab', () => {
      store.getState().initTabUIState('tab-1');

      // Default is expanded (aiGroupsExpandedByDefault = true)
      expect(store.getState().isAIGroupExpandedForTab('tab-1', 'group-1')).toBe(true);

      // Toggle once → collapsed
      store.getState().toggleAIGroupExpansionForTab('tab-1', 'group-1');
      expect(store.getState().isAIGroupExpandedForTab('tab-1', 'group-1')).toBe(false);

      // Toggle again → back to expanded
      store.getState().toggleAIGroupExpansionForTab('tab-1', 'group-1');
      expect(store.getState().isAIGroupExpandedForTab('tab-1', 'group-1')).toBe(true);
    });

    it('should isolate AI group expansion between tabs', () => {
      store.getState().initTabUIState('tab-1');
      store.getState().initTabUIState('tab-2');

      // Collapse group-1 in tab-1 only (default is expanded)
      store.getState().toggleAIGroupExpansionForTab('tab-1', 'group-1');

      // tab-1 has it collapsed, tab-2 still expanded by default
      expect(store.getState().isAIGroupExpandedForTab('tab-1', 'group-1')).toBe(false);
      expect(store.getState().isAIGroupExpandedForTab('tab-2', 'group-1')).toBe(true);

      // Collapse group-2 in tab-2
      store.getState().toggleAIGroupExpansionForTab('tab-2', 'group-2');

      // Each tab has its own override state
      expect(store.getState().isAIGroupExpandedForTab('tab-1', 'group-1')).toBe(false);
      expect(store.getState().isAIGroupExpandedForTab('tab-1', 'group-2')).toBe(true);
      expect(store.getState().isAIGroupExpandedForTab('tab-2', 'group-1')).toBe(true);
      expect(store.getState().isAIGroupExpandedForTab('tab-2', 'group-2')).toBe(false);
    });

    it('should expand AI group programmatically', () => {
      store.getState().initTabUIState('tab-1');

      store.getState().expandAIGroupForTab('tab-1', 'group-1');
      expect(store.getState().isAIGroupExpandedForTab('tab-1', 'group-1')).toBe(true);

      // Calling expand again should not change state (idempotent)
      store.getState().expandAIGroupForTab('tab-1', 'group-1');
      expect(store.getState().isAIGroupExpandedForTab('tab-1', 'group-1')).toBe(true);
    });
  });

  describe('Display item expansion - per-tab isolation', () => {
    it('should toggle display item expansion within AI group', () => {
      store.getState().initTabUIState('tab-1');

      const items = store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-1');
      expect(items.size).toBe(0);

      store.getState().toggleDisplayItemExpansionForTab('tab-1', 'group-1', 'item-1');

      const updatedItems = store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-1');
      expect(updatedItems.has('item-1')).toBe(true);

      store.getState().toggleDisplayItemExpansionForTab('tab-1', 'group-1', 'item-1');

      const finalItems = store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-1');
      expect(finalItems.has('item-1')).toBe(false);
    });

    it('should isolate display item expansion between tabs', () => {
      store.getState().initTabUIState('tab-1');
      store.getState().initTabUIState('tab-2');

      // Expand item in tab-1
      store.getState().toggleDisplayItemExpansionForTab('tab-1', 'group-1', 'item-1');

      // tab-1 should have it, tab-2 should not
      expect(
        store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-1').has('item-1')
      ).toBe(true);
      expect(
        store.getState().getExpandedDisplayItemIdsForTab('tab-2', 'group-1').has('item-1')
      ).toBe(false);
    });

    it('should isolate display items by AI group within same tab', () => {
      store.getState().initTabUIState('tab-1');

      store.getState().toggleDisplayItemExpansionForTab('tab-1', 'group-1', 'item-1');
      store.getState().toggleDisplayItemExpansionForTab('tab-1', 'group-2', 'item-2');

      expect(
        store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-1').has('item-1')
      ).toBe(true);
      expect(
        store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-1').has('item-2')
      ).toBe(false);
      expect(
        store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-2').has('item-1')
      ).toBe(false);
      expect(
        store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-2').has('item-2')
      ).toBe(true);
    });

    it('should expand display item programmatically', () => {
      store.getState().initTabUIState('tab-1');

      store.getState().expandDisplayItemForTab('tab-1', 'group-1', 'item-1');
      expect(
        store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-1').has('item-1')
      ).toBe(true);

      // Calling expand again should not change state (idempotent)
      store.getState().expandDisplayItemForTab('tab-1', 'group-1', 'item-1');
      expect(
        store.getState().getExpandedDisplayItemIdsForTab('tab-1', 'group-1').has('item-1')
      ).toBe(true);
    });
  });

  describe('Subagent trace expansion - per-tab isolation', () => {
    it('should toggle subagent trace expansion', () => {
      store.getState().initTabUIState('tab-1');

      expect(store.getState().isSubagentTraceExpandedForTab('tab-1', 'subagent-1')).toBe(false);

      store.getState().toggleSubagentTraceExpansionForTab('tab-1', 'subagent-1');
      expect(store.getState().isSubagentTraceExpandedForTab('tab-1', 'subagent-1')).toBe(true);

      store.getState().toggleSubagentTraceExpansionForTab('tab-1', 'subagent-1');
      expect(store.getState().isSubagentTraceExpandedForTab('tab-1', 'subagent-1')).toBe(false);
    });

    it('should isolate subagent trace expansion between tabs', () => {
      store.getState().initTabUIState('tab-1');
      store.getState().initTabUIState('tab-2');

      store.getState().toggleSubagentTraceExpansionForTab('tab-1', 'subagent-1');

      expect(store.getState().isSubagentTraceExpandedForTab('tab-1', 'subagent-1')).toBe(true);
      expect(store.getState().isSubagentTraceExpandedForTab('tab-2', 'subagent-1')).toBe(false);
    });
  });

  describe('Context panel visibility - per-tab isolation', () => {
    it('should set context panel visibility', () => {
      store.getState().initTabUIState('tab-1');

      expect(store.getState().isContextPanelVisibleForTab('tab-1')).toBe(false);

      store.getState().setContextPanelVisibleForTab('tab-1', true);
      expect(store.getState().isContextPanelVisibleForTab('tab-1')).toBe(true);

      store.getState().setContextPanelVisibleForTab('tab-1', false);
      expect(store.getState().isContextPanelVisibleForTab('tab-1')).toBe(false);
    });

    it('should isolate context panel visibility between tabs', () => {
      store.getState().initTabUIState('tab-1');
      store.getState().initTabUIState('tab-2');

      store.getState().setContextPanelVisibleForTab('tab-1', true);

      expect(store.getState().isContextPanelVisibleForTab('tab-1')).toBe(true);
      expect(store.getState().isContextPanelVisibleForTab('tab-2')).toBe(false);
    });
  });

  describe('Scroll position - per-tab isolation', () => {
    it('should save and retrieve scroll position', () => {
      store.getState().initTabUIState('tab-1');

      expect(store.getState().getScrollPositionForTab('tab-1')).toBeUndefined();

      store.getState().saveScrollPositionForTab('tab-1', 500);
      expect(store.getState().getScrollPositionForTab('tab-1')).toBe(500);

      store.getState().saveScrollPositionForTab('tab-1', 1000);
      expect(store.getState().getScrollPositionForTab('tab-1')).toBe(1000);
    });

    it('should isolate scroll positions between tabs', () => {
      store.getState().initTabUIState('tab-1');
      store.getState().initTabUIState('tab-2');

      store.getState().saveScrollPositionForTab('tab-1', 100);
      store.getState().saveScrollPositionForTab('tab-2', 200);

      expect(store.getState().getScrollPositionForTab('tab-1')).toBe(100);
      expect(store.getState().getScrollPositionForTab('tab-2')).toBe(200);
    });
  });

  describe('Integration with tab lifecycle', () => {
    it('should handle full tab lifecycle', () => {
      // Simulate opening a tab
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });
      const tabId = store.getState().activeTabId!;

      // Initialize UI state
      store.getState().initTabUIState(tabId);

      // Set some UI state
      store.getState().toggleAIGroupExpansionForTab(tabId, 'group-1');
      store.getState().setContextPanelVisibleForTab(tabId, true);
      store.getState().saveScrollPositionForTab(tabId, 300);

      // Verify state (default=expanded, one toggle → collapsed)
      expect(store.getState().isAIGroupExpandedForTab(tabId, 'group-1')).toBe(false);
      expect(store.getState().isContextPanelVisibleForTab(tabId)).toBe(true);
      expect(store.getState().getScrollPositionForTab(tabId)).toBe(300);

      // Close tab (should cleanup UI state)
      store.getState().closeTab(tabId);

      // UI state should be cleaned up
      expect(store.getState().tabUIStates.has(tabId)).toBe(false);
    });

    it('should maintain separate state for two tabs with same session (forceNewTab)', () => {
      // Open first tab
      store.getState().openTab({
        type: 'session',
        sessionId: 'session-1',
        projectId: 'project-1',
        label: 'Session 1',
      });
      const tab1Id = store.getState().activeTabId!;
      store.getState().initTabUIState(tab1Id);

      // Open second tab with same session (forceNewTab)
      store.getState().openTab(
        {
          type: 'session',
          sessionId: 'session-1',
          projectId: 'project-1',
          label: 'Session 1 (Copy)',
        },
        { forceNewTab: true }
      );
      const tab2Id = store.getState().activeTabId!;
      store.getState().initTabUIState(tab2Id);

      // Both tabs should have same session
      expect(store.getState().openTabs.filter((t) => t.sessionId === 'session-1')).toHaveLength(2);

      // Set different states for each tab
      store.getState().toggleAIGroupExpansionForTab(tab1Id, 'group-1');
      store.getState().toggleAIGroupExpansionForTab(tab2Id, 'group-2');
      store.getState().setContextPanelVisibleForTab(tab1Id, true);
      store.getState().saveScrollPositionForTab(tab1Id, 100);
      store.getState().saveScrollPositionForTab(tab2Id, 500);

      // Verify states are isolated (default=expanded, toggle inverts the specific group)
      expect(store.getState().isAIGroupExpandedForTab(tab1Id, 'group-1')).toBe(false); // toggled → collapsed
      expect(store.getState().isAIGroupExpandedForTab(tab1Id, 'group-2')).toBe(true); // untouched → expanded
      expect(store.getState().isAIGroupExpandedForTab(tab2Id, 'group-1')).toBe(true); // untouched → expanded
      expect(store.getState().isAIGroupExpandedForTab(tab2Id, 'group-2')).toBe(false); // toggled → collapsed

      expect(store.getState().isContextPanelVisibleForTab(tab1Id)).toBe(true);
      expect(store.getState().isContextPanelVisibleForTab(tab2Id)).toBe(false);

      expect(store.getState().getScrollPositionForTab(tab1Id)).toBe(100);
      expect(store.getState().getScrollPositionForTab(tab2Id)).toBe(500);
    });
  });

  describe('Edge cases', () => {
    it('should return false/empty for uninitialized tab', () => {
      // No initialization - uninitialized tabs default to expanded (aiGroupsExpandedByDefault=true)
      expect(store.getState().isAIGroupExpandedForTab('nonexistent', 'group-1')).toBe(true);
      expect(store.getState().getExpandedDisplayItemIdsForTab('nonexistent', 'group-1').size).toBe(
        0
      );
      expect(store.getState().isSubagentTraceExpandedForTab('nonexistent', 'subagent-1')).toBe(
        false
      );
      expect(store.getState().isContextPanelVisibleForTab('nonexistent')).toBe(false);
      expect(store.getState().getScrollPositionForTab('nonexistent')).toBeUndefined();
    });

    it('should auto-create tab state when toggling (lazy initialization)', () => {
      // Toggle without explicit init
      store.getState().toggleAIGroupExpansionForTab('lazy-tab', 'group-1');

      // Should have created the state; default is expanded so one toggle → collapsed
      expect(store.getState().tabUIStates.has('lazy-tab')).toBe(true);
      expect(store.getState().isAIGroupExpandedForTab('lazy-tab', 'group-1')).toBe(false);
    });
  });
});
