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
import { isSessionRowActive } from '@renderer/utils/sessionRowActive';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDownWideNarrow,
  Calendar,
  CheckSquare,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  MessageSquareOff,
  Pin,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SessionItem } from './SessionItem';

import type { Session } from '@renderer/types/data';
import type { DateCategory } from '@renderer/types/tabs';

// Virtual list item types
type VirtualItem =
  | { type: 'header'; category: DateCategory; id: string }
  | { type: 'pinned-header'; id: string }
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
    combinedSessions,
    selectedSessionId,
    selectedProjectId,
    activeProjectId,
    activeContextId,
    availableContexts,
    sessionsLoading,
    combinedSessionsLoading,
    sessionsError,
    sessionsHasMore,
    combinedSessionsHasMore,
    sessionsLoadingMore,
    combinedSessionsLoadingMore,
    fetchSessionsMore,
    fetchCombinedSessionsMore,
    pinnedSessionIds,
    sessionSortMode,
    setSessionSortMode,
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
    combinedModeEnabled,
    combinedModeToggling,
    toggleCombinedMode,
  } = useStore(
    useShallow((s) => ({
      sessions: s.sessions,
      combinedSessions: s.combinedSessions,
      selectedSessionId: s.selectedSessionId,
      selectedProjectId: s.selectedProjectId,
      activeProjectId: s.activeProjectId,
      activeContextId: s.activeContextId,
      availableContexts: s.availableContexts,
      sessionsLoading: s.sessionsLoading,
      combinedSessionsLoading: s.combinedSessionsLoading,
      sessionsError: s.sessionsError,
      sessionsHasMore: s.sessionsHasMore,
      combinedSessionsHasMore: s.combinedSessionsHasMore,
      sessionsLoadingMore: s.sessionsLoadingMore,
      combinedSessionsLoadingMore: s.combinedSessionsLoadingMore,
      fetchSessionsMore: s.fetchSessionsMore,
      fetchCombinedSessionsMore: s.fetchCombinedSessionsMore,
      pinnedSessionIds: s.pinnedSessionIds,
      sessionSortMode: s.sessionSortMode,
      setSessionSortMode: s.setSessionSortMode,
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
      combinedModeEnabled: s.combinedModeEnabled,
      combinedModeToggling: s.combinedModeToggling,
      toggleCombinedMode: s.toggleCombinedMode,
    }))
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const [showCountTooltip, setShowCountTooltip] = useState(false);

  const hiddenSet = useMemo(
    () => (combinedModeEnabled ? new Set<string>() : new Set(hiddenSessionIds)),
    [combinedModeEnabled, hiddenSessionIds]
  );
  const hasHiddenSessions = hiddenSessionIds.length > 0;
  const sessionsSource = combinedModeEnabled ? combinedSessions : sessions;
  const sessionsLoadingState = combinedModeEnabled ? combinedSessionsLoading : sessionsLoading;
  const sessionsHasMoreState = combinedModeEnabled ? combinedSessionsHasMore : sessionsHasMore;
  const sessionsLoadingMoreState = combinedModeEnabled
    ? combinedSessionsLoadingMore
    : sessionsLoadingMore;
  const effectiveSortMode = combinedModeEnabled ? 'recent' : sessionSortMode;

  // Filter out hidden sessions unless showHiddenSessions is on
  const visibleSessions = useMemo(() => {
    if (combinedModeEnabled) return sessionsSource;
    if (showHiddenSessions) return sessionsSource;
    return sessionsSource.filter((s) => !hiddenSet.has(s.id));
  }, [combinedModeEnabled, showHiddenSessions, sessionsSource, hiddenSet]);

  // Separate pinned sessions from unpinned
  const { pinned: pinnedSessions, unpinned: unpinnedSessions } = useMemo(
    () =>
      combinedModeEnabled
        ? { pinned: [] as Session[], unpinned: visibleSessions }
        : separatePinnedSessions(visibleSessions, pinnedSessionIds),
    [combinedModeEnabled, visibleSessions, pinnedSessionIds]
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
    if (effectiveSortMode !== 'most-context') return [];
    return [...visibleSessions].sort(
      (a, b) => (b.contextConsumption ?? 0) - (a.contextConsumption ?? 0)
    );
  }, [visibleSessions, effectiveSortMode]);

  // Flatten sessions with date headers into virtual list items
  const virtualItems = useMemo((): VirtualItem[] => {
    const items: VirtualItem[] = [];

    if (effectiveSortMode === 'most-context') {
      // Flat list sorted by consumption - no date headers, no pinned section
      for (const session of contextSortedSessions) {
        items.push({
          type: 'session',
          session,
          isPinned: pinnedSessionIds.includes(session.id),
          isHidden: hiddenSet.has(session.id),
          id: session.contextId
            ? `session-${session.contextId}-${session.projectId}-${session.id}`
            : `session-${session.id}`,
        });
      }
    } else {
      // Default: date-grouped view with pinned section
      if (!combinedModeEnabled && pinnedSessions.length > 0) {
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
            id: session.contextId
              ? `session-${session.contextId}-${session.projectId}-${session.id}`
              : `session-${session.id}`,
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
            id: session.contextId
              ? `session-${session.contextId}-${session.projectId}-${session.id}`
              : `session-${session.id}`,
          });
        }
      }
    }

    // Add loader item if there are more sessions to load
    if (sessionsHasMoreState) {
      items.push({
        type: 'loader',
        id: 'loader',
      });
    }

    return items;
  }, [
    effectiveSortMode,
    contextSortedSessions,
    combinedModeEnabled,
    pinnedSessionIds,
    hiddenSet,
    pinnedSessions,
    nonEmptyCategories,
    groupedSessions,
    sessionsHasMoreState,
  ]);

  // Estimate item size based on type
  const estimateSize = useCallback(
    (index: number) => {
      const item = virtualItems[index];
      if (!item) return SESSION_HEIGHT;

      switch (item.type) {
        case 'header':
        case 'pinned-header':
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
      sessionsHasMoreState &&
      !sessionsLoadingMoreState &&
      !sessionsLoadingState
    ) {
      if (combinedModeEnabled) {
        void fetchCombinedSessionsMore();
      } else {
        void fetchSessionsMore();
      }
    }
  }, [
    virtualRows,
    virtualRowsLength,
    virtualItems.length,
    sessionsHasMoreState,
    sessionsLoadingMoreState,
    sessionsLoadingState,
    combinedModeEnabled,
    fetchCombinedSessionsMore,
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

  if (!combinedModeEnabled && !selectedProjectId) {
    return (
      <div className="p-4">
        <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <p>Select a project to view sessions</p>
        </div>
      </div>
    );
  }

  if (sessionsLoadingState && sessionsSource.length === 0) {
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

  if (!combinedModeEnabled && sessionsError) {
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

  if (!combinedModeEnabled && sessionsSource.length === 0) {
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
          {combinedModeEnabled
            ? 'All Sessions'
            : sessionSortMode === 'most-context'
              ? 'By Context'
              : 'Sessions'}
        </h2>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- tooltip trigger via hover, not interactive */}
        <span
          ref={countRef}
          className="text-xs"
          style={{ color: 'var(--color-text-muted)', opacity: 0.6 }}
          onMouseEnter={() => setShowCountTooltip(true)}
          onMouseLeave={() => setShowCountTooltip(false)}
        >
          ({sessionsSource.length}
          {sessionsHasMoreState ? '+' : ''})
        </span>
        {showCountTooltip &&
          sessionsHasMoreState &&
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
              {sessionsSource.length} loaded so far — scroll down to load more. Context sorting only
              ranks loaded sessions.
            </div>,
            document.body
          )}
        <div className="ml-auto flex items-center gap-0.5">
          {(availableContexts.length >= 2 || combinedModeEnabled) && (
            <button
              onClick={() => void toggleCombinedMode()}
              disabled={combinedModeToggling}
              className="rounded p-1 transition-colors hover:bg-white/5"
              title={
                combinedModeEnabled
                  ? 'Show sessions from active root only'
                  : 'Show sessions from all roots'
              }
              style={{
                color: combinedModeEnabled ? '#818cf8' : 'var(--color-text-muted)',
                opacity: combinedModeToggling ? 0.6 : 1,
              }}
            >
              <Layers className="size-3.5" />
            </button>
          )}
          {!combinedModeEnabled && (
            <>
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
                  {showHiddenSessions ? (
                    <Eye className="size-3.5" />
                  ) : (
                    <EyeOff className="size-3.5" />
                  )}
                </button>
              )}
              {/* Sort mode toggle */}
              <button
                onClick={() =>
                  setSessionSortMode(sessionSortMode === 'recent' ? 'most-context' : 'recent')
                }
                className="rounded p-1 transition-colors hover:bg-white/5"
                title={
                  sessionSortMode === 'recent' ? 'Sort by context consumption' : 'Sort by recent'
                }
                style={{
                  color: sessionSortMode === 'most-context' ? '#818cf8' : 'var(--color-text-muted)',
                }}
              >
                <ArrowDownWideNarrow className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bulk action bar - shown when sessions are selected */}
      {!combinedModeEnabled && sidebarMultiSelectActive && sidebarSelectedSessionIds.length > 0 && (
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

      {combinedModeEnabled && sessionsSource.length === 0 && !sessionsHasMoreState ? (
        <div className="flex-1 p-4">
          <div className="py-8 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
            <MessageSquareOff className="mx-auto mb-2 size-8 opacity-50" />
            <p className="mb-2">No sessions found</p>
            <p className="text-xs opacity-70">No sessions are available across your roots yet</p>
          </div>
        </div>
      ) : (
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
                      className="sticky top-0 flex h-full items-center gap-1.5 border-t px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider backdrop-blur-sm"
                      style={{
                        backgroundColor:
                          'color-mix(in srgb, var(--color-surface-sidebar) 95%, transparent)',
                        color: 'var(--color-text-muted)',
                        borderColor: 'var(--color-border-emphasis)',
                      }}
                    >
                      <Pin className="size-3" />
                      Pinned
                    </div>
                  ) : item.type === 'header' ? (
                    <div
                      className="sticky top-0 flex h-full items-center border-t px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider backdrop-blur-sm"
                      style={{
                        backgroundColor:
                          'color-mix(in srgb, var(--color-surface-sidebar) 95%, transparent)',
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
                      {sessionsLoadingMoreState ? (
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
                      isActive={isSessionRowActive(item.session, {
                        selectedSessionId,
                        selectedProjectId,
                        activeProjectId,
                        activeContextId,
                        combinedModeEnabled,
                      })}
                      isPinned={item.isPinned}
                      isHidden={item.isHidden}
                      multiSelectActive={!combinedModeEnabled && sidebarMultiSelectActive}
                      isSelected={selectedSet.has(item.session.id)}
                      onToggleSelect={
                        combinedModeEnabled
                          ? undefined
                          : () => toggleSidebarSessionSelection(item.session.id)
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
