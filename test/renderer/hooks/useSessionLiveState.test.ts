/**
 * useSessionLiveState unit tests.
 *
 * Covers the two things the hook exists to get right: resolving PER TAB (split
 * panes used to all report the focused session's state), and the precedence
 * between the terminal-state hook signal and the transcript-derived fallback.
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { useSessionLiveState } from '../../../src/renderer/hooks/useSessionLiveState';
import { useStore } from '../../../src/renderer/store';

import type { SessionLiveState } from '../../../src/renderer/hooks/useSessionLiveState';

/** Unix SECONDS, as the hook writes them. */
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function terminalState(state: string, tsSeconds: number = nowSeconds()) {
  return { state, ts: tsSeconds };
}

/** Render the hook for `tabId` and return what it resolved to. */
async function renderLiveState(tabId?: string): Promise<SessionLiveState> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let captured: SessionLiveState | null = null;

  function Harness(): React.JSX.Element {
    captured = useSessionLiveState(tabId);
    return React.createElement('div');
  }

  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Harness));
    await Promise.resolve();
  });
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });

  if (!captured) throw new Error('hook did not render');
  return captured;
}

function seedTab(tabId: string, sessionId: string, session: Record<string, unknown> = {}): void {
  useStore.setState({
    tabSessionData: {
      ...useStore.getState().tabSessionData,
      [tabId]: { sessionDetail: { session: { id: sessionId, ...session } } },
    } as never,
  });
}

describe('useSessionLiveState', () => {
  beforeAll(() => {
    // Tells React 18 that act() is supported here; without it every render logs a
    // warning, which the shared test setup treats as a failure.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    useStore.setState({
      tabSessionData: {} as never,
      sessions: [],
      sessionDetail: null,
      selectedSessionId: null,
    });
    document.body.innerHTML = '';
  });

  // The regression the hook was written for: the old inline selector keyed off the
  // global selectedSessionId, so every pane reported the focused session.
  it('resolves each tab to its OWN session, not the globally selected one', async () => {
    useStore.setState({ selectedSessionId: 'focused-session' });
    seedTab('tab-a', 'session-a', { terminalState: terminalState('working') });
    seedTab('tab-b', 'session-b', { terminalState: terminalState('done') });

    const a = await renderLiveState('tab-a');
    const b = await renderLiveState('tab-b');

    expect(a.sessionId).toBe('session-a');
    expect(a.isLive).toBe(true);
    expect(b.sessionId).toBe('session-b');
    expect(b.isLive).toBe(false);
  });

  it('treats a `working` terminal state as live even when the transcript is not', async () => {
    seedTab('tab-a', 'session-a', {
      terminalState: terminalState('working'),
      isOngoing: false,
    });

    const state = await renderLiveState('tab-a');

    expect(state.isLive).toBe(true);
    expect(state.visual?.pulse).toBe(true);
  });

  it('falls back to transcript isOngoing when the state is a resting one', async () => {
    seedTab('tab-a', 'session-a', {
      terminalState: terminalState('ready'),
      isOngoing: true,
    });

    const state = await renderLiveState('tab-a');

    // Live via the fallback, but `ready` is a resting state so it must not pulse.
    expect(state.isLive).toBe(true);
    expect(state.visual?.pulse).toBe(false);
  });

  // The hook is a dotfile, not a repo artifact, so this path has to work.
  it('works with no terminal state at all, from the sidebar row alone', async () => {
    useStore.setState({
      selectedSessionId: 'session-a',
      sessions: [{ id: 'session-a', isOngoing: true }] as never,
    });

    const state = await renderLiveState();

    expect(state.sessionId).toBe('session-a');
    expect(state.isLive).toBe(true);
    expect(state.visual).toBeNull();
  });

  // A session killed mid-turn leaves its file saying `working` forever, because the
  // hook only writes `default` on SessionEnd. Reading the raw payload made that
  // session permanently "live" — a "Thinking…" banner beside no status dot, since
  // the dot already honoured the staleness cut-off.
  it('does not report a stale `working` state as live', async () => {
    const thirteenHoursAgo = nowSeconds() - 13 * 60 * 60;
    seedTab('tab-a', 'session-a', {
      terminalState: terminalState('working', thirteenHoursAgo),
      isOngoing: false,
    });

    const state = await renderLiveState('tab-a');

    expect(state.visual).toBeNull();
    expect(state.isLive).toBe(false);
  });

  it('reports not-live when there is no session at all', async () => {
    const state = await renderLiveState('tab-missing');

    expect(state.sessionId).toBeNull();
    expect(state.isLive).toBe(false);
    expect(state.visual).toBeNull();
  });
});
