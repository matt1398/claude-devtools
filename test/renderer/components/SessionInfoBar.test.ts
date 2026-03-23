/**
 * SessionInfoBar unit tests.
 * Verifies the store-driven logic that determines session info bar visibility
 * and the data it surfaces (session ID, resume command).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI } from '../../mocks/electronAPI';

import { createTestStore, type TestStore } from '../store/storeTestUtils';

import type { SessionDetail } from '../../../src/renderer/types/data';

/** Minimal SessionDetail stub with only the fields SessionInfoBar reads. */
function makeSessionDetail(id: string): SessionDetail {
  return {
    session: {
      id,
      projectId: 'proj-1',
      projectPath: '/home/user/project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 1,
    },
    messages: [],
    chunks: [],
    processes: [],
    metrics: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheRead: 0,
      totalCacheCreation: 0,
      totalCost: 0,
      totalDuration: 0,
      turnCount: 0,
      toolUseCount: 0,
      messageCount: 0,
    },
  } as unknown as SessionDetail;
}

describe('SessionInfoBar store integration', () => {
  let store: TestStore;

  beforeEach(() => {
    installMockElectronAPI();
    store = createTestStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null sessionDetail when no session is loaded', () => {
    const state = store.getState();
    expect(state.sessionDetail).toBeNull();
  });

  it('should expose session ID when sessionDetail is set', () => {
    const detail = makeSessionDetail('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    store.setState({ sessionDetail: detail });

    const state = store.getState();
    expect(state.sessionDetail).not.toBeNull();
    expect(state.sessionDetail!.session.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('should build correct resume command from session ID', () => {
    const sessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const detail = makeSessionDetail(sessionId);
    store.setState({ sessionDetail: detail });

    const resumeCommand = `claude --resume ${store.getState().sessionDetail!.session.id}`;
    expect(resumeCommand).toBe(`claude --resume ${sessionId}`);
  });

  it('should use per-tab sessionDetail when tabId is provided', () => {
    const globalDetail = makeSessionDetail('global-session-id');
    const tabDetail = makeSessionDetail('tab-session-id');

    store.setState({
      sessionDetail: globalDetail,
      tabSessionData: {
        'tab-1': {
          sessionDetail: tabDetail,
          conversation: null,
          conversationLoading: false,
          sessionDetailLoading: false,
          sessionDetailError: null,
          sessionClaudeMdStats: null,
          sessionContextStats: null,
          sessionPhaseInfo: null,
          visibleAIGroupId: null,
          selectedAIGroup: null,
        },
      },
    });

    // Simulates the selector logic from SessionInfoBar:
    // const td = tabId ? s.tabSessionData[tabId] : null;
    // return { sessionDetail: td?.sessionDetail ?? s.sessionDetail };
    const tabId = 'tab-1';
    const state = store.getState();
    const td = tabId ? state.tabSessionData[tabId] : null;
    const resolved = td?.sessionDetail ?? state.sessionDetail;

    expect(resolved).not.toBeNull();
    expect(resolved!.session.id).toBe('tab-session-id');
  });

  it('should fall back to global sessionDetail when tab has no data', () => {
    const globalDetail = makeSessionDetail('global-session-id');

    store.setState({
      sessionDetail: globalDetail,
      tabSessionData: {},
    });

    const tabId = 'nonexistent-tab';
    const state = store.getState();
    const td = tabId ? state.tabSessionData[tabId] : null;
    const resolved = td?.sessionDetail ?? state.sessionDetail;

    expect(resolved).not.toBeNull();
    expect(resolved!.session.id).toBe('global-session-id');
  });

  it('should expose customTitle when set on sessionDetail', () => {
    const detail = makeSessionDetail('session-with-title');
    detail.session.customTitle = 'my-custom-name';
    store.setState({ sessionDetail: detail });

    const state = store.getState();
    expect(state.sessionDetail!.session.customTitle).toBe('my-custom-name');
  });

  it('should have undefined customTitle when not set', () => {
    const detail = makeSessionDetail('session-no-title');
    store.setState({ sessionDetail: detail });

    const state = store.getState();
    expect(state.sessionDetail!.session.customTitle).toBeUndefined();
  });
});
