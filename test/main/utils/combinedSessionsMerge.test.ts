import { describe, expect, it } from 'vitest';

import {
  CURSOR_EXHAUSTED,
  compareCombinedSessions,
  decodeCombinedCursor,
  encodeCombinedCursor,
  encodePerContextCursor,
  isContextExhausted,
  mergeCombinedResults,
} from '../../../src/main/utils/combinedSessionsMerge';

import type { ContextFetchResult } from '../../../src/main/utils/combinedSessionsMerge';
import type { Session } from '../../../src/main/types';

function makeSession(overrides: Partial<Session> & { id: string; projectId: string }): Session {
  return {
    createdAt: 1000,
    firstMessage: null,
    hasSubagents: false,
    messageTimestamp: null,
    metadataLevel: 'light',
    projectPath: '/tmp',
    ...overrides,
  } as Session;
}

describe('combinedSessionsMerge', () => {
  describe('decodeCombinedCursor', () => {
    it('returns null for null/empty cursor', () => {
      expect(decodeCombinedCursor(null)).toBeNull();
      expect(decodeCombinedCursor('')).toBeNull();
    });

    it('decodes a valid base64 cursor', () => {
      const cursor = { perContext: { ctx1: 'abc', ctx2: null } };
      const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64');
      expect(decodeCombinedCursor(encoded)).toEqual(cursor);
    });

    it('returns null for invalid base64', () => {
      expect(decodeCombinedCursor('not-base64!!!')).toBeNull();
    });

    it('returns null for valid base64 but missing perContext', () => {
      const encoded = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
      expect(decodeCombinedCursor(encoded)).toBeNull();
    });

    it('returns null for non-object perContext', () => {
      const encoded = Buffer.from(JSON.stringify({ perContext: 42 })).toString('base64');
      expect(decodeCombinedCursor(encoded)).toBeNull();
    });

    it('rejects perContext values that are not string or null', () => {
      const encoded = Buffer.from(
        JSON.stringify({ perContext: { ctx1: 'ok', ctx2: 123 } })
      ).toString('base64');
      expect(decodeCombinedCursor(encoded)).toBeNull();
    });

    it('rejects perContextTotals values that are not finite non-negative numbers', () => {
      const encoded = Buffer.from(
        JSON.stringify({ perContext: { ctx1: 'ok' }, perContextTotals: { ctx1: -1 } })
      ).toString('base64');
      expect(decodeCombinedCursor(encoded)).toBeNull();
    });

    it('accepts __exhausted__ sentinel as a valid cursor value', () => {
      const cursor = { perContext: { ctx1: CURSOR_EXHAUSTED, ctx2: null } };
      const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64');
      const decoded = decodeCombinedCursor(encoded);
      expect(decoded).toEqual(cursor);
    });
  });

  describe('encodeCombinedCursor', () => {
    it('round-trips with decodeCombinedCursor', () => {
      const cursor = {
        perContext: { ctx1: 'abc', ctx2: null, ctx3: CURSOR_EXHAUSTED },
        perContextTotals: { ctx1: 3, ctx2: 7, ctx3: 11 },
      };
      const encoded = encodeCombinedCursor(cursor);
      expect(decodeCombinedCursor(encoded)).toEqual(cursor);
    });
  });

  describe('compareCombinedSessions', () => {
    it('sorts by createdAt descending', () => {
      const a = makeSession({ id: 's1', projectId: 'p1', createdAt: 1000 });
      const b = makeSession({ id: 's2', projectId: 'p1', createdAt: 2000 });
      expect(compareCombinedSessions(a, b)).toBeGreaterThan(0);
      expect(compareCombinedSessions(b, a)).toBeLessThan(0);
    });

    it('breaks ties by projectId ascending', () => {
      const a = makeSession({ id: 's1', projectId: 'alpha', createdAt: 1000 });
      const b = makeSession({ id: 's1', projectId: 'beta', createdAt: 1000 });
      expect(compareCombinedSessions(a, b)).toBeLessThan(0);
    });

    it('breaks ties by sessionId ascending', () => {
      const a = makeSession({ id: 'aaa', projectId: 'p1', createdAt: 1000 });
      const b = makeSession({ id: 'zzz', projectId: 'p1', createdAt: 1000 });
      expect(compareCombinedSessions(a, b)).toBeLessThan(0);
    });
  });

  describe('encodePerContextCursor', () => {
    it('encodes session sort key fields', () => {
      const session = makeSession({ id: 's1', projectId: 'p1', createdAt: 5000 });
      const encoded = encodePerContextCursor(session);
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
      expect(decoded).toEqual({ timestamp: 5000, sessionId: 's1', projectId: 'p1' });
    });
  });

  describe('isContextExhausted', () => {
    it('returns true for __exhausted__ sentinel', () => {
      expect(isContextExhausted(CURSOR_EXHAUSTED)).toBe(true);
    });

    it('returns false for null, undefined, and other strings', () => {
      expect(isContextExhausted(null)).toBe(false);
      expect(isContextExhausted(undefined)).toBe(false);
      expect(isContextExhausted('some-cursor')).toBe(false);
    });
  });

  describe('mergeCombinedResults', () => {
    it('merges sessions from multiple contexts by sort order', () => {
      const results: ContextFetchResult[] = [
        {
          contextId: 'ctx1',
          previousCursor: null,
          sessions: [
            makeSession({ id: 's1', projectId: 'p1', createdAt: 3000 }),
            makeSession({ id: 's3', projectId: 'p1', createdAt: 1000 }),
          ],
          nextCursor: null,
          hasMore: false,
          totalCount: 2,
        },
        {
          contextId: 'ctx2',
          previousCursor: null,
          sessions: [
            makeSession({ id: 's2', projectId: 'p2', createdAt: 2000 }),
          ],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        },
      ];

      const result = mergeCombinedResults(results, 10);
      expect(result.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.totalCount).toBe(3);
    });

    it('respects the limit parameter', () => {
      const results: ContextFetchResult[] = [
        {
          contextId: 'ctx1',
          previousCursor: null,
          sessions: [
            makeSession({ id: 's1', projectId: 'p1', createdAt: 3000 }),
            makeSession({ id: 's3', projectId: 'p1', createdAt: 1000 }),
          ],
          nextCursor: null,
          hasMore: false,
          totalCount: 2,
        },
        {
          contextId: 'ctx2',
          previousCursor: null,
          sessions: [
            makeSession({ id: 's2', projectId: 'p2', createdAt: 2000 }),
          ],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        },
      ];

      const result = mergeCombinedResults(results, 2);
      expect(result.sessions).toHaveLength(2);
      expect(result.sessions.map((s) => s.id)).toEqual(['s1', 's2']);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).not.toBeNull();
    });

    it('marks exhausted contexts with sentinel in cursor', () => {
      const results: ContextFetchResult[] = [
        {
          contextId: 'ctx1',
          previousCursor: null,
          sessions: [makeSession({ id: 's1', projectId: 'p1', createdAt: 2000 })],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        },
        {
          contextId: 'ctx2',
          previousCursor: null,
          sessions: [makeSession({ id: 's2', projectId: 'p2', createdAt: 1000 })],
          nextCursor: 'page2',
          hasMore: true,
          totalCount: 5,
        },
      ];

      const result = mergeCombinedResults(results, 10);
      expect(result.hasMore).toBe(true);
      const cursor = decodeCombinedCursor(result.nextCursor!);
      expect(cursor?.perContext['ctx1']).toBe(CURSOR_EXHAUSTED);
      expect(cursor?.perContext['ctx2']).toBe('page2');
      expect(cursor?.perContextTotals).toEqual({ ctx1: 1, ctx2: 5 });
    });

    it('preserves previousCursor for unconsumed contexts', () => {
      const results: ContextFetchResult[] = [
        {
          contextId: 'ctx1',
          previousCursor: null,
          sessions: [makeSession({ id: 's1', projectId: 'p1', createdAt: 5000 })],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        },
        {
          contextId: 'ctx2',
          previousCursor: 'prev-cursor',
          sessions: [makeSession({ id: 's2', projectId: 'p2', createdAt: 100 })],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        },
      ];

      // Limit 1: only ctx1's session consumed
      const result = mergeCombinedResults(results, 1);
      const cursor = decodeCombinedCursor(result.nextCursor!);
      // ctx2 was unconsumed — its cursor should be preserved as previousCursor
      expect(cursor?.perContext['ctx2']).toBe('prev-cursor');
    });

    it('encodes per-context cursor for partially consumed context', () => {
      const results: ContextFetchResult[] = [
        {
          contextId: 'ctx1',
          previousCursor: null,
          sessions: [
            makeSession({ id: 's1', projectId: 'p1', createdAt: 5000 }),
            makeSession({ id: 's3', projectId: 'p1', createdAt: 3000 }),
            makeSession({ id: 's5', projectId: 'p1', createdAt: 1000 }),
          ],
          nextCursor: 'ctx1-page2',
          hasMore: true,
          totalCount: 10,
        },
        {
          contextId: 'ctx2',
          previousCursor: null,
          sessions: [
            makeSession({ id: 's2', projectId: 'p2', createdAt: 4000 }),
            makeSession({ id: 's4', projectId: 'p2', createdAt: 2000 }),
          ],
          nextCursor: null,
          hasMore: false,
          totalCount: 2,
        },
      ];

      // Limit 3: merge picks s1(5000), s2(4000), s3(3000) — ctx1 partially consumed (2 of 3)
      const result = mergeCombinedResults(results, 3);
      expect(result.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
      expect(result.hasMore).toBe(true);

      const cursor = decodeCombinedCursor(result.nextCursor!);
      // ctx1: partially consumed — cursor should encode last consumed session's sort key
      const ctx1Cursor = cursor?.perContext['ctx1'];
      expect(ctx1Cursor).toBeTruthy();
      const decoded = JSON.parse(Buffer.from(ctx1Cursor!, 'base64').toString('utf8'));
      expect(decoded).toEqual({ timestamp: 3000, sessionId: 's3', projectId: 'p1' });

      // ctx2: only s2 consumed (1 of 2), still has unconsumed s4
      const ctx2Cursor = cursor?.perContext['ctx2'];
      expect(ctx2Cursor).toBeTruthy();
      const decoded2 = JSON.parse(Buffer.from(ctx2Cursor!, 'base64').toString('utf8'));
      expect(decoded2).toEqual({ timestamp: 4000, sessionId: 's2', projectId: 'p2' });
    });

    it('handles empty context results', () => {
      const result = mergeCombinedResults([], 10);
      expect(result.sessions).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.totalCount).toBe(0);
    });

    it('advances cursor when context returns 0 sessions but hasMore (prevents infinite loop)', () => {
      const results: ContextFetchResult[] = [
        {
          contextId: 'ctx1',
          previousCursor: 'old-cursor',
          sessions: [], // all sessions filtered/unreadable
          nextCursor: 'next-page-cursor',
          hasMore: true,
          totalCount: 10,
        },
        {
          contextId: 'ctx2',
          previousCursor: null,
          sessions: [makeSession({ id: 's1', projectId: 'p1', createdAt: 1000 })],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        },
      ];

      const result = mergeCombinedResults(results, 10);
      const cursor = decodeCombinedCursor(result.nextCursor!);
      // ctx1 returned 0 sessions but has more — must advance to nextCursor, NOT loop on old-cursor
      expect(cursor?.perContext['ctx1']).toBe('next-page-cursor');
      expect(cursor?.perContext['ctx2']).toBe(CURSOR_EXHAUSTED);
    });

    it('preserves errored context previousCursor for retry from same position', () => {
      const results: ContextFetchResult[] = [
        {
          contextId: 'ctx1',
          previousCursor: 'old-cursor',
          sessions: [],
          nextCursor: null,
          hasMore: false,
          totalCount: 0,
          errored: true, // transient SSH failure
        },
        {
          contextId: 'ctx2',
          previousCursor: null,
          sessions: [makeSession({ id: 's1', projectId: 'p1', createdAt: 1000 })],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        },
      ];

      const result = mergeCombinedResults(results, 10);
      expect(result.hasMore).toBe(true); // incomplete result
      const cursor = decodeCombinedCursor(result.nextCursor!);
      // Errored context preserves its cursor — retries from same position, not page 1
      expect(cursor?.perContext['ctx1']).toBe('old-cursor');
      expect(cursor?.perContext['ctx2']).toBe(CURSOR_EXHAUSTED);
    });

    it('omits errored context with null previousCursor (retries from page 1)', () => {
      const results: ContextFetchResult[] = [
        {
          contextId: 'ctx1',
          previousCursor: null,
          sessions: [],
          nextCursor: null,
          hasMore: false,
          totalCount: 0,
          errored: true,
        },
        {
          contextId: 'ctx2',
          previousCursor: null,
          sessions: [makeSession({ id: 's1', projectId: 'p1', createdAt: 1000 })],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        },
      ];

      const result = mergeCombinedResults(results, 10);
      expect(result.hasMore).toBe(true);
      const cursor = decodeCombinedCursor(result.nextCursor!);
      // Null previousCursor → omitted from cursor → absent key starts from page 1
      expect(cursor?.perContext).not.toHaveProperty('ctx1');
      expect(cursor?.perContext['ctx2']).toBe(CURSOR_EXHAUSTED);
    });

    it('marks context as exhausted when 0 sessions and no more pages', () => {
      const results: ContextFetchResult[] = [
        {
          contextId: 'ctx1',
          previousCursor: 'old-cursor',
          sessions: [],
          nextCursor: null,
          hasMore: false,
          totalCount: 0,
        },
        {
          contextId: 'ctx2',
          previousCursor: null,
          sessions: [makeSession({ id: 's1', projectId: 'p1', createdAt: 1000 })],
          nextCursor: null,
          hasMore: false,
          totalCount: 1,
        },
      ];

      const result = mergeCombinedResults(results, 10);
      // ctx1 returned 0 sessions and no more — should be exhausted, not looping
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });
});
