/**
 * Shared utilities for combined sessions K-way merge and cursor codec.
 *
 * Used by both IPC and HTTP combined session handlers to avoid logic duplication.
 */

import type { PaginatedSessionsResult, Session, SessionCursor } from '../types';

/** Sentinel value marking a context as fully exhausted (no more pages). */
export const CURSOR_EXHAUSTED = '__exhausted__';

export interface CombinedCursor {
  perContext: Record<string, string | null>;
  perContextTotals?: Record<string, number>;
}

/**
 * Result of fetching sessions from a single context.
 * Produced by each per-context query, consumed by `mergeCombinedResults`.
 */
export interface ContextFetchResult {
  contextId: string;
  previousCursor: string | null;
  sessions: Session[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
  /** True if this result came from an error catch path (transient failure). */
  errored?: boolean;
}

/**
 * Decodes a base64-encoded composite cursor into per-context cursor map.
 * Returns null for missing, malformed, or invalid cursor values.
 */
export function decodeCombinedCursor(cursor: string | null): CombinedCursor | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as unknown;
    if (typeof decoded !== 'object' || decoded === null || !('perContext' in decoded)) {
      return null;
    }

    const perContext = (decoded as { perContext?: unknown }).perContext;
    if (typeof perContext !== 'object' || perContext === null) {
      return null;
    }

    // Validate each perContext value: must be string | null
    const record = perContext as Record<string, unknown>;
    for (const value of Object.values(record)) {
      if (value !== null && typeof value !== 'string') {
        return null;
      }
    }

    const perContextTotals = (decoded as { perContextTotals?: unknown }).perContextTotals;
    if (perContextTotals !== undefined) {
      if (typeof perContextTotals !== 'object' || perContextTotals === null) {
        return null;
      }
      for (const value of Object.values(perContextTotals as Record<string, unknown>)) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          return null;
        }
      }
    }

    return decoded as CombinedCursor;
  } catch {
    return null;
  }
}

/**
 * Encodes a composite cursor to a base64 string.
 */
export function encodeCombinedCursor(cursor: CombinedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

/**
 * Combined-mode session sort comparator.
 * Sort order: (createdAt DESC, projectId ASC, sessionId ASC)
 */
export function compareCombinedSessions(a: Session, b: Session): number {
  if (b.createdAt !== a.createdAt) {
    return b.createdAt - a.createdAt;
  }
  if (a.projectId !== b.projectId) {
    return a.projectId.localeCompare(b.projectId);
  }
  return a.id.localeCompare(b.id);
}

/**
 * Encodes a per-context cursor from a session's sort key fields.
 */
export function encodePerContextCursor(session: Session): string {
  const cursor: SessionCursor = {
    timestamp: session.createdAt,
    sessionId: session.id,
    projectId: session.projectId,
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

/**
 * Checks if a per-context cursor value represents an exhausted context.
 */
export function isContextExhausted(cursorValue: string | null | undefined): boolean {
  return cursorValue === CURSOR_EXHAUSTED;
}

/**
 * K-way merge of per-context session results into a single paginated result.
 *
 * Takes pre-fetched results from each context and merges them by sort order,
 * building a composite cursor that tracks pagination position per-context.
 */
export function mergeCombinedResults(
  contextResults: ContextFetchResult[],
  limit: number
): PaginatedSessionsResult {
  const indexes = new Map<string, number>();
  const consumed = new Map<string, number>();
  const lastConsumed = new Map<string, Session>();
  for (const result of contextResults) {
    indexes.set(result.contextId, 0);
    consumed.set(result.contextId, 0);
  }

  const merged: Session[] = [];
  while (merged.length < limit) {
    let bestContextId: string | null = null;
    let bestSession: Session | null = null;

    for (const result of contextResults) {
      const index = indexes.get(result.contextId) ?? 0;
      const session = result.sessions[index];
      if (!session) {
        continue;
      }
      if (!bestSession || compareCombinedSessions(session, bestSession) < 0) {
        bestSession = session;
        bestContextId = result.contextId;
      }
    }

    if (!bestSession || !bestContextId) {
      break;
    }

    merged.push(bestSession);
    indexes.set(bestContextId, (indexes.get(bestContextId) ?? 0) + 1);
    consumed.set(bestContextId, (consumed.get(bestContextId) ?? 0) + 1);
    lastConsumed.set(bestContextId, bestSession);
  }

  const perContextCursor: Record<string, string | null> = {};
  let hasMore = false;
  for (const result of contextResults) {
    // Errored contexts preserve their previousCursor so that next request
    // retries from the same position — avoids replaying already-seen sessions
    // (which happens if the key is omitted, because absent keys start from page 1).
    if (result.errored) {
      hasMore = true; // Signal that the combined result is incomplete
      if (result.previousCursor !== null) {
        perContextCursor[result.contextId] = result.previousCursor;
      }
      // If previousCursor is null, omit — absent key means "start from page 1",
      // which is correct for a context that never successfully paginated.
      continue;
    }

    const consumedCount = consumed.get(result.contextId) ?? 0;
    const hasUnconsumed = consumedCount < result.sessions.length;
    if (result.hasMore || hasUnconsumed) {
      hasMore = true;
    }

    if (consumedCount === 0) {
      // If the context returned 0 sessions but has more pages, advance to nextCursor
      // to avoid re-fetching the same empty page indefinitely.
      if (result.sessions.length === 0 && result.nextCursor !== null) {
        perContextCursor[result.contextId] = result.nextCursor;
      } else if (result.sessions.length === 0 && !result.hasMore) {
        perContextCursor[result.contextId] = CURSOR_EXHAUSTED;
      } else {
        perContextCursor[result.contextId] = result.previousCursor;
      }
      continue;
    }
    if (consumedCount >= result.sessions.length) {
      if (result.nextCursor === null && !result.hasMore) {
        // Context exhausted — mark with sentinel so next request skips it
        // (don't omit: absent keys are treated as new contexts queried from page 1)
        perContextCursor[result.contextId] = CURSOR_EXHAUSTED;
        continue;
      }
      perContextCursor[result.contextId] = result.nextCursor;
      continue;
    }

    const last = lastConsumed.get(result.contextId);
    perContextCursor[result.contextId] = last
      ? encodePerContextCursor(last)
      : result.previousCursor;
  }

  const perContextTotals = contextResults.reduce<Record<string, number>>((acc, result) => {
    acc[result.contextId] = result.totalCount;
    return acc;
  }, {});

  return {
    sessions: merged,
    nextCursor: hasMore
      ? encodeCombinedCursor({ perContext: perContextCursor, perContextTotals })
      : null,
    hasMore,
    totalCount: contextResults.reduce((sum, result) => sum + result.totalCount, 0),
  };
}
