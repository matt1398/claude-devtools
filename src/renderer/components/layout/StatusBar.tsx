/**
 * StatusBar - Persistent, editor-style status bar pinned to the bottom of a
 * session pane. Mirrors the owner's Claude Code statusline for the currently-
 * viewed session.
 *
 * Two rendering modes:
 *
 *  1. SNAPSHOT (active sessions): when `session.statusline` is present (written
 *     by a hook to `${CLAUDE_ROOT}/devtools-state/<sid>.statusline.json`), the
 *     bar is an EXACT mirror of the owner's live statusline:
 *
 *       <model>  <dir>  <branch>[ ↑N ↓N ]  ·  Context X%  ·  Weekly Y% → reset  ·  Session Z% → reset
 *
 *     Context/Weekly/Session are color-coded by REMAINING % (owner's
 *     `color_remaining`): >30 green, >10 yellow, else red.
 *
 *  2. FALLBACK (non-active/older sessions, no snapshot): the transcript-derived
 *     model label + context consumption (REMAINING %, 1M-aware) + global
 *     weekly/session usage via the `useUsage` hook.
 *
 * The live terminal-state dot (wezterm palette) is always shown, right-aligned.
 */

import React, { useMemo } from 'react';

import {
  COLOR_BORDER_SUBTLE,
  COLOR_SURFACE_RAISED,
  COLOR_TEXT_MUTED,
} from '@renderer/constants/cssVariables';
import { useSessionLiveState } from '@renderer/hooks/useSessionLiveState';
import { type UsageWindow, useUsage } from '@renderer/hooks/useUsage';
import { useStore } from '@renderer/store';
import { friendlyModelLabel, parseModelString } from '@shared/utils/modelParser';
import { useShallow } from 'zustand/react/shallow';

import type { ModelInfo } from '@shared/utils/modelParser';

/**
 * Statusline snapshot shape (mirrors the hook's JSON; see domain.ts `Session`).
 */
interface StatuslineSnapshot {
  model?: string;
  dir?: string;
  branch?: string;
  ahead?: string;
  behind?: string;
  context_pct?: number | null;
  weekly_pct?: number | null;
  weekly_reset?: string;
  session_pct?: number | null;
  session_reset?: string;
  ts?: number;
}

/** Remaining-% → hex color, matching the owner's statusline `color_remaining`. */
const COLOR_GREEN = '#22c55e';
const COLOR_YELLOW = '#eab308';
const COLOR_RED = '#ef4444';
function colorForRemaining(remaining: number): string {
  if (remaining > 30) return COLOR_GREEN;
  if (remaining > 10) return COLOR_YELLOW;
  return COLOR_RED;
}

/**
 * Nominal context-window size used by the fallback path to render consumption.
 * 1M-context models use a larger window (detected from the raw model id).
 */
const CONTEXT_WINDOW_TOKENS = 200_000;
const CONTEXT_WINDOW_TOKENS_1M = 1_000_000;

/**
 * Derive the session's model from its assistant messages (last one wins),
 * returning both the parsed info and the raw id (needed to detect the 1M
 * context marker, which `parseModelString` drops).
 */
function useSessionModel(messages: readonly { type: string; model?: string }[] | undefined): {
  info: ModelInfo | null;
  raw: string | null;
} {
  return useMemo(() => {
    if (!messages) return { info: null, raw: null };
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'assistant' && msg.model) {
        const info = parseModelString(msg.model);
        if (info) return { info, raw: msg.model };
      }
    }
    return { info: null, raw: null };
  }, [messages]);
}

