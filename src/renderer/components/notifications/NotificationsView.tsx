/**
 * NotificationsView - Linear Inbox-style notifications page.
 * Single list showing all notifications with unread indicator.
 * Includes a filter chip bar to filter by trigger name.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useStore } from '@renderer/store';
import { getTriggerColorDef } from '@shared/constants/triggerColors';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CheckCheck, Inbox, Loader2, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { NotificationRow } from './NotificationRow';

import type { DetectedError } from '@renderer/types/data';

// Virtual list constants
const ROW_HEIGHT = 56;
const OVERSCAN = 5;

/** Label used for notifications without a triggerName */
const OTHER_LABEL = 'Other';

interface FilterChip {
  label: string;
  count: number;
  colorHex: string;
}

export const NotificationsView = (): React.JSX.Element => {
  const {
    notifications,
    unreadCount,
    fetchNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    deleteNotification,
    clearNotifications,
    navigateToError,
  } = useStore(
    useShallow((s) => ({
      notifications: s.notifications,
      unreadCount: s.unreadCount,
      fetchNotifications: s.fetchNotifications,
      markNotificationRead: s.markNotificationRead,
      markAllNotificationsRead: s.markAllNotificationsRead,
      deleteNotification: s.deleteNotification,
      clearNotifications: s.clearNotifications,
      navigateToError: s.navigateToError,
    }))
  );

  const parentRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Fetch notifications on mount
  useEffect(() => {
    const loadNotifications = async (): Promise<void> => {
      setIsLoading(true);
      try {
        await fetchNotifications();
      } finally {
        setIsLoading(false);
      }
    };
    void loadNotifications();
  }, [fetchNotifications]);

  // Sort notifications by timestamp (most recent first)
  const sortedNotifications = useMemo(() => {
    return [...notifications].sort((a, b) => b.timestamp - a.timestamp);
  }, [notifications]);

  // Derive filter chips from notifications
  const filterChips = useMemo((): FilterChip[] => {
    const counts = new Map<string, { count: number; colorHex: string }>();
    for (const n of sortedNotifications) {
      const label = n.triggerName ?? OTHER_LABEL;
      const existing = counts.get(label);
      if (existing) {
        existing.count++;
      } else {
        counts.set(label, {
          count: 1,
          colorHex: getTriggerColorDef(n.triggerColor).hex,
        });
      }
    }
    // Sort by frequency descending
    return Array.from(counts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([label, { count, colorHex }]) => ({ label, count, colorHex }));
  }, [sortedNotifications]);

  // Reset filter when all notifications are cleared
  useEffect(() => {
    if (notifications.length === 0) {
      setActiveFilter(null);
    }
  }, [notifications.length]);

  // Apply filter
  const filteredNotifications = useMemo(() => {
    if (activeFilter === null) return sortedNotifications;
    return sortedNotifications.filter((n) => {
      const label = n.triggerName ?? OTHER_LABEL;
      return label === activeFilter;
    });
  }, [sortedNotifications, activeFilter]);

  // Estimate item size
  const estimateSize = useCallback(() => ROW_HEIGHT, []);

  // Set up virtualizer
  const rowVirtualizer = useVirtualizer({
    count: filteredNotifications.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: OVERSCAN,
  });

  // Scroll to top when filter changes
  useEffect(() => {
    rowVirtualizer.scrollToIndex(0);
  }, [activeFilter, rowVirtualizer]);

  // Derive filtered unread count for scoped button visibility
  const filteredUnreadCount = useMemo(() => {
    if (activeFilter === null) return unreadCount;
    return filteredNotifications.filter((n) => !n.isRead).length;
  }, [activeFilter, filteredNotifications, unreadCount]);

  // Handle mark all read (scoped to active filter)
  const handleMarkAllRead = async (): Promise<void> => {
    await markAllNotificationsRead(activeFilter ?? undefined);
  };

  // Handle clear all with confirmation (scoped to active filter)
  const handleClearAll = async (): Promise<void> => {
    if (showClearConfirm) {
      await clearNotifications(activeFilter ?? undefined);
      setShowClearConfirm(false);
    } else {
      setShowClearConfirm(true);
      // Auto-hide confirmation after 3 seconds
      setTimeout(() => setShowClearConfirm(false), 3000);
    }
  };

  // Handle archive (mark as read)
  const handleArchive = async (id: string): Promise<void> => {
    await markNotificationRead(id);
  };

  // Handle delete
  const handleDelete = async (id: string): Promise<void> => {
    await deleteNotification(id);
  };

  // Handle row click - navigate to error
  const handleRowClick = (error: DetectedError): void => {
    // Mark as read when navigating
    if (!error.isRead) {
      void markNotificationRead(error.id);
    }
    navigateToError(error);
  };

  // Handle filter chip click
  const handleFilterClick = (label: string): void => {
    setActiveFilter((prev) => (prev === label ? null : label));
  };

  // Loading state
  if (isLoading) {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center justify-center py-16">
          <Loader2
            className="mr-2 size-5 animate-spin"
            style={{ color: 'var(--color-text-muted)' }}
          />
          <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Loading notifications...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Header */}
      <div className="shrink-0 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <div className="flex items-center justify-between px-4 py-3">
          {/* Title */}
          <div className="flex items-center gap-2">
            <Inbox className="size-4" style={{ color: 'var(--color-text-secondary)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Notifications
            </span>
            {notifications.length > 0 && (
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {activeFilter !== null
                  ? filteredUnreadCount > 0
                    ? `${filteredUnreadCount} unread in filter`
                    : `${filteredNotifications.length} in filter`
                  : unreadCount > 0
                    ? `${unreadCount} unread`
                    : `${notifications.length} total`}
              </span>
            )}
          </div>

          {/* Action Buttons */}
          {notifications.length > 0 && (
            <div className="flex items-center gap-1">
              {/* Mark all/filtered read */}
              {filteredUnreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:opacity-80"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={activeFilter !== null ? 'Mark filtered as read' : 'Mark all as read'}
                >
                  <CheckCheck className="size-4" />
                  <span className="hidden sm:inline">
                    {activeFilter !== null ? 'Mark filtered read' : 'Mark all read'}
                  </span>
                </button>
              )}
              {/* Clear all/filtered */}
              <button
                onClick={handleClearAll}
                className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  showClearConfirm
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'hover:opacity-80'
                }`}
                style={showClearConfirm ? undefined : { color: 'var(--color-text-muted)' }}
                title={
                  activeFilter !== null ? 'Clear filtered notifications' : 'Clear all notifications'
                }
              >
                <Trash2 className="size-4" />
                <span className="hidden sm:inline">
                  {showClearConfirm
                    ? 'Click to confirm'
                    : activeFilter !== null
                      ? 'Clear filtered'
                      : 'Clear all'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter Chip Bar */}
      {filterChips.length > 1 && (
        <div
          className="scrollbar-none shrink-0 overflow-x-auto border-b"
          style={{ borderColor: 'var(--color-border-subtle)' }}
        >
          <div className="flex items-center gap-1.5 px-4 py-2">
            {/* All chip */}
            <button
              onClick={() => setActiveFilter(null)}
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors"
              style={{
                backgroundColor: activeFilter === null ? 'var(--color-surface-raised)' : undefined,
                color: activeFilter === null ? 'var(--color-text)' : 'var(--color-text-muted)',
                border:
                  activeFilter === null
                    ? '1px solid var(--color-border-emphasis)'
                    : '1px solid var(--color-border)',
              }}
            >
              All
              <span className="opacity-60">({sortedNotifications.length})</span>
            </button>
            {/* Trigger chips */}
            {filterChips.map((chip) => (
              <button
                key={chip.label}
                onClick={() => handleFilterClick(chip.label)}
                className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors"
                style={{
                  backgroundColor:
                    activeFilter === chip.label ? 'var(--color-surface-raised)' : undefined,
                  color:
                    activeFilter === chip.label ? 'var(--color-text)' : 'var(--color-text-muted)',
                  border:
                    activeFilter === chip.label
                      ? '1px solid var(--color-border-emphasis)'
                      : '1px solid var(--color-border)',
                }}
              >
                <span className="size-2 rounded-full" style={{ backgroundColor: chip.colorHex }} />
                {chip.label}
                <span className="opacity-60">({chip.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Notifications List */}
      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {filteredNotifications.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16"
            style={{ color: 'var(--color-text-muted)' }}
          >
            <Inbox className="mb-3 size-10 opacity-30" />
            <p className="mb-1 text-sm font-medium">
              {activeFilter !== null ? 'No matching notifications' : 'No notifications'}
            </p>
            <p className="text-xs opacity-70">
              {activeFilter !== null ? 'Try a different filter' : "You're all caught up!"}
            </p>
          </div>
        ) : (
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const notification = filteredNotifications[virtualRow.index];
              if (!notification) return null;

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
                  <NotificationRow
                    error={notification}
                    onRowClick={() => handleRowClick(notification)}
                    onArchive={() => handleArchive(notification.id)}
                    onDelete={() => handleDelete(notification.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
