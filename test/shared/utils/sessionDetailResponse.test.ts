/**
 * IPC contract tests for `getSessionDetail` response shape.
 *
 * These tests guard the wire format between the renderer and main process.
 * If `isSessionDetailUnchanged` ever stops correctly identifying the sentinel,
 * `refreshSessionInPlace` will fall through to the full transform path on
 * every no-op refresh — restoring the v0.4.13 perf regression. That's the
 * scenario this test exists to prevent.
 */

import { describe, expect, it } from 'vitest';

import { isSessionDetailUnchanged } from '../../../src/shared/utils/sessionDetailResponse';

import type { SessionDetail } from '../../../src/main/types';

describe('isSessionDetailUnchanged', () => {
  it('returns true for the unchanged sentinel', () => {
    expect(isSessionDetailUnchanged({ unchanged: true, fingerprint: '12345-67890' })).toBe(true);
  });

  it('returns false for a full SessionDetail (no unchanged field)', () => {
    const detail = {
      session: {} as never,
      messages: [],
      chunks: [],
      processes: [],
      metrics: {} as never,
      fingerprint: '12345-67890',
    } as SessionDetail;

    expect(isSessionDetailUnchanged(detail)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSessionDetailUnchanged(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSessionDetailUnchanged(undefined)).toBe(false);
  });

  it('returns false when unchanged is not literal true (defense-in-depth)', () => {
    // Any non-true value should not be treated as unchanged. Guards against a
    // future refactor that accidentally serializes a falsy/truthy variant.
    expect(isSessionDetailUnchanged({ unchanged: false } as never)).toBe(false);
    expect(isSessionDetailUnchanged({ unchanged: 1 } as never)).toBe(false);
    expect(isSessionDetailUnchanged({ unchanged: 'yes' } as never)).toBe(false);
  });

  it('narrows the type so callers can access fingerprint', () => {
    const response: SessionDetail | { unchanged: true; fingerprint: string } = {
      unchanged: true,
      fingerprint: 'abc-123',
    };
    if (isSessionDetailUnchanged(response)) {
      // Type narrowing: response.fingerprint is now string, not optional.
      expect(response.fingerprint).toBe('abc-123');
    } else {
      throw new Error('expected unchanged sentinel');
    }
  });
});
