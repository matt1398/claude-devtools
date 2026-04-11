/**
 * DateGroupedSessions - Sessions organized by date categories with virtual scrolling.
 * Uses @tanstack/react-virtual for efficient DOM rendering with infinite scroll.
 * Supports multi-select with bulk actions and hidden session filtering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useStore } from '@renderer/store';
import {
  getNonEmptyCategories,
  groupSessionsByDate,
  separatePinnedSessions,
} from '@renderer/utils/dateGrouping';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Activity,
  ArrowDownWideNarrow,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderTree,
  Loader2,
  MessageSquareOff,
  Pin,
  Settings,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SessionItem } from './SessionItem';

import type { Session } from '@renderer/types/data';
import type { DateCategory } from '@renderer/types/tabs';

// Sentinel key for the Ungrouped logical-project section
const UNGROUPED_KEY = '__ungrouped__';

// Virtual list item types
type VirtualItem =
  | { type: 'header'; category: DateCategory; id: string }
  | { type: 'pinned-header'; id: string }
  | {
      type: 'lp-header';
      /** logicalProjectId or UNGROUPED_KEY */
      key: string;
      name: string;
      color: string;
      count: number;
      collapsed: boolean;
      id: string;
    }
  | { type: 'session'; session: Session; isPinned: boolean; isHidden: boolean; id: string }
  | { type: 'loader'; id: string };

/**
 * Item height constants for virtual scroll positioning.
 * CRITICAL: These values MUST match the actual rendered heights of components.
 * If SessionItem height changes, update SESSION_HEIGHT here AND add h-[Xpx] to SessionItem.
 * Mismatch causes items to overlap!
 */
const HEADER_HEIGHT = 28;
const SESSION_HEIGHT = 48; // Must match h-[48px] in SessionItem.tsx
const LOADER_HEIGHT = 36;
const OVERSCAN = 5;

