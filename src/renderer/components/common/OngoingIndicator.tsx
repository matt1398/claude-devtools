/**
 * OngoingIndicator - Live-status visuals for sessions/turns in progress.
 *
 * Exports:
 * - LiveStatusDot: wezterm-palette status dot for the sidebar rows and app tabs.
 *   Renders NOTHING for non-live sessions (complete/interrupted).
 * - OngoingBanner: in-session banner showing the current activity
 *   ("Thinking…" / "Running <Tool>…" / "Working…") + output token total.
 *
 * There is intentionally NO elapsed-seconds ticker here — the owner does not
 * want a countdown/timer next to status indicators, so no setInterval / no
 * per-second re-render lives in this module.
 */

import React from 'react';

import { type TerminalVisual } from '@renderer/constants/sessionStatus';

interface LiveStatusDotProps {
  /**
   * Resolved terminal visual (from `getTerminalVisual(session.terminalState)`),
   * or null/undefined when the session is not live in the terminal. The dot
   * renders nothing in that case, so callers can pass the result directly.
   */
  visual: TerminalVisual | null | undefined;
  /** Dot size variant. */
  size?: 'sm' | 'md';
}

/**
 * LiveStatusDot - a compact wezterm-palette dot for a session's TRUE terminal
 * state (from the wezterm hook), not the transcript-derived status.
 *
 * - working   → amber, pulsing
 * - attention → purple, static
 * - ready     → blue, static
 * - done      → green, static
 * - ended / stale / missing (null visual) → renders nothing
 *
 * The color/label/pulse decision lives entirely in `getTerminalVisual` (the
 * shared wezterm palette); this component only renders the resolved visual.
 */
export const LiveStatusDot = ({
  visual,
  size = 'sm',
}: Readonly<LiveStatusDotProps>): React.JSX.Element | null => {
  if (!visual) return null;

  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';

  if (visual.pulse) {
    return (
      <span
        className={`relative flex shrink-0 ${dotSize}`}
        title={visual.label}
        aria-label={visual.label}
      >
        <span
          className="absolute inline-flex size-full animate-ping rounded-full opacity-75"
          style={{ backgroundColor: visual.color }}
        />
        <span
          className={`relative inline-flex rounded-full ${dotSize}`}
          style={{ backgroundColor: visual.color }}
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 rounded-full ${dotSize}`}
      style={{ backgroundColor: visual.color }}
      title={visual.label}
      aria-label={visual.label}
    />
  );
};

/** Kind of the in-progress turn's last activity, for the banner label. */
export type OngoingActivityKind = 'thinking' | 'tool';

interface OngoingBannerProps {
  /** Last activity kind of the in-progress turn (thinking vs a tool_use). */
  activityKind?: OngoingActivityKind;
  /** Tool name when `activityKind === 'tool'`. */
  toolName?: string;
  /** In-progress turn's output tokens, shown as "↓ <n> tok" when > 0. */
  outputTokens?: number;
}

/**
 * Resolve the banner's activity label:
 * - thinking → "Thinking…"
 * - tool     → "Running <ToolName>…"
 * - anything indeterminate → "Working…"
 */
function activityLabel(kind?: OngoingActivityKind, toolName?: string): string {
  if (kind === 'thinking') return 'Thinking…';
  if (kind === 'tool') {
    const name = toolName?.trim();
    return name ? `Running ${name}…` : 'Running…';
  }
  return 'Working…';
}

/**
 * OngoingBanner - full-width banner for LastOutputDisplay when the last AI
 * group of an ongoing session is still in progress. Shows a spinner glyph,
 * the current activity label, and the output token total. No elapsed timer.
 */
export const OngoingBanner = ({
  activityKind,
  toolName,
  outputTokens,
}: Readonly<OngoingBannerProps>): React.JSX.Element => {
  const label = activityLabel(activityKind, toolName);
  const showTokens = outputTokens != null && outputTokens > 0;

  return (
    <div
      className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3"
      style={{
        backgroundColor: 'var(--info-bg, rgba(59, 130, 246, 0.1))',
        border: '1px solid var(--info-border, rgba(59, 130, 246, 0.3))',
      }}
    >
      {/* Rotating asterisk spinner (theme-aware via inherited color). */}
      <span
        className="inline-block animate-spin text-sm leading-none"
        style={{ color: 'var(--info-text, #3b82f6)' }}
        aria-hidden="true"
      >
        ✽
      </span>
      <span className="text-sm tabular-nums" style={{ color: 'var(--info-text, #3b82f6)' }}>
        {label}
        {showTokens && ` (↓ ${outputTokens.toLocaleString()} tok)`}
      </span>
    </div>
  );
};
