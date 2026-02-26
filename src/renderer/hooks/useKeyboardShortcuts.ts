/**
 * useKeyboardShortcuts - Global keyboard shortcut handler
 * Handles app-wide keyboard shortcuts for tab management, navigation, and pane management.
 *
 * Pane-scoped: Tab cycling (Ctrl+Tab, Cmd+1-9, Cmd+Shift+[/]) operates within the focused pane.
 * Pane shortcuts: Cmd+Option+1-4 (focus pane), Cmd+\ (split right), Cmd+Option+W (close pane).
 */

import { useEffect } from 'react';

import { createLogger } from '@shared/utils/logger';
import { useShallow } from 'zustand/react/shallow';

import { useStore } from '../store';

const logger = createLogger('Hook:KeyboardShortcuts');

export function useKeyboardShortcuts(): void {
  const {
    openTabs,
    activeTabId,
    selectedTabIds,
    openDashboard,
    closeTab,
    closeAllTabs,
    closeTabs,
    setActiveTab,
    showSearch,
    getActiveTab,
    selectedProjectId,
    selectedSessionId,
    refreshSessionInPlace,
    fetchSessions,
    openCommandPalette,
    openSettingsTab,
    toggleSidebar,
    paneLayout,
    focusPane,
    splitPane,
    closePane,
    availableContexts,
    activeContextId,
    switchContext,
    isContextSwitching,
  } = useStore(
    useShallow((s) => ({
      openTabs: s.openTabs,
      activeTabId: s.activeTabId,
      selectedTabIds: s.selectedTabIds,
      openDashboard: s.openDashboard,
      closeTab: s.closeTab,
      closeAllTabs: s.closeAllTabs,
      closeTabs: s.closeTabs,
      setActiveTab: s.setActiveTab,
      showSearch: s.showSearch,
      getActiveTab: s.getActiveTab,
      selectedProjectId: s.selectedProjectId,
      selectedSessionId: s.selectedSessionId,
      refreshSessionInPlace: s.refreshSessionInPlace,
      fetchSessions: s.fetchSessions,
      openCommandPalette: s.openCommandPalette,
      openSettingsTab: s.openSettingsTab,
      toggleSidebar: s.toggleSidebar,
      paneLayout: s.paneLayout,
      focusPane: s.focusPane,
      splitPane: s.splitPane,
      closePane: s.closePane,
      availableContexts: s.availableContexts,
      activeContextId: s.activeContextId,
      switchContext: s.switchContext,
      isContextSwitching: s.isContextSwitching,
    }))
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      // Check if Cmd (macOS) or Ctrl (Windows/Linux) is pressed
      const isMod = event.metaKey || event.ctrlKey;

      // Ctrl+Tab / Ctrl+Shift+Tab: Switch tabs within focused pane (universal shortcut)
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault();
        const currentIndex = openTabs.findIndex((t) => t.id === activeTabId);

        if (event.shiftKey) {
          // Ctrl+Shift+Tab: Previous tab (with wrap-around)
          if (currentIndex > 0) {
            setActiveTab(openTabs[currentIndex - 1].id);
          } else if (openTabs.length > 0) {
            // Wrap to last tab
            setActiveTab(openTabs[openTabs.length - 1].id);
          }
        } else {
          // Ctrl+Tab: Next tab (with wrap-around)
          if (currentIndex !== -1 && currentIndex < openTabs.length - 1) {
            setActiveTab(openTabs[currentIndex + 1].id);
          } else if (openTabs.length > 0) {
            // Wrap to first tab
            setActiveTab(openTabs[0].id);
          }
        }
        return;
      }

      if (!isMod) return;

      // --- Pane management shortcuts (Cmd+Option) ---

      // Cmd+Option+1-4: Focus pane by index
      if (event.altKey && !event.shiftKey) {
        const numKey = parseInt(event.key);
        if (numKey >= 1 && numKey <= 4) {
          event.preventDefault();
          const targetPane = paneLayout.panes[numKey - 1];
          if (targetPane) {
            focusPane(targetPane.id);
          }
          return;
        }

        // Cmd+Option+W: Close current pane
        if (event.key === 'w') {
          event.preventDefault();
          if (paneLayout.panes.length > 1) {
            closePane(paneLayout.focusedPaneId);
          }
          return;
        }
      }

      // Cmd+\: Split right with current tab
      if (event.key === '\\' && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (activeTabId) {
          splitPane(paneLayout.focusedPaneId, activeTabId, 'right');
        }
        return;
      }

      // Cmd+T: New tab (Dashboard)
      if (event.key === 't') {
        event.preventDefault();
        openDashboard();
        return;
      }

      // Cmd+Shift+W: Close all tabs
      if (event.key === 'w' && event.shiftKey && !event.altKey) {
        event.preventDefault();
        closeAllTabs();
        return;
      }

      // Cmd+W: Close selected tabs (if multi-selected) or active tab
      if (event.key === 'w' && !event.altKey) {
        event.preventDefault();
        if (selectedTabIds.length > 0) {
          closeTabs(selectedTabIds);
        } else if (activeTabId) {
          closeTab(activeTabId);
        }
        return;
      }

      // Cmd+[1-9]: Switch to tab by index within focused pane
      const numKey = parseInt(event.key);
      if (numKey >= 1 && numKey <= 9 && !event.altKey) {
        event.preventDefault();
        const targetTab = openTabs[numKey - 1];
        if (targetTab) {
          setActiveTab(targetTab.id);
        }
        return;
      }

      // Cmd+Shift+]: Next tab within focused pane
      if (event.key === ']' && event.shiftKey) {
        event.preventDefault();
        const currentIndex = openTabs.findIndex((t) => t.id === activeTabId);
        if (currentIndex !== -1 && currentIndex < openTabs.length - 1) {
          setActiveTab(openTabs[currentIndex + 1].id);
        }
        return;
      }

      // Cmd+Shift+[: Previous tab within focused pane
      if (event.key === '[' && event.shiftKey) {
        event.preventDefault();
        const currentIndex = openTabs.findIndex((t) => t.id === activeTabId);
        if (currentIndex > 0) {
          setActiveTab(openTabs[currentIndex - 1].id);
        }
        return;
      }

      // Cmd+Option+Right: Next tab (browser-style) within focused pane
      if (event.key === 'ArrowRight' && event.altKey) {
        event.preventDefault();
        const currentIndex = openTabs.findIndex((t) => t.id === activeTabId);
        if (currentIndex !== -1 && currentIndex < openTabs.length - 1) {
          setActiveTab(openTabs[currentIndex + 1].id);
        }
        return;
      }

      // Cmd+Option+Left: Previous tab (browser-style) within focused pane
      if (event.key === 'ArrowLeft' && event.altKey) {
        event.preventDefault();
        const currentIndex = openTabs.findIndex((t) => t.id === activeTabId);
        if (currentIndex > 0) {
          setActiveTab(openTabs[currentIndex - 1].id);
        }
        return;
      }

      // Cmd+Shift+K: Cycle to next workspace context
      if (event.key === 'k' && event.shiftKey) {
        event.preventDefault();
        if (!isContextSwitching && availableContexts.length > 1) {
          const currentIndex = availableContexts.findIndex((c) => c.id === activeContextId);
          const nextIndex = (currentIndex + 1) % availableContexts.length;
          void switchContext(availableContexts[nextIndex].id);
        }
        return;
      }

      // Cmd+K: Open command palette for global search
      if (event.key === 'k') {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      // Cmd+,: Open settings (standard macOS shortcut)
      if (event.key === ',') {
        event.preventDefault();
        openSettingsTab();
        return;
      }

      // Cmd+F: Find in session
      if (event.key === 'f') {
        event.preventDefault();
        const activeTab = getActiveTab();
        // Only enable search in session views, not dashboard
        if (activeTab?.type === 'session') {
          showSearch();
        }
        return;
      }

      // Cmd+O: Open project (placeholder for future implementation)
      if (event.key === 'o') {
        event.preventDefault();
        logger.debug('Open project shortcut triggered (not yet implemented)');
        return;
      }

      // Cmd+R: Refresh current session and sidebar session list
      if (event.key === 'r') {
        event.preventDefault();
        if (selectedProjectId && selectedSessionId) {
          void Promise.all([
            refreshSessionInPlace(selectedProjectId, selectedSessionId),
            fetchSessions(selectedProjectId),
          ]).then(() => {
            window.dispatchEvent(new CustomEvent('session-refresh-scroll-bottom'));
          });
        }
        return;
      }

      // Cmd+B: Toggle sidebar
      if (event.key === 'b') {
        event.preventDefault();
        toggleSidebar();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    openTabs,
    activeTabId,
    selectedTabIds,
    openDashboard,
    closeTab,
    closeAllTabs,
    closeTabs,
    setActiveTab,
    showSearch,
    getActiveTab,
    selectedProjectId,
    selectedSessionId,
    refreshSessionInPlace,
    fetchSessions,
    openCommandPalette,
    openSettingsTab,
    toggleSidebar,
    paneLayout,
    focusPane,
    splitPane,
    closePane,
    availableContexts,
    activeContextId,
    switchContext,
    isContextSwitching,
  ]);
}
