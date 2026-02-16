/**
 * SessionItem - Compact session row in the session list.
 * Shows title, message count, and time ago.
 * Supports right-click context menu for pane management.
 */

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useStore } from '@renderer/store';
import { formatTokensCompact } from '@shared/utils/tokenFormatting';
import { formatDistanceToNowStrict } from 'date-fns';
import { EyeOff, MessageSquare, Pin } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { OngoingIndicator } from '../common/OngoingIndicator';

import { SessionContextMenu } from './SessionContextMenu';

import type { PhaseTokenBreakdown, Session } from '@renderer/types/data';

interface SessionItemProps {
  session: Session;
  isActive?: boolean;
  isPinned?: boolean;
  isHidden?: boolean;
  multiSelectActive?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}

/**
 * Format time distance in short form (e.g., "4m", "2h", "1d")
 */
function formatShortTime(date: Date): string {
  const distance = formatDistanceToNowStrict(date, { addSuffix: false });
  return distance
    .replace(' seconds', 's')
    .replace(' second', 's')
    .replace(' minutes', 'm')
    .replace(' minute', 'm')
    .replace(' hours', 'h')
    .replace(' hour', 'h')
    .replace(' days', 'd')
    .replace(' day', 'd')
    .replace(' weeks', 'w')
    .replace(' week', 'w')
    .replace(' months', 'mo')
    .replace(' month', 'mo')
    .replace(' years', 'y')
    .replace(' year', 'y');
}

/**
 * Consumption badge with hover popover showing phase breakdown.
 */
