/**
 * SearchTextCache - LRU cache for extracted search text with mtime invalidation.
 *
 * Caches SearchTextResult per session file path. Entries are small (~1KB each,
 * just text + metadata), so 200 entries is a reasonable default.
 *
 * Invalidation: mtime comparison on get(). If the file's mtime has changed
 * since caching, the entry is considered stale and undefined is returned.
 * No TTL needed — mtime check is sufficient.
 */

import type { SearchableEntry } from './SearchTextExtractor';

interface CacheEntry {
  entries: SearchableEntry[];
  sessionTitle: string | undefined;
  mtimeMs: number;
}

export class SearchTextCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;

  constructor(maxSize: number = 200) {
    this.maxSize = maxSize;
  }

  /**
   * Get cached entries for a file path if the mtime matches.
   * Returns undefined if not cached or stale.
   */
  get(
    filePath: string,
    mtimeMs: number
  ): { entries: SearchableEntry[]; sessionTitle: string | undefined } | undefined {
    const entry = this.cache.get(filePath);
    if (!entry) return undefined;

    // Stale — file was modified since we cached it
    if (entry.mtimeMs !== mtimeMs) {
      this.cache.delete(filePath);
      return undefined;
    }

    // LRU: delete and re-insert to move to end (most recent)
    this.cache.delete(filePath);
    this.cache.set(filePath, entry);

    return { entries: entry.entries, sessionTitle: entry.sessionTitle };
  }

  /**
   * Cache extracted entries for a file path.
   */
  set(
    filePath: string,
    mtimeMs: number,
    entries: SearchableEntry[],
    sessionTitle: string | undefined
  ): void {
    // If already exists, delete first to update position
    this.cache.delete(filePath);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(filePath, { entries, sessionTitle, mtimeMs });
  }

  /**
   * Remove a specific entry from the cache.
   */
  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Current number of cached entries.
   */
  get size(): number {
    return this.cache.size;
  }
}
