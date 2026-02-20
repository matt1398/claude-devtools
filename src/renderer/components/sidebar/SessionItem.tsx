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

let latestSessionOpenIntent = 0;
const CONTEXT_SWITCH_WAIT_INTERVAL_MS = 50;
const CONTEXT_SWITCH_WAIT_TIMEOUT_MS = 15_000;

function beginSessionOpenIntent(): number {
  latestSessionOpenIntent += 1;
  return latestSessionOpenIntent;
}

function isLatestSessionOpenIntent(intentId: number): boolean {
  return intentId === latestSessionOpenIntent;
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
    selectSession,
    activeProjectId,
    switchContext,
    combinedModeEnabled,
    paneCount,
    splitPane,
    togglePinSession,
    toggleHideSession,
  } = useStore(
    useShallow((s) => ({
      openTab: s.openTab,
      selectSession: s.selectSession,
      activeProjectId: s.activeProjectId,
      switchContext: s.switchContext,
      combinedModeEnabled: s.combinedModeEnabled,
      paneCount: s.paneLayout.panes.length,
      splitPane: s.splitPane,
      togglePinSession: s.togglePinSession,
      toggleHideSession: s.toggleHideSession,
    }))
  );

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const resolveProjectId = useCallback(
    (): string | null => session.projectId || activeProjectId || null,
    [session.projectId, activeProjectId]
  );
  const sessionLabel = session.firstMessage?.slice(0, 50) ?? 'Session';

  const waitForContextSwitchToSettle = useCallback(async (intentId: number): Promise<boolean> => {
    const startMs = Date.now();
    while (Date.now() - startMs < CONTEXT_SWITCH_WAIT_TIMEOUT_MS) {
      if (!isLatestSessionOpenIntent(intentId)) {
        return false;
      }
      if (!useStore.getState().isContextSwitching) {
        return true;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, CONTEXT_SWITCH_WAIT_INTERVAL_MS);
      });
    }
    if (!isLatestSessionOpenIntent(intentId)) {
      return false;
    }
    return !useStore.getState().isContextSwitching;
  }, []);

  const ensureSessionContextReady = useCallback(async (intentId: number): Promise<boolean> => {
    if (!session.contextId) {
      return true;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!isLatestSessionOpenIntent(intentId)) {
        return false;
      }

      const state = useStore.getState();
      if (state.activeContextId === session.contextId) {
        return true;
      }

      if (state.isContextSwitching) {
        const settled = await waitForContextSwitchToSettle(intentId);
        if (!settled) {
          return false;
        }
        continue;
      }

      await switchContext(session.contextId);
      if (!isLatestSessionOpenIntent(intentId)) {
        return false;
      }
      if (useStore.getState().activeContextId === session.contextId) {
        return true;
      }
      const settled = await waitForContextSwitchToSettle(intentId);
      if (!settled) {
        return false;
      }
    }

    return useStore.getState().activeContextId === session.contextId;
  }, [session.contextId, switchContext, waitForContextSwitchToSettle]);

  const openInCurrentPaneWithContextSwitch = useCallback(async (intentId: number): Promise<boolean> => {
    if (!isLatestSessionOpenIntent(intentId)) return false;
    const effectiveProjectId = resolveProjectId();
    if (!effectiveProjectId) return false;
    if (!(await ensureSessionContextReady(intentId))) {
      return false;
    }
    if (!isLatestSessionOpenIntent(intentId)) return false;
    openTab(
      {
        type: 'session',
        sessionId: session.id,
        projectId: effectiveProjectId,
        contextId: session.contextId,
        label: sessionLabel,
      },
      { replaceActiveTab: true }
    );
    if (!isLatestSessionOpenIntent(intentId)) return false;
    selectSession(session.id, effectiveProjectId);
    return true;
  }, [
    resolveProjectId,
    session.id,
    session.contextId,
    ensureSessionContextReady,
    openTab,
    selectSession,
    sessionLabel,
  ]);

  const openInNewTabWithContextSwitch = useCallback(async (intentId: number): Promise<void> => {
    if (!isLatestSessionOpenIntent(intentId)) return;
    const effectiveProjectId = resolveProjectId();
    if (!effectiveProjectId) return;
    if (!(await ensureSessionContextReady(intentId))) {
      return;
    }
    if (!isLatestSessionOpenIntent(intentId)) return;
    openTab(
      {
        type: 'session',
        sessionId: session.id,
        projectId: effectiveProjectId,
        contextId: session.contextId,
        label: sessionLabel,
      },
      { forceNewTab: true }
    );
    if (!isLatestSessionOpenIntent(intentId)) return;
    selectSession(session.id, effectiveProjectId);
  }, [
    resolveProjectId,
    session.contextId,
    ensureSessionContextReady,
    openTab,
    selectSession,
    session.id,
    sessionLabel,
  ]);

  const handleClick = (event: React.MouseEvent): void => {
    // In multi-select mode, clicks toggle selection
    if (multiSelectActive && onToggleSelect) {
      onToggleSelect();
      return;
    }

    event.preventDefault();
    const intentId = beginSessionOpenIntent();
    if (event.ctrlKey || event.metaKey) {
      void openInNewTabWithContextSwitch(intentId);
      return;
    }
    void openInCurrentPaneWithContextSwitch(intentId);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handleOpenInCurrentPane = useCallback(() => {
    const intentId = beginSessionOpenIntent();
    void openInCurrentPaneWithContextSwitch(intentId);
  }, [openInCurrentPaneWithContextSwitch]);

  const handleOpenInNewTab = useCallback(() => {
    const intentId = beginSessionOpenIntent();
    void openInNewTabWithContextSwitch(intentId);
  }, [openInNewTabWithContextSwitch]);

  const handleSplitRightAndOpen = useCallback(() => {
    const intentId = beginSessionOpenIntent();
    void (async () => {
      if (!isLatestSessionOpenIntent(intentId)) return;
      // Use forceNewTab (not replaceActiveTab) so the original tab stays in the left pane
      const effectiveProjectId = resolveProjectId();
      if (!effectiveProjectId) return;
      if (!(await ensureSessionContextReady(intentId))) {
        return;
      }
      if (!isLatestSessionOpenIntent(intentId)) return;
      openTab(
        {
          type: 'session',
          sessionId: session.id,
          projectId: effectiveProjectId,
          contextId: session.contextId,
          label: sessionLabel,
        },
        { forceNewTab: true }
      );
      if (!isLatestSessionOpenIntent(intentId)) return;
      selectSession(session.id, effectiveProjectId);
      const state = useStore.getState();
      const focusedPaneId = state.paneLayout.focusedPaneId;
      const tabId = state.activeTabId;
      if (!isLatestSessionOpenIntent(intentId)) return;
      if (tabId) {
        splitPane(focusedPaneId, tabId, 'right');
      }
    })();
  }, [
    resolveProjectId,
    session.contextId,
    session.id,
    ensureSessionContextReady,
    openTab,
    selectSession,
    sessionLabel,
    splitPane,
  ]);

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
          {session.rootName && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span
                className="max-w-[60px] truncate text-[10px]"
                style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}
              >
                {session.rootName}
              </span>
            </>
          )}
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
        resolveProjectId() &&
        createPortal(
          <SessionContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            sessionId={session.id}
            projectId={resolveProjectId()!}
            sessionLabel={sessionLabel}
            paneCount={paneCount}
            isPinned={isPinned ?? false}
            isHidden={isHidden ?? false}
            onClose={() => setContextMenu(null)}
            onOpenInCurrentPane={handleOpenInCurrentPane}
            onOpenInNewTab={handleOpenInNewTab}
            onSplitRightAndOpen={handleSplitRightAndOpen}
            onTogglePin={combinedModeEnabled ? undefined : () => void togglePinSession(session.id)}
            onToggleHide={
              combinedModeEnabled ? undefined : () => void toggleHideSession(session.id)
            }
          />,
          document.body
        )}
    </>
  );
};
