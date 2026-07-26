/**
 * Session status → visual mapping, aligned to the owner's wezterm tab palette
 * (`~/.wezterm.lua` `claude_colors`). Single source of truth for the sidebar
 * status dots, the app tab dots, and any other live-status surface.
 *
 * IMPORTANT — colors are shown ONLY for sessions that are "live in the
 * terminal". We can't truly know which sessions are open in wezterm, so the
 * reliable proxy is: actively working (ongoing), awaiting input (waiting), or
 * errored. Quiet terminal states (complete / interrupted) get NO dot. Callers
 * must use `getLiveStatusVisual()` and render nothing when it returns null.
 */

/** Mirrors the main-process SessionStatus union (src/main/types/domain.ts). */
export type SessionStatus = 'ongoing' | 'error' | 'waiting' | 'interrupted' | 'complete';

export interface StatusVisual {
  /** Dot color — hex straight from the wezterm `claude_colors` table. */
  color: string;
  /** Human label for tooltip / aria-label. */
  label: string;
  /** Whether this status counts as "live in the terminal" (gets a dot). */
  live: boolean;
  /** Whether the dot should pulse (only active work pulses). */
  pulse: boolean;
}

/** wezterm claude_colors: working=amber, attention=purple, error=red, done=green, default=gray. */
export const SESSION_STATUS_VISUALS: Record<SessionStatus, StatusVisual> = {
  ongoing: { color: '#f59e0b', label: 'Working', live: true, pulse: true }, // wezterm "working"
  waiting: { color: '#a855f7', label: 'Waiting for input', live: true, pulse: false }, // wezterm "attention"
  error: { color: '#ef4444', label: 'Error', live: true, pulse: false }, // wezterm "error"
  interrupted: { color: '#1f2937', label: 'Interrupted', live: false, pulse: false }, // wezterm "default"
  complete: { color: '#22c55e', label: 'Done', live: false, pulse: false }, // wezterm "done"
};

/**
 * Resolve the effective status from the (possibly undefined) `session.status`
 * plus the legacy `isOngoing` flag, so older cached sessions never crash.
 */
export function resolveSessionStatus(
  status: SessionStatus | string | undefined,
  isOngoing?: boolean
): SessionStatus {
  if (status && status in SESSION_STATUS_VISUALS) {
    return status as SessionStatus;
  }
  return isOngoing ? 'ongoing' : 'complete';
}

/**
 * Returns the visual to render for a session's status dot, or `null` when the
 * session is not live in the terminal (caller renders nothing).
 */
export function getLiveStatusVisual(
  status: SessionStatus | string | undefined,
  isOngoing?: boolean
): StatusVisual | null {
  const visual = SESSION_STATUS_VISUALS[resolveSessionStatus(status, isOngoing)];
  return visual.live ? visual : null;
}

// ===========================================================================
// TERMINAL STATE (from the set-wezterm-state.sh hook, via ~/.claude/devtools-
// state/<session_id>.json). This is the AUTHORITATIVE per-session state — it
// reflects what's actually happening in the terminal, unlike the transcript-
// derived SessionStatus above. Dots should prefer this when available.
// ===========================================================================

/** States emitted by the hook — exactly the owner's wezterm `claude_state`. */
export type TerminalState = 'ready' | 'working' | 'attention' | 'done' | 'default';

/** Payload written by the hook and surfaced on the session as `terminalState`. */
export interface TerminalStateInfo {
  state: TerminalState | string;
  ts: number; // unix SECONDS (as written by the hook)
  cwd?: string;
}

export interface TerminalVisual {
  color: string;
  label: string;
  pulse: boolean;
}

/** wezterm `claude_colors`. `default` (SessionEnd) => no dot. */
export const TERMINAL_STATE_VISUALS: Record<TerminalState, TerminalVisual | null> = {
  ready: { color: '#3b82f6', label: 'Ready', pulse: false }, // wezterm blue
  working: { color: '#f59e0b', label: 'Working', pulse: true }, // wezterm amber
  attention: { color: '#a855f7', label: 'Waiting for input', pulse: false }, // wezterm purple
  done: { color: '#22c55e', label: 'Done', pulse: false }, // wezterm green
  default: null, // session ended — no dot
};

/** Files older than this are treated as stale (crashed session, no SessionEnd). */
export const TERMINAL_STATE_STALE_MS = 12 * 60 * 60 * 1000;

/**
 * Visual for a session's live terminal state, or null when there's no live
 * state (missing, ended/`default`, unknown, or stale) — caller renders nothing.
 * Pass `nowMs` (Date.now()) for testability.
 */
export function getTerminalVisual(
  info: TerminalStateInfo | null | undefined,
  nowMs: number = Date.now()
): TerminalVisual | null {
  if (!info || typeof info.ts !== 'number') return null;
  if (nowMs - info.ts * 1000 > TERMINAL_STATE_STALE_MS) return null;
  return TERMINAL_STATE_VISUALS[info.state as TerminalState] ?? null;
}