export const DateGroupedSessions = (): React.JSX.Element => {
  const {
    sessions,
    selectedSessionId,
    selectedProjectId,
    sessionsLoading,
    sessionsError,
    sessionsHasMore,
    sessionsLoadingMore,
    fetchSessionsMore,
    pinnedSessionIds,
    sessionSortMode,
    setSessionSortMode,
    filterActiveOnly,
    setFilterActiveOnly,
    hiddenSessionIds,
    showHiddenSessions,
    toggleShowHiddenSessions,
    sidebarSelectedSessionIds,
    sidebarMultiSelectActive,
    toggleSidebarSessionSelection,
    clearSidebarSelection,
    toggleSidebarMultiSelect,
    hideMultipleSessions,
    unhideMultipleSessions,
    pinMultipleSessions,
    logicalProjects,
    sessionProjectMap,
    cwdProjectMap,
    sidebarGroupBy,
    setSidebarGroupBy,
    openLogicalProjectManager,
  } = useStore(
    useShallow((s) => ({
      sessions: s.sessions,
      selectedSessionId: s.selectedSessionId,
      selectedProjectId: s.selectedProjectId,
      sessionsLoading: s.sessionsLoading,
      sessionsError: s.sessionsError,
      sessionsHasMore: s.sessionsHasMore,
      sessionsLoadingMore: s.sessionsLoadingMore,
      fetchSessionsMore: s.fetchSessionsMore,
      pinnedSessionIds: s.pinnedSessionIds,
      sessionSortMode: s.sessionSortMode,
      setSessionSortMode: s.setSessionSortMode,
      filterActiveOnly: s.filterActiveOnly,
      setFilterActiveOnly: s.setFilterActiveOnly,
      hiddenSessionIds: s.hiddenSessionIds,
      showHiddenSessions: s.showHiddenSessions,
      toggleShowHiddenSessions: s.toggleShowHiddenSessions,
      sidebarSelectedSessionIds: s.sidebarSelectedSessionIds,
      sidebarMultiSelectActive: s.sidebarMultiSelectActive,
      toggleSidebarSessionSelection: s.toggleSidebarSessionSelection,
      clearSidebarSelection: s.clearSidebarSelection,
      toggleSidebarMultiSelect: s.toggleSidebarMultiSelect,
      hideMultipleSessions: s.hideMultipleSessions,
      unhideMultipleSessions: s.unhideMultipleSessions,
      pinMultipleSessions: s.pinMultipleSessions,
      logicalProjects: s.logicalProjects,
      sessionProjectMap: s.sessionProjectMap,
      cwdProjectMap: s.cwdProjectMap,
      sidebarGroupBy: s.sidebarGroupBy,
      setSidebarGroupBy: s.setSidebarGroupBy,
      openLogicalProjectManager: s.openLogicalProjectManager,
    }))
  );

  // Local (non-persisted) collapsed state for logical-project sections.
  // Keyed by logicalProjectId or UNGROUPED_KEY.
  const [collapsedLpKeys, setCollapsedLpKeys] = useState<Set<string>>(new Set());
  const toggleLpCollapsed = useCallback((key: string) => {
    setCollapsedLpKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const parentRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const [showCountTooltip, setShowCountTooltip] = useState(false);

  const hiddenSet = useMemo(() => new Set(hiddenSessionIds), [hiddenSessionIds]);
  const hasHiddenSessions = hiddenSessionIds.length > 0;

  // Filter out hidden sessions (unless showHiddenSessions) and apply active-only filter
  const visibleSessions = useMemo(() => {
    let result = showHiddenSessions ? sessions : sessions.filter((s) => !hiddenSet.has(s.id));
    if (filterActiveOnly) {
      result = result.filter((s) => s.isOngoing === true);
    }
    return result;
  }, [sessions, hiddenSet, showHiddenSessions, filterActiveOnly]);

  // Separate pinned sessions from unpinned
  const { pinned: pinnedSessions, unpinned: unpinnedSessions } = useMemo(
    () => separatePinnedSessions(visibleSessions, pinnedSessionIds),
    [visibleSessions, pinnedSessionIds]
  );

  // Group only unpinned sessions by date
  const groupedSessions = useMemo(() => groupSessionsByDate(unpinnedSessions), [unpinnedSessions]);

  // Get non-empty categories in display order
  const nonEmptyCategories = useMemo(
    () => getNonEmptyCategories(groupedSessions),
    [groupedSessions]
  );

  // Sessions sorted by context consumption (for most-context sort mode)
  const contextSortedSessions = useMemo(() => {
    if (sessionSortMode !== 'most-context') return [];
    return [...visibleSessions].sort(
      (a, b) => (b.contextConsumption ?? 0) - (a.contextConsumption ?? 0)
    );
  }, [visibleSessions, sessionSortMode]);

  // Resolve which logical project a session belongs to (pure lookup — no store reads).
  const resolveLpId = useCallback(
    (session: Session): string | null => {
      const explicit = sessionProjectMap[session.id];
      if (explicit && logicalProjects[explicit]) return explicit;
      const inherited = cwdProjectMap[session.projectId];
      if (inherited && logicalProjects[inherited]) return inherited;
      return null;
    },
    [sessionProjectMap, cwdProjectMap, logicalProjects]
  );

  // Logical-project grouping of unpinned sessions (only computed in lp mode).
  const lpGrouping = useMemo(() => {
    if (sidebarGroupBy !== 'logical-project') {
      return null;
    }
    const byLp: Record<string, Session[]> = {};
    const ungrouped: Session[] = [];
    for (const session of unpinnedSessions) {
      const lpId = resolveLpId(session);
      if (lpId) {
        const existing = byLp[lpId] ?? [];
        existing.push(session);
        byLp[lpId] = existing;
      } else {
        ungrouped.push(session);
      }
    }
    // Sort within each group by the active sort mode
    const sortFn = (a: Session, b: Session): number =>
      sessionSortMode === 'most-context'
        ? (b.contextConsumption ?? 0) - (a.contextConsumption ?? 0)
        : b.createdAt - a.createdAt;
    for (const arr of Object.values(byLp)) arr.sort(sortFn);
    // Ungrouped always time-sorted per user spec
    ungrouped.sort((a, b) => b.createdAt - a.createdAt);

    // Ordered list of logical projects with sessions (skip empty ones)
    const orderedLps = Object.values(logicalProjects)
      .filter((lp) => (byLp[lp.id]?.length ?? 0) > 0)
      .sort((a, b) => a.order - b.order);

    return { byLp, ungrouped, orderedLps };
  }, [sidebarGroupBy, unpinnedSessions, sessionSortMode, resolveLpId, logicalProjects]);

  // Flatten sessions with headers into virtual list items
  const virtualItems = useMemo((): VirtualItem[] => {
    const items: VirtualItem[] = [];

    if (sidebarGroupBy === 'logical-project' && lpGrouping) {
      // Pinned section remains at top in logical-project mode
      if (pinnedSessions.length > 0) {
        items.push({ type: 'pinned-header', id: 'header-pinned' });
        for (const session of pinnedSessions) {
          items.push({
            type: 'session',
            session,
            isPinned: true,
            isHidden: hiddenSet.has(session.id),
            id: `session-${session.id}`,
          });
        }
      }

      for (const lp of lpGrouping.orderedLps) {
        const sessionsForLp = lpGrouping.byLp[lp.id] ?? [];
        const collapsed = collapsedLpKeys.has(lp.id);
        items.push({
          type: 'lp-header',
          key: lp.id,
          name: lp.name,
          color: lp.color,
          count: sessionsForLp.length,
          collapsed,
          id: `lp-${lp.id}`,
        });
        if (!collapsed) {
          for (const session of sessionsForLp) {
            items.push({
              type: 'session',
              session,
              isPinned: false,
              isHidden: hiddenSet.has(session.id),
              id: `session-${session.id}`,
            });
          }
        }
      }

      // Ungrouped section at the bottom
      if (lpGrouping.ungrouped.length > 0) {
        const collapsed = collapsedLpKeys.has(UNGROUPED_KEY);
        items.push({
          type: 'lp-header',
          key: UNGROUPED_KEY,
          name: 'Ungrouped',
          color: '#6b7280',
          count: lpGrouping.ungrouped.length,
          collapsed,
          id: 'lp-ungrouped',
        });
        if (!collapsed) {
          for (const session of lpGrouping.ungrouped) {
            items.push({
              type: 'session',
              session,
              isPinned: false,
              isHidden: hiddenSet.has(session.id),
              id: `session-${session.id}`,
            });
          }
        }
      }
    } else if (sessionSortMode === 'most-context') {
      // Flat list sorted by consumption - no date headers, no pinned section
      for (const session of contextSortedSessions) {
        items.push({
          type: 'session',
          session,
          isPinned: pinnedSessionIds.includes(session.id),
          isHidden: hiddenSet.has(session.id),
          id: `session-${session.id}`,
        });
      }
    } else {
      // Default: date-grouped view with pinned section
      if (pinnedSessions.length > 0) {
        items.push({
          type: 'pinned-header',
          id: 'header-pinned',
        });

        for (const session of pinnedSessions) {
          items.push({
            type: 'session',
            session,
            isPinned: true,
            isHidden: hiddenSet.has(session.id),
            id: `session-${session.id}`,
          });
        }
      }

      for (const category of nonEmptyCategories) {
        items.push({
          type: 'header',
          category,
          id: `header-${category}`,
        });

        for (const session of groupedSessions[category]) {
          items.push({
            type: 'session',
            session,
            isPinned: false,
            isHidden: hiddenSet.has(session.id),
            id: `session-${session.id}`,
          });
        }
      }
    }

    // Add loader item if there are more sessions to load
    if (sessionsHasMore) {
      items.push({
        type: 'loader',
        id: 'loader',
      });
    }

    return items;
  }, [
    sidebarGroupBy,
    lpGrouping,
    collapsedLpKeys,
    sessionSortMode,
    contextSortedSessions,
    pinnedSessionIds,
    hiddenSet,
    pinnedSessions,
    nonEmptyCategories,
    groupedSessions,
    sessionsHasMore,
  ]);

  // Estimate item size based on type
  const estimateSize = useCallback(
    (index: number) => {
      const item = virtualItems[index];
      if (!item) return SESSION_HEIGHT;

      switch (item.type) {
        case 'header':
        case 'pinned-header':
        case 'lp-header':
          return HEADER_HEIGHT;
        case 'loader':
          return LOADER_HEIGHT;
        case 'session':
        default:
          return SESSION_HEIGHT;
      }
    },
    [virtualItems]
  );

  // Set up virtualizer
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual API limitation, not fixable in user code
  const rowVirtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN,
  });

  // Get virtual items for dependency tracking
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualRowsLength = virtualRows.length;

  // Load more when scrolling near end
  useEffect(() => {
    if (virtualRowsLength === 0) return;

    const lastItem = virtualRows[virtualRowsLength - 1];
    if (!lastItem) return;

    // If we're within 3 items of the end and there's more to load, fetch more
    if (
      lastItem.index >= virtualItems.length - 3 &&
      sessionsHasMore &&
      !sessionsLoadingMore &&
      !sessionsLoading
    ) {
      void fetchSessionsMore();
    }
  }, [
    virtualRows,
    virtualRowsLength,
    virtualItems.length,
    sessionsHasMore,
    sessionsLoadingMore,
    sessionsLoading,
    fetchSessionsMore,
  ]);

  // Bulk action helpers
  const selectedSet = useMemo(
    () => new Set(sidebarSelectedSessionIds),
    [sidebarSelectedSessionIds]
  );
  const someSelectedAreHidden = useMemo(
    () => sidebarSelectedSessionIds.some((id) => hiddenSet.has(id)),
    [sidebarSelectedSessionIds, hiddenSet]
  );

  const handleBulkHide = useCallback(() => {
    void hideMultipleSessions(sidebarSelectedSessionIds);
    clearSidebarSelection();
  }, [hideMultipleSessions, sidebarSelectedSessionIds, clearSidebarSelection]);

  const handleBulkUnhide = useCallback(() => {
    const hiddenSelected = sidebarSelectedSessionIds.filter((id) => hiddenSet.has(id));
    void unhideMultipleSessions(hiddenSelected);
    clearSidebarSelection();
  }, [unhideMultipleSessions, sidebarSelectedSessionIds, hiddenSet, clearSidebarSelection]);

  const handleBulkPin = useCallback(() => {
    void pinMultipleSessions(sidebarSelectedSessionIds);
    clearSidebarSelection();
  }, [pinMultipleSessions, sidebarSelectedSessionIds, clearSidebarSelection]);

  if (!selectedProjectId) {
    return (
      <div className="p-4">
        <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <p>Select a project to view sessions</p>
        </div>
      </div>
    );
  }

  if (sessionsLoading && sessions.length === 0) {
    const widths = [
      { header: '30%', title: '75%', sub: '90%' },
      { header: '22%', title: '60%', sub: '80%' },
      { header: '26%', title: '85%', sub: '65%' },
    ];

    return (
      <div className="p-4">
        <div className="space-y-3">
          {widths.map((w, i) => (
            <div key={i} className="space-y-2">
              <div
                className="skeleton-shimmer h-3 rounded-sm"
                style={{ backgroundColor: 'var(--skeleton-base-dim)', width: w.header }}
              />
              <div
                className="skeleton-shimmer h-4 rounded-sm"
                style={{ backgroundColor: 'var(--skeleton-base)', width: w.title }}
              />
              <div
                className="skeleton-shimmer h-3 rounded-sm"
                style={{ backgroundColor: 'var(--skeleton-base-dim)', width: w.sub }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (sessionsError) {
    return (
      <div className="p-4">
        <div
          className="rounded-lg border p-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface-raised)',
            color: 'var(--color-text-muted)',
          }}
        >
          <p className="mb-1 font-semibold" style={{ color: 'var(--color-text)' }}>
            Error loading sessions
          </p>
          <p>{sessionsError}</p>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4">
        <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <MessageSquareOff className="mx-auto mb-2 size-8 opacity-50" />
          <p className="mb-2">No sessions found</p>
          <p className="text-xs opacity-70">This project has no sessions yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="mt-2 flex items-center gap-2 px-4 py-3">
        <Calendar className="size-4" style={{ color: 'var(--color-text-muted)' }} />
        <h2
          className="text-xs uppercase tracking-wider"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {sessionSortMode === 'most-context' ? 'By Context' : 'Sessions'}
        </h2>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- tooltip trigger via hover, not interactive */}
        <span
          ref={countRef}
          className="text-xs"
          style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}
          onMouseEnter={() => setShowCountTooltip(true)}
          onMouseLeave={() => setShowCountTooltip(false)}
        >
          ({sessions.length}
          {sessionsHasMore ? '+' : ''})
        </span>
        {showCountTooltip &&
          sessionsHasMore &&
          countRef.current &&
          createPortal(
            <div
              className="pointer-events-none fixed z-50 w-48 rounded-md px-2.5 py-1.5 text-[11px] leading-snug shadow-lg"
              style={{
                top: countRef.current.getBoundingClientRect().bottom + 6,
                left:
                  countRef.current.getBoundingClientRect().left +
                  countRef.current.getBoundingClientRect().width / 2 -
                  96,
                backgroundColor: 'var(--color-surface-overlay)',
                border: '1px solid var(--color-border-emphasis)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {sessions.length} loaded so far — scroll down to load more. Context sorting only ranks
              loaded sessions.
            </div>,
            document.body
          )}
        <div className="ml-auto flex items-center gap-0.5">
          {/* Multi-select toggle */}
          <button
            onClick={toggleSidebarMultiSelect}
            className="rounded p-1 transition-colors hover:bg-white/5"
            title={sidebarMultiSelectActive ? 'Exit selection mode' : 'Select sessions'}
            style={{
              color: sidebarMultiSelectActive ? '#818cf8' : 'var(--color-text-muted)',
            }}
          >
            <CheckSquare className="size-3.5" />
          </button>
          {/* Show hidden sessions toggle - only when hidden sessions exist */}
          {hasHiddenSessions && (
            <button
              onClick={toggleShowHiddenSessions}
              className="rounded p-1 transition-colors hover:bg-white/5"
              title={showHiddenSessions ? 'Hide hidden sessions' : 'Show hidden sessions'}
              style={{
                color: showHiddenSessions ? '#818cf8' : 'var(--color-text-muted)',
              }}
            >
              {showHiddenSessions ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </button>
          )}
          {/* Active-only filter toggle */}
          <button
            onClick={() => void setFilterActiveOnly(!filterActiveOnly)}
            className="rounded p-1 transition-colors hover:bg-white/5"
            title={filterActiveOnly ? 'Show all sessions' : 'Show only active (ongoing) sessions'}
            style={{
              color: filterActiveOnly ? '#22c55e' : 'var(--color-text-muted)',
            }}
          >
            <Activity className="size-3.5" />
          </button>
          {/* Group-by toggle: date <-> logical project */}
          <button
            onClick={() =>
              void setSidebarGroupBy(sidebarGroupBy === 'date' ? 'logical-project' : 'date')
            }
            className="rounded p-1 transition-colors hover:bg-white/5"
            title={
              sidebarGroupBy === 'date'
                ? 'Group by logical project'
                : 'Group by date'
            }
            style={{
              color: sidebarGroupBy === 'logical-project' ? '#818cf8' : 'var(--color-text-muted)',
            }}
          >
            <FolderTree className="size-3.5" />
          </button>
          {/* Manage logical projects */}
          <button
            onClick={openLogicalProjectManager}
            className="rounded p-1 transition-colors hover:bg-white/5"
            title="Manage logical projects"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Settings className="size-3.5" />
          </button>
          {/* Sort mode toggle */}
          <button
            onClick={() =>
              setSessionSortMode(sessionSortMode === 'recent' ? 'most-context' : 'recent')
            }
            className="rounded p-1 transition-colors hover:bg-white/5"
            title={sessionSortMode === 'recent' ? 'Sort by context consumption' : 'Sort by recent'}
            style={{
              color: sessionSortMode === 'most-context' ? '#818cf8' : 'var(--color-text-muted)',
            }}
          >
            <ArrowDownWideNarrow className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Bulk action bar - shown when sessions are selected */}
      {sidebarMultiSelectActive && sidebarSelectedSessionIds.length > 0 && (
        <div
          className="flex items-center gap-1.5 border-b px-3 py-1.5"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface-raised)',
          }}
        >
          <span
            className="text-[11px] font-medium"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {sidebarSelectedSessionIds.length} selected
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={handleBulkPin}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
              style={{ color: 'var(--color-text-secondary)' }}
              title="Pin selected sessions"
            >
              <Pin className="inline-block size-3" /> Pin
            </button>
            <button
              onClick={handleBulkHide}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
              style={{ color: 'var(--color-text-secondary)' }}
              title="Hide selected sessions"
            >
              <EyeOff className="inline-block size-3" /> Hide
            </button>
            {showHiddenSessions && someSelectedAreHidden && (
              <button
                onClick={handleBulkUnhide}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/5"
                style={{ color: 'var(--color-text-secondary)' }}
                title="Unhide selected sessions"
              >
                <Eye className="inline-block size-3" /> Unhide
              </button>
            )}
            <button
              onClick={clearSidebarSelection}
              className="rounded p-0.5 transition-colors hover:bg-white/5"
              style={{ color: 'var(--color-text-muted)' }}
              title="Cancel selection"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = virtualItems[virtualRow.index];
            if (!item) return null;

            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {item.type === 'pinned-header' ? (
                  <div
                    className="sticky top-0 flex h-full items-center gap-1.5 border-t px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
                    style={{
                      backgroundColor:
                        'var(--color-surface-sidebar)',
                      color: 'var(--color-text-muted)',
                      borderColor: 'var(--color-border-emphasis)',
                    }}
                  >
                    <Pin className="size-3" />
                    Pinned
                  </div>
                ) : item.type === 'lp-header' ? (
                  <button
                    type="button"
                    onClick={() => toggleLpCollapsed(item.key)}
                    className="sticky top-0 flex size-full items-center gap-1.5 border-t px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-white/5"
                    style={{
                      backgroundColor: 'var(--color-surface-sidebar)',
                      color: 'var(--color-text-muted)',
                      borderColor: 'var(--color-border-emphasis)',
                    }}
                    title={item.collapsed ? 'Expand section' : 'Collapse section'}
                  >
                    {item.collapsed ? (
                      <ChevronRight className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="truncate">{item.name}</span>
                    <span className="ml-auto opacity-60">({item.count})</span>
                  </button>
                ) : item.type === 'header' ? (
                  <div
                    className="sticky top-0 flex h-full items-center border-t px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider"
                    style={{
                      backgroundColor:
                        'var(--color-surface-sidebar)',
                      color: 'var(--color-text-muted)',
                      borderColor: 'var(--color-border-emphasis)',
                    }}
                  >
                    {item.category}
                  </div>
                ) : item.type === 'loader' ? (
                  <div
                    className="flex h-full items-center justify-center"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {sessionsLoadingMore ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        <span className="text-xs">Loading more sessions...</span>
                      </>
                    ) : (
                      <span className="text-xs opacity-50">Scroll to load more</span>
                    )}
                  </div>
                ) : (
                  <SessionItem
                    session={item.session}
                    isActive={selectedSessionId === item.session.id}
                    isPinned={item.isPinned}
                    isHidden={item.isHidden}
                    multiSelectActive={sidebarMultiSelectActive}
                    isSelected={selectedSet.has(item.session.id)}
                    onToggleSelect={() => toggleSidebarSessionSelection(item.session.id)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