/** Weekly reset → "Jul 23" (local). */
function formatWeeklyReset(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Session reset → "1:39am" (local, lowercase meridiem). */
function formatSessionReset(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const meridiem = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, '0')}${meridiem}`;
}

/** Match the owner's statusline ANSI colors: model + dir = blue (94), branch = cyan (96). */
const STATUSLINE_BLUE = '#3b8eea';
const STATUSLINE_CYAN = '#29b8db';

interface StatusBarProps {
  /** Tab id whose session detail should be shown. */
  tabId: string;
}

const Separator = (): React.JSX.Element => (
  <span aria-hidden className="shrink-0" style={{ color: COLOR_BORDER_SUBTLE }}>
    ·
  </span>
);

/**
 * A "<label> <util>% → <reset>" usage segment for the FALLBACK path (global
 * usage). Colored by REMAINING % (100 - utilization). Renders null when absent.
 */
const UsageSegment = ({
  label,
  window,
  formatReset,
}: Readonly<{
  label: string;
  window: UsageWindow | null | undefined;
  formatReset: (iso: string) => string;
}>): React.JSX.Element | null => {
  if (!window) return null;
  const reset = formatReset(window.resets_at);
  const remaining = 100 - window.utilization;
  return (
    <span className="shrink-0 tabular-nums" style={{ color: colorForRemaining(remaining) }}>
      {label} {Math.round(window.utilization)}%{reset && <span aria-hidden> → {reset}</span>}
    </span>
  );
};

/**
 * A snapshot usage segment: "<label> <util>% → <reset>" (reset is already a
 * display string). Colored by REMAINING %. Hidden when `pct` is null/undefined.
 */
const SnapshotUsageSegment = ({
  label,
  pct,
  reset,
  remaining,
}: Readonly<{
  label: string;
  pct: number | null | undefined;
  reset?: string;
  remaining: number;
}>): React.JSX.Element | null => {
  if (pct == null) return null;
  return (
    <>
      <Separator />
      <span className="shrink-0 tabular-nums" style={{ color: colorForRemaining(remaining) }}>
        {label} {Math.round(pct)}%{reset && <span aria-hidden> → {reset}</span>}
      </span>
    </>
  );
};

export const StatusBar = ({ tabId }: Readonly<StatusBarProps>): React.JSX.Element | null => {
  // Per-tab session detail, falling back to the global slice (mirrors SessionTabContent).
  const sessionDetail = useStore(
    useShallow((s) => s.tabSessionData[tabId]?.sessionDetail ?? s.sessionDetail)
  );

  const { info: model, raw: rawModel } = useSessionModel(sessionDetail?.messages);
  const usage = useUsage();

  // Live status: TRUE terminal state (wezterm hook), colored only when live.
  // Sourced from the shared hook rather than sessionDetail directly — the detail
  // refresh short-circuits on an unchanged JSONL fingerprint, so a terminal-state
  // write alone never updated it and this bar was permanently stuck on "Idle".
  const { visual: liveVisual } = useSessionLiveState(tabId);

  // No session loaded → render nothing (cleaner than an empty muted bar).
  if (!sessionDetail) return null;

  const { session } = sessionDetail;

  const snapshot = (session as { statusline?: StatuslineSnapshot }).statusline;

  // Live terminal status element (shared by both modes).
  const liveStatus = (
    <span className="flex shrink-0 items-center gap-1.5">
      {liveVisual ? (
        <>
          <span
            className={`inline-block size-2 rounded-full ${liveVisual.pulse ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: liveVisual.color }}
            aria-hidden
          />
          <span style={{ color: liveVisual.color }}>{liveVisual.label}</span>
        </>
      ) : (
        <span style={{ color: COLOR_TEXT_MUTED }}>Idle</span>
      )}
    </span>
  );

  const containerClass =
    'flex h-7 shrink-0 items-center gap-2 overflow-hidden px-3 font-mono text-sm';
  const containerStyle: React.CSSProperties = {
    backgroundColor: COLOR_SURFACE_RAISED,
    borderTop: `1px solid ${COLOR_BORDER_SUBTLE}`,
    color: COLOR_TEXT_MUTED,
  };

  // ===========================================================================
  // SNAPSHOT MODE — exact mirror of the owner's live statusline.
  // ===========================================================================
  if (snapshot) {
    const branch = snapshot.branch?.trim();
    const ahead = snapshot.ahead && snapshot.ahead !== '0' ? snapshot.ahead : '';
    const behind = snapshot.behind && snapshot.behind !== '0' ? snapshot.behind : '';

    const contextPct = snapshot.context_pct; // already REMAINING %
    const weeklyRemaining = snapshot.weekly_pct == null ? 0 : 100 - snapshot.weekly_pct;
    const sessionRemaining = snapshot.session_pct == null ? 0 : 100 - snapshot.session_pct;

    return (
      <div className={containerClass} style={containerStyle} title={`Session ${session.id}`}>
        {/* Model — statusline blue */}
        {snapshot.model && (
          <span className="shrink-0" style={{ color: STATUSLINE_BLUE }}>
            {snapshot.model}
          </span>
        )}

        {/* Directory — statusline blue (truncates first when the row is tight) */}
        {snapshot.dir && (
          <span
            className="min-w-0 truncate"
            style={{ color: STATUSLINE_BLUE }}
            title={snapshot.dir}
          >
            {snapshot.dir}
          </span>
        )}

        {/* Branch + ahead/behind — statusline cyan */}
        {branch && (
          <span className="shrink-0 tabular-nums" style={{ color: STATUSLINE_CYAN }}>
            {branch}
            {ahead && <span aria-label={`${ahead} ahead`}> ↑{ahead}</span>}
            {behind && <span aria-label={`${behind} behind`}> ↓{behind}</span>}
          </span>
        )}

        {/* Context (remaining %, color-coded) */}
        {contextPct != null && (
          <>
            <Separator />
            <span
              className="shrink-0 tabular-nums"
              style={{ color: colorForRemaining(contextPct) }}
            >
              Context {Math.round(contextPct)}%
            </span>
          </>
        )}

        {/* Weekly + Session usage limits */}
        <SnapshotUsageSegment
          label="Weekly"
          pct={snapshot.weekly_pct}
          reset={snapshot.weekly_reset}
          remaining={weeklyRemaining}
        />
        <SnapshotUsageSegment
          label="Session"
          pct={snapshot.session_pct}
          reset={snapshot.session_reset}
          remaining={sessionRemaining}
        />

        {/* Spacer pushes live status to the right edge */}
        <div className="ml-auto" />
        {liveStatus}
      </div>
    );
  }

  // ===========================================================================
  // FALLBACK MODE — transcript-derived model + context + global usage.
  // ===========================================================================
  const contextConsumption = session.contextConsumption ?? 0;
  const is1M = rawModel ? /1m/i.test(rawModel) : false;
  const contextWindow = is1M ? CONTEXT_WINDOW_TOKENS_1M : CONTEXT_WINDOW_TOKENS;
  const consumedPercent =
    contextConsumption > 0 ? Math.min((contextConsumption / contextWindow) * 100, 100) : 0;
  const remainingPercent = 100 - consumedPercent;

  const modelLabel = rawModel ? friendlyModelLabel(rawModel, model) : null;

  return (
    <div className={containerClass} style={containerStyle} title={`Session ${session.id}`}>
      {/* Model — statusline blue */}
      {modelLabel && (
        <span className="shrink-0" style={{ color: STATUSLINE_BLUE }}>
          {modelLabel}
        </span>
      )}

      {/* Context window remaining */}
      {contextConsumption > 0 && (
        <>
          {modelLabel && <Separator />}
          <span
            className="shrink-0 tabular-nums"
            style={{ color: colorForRemaining(remainingPercent) }}
            title={`Context remaining (compaction-aware) vs ${is1M ? '1M' : '200k'} window`}
          >
            Context {remainingPercent.toFixed(0)}%
          </span>
        </>
      )}

      {/* Weekly usage limit */}
      {usage?.weekly && (
        <>
          <Separator />
          <UsageSegment label="Weekly" window={usage.weekly} formatReset={formatWeeklyReset} />
        </>
      )}

      {/* Current-session usage limit */}
      {usage?.session && (
        <>
          <Separator />
          <UsageSegment label="Session" window={usage.session} formatReset={formatSessionReset} />
        </>
      )}

      {/* Spacer pushes live status to the right edge */}
      <div className="ml-auto" />
      {liveStatus}
    </div>
  );
};
