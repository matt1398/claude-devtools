/**
 * Session slice unit tests.
 * Tests session state management including fetching, pagination, and selection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI, type MockElectronAPI } from '../../mocks/electronAPI';

import { createTestStore, type TestStore } from './storeTestUtils';

describe('sessionSlice', () => {
  let store: TestStore;
  let mockAPI: MockElectronAPI;

  beforeEach(() => {
    mockAPI = installMockElectronAPI();
    store = createTestStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchSessionsInitial', () => {
    it('should fetch first page of sessions', async () => {
      const mockSessions = [
        { id: 'session-1', createdAt: '2024-01-15T10:00:00Z' },
        { id: 'session-2', createdAt: '2024-01-14T10:00:00Z' },
      ];

      mockAPI.getSessionsPaginated.mockResolvedValue({
        sessions: mockSessions as never[],
        nextCursor: 'cursor-1',
        hasMore: true,
        totalCount: 50,
      });

      await store.getState().fetchSessionsInitial('project-1');

      expect(mockAPI.getSessionsPaginated).toHaveBeenCalledWith('project-1', null, 20, {
        includeTotalCount: false,
        prefilterAll: false,
        metadataLevel: 'light',
      });
      expect(store.getState().sessions).toHaveLength(2);
      expect(store.getState().sessionsCursor).toBe('cursor-1');
      expect(store.getState().sessionsHasMore).toBe(true);
      expect(store.getState().sessionsTotalCount).toBe(50);
      expect(store.getState().sessionsLoading).toBe(false);
    });

    it('should set loading state during fetch', async () => {
      mockAPI.getSessionsPaginated.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  sessions: [],
                  nextCursor: null,
                  hasMore: false,
                  totalCount: 0,
                }),
              100
            );
          })
      );

      const fetchPromise = store.getState().fetchSessionsInitial('project-1');
      expect(store.getState().sessionsLoading).toBe(true);

      vi.useFakeTimers();
      vi.advanceTimersByTime(100);
      await fetchPromise;
      vi.useRealTimers();

      expect(store.getState().sessionsLoading).toBe(false);
    });

    it('should handle fetch error', async () => {
      mockAPI.getSessionsPaginated.mockRejectedValue(new Error('Network error'));

      await store.getState().fetchSessionsInitial('project-1');

      expect(store.getState().sessionsError).toBe('Network error');
      expect(store.getState().sessionsLoading).toBe(false);
    });
  });

  describe('fetchSessionsMore', () => {
    it('should append sessions to existing list', async () => {
      // Setup initial state
      store.setState({
        selectedProjectId: 'project-1',
        sessions: [{ id: 'session-1' }] as never[],
        sessionsCursor: 'cursor-1',
        sessionsHasMore: true,
        sessionsLoadingMore: false,
      });

      mockAPI.getSessionsPaginated.mockResolvedValue({
        sessions: [{ id: 'session-2' }] as never[],
        nextCursor: 'cursor-2',
        hasMore: true,
        totalCount: 50,
      });

      await store.getState().fetchSessionsMore();

      expect(store.getState().sessions).toHaveLength(2);
      expect(store.getState().sessionsCursor).toBe('cursor-2');
    });

    it('should not fetch if no more pages', async () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessionsHasMore: false,
        sessionsCursor: null,
      });

      await store.getState().fetchSessionsMore();

      expect(mockAPI.getSessionsPaginated).not.toHaveBeenCalled();
    });

    it('should not fetch if already loading', async () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessionsHasMore: true,
        sessionsCursor: 'cursor-1',
        sessionsLoadingMore: true,
      });

      await store.getState().fetchSessionsMore();

      expect(mockAPI.getSessionsPaginated).not.toHaveBeenCalled();
    });
  });

  describe('selectSession', () => {
    it('should update selected session ID', () => {
      store.setState({
        selectedProjectId: 'project-1',
      });

      mockAPI.getSessionDetail.mockResolvedValue({
        session: { id: 'session-1' },
        chunks: [],
      } as never);

      store.getState().selectSession('session-1');

      expect(store.getState().selectedSessionId).toBe('session-1');
    });

    it('should clear previous session detail', () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessionDetail: { session: { id: 'old-session' } } as never,
        sessionContextStats: new Map() as never,
      });

      mockAPI.getSessionDetail.mockResolvedValue({
        session: { id: 'session-2' },
        chunks: [],
      } as never);

      store.getState().selectSession('session-2');

      expect(store.getState().sessionDetail).toBeNull();
      expect(store.getState().sessionContextStats).toBeNull();
    });
  });

  describe('clearSelection', () => {
    it('should clear all selection state', () => {
      store.setState({
        selectedProjectId: 'project-1',
        selectedSessionId: 'session-1',
        sessions: [{ id: 'session-1' }] as never[],
        sessionDetail: { session: { id: 'session-1' } } as never,
      });

      store.getState().clearSelection();

      expect(store.getState().selectedProjectId).toBeNull();
      expect(store.getState().selectedSessionId).toBeNull();
      expect(store.getState().sessions).toHaveLength(0);
      expect(store.getState().sessionDetail).toBeNull();
    });
  });

  describe('refreshSessionsInPlace', () => {
    it('should refresh sessions without loading state', async () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessions: [{ id: 'session-1' }] as never[],
        sessionsLoading: false,
      });

      mockAPI.getSessionsPaginated.mockResolvedValue({
        sessions: [{ id: 'session-1' }, { id: 'session-2' }] as never[],
        nextCursor: null,
        hasMore: false,
        totalCount: 2,
      });

      await store.getState().refreshSessionsInPlace('project-1');

      expect(store.getState().sessions).toHaveLength(2);
      expect(mockAPI.getSessionsPaginated).toHaveBeenCalledWith('project-1', null, 20, {
        includeTotalCount: false,
        prefilterAll: false,
        metadataLevel: 'light',
      });
      // Should not have set loading state
      expect(store.getState().sessionsLoading).toBe(false);
    });

    it('should skip refresh if different project selected', async () => {
      store.setState({
        selectedProjectId: 'project-1',
      });

      await store.getState().refreshSessionsInPlace('project-2');

      expect(mockAPI.getSessionsPaginated).not.toHaveBeenCalled();
    });

    it('should ignore stale refresh responses and keep latest result', async () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessions: [{ id: 'seed' }] as never[],
      });

      let resolveFirst: ((value: unknown) => void) | undefined;
      let resolveSecond: ((value: unknown) => void) | undefined;

      mockAPI.getSessionsPaginated
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            })
        );

      const first = store.getState().refreshSessionsInPlace('project-1');
      const second = store.getState().refreshSessionsInPlace('project-1');

      resolveSecond?.({
        sessions: [{ id: 'newest' }] as never[],
        nextCursor: null,
        hasMore: false,
        totalCount: 1,
      });
      resolveFirst?.({
        sessions: [{ id: 'stale' }] as never[],
        nextCursor: null,
        hasMore: false,
        totalCount: 1,
      });

      await Promise.all([first, second]);
      expect(store.getState().sessions[0]?.id).toBe('newest');
    });

    // The refresh only refetches page 1. Replacing the list wholesale truncated it
    // back to 20 whenever deeper pages had been loaded, which re-armed the "load
    // more" row and made the sidebar page itself in and out on a loop.
    it('should merge page 1 without truncating deeper loaded pages', async () => {
      const loaded = Array.from({ length: 45 }, (_, i) => ({ id: `session-${i}` }));
      store.setState({
        selectedProjectId: 'project-1',
        sessions: loaded as never[],
        sessionsCursor: 'deep-cursor',
        sessionsHasMore: true,
        sessionsTotalCount: 45,
        sessionsPagesLoaded: 3,
      });

      // Page 1 comes back with one brand-new session at the head.
      mockAPI.getSessionsPaginated.mockResolvedValue({
        sessions: [{ id: 'brand-new' }, ...loaded.slice(0, 19)] as never[],
        nextCursor: 'page-1-cursor',
        hasMore: true,
        totalCount: 20,
      });

      await store.getState().refreshSessionsInPlace('project-1');

      const state = store.getState();
      expect(state.sessions).toHaveLength(46);
      expect(state.sessions[0]?.id).toBe('brand-new');
      expect(state.sessions.some((s) => s.id === 'session-44')).toBe(true);
      // Pagination must not rewind to the page-1 cursor.
      expect(state.sessionsCursor).toBe('deep-cursor');
      expect(state.sessionsTotalCount).toBe(46);
    });

    it('should adopt the fresh cursor when only page 1 is loaded', async () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessions: [{ id: 'a' }] as never[],
        sessionsCursor: 'old-cursor',
        sessionsHasMore: false,
        sessionsPagesLoaded: 1,
      });

      mockAPI.getSessionsPaginated.mockResolvedValue({
        sessions: [{ id: 'a' }, { id: 'b' }] as never[],
        nextCursor: 'fresh-cursor',
        hasMore: true,
        totalCount: 2,
      });

      await store.getState().refreshSessionsInPlace('project-1');

      expect(store.getState().sessionsCursor).toBe('fresh-cursor');
      expect(store.getState().sessionsHasMore).toBe(true);
    });

    // A transient scan failure surfaces as an empty page; blanking the list on that
    // renders a bogus "No sessions found" empty state.
    it('should not blank a populated list when the refresh returns nothing', async () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessions: [{ id: 'session-1' }, { id: 'session-2' }] as never[],
      });

      mockAPI.getSessionsPaginated.mockResolvedValue({
        sessions: [] as never[],
        nextCursor: null,
        hasMore: false,
        totalCount: 0,
      });

      await store.getState().refreshSessionsInPlace('project-1');

      expect(store.getState().sessions).toHaveLength(2);
    });

    // The merge must be able to shrink, or a deleted session sits in the sidebar
    // for the life of the process — nothing else prunes the list, and the cache
    // outlives project switches.
    it('should drop a session that vanished from page 1', async () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[],
        sessionsPagesLoaded: 1,
      });

      mockAPI.getSessionsPaginated.mockResolvedValue({
        sessions: [{ id: 'a' }, { id: 'c' }] as never[],
        nextCursor: null,
        hasMore: false,
        totalCount: 2,
      });

      await store.getState().refreshSessionsInPlace('project-1');

      expect(store.getState().sessions.map((s) => s.id)).toEqual(['a', 'c']);
    });

    // A new session pushes the tail of the old page 1 down into page 2, which this
    // response says nothing about. Treating that as a deletion would evict a live
    // session on every refresh that happens to see a new one.
    it('should not mistake a session pushed out of page 1 for a deletion', async () => {
      const loaded = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}` }));
      store.setState({
        selectedProjectId: 'project-1',
        sessions: loaded as never[],
        sessionsPagesLoaded: 1,
      });

      // Page size is effectively 3 here: a new session arrives, so s2 falls off.
      mockAPI.getSessionsPaginated.mockResolvedValue({
        sessions: [{ id: 'new' }, { id: 's0' }, { id: 's1' }] as never[],
        nextCursor: 'c',
        hasMore: true,
        totalCount: 4,
      });

      await store.getState().refreshSessionsInPlace('project-1');

      expect(store.getState().sessions.map((s) => s.id)).toEqual(['new', 's0', 's1', 's2']);
    });

    // The pre-await guard can't see a switch that happens while the request is in
    // flight, and the generation counter is per-project so it won't catch it either.
    it('should not merge into another project after a mid-flight switch', async () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessions: [{ id: 'a-1' }] as never[],
      });

      let resolveRequest: ((value: unknown) => void) | undefined;
      mockAPI.getSessionsPaginated.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve as (value: unknown) => void;
          })
      );

      const inFlight = store.getState().refreshSessionsInPlace('project-1');

      // User switches to project 2 before project 1's response lands.
      store.setState({ selectedProjectId: 'project-2', sessions: [{ id: 'b-1' }] as never[] });

      resolveRequest?.({
        sessions: [{ id: 'a-1' }, { id: 'a-2' }] as never[],
        nextCursor: null,
        hasMore: false,
        totalCount: 2,
      });
      await inFlight;

      expect(store.getState().sessions.map((s) => s.id)).toEqual(['b-1']);
      expect(store.getState()._sessionCache.has('project-1')).toBe(false);
    });

    it('should update changed session metadata in place', async () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessions: [{ id: 'session-1', messageCount: 3 }] as never[],
      });

      mockAPI.getSessionsPaginated.mockResolvedValue({
        sessions: [{ id: 'session-1', messageCount: 9 }] as never[],
        nextCursor: null,
        hasMore: false,
        totalCount: 1,
      });

      await store.getState().refreshSessionsInPlace('project-1');

      expect(store.getState().sessions).toHaveLength(1);
      expect((store.getState().sessions[0] as { messageCount?: number }).messageCount).toBe(9);
    });
  });

  describe('removeSessionFromList', () => {
    it('should drop the session and shrink the total', () => {
      store.setState({
        sessions: [{ id: 'a' }, { id: 'b' }] as never[],
        sessionsTotalCount: 2,
      });

      store.getState().removeSessionFromList('a');

      expect(store.getState().sessions.map((s) => s.id)).toEqual(['b']);
      expect(store.getState().sessionsTotalCount).toBe(1);
    });

    // Otherwise switching away and back resurrects the deleted row from cache.
    it('should evict the session from the project cache too', () => {
      store.setState({
        selectedProjectId: 'project-1',
        sessions: [{ id: 'a' }, { id: 'b' }] as never[],
        sessionsTotalCount: 2,
      });
      store.getState()._sessionCache.set('project-1', {
        sessions: [{ id: 'a' }, { id: 'b' }] as never[],
        cursor: null,
        hasMore: false,
        totalCount: 2,
        pagesLoaded: 1,
        timestamp: 0,
      });

      store.getState().removeSessionFromList('a');

      const cached = store.getState()._sessionCache.get('project-1');
      expect(cached?.sessions.map((s) => s.id)).toEqual(['b']);
      expect(cached?.totalCount).toBe(1);
    });

    it('should be a no-op for a session it does not hold', () => {
      const before = [{ id: 'a' }] as never[];
      store.setState({ sessions: before });

      store.getState().removeSessionFromList('nope');

      expect(store.getState().sessions).toBe(before);
    });
  });

  describe('applyTerminalStateChange', () => {
    const working = { state: 'working', ts: 1_700_000_000 };

    it('should patch the sidebar session without any refetch', () => {
      store.setState({
        sessions: [{ id: 'session-1' }, { id: 'session-2' }] as never[],
      });

      store.getState().applyTerminalStateChange({ sessionId: 'session-2', state: working });

      const sessions = store.getState().sessions as { id: string; terminalState?: unknown }[];
      expect(sessions[1]?.terminalState).toEqual(working);
      expect(sessions[0]?.terminalState).toBeUndefined();
      expect(mockAPI.getSessionsPaginated).not.toHaveBeenCalled();
      expect(mockAPI.getSessionDetail).not.toHaveBeenCalled();
    });

    // getSessionDetail short-circuits on an unchanged JSONL fingerprint, so a
    // terminal-state write can only reach the chat pane by being patched directly.
    it('should patch every tab whose detail shows that session', () => {
      store.setState({
        sessions: [] as never[],
        tabSessionData: {
          'tab-a': { sessionDetail: { session: { id: 'session-1' } } },
          'tab-b': { sessionDetail: { session: { id: 'other' } } },
        } as never,
      });

      store.getState().applyTerminalStateChange({ sessionId: 'session-1', state: working });

      const data = store.getState().tabSessionData as Record<
        string,
        { sessionDetail: { session: { terminalState?: unknown } } }
      >;
      expect(data['tab-a'].sessionDetail.session.terminalState).toEqual(working);
      expect(data['tab-b'].sessionDetail.session.terminalState).toBeUndefined();
    });

    it('should clear state when the file is removed', () => {
      store.setState({
        sessions: [{ id: 'session-1', terminalState: working }] as never[],
      });

      store.getState().applyTerminalStateChange({ sessionId: 'session-1' });

      const sessions = store.getState().sessions as { terminalState?: unknown }[];
      expect(sessions[0]?.terminalState).toBeUndefined();
    });

    it('should be a no-op for an unknown session', () => {
      const before = [{ id: 'session-1' }] as never[];
      store.setState({ sessions: before });

      store.getState().applyTerminalStateChange({ sessionId: 'nope', state: working });

      expect(store.getState().sessions).toBe(before);
    });
  });

  describe('fetchSessionDetail', () => {
    it('should ignore stale responses and keep the latest session detail', async () => {
      store.setState({
        selectedSessionId: 'session-2',
      });

      let resolveFirst: ((value: unknown) => void) | undefined;
      let resolveSecond: ((value: unknown) => void) | undefined;

      mockAPI.getSessionDetail
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            })
        );

      const first = store.getState().fetchSessionDetail('project-1', 'session-1');
      const second = store.getState().fetchSessionDetail('project-1', 'session-2');

      resolveSecond?.({
        session: { id: 'session-2' },
        chunks: [],
        processes: [],
      });
      resolveFirst?.({
        session: { id: 'session-1' },
        chunks: [],
        processes: [],
      });

      await Promise.all([first, second]);
      expect(store.getState().sessionDetail?.session.id).toBe('session-2');
    });
  });
});