const ConsumptionBadge = ({
  contextConsumption,
  phaseBreakdown,
}: Readonly<{
  contextConsumption: number;
  phaseBreakdown?: PhaseTokenBreakdown[];
}>): React.JSX.Element => {
  const [popoverPosition, setPopoverPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const isHigh = contextConsumption > 150_000;

  const showPopover = popoverPosition !== null;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- tooltip trigger via hover, not interactive
    <span
      ref={badgeRef}
      className="tabular-nums"
      style={{ color: isHigh ? 'rgb(251, 191, 36)' : undefined }}
      onMouseEnter={() => {
        const rect = badgeRef.current?.getBoundingClientRect();
        if (rect) {
          setPopoverPosition({
            top: rect.top - 6,
            left: rect.left + rect.width / 2,
          });
        }
      }}
      onMouseLeave={() => setPopoverPosition(null)}
    >
      {formatTokensCompact(contextConsumption)}
      {showPopover &&
        popoverPosition &&
        phaseBreakdown &&
        phaseBreakdown.length > 0 &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg px-3 py-2 text-[10px] shadow-xl"
            style={{
              top: popoverPosition.top,
              left: popoverPosition.left,
              backgroundColor: 'var(--color-surface-overlay)',
              border: '1px solid var(--color-border-emphasis)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <div className="mb-1 font-medium" style={{ color: 'var(--color-text)' }}>
              Total Context: {formatTokensCompact(contextConsumption)} tokens
            </div>
            {phaseBreakdown.length === 1 ? (
              <div>Context: {formatTokensCompact(phaseBreakdown[0].peakTokens)}</div>
            ) : (
              phaseBreakdown.map((phase) => (
                <div key={phase.phaseNumber} className="flex items-center gap-1">
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    Phase {phase.phaseNumber}:
                  </span>
                  <span className="tabular-nums">{formatTokensCompact(phase.contribution)}</span>
                  {phase.postCompaction != null && (
                    <span style={{ color: 'var(--color-text-muted)' }}>
                      (compacted to {formatTokensCompact(phase.postCompaction)})
                    </span>
                  )}
                </div>
              ))
            )}
          </div>,
          document.body
        )}
    </span>
  );
};

export const SessionItem = ({
  session,
  isActive,
  isPinned,
  isHidden,
  multiSelectActive,
  isSelected,
  onToggleSelect,
}: Readonly<SessionItemProps>): React.JSX.Element => {
  const {
    openTab,
    activeProjectId,
    selectSession,
    paneCount,
    splitPane,
    togglePinSession,
    toggleHideSession,
  } = useStore(
    useShallow((s) => ({
      openTab: s.openTab,
      activeProjectId: s.activeProjectId,
      selectSession: s.selectSession,
      paneCount: s.paneLayout.panes.length,
      splitPane: s.splitPane,
      togglePinSession: s.togglePinSession,
      toggleHideSession: s.toggleHideSession,
    }))
  );

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = (event: React.MouseEvent): void => {
    if (!activeProjectId) return;

    // In multi-select mode, clicks toggle selection
    if (multiSelectActive && onToggleSelect) {
      onToggleSelect();
      return;
    }

    // Cmd/Ctrl+click: open in new tab; plain click: replace current tab
    const forceNewTab = event.ctrlKey || event.metaKey;

    openTab(
      {
        type: 'session',
        sessionId: session.id,
        projectId: activeProjectId,
        label: session.firstMessage?.slice(0, 50) ?? 'Session',
      },
      forceNewTab ? { forceNewTab } : { replaceActiveTab: true }
    );

    selectSession(session.id);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const sessionLabel = session.firstMessage?.slice(0, 50) ?? 'Session';

  const handleOpenInCurrentPane = useCallback(() => {
    if (!activeProjectId) return;
    openTab(
      {
        type: 'session',
        sessionId: session.id,
        projectId: activeProjectId,
        label: sessionLabel,
      },
      { replaceActiveTab: true }
    );
    selectSession(session.id);
  }, [activeProjectId, openTab, selectSession, session.id, sessionLabel]);

  const handleOpenInNewTab = useCallback(() => {
    if (!activeProjectId) return;
    openTab(
      {
        type: 'session',
        sessionId: session.id,
        projectId: activeProjectId,
        label: sessionLabel,
      },
      { forceNewTab: true }
    );
    selectSession(session.id);
  }, [activeProjectId, openTab, selectSession, session.id, sessionLabel]);

  const handleSplitRightAndOpen = useCallback(() => {
    if (!activeProjectId) return;
    // First open the tab in the focused pane
    openTab({
      type: 'session',
      sessionId: session.id,
      projectId: activeProjectId,
      label: sessionLabel,
    });
    selectSession(session.id);
    // Then split it to the right
    const state = useStore.getState();
    const focusedPaneId = state.paneLayout.focusedPaneId;
    const activeTabId = state.activeTabId;
    if (activeTabId) {
      splitPane(focusedPaneId, activeTabId, 'right');
    }
  }, [activeProjectId, openTab, selectSession, session.id, sessionLabel, splitPane]);

  // Height must match SESSION_HEIGHT (48px) in DateGroupedSessions.tsx for virtual scroll
  return (
    <>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className={`h-[48px] w-full overflow-hidden border-b px-3 py-2 text-left transition-all duration-150 ${isActive ? '' : 'bg-transparent hover:opacity-80'} `}
        style={{
          borderColor: 'var(--color-border)',
          ...(isActive ? { backgroundColor: 'var(--color-surface-raised)' } : {}),
          ...(isHidden ? { opacity: 0.5 } : {}),
        }}
      >
        {/* First line: title + ongoing indicator + pin/hidden icons */}
        <div className="flex items-center gap-1.5">
          {multiSelectActive && (
            <input
              type="checkbox"
              checked={isSelected ?? false}
              onChange={() => onToggleSelect?.()}
              onClick={(e) => e.stopPropagation()}
              className="size-3.5 shrink-0 accent-blue-500"
            />
          )}
          {session.isOngoing && <OngoingIndicator />}
          {isPinned && <Pin className="size-2.5 shrink-0 text-blue-400" />}
          {isHidden && <EyeOff className="size-2.5 shrink-0 text-zinc-500" />}
          <span
            className="truncate text-[13px] font-medium leading-tight"
            style={{ color: isActive ? 'var(--color-text)' : 'var(--color-text-muted)' }}
          >
            {session.firstMessage ?? 'Untitled'}
          </span>
        </div>

        {/* Second line: message count + time + context consumption */}
        <div
          className="mt-0.5 flex items-center gap-2 text-[10px] leading-tight"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <span className="flex items-center gap-0.5">
            <MessageSquare className="size-2.5" />
            {session.messageCount}
          </span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span className="tabular-nums">{formatShortTime(new Date(session.createdAt))}</span>
          {session.contextConsumption != null && session.contextConsumption > 0 && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <ConsumptionBadge
                contextConsumption={session.contextConsumption}
                phaseBreakdown={session.phaseBreakdown}
              />
            </>
          )}
        </div>
      </button>

      {contextMenu &&
        activeProjectId &&
        createPortal(
          <SessionContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            sessionId={session.id}
            projectId={activeProjectId}
            sessionLabel={sessionLabel}
            paneCount={paneCount}
            isPinned={isPinned ?? false}
            isHidden={isHidden ?? false}
            onClose={() => setContextMenu(null)}
            onOpenInCurrentPane={handleOpenInCurrentPane}
            onOpenInNewTab={handleOpenInNewTab}
            onSplitRightAndOpen={handleSplitRightAndOpen}
            onTogglePin={() => void togglePinSession(session.id)}
            onToggleHide={() => void toggleHideSession(session.id)}
          />,
          document.body
        )}
    </>
  );
};
