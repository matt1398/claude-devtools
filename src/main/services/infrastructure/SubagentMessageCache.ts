/**
 * SubagentMessageCache - LRU cache for lazy-loaded subagent message bodies.
 *
 * Distinct from DataCache so that subagent message arrays don't compete with
 * full SessionDetails for slots. Sized small (default 10) because each entry
 * holds a full subagent transcript and we only need to retain the few that
 * the user is actively expanding. Entries expire after `ttlMinutes` minutes.
 *
 * Key format: `${projectId}::${sessionId}::${subagentId}`.
 */

import { type ParsedMessage } from '@main/types';
import { createLogger } from '@shared/utils/logger';

const logger = createLogger('Service:SubagentMessageCache');

interface CacheEntry {
  messages: ParsedMessage[];
  timestamp: number;
}

export class SubagentMessageCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private enabled: boolean;
  private disposed = false;

  constructor(maxSize: number = 10, ttlMinutes: number = 10, enabled: boolean = true) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMinutes * 60 * 1000;
    this.enabled = enabled;
  }

  /** Build the canonical cache key. */
  static buildKey(projectId: string, sessionId: string, subagentId: string): string {
    return `${projectId}::${sessionId}::${subagentId}`;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cache.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Read a cache entry. Returns undefined if missing, expired, or disabled.
   * Touches the entry on read so LRU eviction reflects recency.
   */
  get(key: string): ParsedMessage[] | undefined {
    if (!this.enabled) return undefined;
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh LRU position by re-inserting at the back.
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.messages;
  }

  /**
   * Store a value, evicting the least-recently-used entry if at capacity.
   * Re-setting an existing key refreshes its LRU position.
   */
  set(key: string, messages: ParsedMessage[]): void {
    if (!this.enabled) return;

    // Refresh LRU order if the key already exists.
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { messages, timestamp: Date.now() });
  }

  /**
   * Drop every entry whose key matches the given session.
   * Called when a session refresh invalidates downstream subagent state.
   */
  invalidateSession(projectId: string, sessionId: string): void {
    const prefix = `${projectId}::${sessionId}::`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /** Drop every entry for a given project (any session). */
  invalidateProject(projectId: string): void {
    const prefix = `${projectId}::`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    logger.info('Disposing SubagentMessageCache');
    this.cache.clear();
    this.enabled = false;
    this.disposed = true;
  }
}
