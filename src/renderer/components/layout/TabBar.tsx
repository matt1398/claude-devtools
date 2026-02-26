/**
 * TabBar - Displays open tabs with close buttons and action buttons.
 * Accepts a paneId prop to scope to a specific pane's tabs.
 * Supports tab switching, closing, horizontal scrolling on overflow,
 * right-click context menu, middle-click to close, Shift/Ctrl+click multi-select,
 * and drag-and-drop reordering/cross-pane movement via @dnd-kit.
 * When sidebar is collapsed, shows expand button on the left with macOS traffic light spacing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useDroppable } from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import { isElectronMode } from '@renderer/api';
import { HEADER_ROW1_HEIGHT } from '@renderer/constants/layout';
import { useStore } from '@renderer/store';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { Bell, PanelLeft, Plus, RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { MoreMenu } from './MoreMenu';
import { SortableTab } from './SortableTab';
import { TabContextMenu } from './TabContextMenu';

interface TabBarProps {
  paneId: string;
}

export const TabBar = ({ paneId }: TabBarProps): React.JSX.Element => {
  const {
    pane,
    isFocused,
    paneCount,
    setActiveTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    closeTabs,
    setSelectedTabIds,
    clearTabSelection,
    openDashboard,
    refreshSessionInPlace,
    fetchSessions,
    unreadCount,
    openNotificationsTab,
    sidebarCollapsed,
    toggleSidebar,
    splitPane,
    togglePinSession,
    pinnedSessionIds,
    toggleHideSession,
    hiddenSessionIds,
    tabSessionData,
  } = useStore(
    useShallow((s) => ({
      pane: s.paneLayout.panes.find((p) => p.id === paneId),
      isFocused: s.paneLayout.focusedPaneId === paneId,
      paneCount: s.paneLayout.panes.length,
      setActiveTab: s.setActiveTab,
      closeTab: s.closeTab,
      closeOtherTabs: s.closeOtherTabs,
      closeAllTabs: s.closeAllTabs,
      closeTabs: s.closeTabs,
      setSelectedTabIds: s.setSelectedTabIds,
      clearTabSelection: s.clearTabSelection,
      openDashboard: s.openDashboard,
      refreshSessionInPlace: s.refreshSessionInPlace,
      fetchSessions: s.fetchSessions,
      unreadCount: s.unreadCount,
      openNotificationsTab: s.openNotificationsTab,
      sidebarCollapsed: s.sidebarCollapsed,
      toggleSidebar: s.toggleSidebar,
      splitPane: s.splitPane,
      togglePinSession: s.togglePinSession,
      pinnedSessionIds: s.pinnedSessionIds,
      toggleHideSession: s.toggleHideSession,
      hiddenSessionIds: s.hiddenSessionIds,
      tabSessionData: s.tabSessionData,
    }))
  );

  const openTabs = useMemo(() => pane?.tabs ?? [], [pane?.tabs]);
  const activeTabId = pane?.activeTabId ?? null;
  const selectedTabIds = useMemo(() => pane?.selectedTabIds ?? [], [pane?.selectedTabIds]);

  // Derive Set for O(1) lookups
  const selectedSet = useMemo(() => new Set(selectedTabIds), [selectedTabIds]);

  // Derive stable tab IDs array for SortableContext
  const tabIds = useMemo(() => openTabs.map((t) => t.id), [openTabs]);

  // Derive session detail for the active tab (used by export dropdown)
  const activeTabSessionDetail = activeTabId
    ? (tabSessionData[activeTabId]?.sessionDetail ?? null)
    : null;

  // Hover states for buttons
  const [expandHover, setExpandHover] = useState(false);
  const [refreshHover, setRefreshHover] = useState(false);
  const [newTabHover, setNewTabHover] = useState(false);
  const [notificationsHover, setNotificationsHover] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(
    null
  );

  // Track last clicked tab for Shift range selection
  const lastClickedTabIdRef = useRef<string | null>(null);

  // Get the active tab
  const activeTab = openTabs.find((tab) => tab.id === activeTabId);

  // Refs for auto-scrolling to active tab
  const tabRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Make the tab bar area droppable for cross-pane drops
  const { setNodeRef: setDroppableRef, isOver: isDroppableOver } = useDroppable({
    id: `tabbar-${paneId}`,
    data: {
      type: 'tabbar',
      paneId,
    },
  });

  // Auto-scroll to active tab when it changes
  useEffect(() => {
    if (!activeTabId) return;

    const tabElement = tabRefsMap.current.get(activeTabId);
    if (tabElement && scrollContainerRef.current) {
      tabElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [activeTabId]);

  // Clear selection on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && selectedTabIds.length > 0) {
        clearTabSelection();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedTabIds.length, clearTabSelection]);

  // Handle tab click with multi-select support
  const handleTabClick = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      if (isMeta) {
        // Ctrl/Cmd+click: toggle tab in selection
        if (selectedSet.has(tabId)) {
          setSelectedTabIds(selectedTabIds.filter((id) => id !== tabId));
        } else {
          setSelectedTabIds([...selectedTabIds, tabId]);
        }
        lastClickedTabIdRef.current = tabId;
        return;
      }

      if (isShift && lastClickedTabIdRef.current) {
        // Shift+click: range selection from last clicked to current
        const lastIndex = openTabs.findIndex((t) => t.id === lastClickedTabIdRef.current);
        const currentIndex = openTabs.findIndex((t) => t.id === tabId);
        if (lastIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastIndex, currentIndex);
          const end = Math.max(lastIndex, currentIndex);
          const rangeIds = openTabs.slice(start, end + 1).map((t) => t.id);
          // Merge with existing selection
          const merged = new Set([...selectedTabIds, ...rangeIds]);
          setSelectedTabIds([...merged]);
        }
        return;
      }

      // Plain click: clear selection, switch tab
      clearTabSelection();
      lastClickedTabIdRef.current = tabId;
      setActiveTab(tabId);
    },
    [openTabs, selectedTabIds, selectedSet, setActiveTab, setSelectedTabIds, clearTabSelection]
  );

  // Middle-click to close + prevent text selection on Shift/Cmd click
  const handleMouseDown = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(tabId);
        return;
      }
      // Prevent native text selection when Shift or Cmd/Ctrl clicking tabs
      if (e.button === 0 && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
      }
    },
    [closeTab]
  );

  // Right-click context menu
  const handleContextMenu = useCallback((tabId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }, []);

  // Handle refresh for active session tab
  const handleRefresh = async (): Promise<void> => {
    if (activeTab?.type === 'session' && activeTab.projectId && activeTab.sessionId) {
      await Promise.all([
        refreshSessionInPlace(activeTab.projectId, activeTab.sessionId),
        fetchSessions(activeTab.projectId),
      ]);
      window.dispatchEvent(new CustomEvent('session-refresh-scroll-bottom'));
    }
  };

  // Ref setter for SortableTab
  const setTabRef = useCallback((tabId: string, el: HTMLDivElement | null) => {
    if (el) {
      tabRefsMap.current.set(tabId, el);
    } else {
      tabRefsMap.current.delete(tabId);
    }
  }, []);

  // Context menu helpers
  const contextMenuTabId = contextMenu?.tabId ?? null;
  const effectiveSelectedCount =
    contextMenuTabId && selectedSet.has(contextMenuTabId) ? selectedTabIds.length : 0;

  // Pin state for context menu tab
  const contextMenuTab = contextMenuTabId ? openTabs.find((t) => t.id === contextMenuTabId) : null;
  const isContextMenuTabSession = contextMenuTab?.type === 'session';
  const isContextMenuTabPinned =
    isContextMenuTabSession && contextMenuTab?.sessionId
      ? pinnedSessionIds.includes(contextMenuTab.sessionId)
      : false;
  const isContextMenuTabHidden =
    isContextMenuTabSession && contextMenuTab?.sessionId
      ? hiddenSessionIds.includes(contextMenuTab.sessionId)
      : false;

  // Show sidebar expand button only in the leftmost pane
  const isLeftmostPane = useStore(
    (s) => s.paneLayout.panes.length === 0 || s.paneLayout.panes[0]?.id === paneId
  );

  return (
    <div
      className="flex items-center justify-between pr-2"
      style={
        {
          height: `${HEADER_ROW1_HEIGHT}px`,
          paddingLeft:
            sidebarCollapsed && isLeftmostPane
              ? 'var(--macos-traffic-light-padding-left, 72px)'
              : '8px',
          WebkitAppRegion: isElectronMode() && isLeftmostPane ? 'drag' : undefined,
          backgroundColor: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          opacity: isFocused || paneCount === 1 ? 1 : 0.7,
        } as React.CSSProperties
      }
    >
      {/* Expand sidebar button - show when collapsed (only in leftmost pane) */}
      {sidebarCollapsed && isLeftmostPane && (
        <button
          onClick={toggleSidebar}
          onMouseEnter={() => setExpandHover(true)}
          onMouseLeave={() => setExpandHover(false)}
          className="mr-2 shrink-0 rounded-md p-1.5 transition-colors"
          style={
            {
              WebkitAppRegion: 'no-drag',
              color: expandHover ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor: expandHover ? 'var(--color-surface-raised)' : 'transparent',
            } as React.CSSProperties
          }
          title="Expand sidebar"
        >
          <PanelLeft className="size-4" />
        </button>
      )}

      {/* Tab list with horizontal scroll, sortable DnD, and droppable area.
          Capped at 75% so the drag spacer always has room to the right. */}
      <div
        ref={(el) => {
          scrollContainerRef.current = el;
          setDroppableRef(el);
        }}
        className="scrollbar-none flex min-w-0 shrink items-center gap-1 overflow-x-auto"
        style={
          {
            maxWidth: '75%',
            WebkitAppRegion: 'no-drag',
            outline: isDroppableOver ? '1px dashed var(--color-accent, #6366f1)' : 'none',
            outlineOffset: '-1px',
          } as React.CSSProperties
        }
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          {openTabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              paneId={paneId}
              isActive={tab.id === activeTabId}
              isSelected={selectedSet.has(tab.id)}
              onTabClick={handleTabClick}
              onMouseDown={handleMouseDown}
              onContextMenu={handleContextMenu}
              onClose={closeTab}
              setRef={setTabRef}
            />
          ))}
        </SortableContext>

        {/* Refresh button - show only for session tabs */}
        {activeTab?.type === 'session' && (
          <button
            className="flex size-8 shrink-0 items-center justify-center rounded-md transition-colors"
            style={{
              color: refreshHover ? 'var(--color-text)' : 'var(--color-text-muted)',
              backgroundColor: refreshHover ? 'var(--color-surface-raised)' : 'transparent',
            }}
            onMouseEnter={() => setRefreshHover(true)}
            onMouseLeave={() => setRefreshHover(false)}
            onClick={handleRefresh}
            title={`Refresh Session (${formatShortcut('R')})`}
          >
            <RefreshCw className="size-4" />
          </button>
        )}
      </div>

      {/* Drag spacer — fills empty space between tab list and action buttons.
          Gives users a reliable window-drag target regardless of how many tabs are open.
          Only applied on the leftmost pane in Electron to match the TabBar drag region logic. */}
      <div
        className="flex-1 self-stretch"
        style={
          {
            WebkitAppRegion: isElectronMode() && isLeftmostPane ? 'drag' : undefined,
          } as React.CSSProperties
        }
      />

      {/* Right side actions */}
      <div
        className="ml-2 flex shrink-0 items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* New tab button */}
        <button
          onClick={openDashboard}
          onMouseEnter={() => setNewTabHover(true)}
          onMouseLeave={() => setNewTabHover(false)}
          className="rounded-md p-2 transition-colors"
          style={{
            color: newTabHover ? 'var(--color-text)' : 'var(--color-text-muted)',
            backgroundColor: newTabHover ? 'var(--color-surface-raised)' : 'transparent',
          }}
          title="New tab (Dashboard)"
        >
          <Plus className="size-4" />
        </button>

        {/* Notifications bell icon */}
        <button
          onClick={openNotificationsTab}
          onMouseEnter={() => setNotificationsHover(true)}
          onMouseLeave={() => setNotificationsHover(false)}
          className="relative rounded-md p-2 transition-colors"
          style={{
            color: notificationsHover ? 'var(--color-text)' : 'var(--color-text-muted)',
            backgroundColor: notificationsHover ? 'var(--color-surface-raised)' : 'transparent',
          }}
          title="Notifications"
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-medium text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* More menu (Search, Export, Settings) */}
        <MoreMenu activeTab={activeTab} activeTabSessionDetail={activeTabSessionDetail} />
      </div>

      {/* Context menu */}
      {contextMenu && contextMenuTabId && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tabId={contextMenuTabId}
          paneId={paneId}
          selectedCount={effectiveSelectedCount}
          onClose={() => setContextMenu(null)}
          onCloseTab={() => closeTab(contextMenuTabId)}
          onCloseOtherTabs={() => closeOtherTabs(contextMenuTabId)}
          onCloseAllTabs={() => closeAllTabs()}
          onCloseSelectedTabs={
            effectiveSelectedCount > 1 ? () => closeTabs([...selectedTabIds]) : undefined
          }
          onSplitRight={() => splitPane(paneId, contextMenuTabId, 'right')}
          onSplitLeft={() => splitPane(paneId, contextMenuTabId, 'left')}
          disableSplit={paneCount >= 4}
          isSessionTab={isContextMenuTabSession}
          isPinned={isContextMenuTabPinned}
          onTogglePin={
            isContextMenuTabSession && contextMenuTab?.sessionId
              ? () => togglePinSession(contextMenuTab.sessionId!)
              : undefined
          }
          isHidden={isContextMenuTabHidden}
          onToggleHide={
            isContextMenuTabSession && contextMenuTab?.sessionId
              ? () => toggleHideSession(contextMenuTab.sessionId!)
              : undefined
          }
        />
      )}
    </div>
  );
};
