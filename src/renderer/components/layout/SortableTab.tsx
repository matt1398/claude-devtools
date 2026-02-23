/**
 * SortableTab - A draggable tab item used within SortableContext.
 * Wraps useSortable from @dnd-kit for tab reordering and cross-pane movement.
 */

import { useCallback, useState } from 'react';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '@renderer/store';
import { Activity, Bell, FileText, LayoutDashboard, Pin, Search, Settings, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { Tab } from '@renderer/types/tabs';

interface SortableTabProps {
  tab: Tab;
  paneId: string;
  isActive: boolean;
  isSelected: boolean;
  onTabClick: (tabId: string, e: React.MouseEvent) => void;
  onMouseDown: (tabId: string, e: React.MouseEvent) => void;
  onContextMenu: (tabId: string, e: React.MouseEvent) => void;
  onClose: (tabId: string) => void;
  setRef: (tabId: string, el: HTMLDivElement | null) => void;
}

const TAB_ICONS = {
  dashboard: LayoutDashboard,
  notifications: Bell,
  settings: Settings,
  session: FileText,
  report: Activity,
} as const;

export const SortableTab = ({
  tab,
  paneId,
  isActive,
  isSelected,
  onTabClick,
  onMouseDown,
  onContextMenu,
  onClose,
  setRef,
}: SortableTabProps): React.JSX.Element => {
  const [isHovered, setIsHovered] = useState(false);

  const isPinned = useStore(
    useShallow((s) =>
      tab.type === 'session' && tab.sessionId ? s.pinnedSessionIds.includes(tab.sessionId) : false
    )
  );

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    data: {
      type: 'tab',
      tabId: tab.id,
      paneId,
    },
  });

  const style = {
    WebkitAppRegion: 'no-drag',
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0.3 : 1,
    backgroundColor: isActive
      ? 'var(--color-surface-raised)'
      : isHovered
        ? 'var(--color-surface-overlay)'
        : 'transparent',
    color: isActive || isHovered ? 'var(--color-text)' : 'var(--color-text-muted)',
    outline: isSelected ? '1px solid var(--color-border-emphasis)' : 'none',
    outlineOffset: '-1px',
  };

  const Icon = TAB_ICONS[tab.type];

  const handleRef = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      setRef(tab.id, el);
    },
    [setNodeRef, setRef, tab.id]
  );

  return (
    <div
      ref={handleRef}
      // eslint-disable-next-line react/jsx-props-no-spreading -- @dnd-kit useSortable requires prop spreading
      {...attributes}
      // eslint-disable-next-line react/jsx-props-no-spreading -- @dnd-kit useSortable requires prop spreading
      {...listeners}
      role="tab"
      tabIndex={0}
      aria-selected={isActive}
      className="group flex min-w-0 max-w-[200px] shrink-0 cursor-grab items-center gap-2 rounded-md px-3 py-1.5"
      style={style}
      onClick={(e) => onTabClick(tab.id, e)}
      onMouseDown={(e) => onMouseDown(tab.id, e)}
      onContextMenu={(e) => onContextMenu(tab.id, e)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTabClick(tab.id, e as unknown as React.MouseEvent);
        }
      }}
    >
      <Icon className="size-4 shrink-0" />
      {tab.fromSearch && (
        <span title="Opened from search">
          <Search className="size-3 shrink-0 text-amber-400" />
        </span>
      )}
      {isPinned && (
        <span title="Pinned session">
          <Pin className="size-3 shrink-0 text-blue-400" />
        </span>
      )}
      <span className="truncate text-sm">{tab.label}</span>
      <button
        className="flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity group-hover:opacity-100"
        style={{ backgroundColor: 'transparent' }}
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Close tab"
      >
        <X className="size-3" />
      </button>
    </div>
  );
};

/**
 * DragOverlayTab - Semi-transparent ghost of a tab shown during drag.
 */
export const DragOverlayTab = ({ tab }: { tab: Tab }): React.JSX.Element => {
  const Icon = TAB_ICONS[tab.type];

  return (
    <div
      className="flex min-w-0 max-w-[200px] items-center gap-2 rounded-md border-2 px-3 py-1.5"
      style={{
        backgroundColor: 'var(--color-surface-raised)',
        borderColor: 'var(--color-accent, #6366f1)',
        color: 'var(--color-text)',
        opacity: 0.9,
        cursor: 'grabbing',
      }}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate text-sm">{tab.label}</span>
    </div>
  );
};
