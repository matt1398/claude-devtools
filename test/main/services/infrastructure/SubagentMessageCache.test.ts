/**
 * Tests for SubagentMessageCache.
 *
 * Covers:
 *   - Basic set/get round trip
 *   - LRU eviction at maxSize
 *   - Re-set updates LRU order
 *   - TTL expiry
 *   - invalidateSession drops only matching entries
 *   - dispose clears and disables
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubagentMessageCache } from '../../../../src/main/services/infrastructure/SubagentMessageCache';
import type { ParsedMessage } from '../../../../src/main/types';

function fakeMessages(n: number): ParsedMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    uuid: `m-${i}`,
    parentUuid: null,
    type: 'assistant' as const,
    timestamp: new Date(),
    content: '',
    isSidechain: true,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
  }));
}

describe('SubagentMessageCache', () => {
  let cache: SubagentMessageCache;

  beforeEach(() => {
    cache = new SubagentMessageCache(3, 10); // 3 entries, 10 min TTL
  });

  it('round-trips messages by key', () => {
    const key = SubagentMessageCache.buildKey('p1', 's1', 'a1');
    const msgs = fakeMessages(5);
    cache.set(key, msgs);
    expect(cache.get(key)).toBe(msgs);
    expect(cache.size()).toBe(1);
  });

  it('returns undefined for missing keys', () => {
    expect(cache.get('nope')).toBeUndefined();
  });

  it('evicts least-recently-used when at capacity', () => {
    cache.set('p::s::a1', fakeMessages(1));
    cache.set('p::s::a2', fakeMessages(1));
    cache.set('p::s::a3', fakeMessages(1));
    // Touching a1 makes a2 the oldest.
    cache.get('p::s::a1');
    cache.set('p::s::a4', fakeMessages(1));
    expect(cache.get('p::s::a2')).toBeUndefined();
    expect(cache.get('p::s::a1')).toBeDefined();
    expect(cache.get('p::s::a3')).toBeDefined();
    expect(cache.get('p::s::a4')).toBeDefined();
  });

  it('re-setting an existing key refreshes LRU order without growing size', () => {
    cache.set('p::s::a1', fakeMessages(1));
    cache.set('p::s::a2', fakeMessages(1));
    cache.set('p::s::a3', fakeMessages(1));
    cache.set('p::s::a1', fakeMessages(2)); // refresh a1
    cache.set('p::s::a4', fakeMessages(1));
    // a2 should be evicted (oldest after a1 was refreshed).
    expect(cache.get('p::s::a2')).toBeUndefined();
    expect(cache.get('p::s::a1')).toHaveLength(2);
  });

  it('expires entries past their TTL', () => {
    vi.useFakeTimers();
    const shortLived = new SubagentMessageCache(3, 1); // 1 minute TTL
    shortLived.set('k', fakeMessages(1));
    expect(shortLived.get('k')).toBeDefined();
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(shortLived.get('k')).toBeUndefined();
    vi.useRealTimers();
  });

  it('invalidateSession drops only matching entries', () => {
    cache.set(SubagentMessageCache.buildKey('p1', 's1', 'a1'), fakeMessages(1));
    cache.set(SubagentMessageCache.buildKey('p1', 's2', 'a2'), fakeMessages(1));
    cache.set(SubagentMessageCache.buildKey('p2', 's1', 'a3'), fakeMessages(1));
    cache.invalidateSession('p1', 's1');
    expect(cache.get(SubagentMessageCache.buildKey('p1', 's1', 'a1'))).toBeUndefined();
    expect(cache.get(SubagentMessageCache.buildKey('p1', 's2', 'a2'))).toBeDefined();
    expect(cache.get(SubagentMessageCache.buildKey('p2', 's1', 'a3'))).toBeDefined();
  });

  it('invalidateProject drops every entry for a project', () => {
    cache.set(SubagentMessageCache.buildKey('p1', 's1', 'a1'), fakeMessages(1));
    cache.set(SubagentMessageCache.buildKey('p1', 's2', 'a2'), fakeMessages(1));
    cache.set(SubagentMessageCache.buildKey('p2', 's1', 'a3'), fakeMessages(1));
    cache.invalidateProject('p1');
    expect(cache.size()).toBe(1);
    expect(cache.get(SubagentMessageCache.buildKey('p2', 's1', 'a3'))).toBeDefined();
  });

  it('respects setEnabled(false) — get/set become no-ops and clears entries', () => {
    cache.set('k', fakeMessages(1));
    cache.setEnabled(false);
    expect(cache.get('k')).toBeUndefined();
    expect(cache.isEnabled()).toBe(false);
    cache.set('k2', fakeMessages(1));
    expect(cache.size()).toBe(0);
  });

  it('dispose clears, disables, and is idempotent', () => {
    cache.set('k', fakeMessages(1));
    cache.dispose();
    expect(cache.size()).toBe(0);
    expect(cache.isEnabled()).toBe(false);
    expect(() => cache.dispose()).not.toThrow();
  });
});
