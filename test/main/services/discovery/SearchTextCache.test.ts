import { describe, expect, it } from 'vitest';

import { SearchTextCache } from '../../../../src/main/services/discovery/SearchTextCache';

import type { SearchableEntry } from '../../../../src/main/services/discovery/SearchTextExtractor';

function makeEntry(text: string, groupId: string): SearchableEntry {
  return {
    text,
    groupId,
    messageType: 'user',
    itemType: 'user',
    timestamp: Date.now(),
    messageUuid: groupId,
  };
}

describe('SearchTextCache', () => {
  it('returns cached entry on mtime match', () => {
    const cache = new SearchTextCache();
    const entries = [makeEntry('hello', 'user-1')];
    cache.set('/path/a.jsonl', 1000, entries, 'Title A');

    const result = cache.get('/path/a.jsonl', 1000);
    expect(result).toBeDefined();
    expect(result!.entries).toEqual(entries);
    expect(result!.sessionTitle).toBe('Title A');
  });

  it('returns undefined on mtime mismatch (stale)', () => {
    const cache = new SearchTextCache();
    const entries = [makeEntry('hello', 'user-1')];
    cache.set('/path/a.jsonl', 1000, entries, 'Title A');

    const result = cache.get('/path/a.jsonl', 2000);
    expect(result).toBeUndefined();
  });

  it('returns undefined for uncached paths', () => {
    const cache = new SearchTextCache();
    const result = cache.get('/path/missing.jsonl', 1000);
    expect(result).toBeUndefined();
  });

  it('evicts oldest entry when at max capacity', () => {
    const cache = new SearchTextCache(3);

    cache.set('/path/1.jsonl', 100, [makeEntry('one', 'u1')], 'One');
    cache.set('/path/2.jsonl', 200, [makeEntry('two', 'u2')], 'Two');
    cache.set('/path/3.jsonl', 300, [makeEntry('three', 'u3')], 'Three');

    expect(cache.size).toBe(3);

    // Adding a 4th entry should evict the oldest (1.jsonl)
    cache.set('/path/4.jsonl', 400, [makeEntry('four', 'u4')], 'Four');

    expect(cache.size).toBe(3);
    expect(cache.get('/path/1.jsonl', 100)).toBeUndefined();
    expect(cache.get('/path/4.jsonl', 400)).toBeDefined();
  });

  it('LRU access moves entry to end, preserving it from eviction', () => {
    const cache = new SearchTextCache(3);

    cache.set('/path/1.jsonl', 100, [makeEntry('one', 'u1')], 'One');
    cache.set('/path/2.jsonl', 200, [makeEntry('two', 'u2')], 'Two');
    cache.set('/path/3.jsonl', 300, [makeEntry('three', 'u3')], 'Three');

    // Access entry 1, moving it to end
    cache.get('/path/1.jsonl', 100);

    // Adding a 4th should now evict entry 2 (oldest after LRU access)
    cache.set('/path/4.jsonl', 400, [makeEntry('four', 'u4')], 'Four');

    expect(cache.get('/path/1.jsonl', 100)).toBeDefined();
    expect(cache.get('/path/2.jsonl', 200)).toBeUndefined();
  });

  it('invalidate() removes a specific entry', () => {
    const cache = new SearchTextCache();
    cache.set('/path/a.jsonl', 1000, [makeEntry('hello', 'u1')], 'Title');

    cache.invalidate('/path/a.jsonl');
    expect(cache.get('/path/a.jsonl', 1000)).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('clear() empties the cache', () => {
    const cache = new SearchTextCache();
    cache.set('/path/1.jsonl', 100, [makeEntry('one', 'u1')], 'One');
    cache.set('/path/2.jsonl', 200, [makeEntry('two', 'u2')], 'Two');

    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('handles undefined sessionTitle', () => {
    const cache = new SearchTextCache();
    cache.set('/path/a.jsonl', 1000, [], undefined);

    const result = cache.get('/path/a.jsonl', 1000);
    expect(result).toBeDefined();
    expect(result!.sessionTitle).toBeUndefined();
    expect(result!.entries).toEqual([]);
  });

  it('updates existing entry on re-set', () => {
    const cache = new SearchTextCache();
    cache.set('/path/a.jsonl', 1000, [makeEntry('old', 'u1')], 'Old');
    cache.set('/path/a.jsonl', 2000, [makeEntry('new', 'u2')], 'New');

    const result = cache.get('/path/a.jsonl', 2000);
    expect(result).toBeDefined();
    expect(result!.entries[0].text).toBe('new');
    expect(result!.sessionTitle).toBe('New');
    expect(cache.size).toBe(1);
  });
});
