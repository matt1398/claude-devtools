/**
 * useSessionLiveState - single source of truth for "is this session live right now?"
 *
 * Two independent signals feed this, and each covers the other's blind spot:
 *
 *  1. `terminalState` (PRIMARY) — written by the wezterm hook to
 *     `${CLAUDE_ROOT}/devtools-state/<sessionId>.json` and pushed to the renderer
 *     over `terminal-state-change`. It flips to `working` the moment a prompt is
 *     submitted, which is the only way to know Claude is busy *before* anything
 *     has been written to the JSONL.
 *
 *  2. `isOngoing` (FALLBACK) — derived from the transcript. True only when there's
 *     thinking/tool activity after the last ending event, so it goes false right
 *     after a prompt is submitted and again the instant the final text block lands.
 *     It's what keeps the indicator working when the hook isn't installed.
 *
 * Resolution is per tab ONCE THE TAB'S DETAIL HAS LOADED; before that it falls
 * back to global state. The previous inline selector keyed off the global
 * `selectedSessionId` unconditionally, so in split panes every pane reported the
 * focused session's state rather than its own.
 */

import { getTerminalVisual, type TerminalStateInfo } from '@renderer/constants/sessionStatus';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import type { TerminalVisual } from '@renderer/constants/sessionStatus';

export interface SessionLiveState {
  /** The session this tab is actually showing (null when the tab has no session). */
  sessionId: string | null;
  /** True when the terminal reports `working`, or the transcript looks mid-turn. */
  isLive: boolean;
  /**
   * Resolved wezterm visual (color/label/pulse), or null when there's no usable
   * terminal state — missing, stale, or the session ended. Note this is a wider
   * notion than `isLive`: `ready`/`attention`/`done` all yield a visual.
   */
  visual: TerminalVisual | null;
  /** Raw hook payload, for callers that need `state`/`ts` directly. */
  terminalState: TerminalStateInfo | null;
}

/**
 * Live state for the session shown in `tabId`, falling back to the globally
 * selected session when no tab is given (single-pane / non-tabbed callers).
 */
export function useSessionLiveState(tabId?: string | null): SessionLiveState {
  return useStore(
    useShallow((s): SessionLiveState => {
      const tabData = tabId ? s.tabSessionData[tabId] : null;
      const detail = tabData?.sessionDetail ?? s.sessionDetail;
      const sessionId = detail?.session?.id ?? s.selectedSessionId ?? null;

      if (!sessionId) {
        return { sessionId: null, isLive: false, visual: null, terminalState: null };
      }

      // Prefer the tab's own detail; fall back to the sidebar row, which is the
      // only source when a session is listed but not open in this tab.
      const sidebarSession = s.sessions.find((sess) => sess.id === sessionId);
      const terminalState =
        (detail?.session?.id === sessionId
          ? (detail.session as { terminalState?: TerminalStateInfo }).terminalState
          : undefined) ??
        (sidebarSession as { terminalState?: TerminalStateInfo } | undefined)?.terminalState ??
        null;

      const visual = getTerminalVisual(terminalState);
      const isOngoing =
        (detail?.session?.id === sessionId ? detail.session.isOngoing : undefined) ??
        sidebarSession?.isOngoing ??
        false;

      return {
        sessionId,
        // Derived from `visual`, NOT from the raw payload, so both go through
        // getTerminalVisual's staleness cut-off. Reading `terminalState.state`
        // directly meant a session killed mid-turn — whose file is left saying
        // `working` because the hook only writes `default` on SessionEnd — stayed
        // "live" forever: a permanent "Thinking…" banner next to no status dot,
        // since the dot already honoured the cut-off. `pulse` is true only for
        // `working`; ready/attention/done are resting states.
        isLive: visual?.pulse === true || isOngoing,
        visual,
        terminalState,
      };
    })
  );
}
