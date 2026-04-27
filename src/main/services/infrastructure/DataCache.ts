/**
 * DataCache service - LRU cache for parsed session data.
 *
 * Responsibilities:
 * - Cache parsed SessionDetail objects to avoid re-parsing
 * - LRU eviction policy with configurable max size
 * - TTL-based expiration
 * - Provide cache invalidation for file changes
 */

import { type SessionDetail, type SubagentDetail } from '@main/types';
import { createLogger } from '@shared/utils/logger';

const logger = createLogger('Service:DataCache');

interface CacheEntry<T> {
  value: T;

  timestamp: number;
  version: number; // Cache schema version
  // Optional file-state fingerprint (e.g., `${mtimeMs}-${size}`).
  // When present on both set() and get(), a mismatch invalidates the entry —
  // a safety net for FileWatcher events dropped by macOS FSEvents.
  fingerprint?: string;
}

// Union type for cached values

type CachedValue = SessionDetail | SubagentDetail;

export class DataCache {
  private cache: Map<string, CacheEntry<CachedValue>>;
  private maxSize: number;
  private ttl: number; // Time-to-live in milliseconds
  private enabled: boolean; // Whether caching is enabled
  private disposed = false; // Flag to prevent reuse after disposal
  private static readonly CURRENT_VERSION = 2; // Increment when cache structure changes

  constructor(maxSize: number = 50, ttlMinutes: number = 10, enabled: boolean = true) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttlMinutes * 60 * 1000;
    this.enabled = enabled;
  }

  /**
   * Enable or disable caching.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      // Clear cache when disabling
      this.cache.clear();
    }
  }

  /**
   * Check if caching is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // ===========================================================================
  // Cache Operations
  // ===========================================================================

  /**
   * Gets a cached session detail.
   * @param key - Cache key in format "projectId/sessionId"
   * @param fingerprint - Optional file-state fingerprint. If the cached entry
   *   has a fingerprint that differs from this one, it's treated as stale.
   * @returns The cached SessionDetail, or undefined if not found, expired, or stale
   */
  get(key: string, fingerprint?: string): SessionDetail | undefined {
    if (!this.enabled) {
      return undefined;
    }

    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if entry version is outdated
    if (entry.version !== DataCache.CURRENT_VERSION) {
      logger.info(`DataCache: Invalidating outdated cache entry (v${entry.version}): ${key}`);
      this.cache.delete(key);
      return undefined;
    }

    // Check if entry has expired
    const now = Date.now();
    if (now - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Check fingerprint mismatch (file changed since cached)
    if (fingerprint !== undefined && entry.fingerprint !== fingerprint) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (mark as recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value as SessionDetail;
  }

  /**
   * Gets a cached subagent detail.
   * @param key - Cache key in format "subagent-projectId-sessionId-subagentId"
   * @returns The cached SubagentDetail, or undefined if not found or expired
   */
  getSubagent(key: string): SubagentDetail | undefined {
    if (!this.enabled) {
      return undefined;
    }

    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if entry version is outdated
    if (entry.version !== DataCache.CURRENT_VERSION) {
      logger.info(
        `DataCache: Invalidating outdated subagent cache entry (v${entry.version}): ${key}`
      );
      this.cache.delete(key);
      return undefined;
    }

    // Check if entry has expired
    const now = Date.now();
    if (now - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (mark as recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value as SubagentDetail;
  }

  /**
   * Internal method to set a value in the cache.
   * Handles LRU eviction and cache entry creation.
   */
  private setInternal(key: string, value: CachedValue, fingerprint?: string): void {
    if (!this.enabled) {
      return;
    }

    // If at max size, remove least recently used (first entry)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      version: DataCache.CURRENT_VERSION,
      fingerprint,
    });
  }

  /**
   * Sets a value in the cache.
   * @param key - Cache key in format "projectId/sessionId"
   * @param value - The SessionDetail to cache
   * @param fingerprint - Optional file-state fingerprint paired with this entry.
   *   When provided here AND on a future get(), a mismatch will invalidate.
   */
  set(key: string, value: SessionDetail, fingerprint?: string): void {
    this.setInternal(key, value, fingerprint);
  }

  /**
   * Sets a subagent detail value in the cache.
   * @param key - Cache key in format "subagent-projectId-sessionId-subagentId"
   * @param value - The SubagentDetail to cache
   */
  setSubagent(key: string, value: SubagentDetail): void {
    this.setInternal(key, value);
  }

  /**
   * Checks if a key exists in the cache and is not expired.
   * @param key - Cache key to check
   * @returns true if key exists and is valid, false otherwise
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  // ===========================================================================
  // Key Building
  // ===========================================================================

  /**
   * Build a cache key from project and session IDs.
   */
  static buildKey(projectId: string, sessionId: string): string {
    return `${projectId}/${sessionId}`;
  }

  /**
   * Parse a cache key into project and session IDs.
   */
  static parseKey(key: string): { projectId: string; sessionId: string } | null {
    const parts = key.split('/');
    if (parts.length !== 2) return null;
    return { projectId: parts[0], sessionId: parts[1] };
  }

  // ===========================================================================
  // Invalidation
  // ===========================================================================

  /**
   * Invalidates a specific cache entry.
   * @param key - Cache key to invalidate
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidates a cache entry by project and session IDs.
   */
  invalidateSession(projectId: string, sessionId: string): void {
    const keysToDelete: string[] = [];
    const sessionToken = `-${sessionId}-`;

    for (const key of this.cache.keys()) {
      const parsed = DataCache.parseKey(key);
      if (
        parsed?.sessionId === sessionId &&
        this.matchesProjectOrComposite(parsed.projectId, projectId)
      ) {
        keysToDelete.push(key);
        continue;
      }

      if (this.isSubagentKeyForProject(key, projectId) && key.includes(sessionToken)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Invalidates all cached subagent details for a session.
   */
  invalidateSubagentSession(projectId: string, sessionId: string): void {
    const sessionToken = `-${sessionId}-`;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (this.isSubagentKeyForProject(key, projectId) && key.includes(sessionToken)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Invalidates all cache entries for a project.
   * @param projectId - The project ID
   */
  invalidateProject(projectId: string): void {
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      const parsed = DataCache.parseKey(key);
      if (parsed && this.matchesProjectOrComposite(parsed.projectId, projectId)) {
        keysToDelete.push(key);
        continue;
      }

      if (this.isSubagentKeyForProject(key, projectId)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Gets current cache size.
   * @returns Number of entries in the cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Gets cache statistics.
   * @returns Object with cache stats
   */
  stats(): {
    size: number;
    maxSize: number;
    ttlMinutes: number;
    keys: string[];
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMinutes: this.ttl / 60000,
      keys: Array.from(this.cache.keys()),
    };
  }

  /**
   * Removes expired and outdated entries from the cache.
   * Should be called periodically to prevent memory bloat.
   */
  cleanExpired(): number {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      // Remove if expired OR outdated version
      if (now - entry.timestamp > this.ttl || entry.version !== DataCache.CURRENT_VERSION) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }

    if (keysToDelete.length > 0) {
      logger.info(`DataCache: Cleaned ${keysToDelete.length} expired/outdated entries`);
    }

    return keysToDelete.length;
  }

  /**
   * Starts automatic cleanup of expired entries.
   * @param intervalMinutes - How often to run cleanup (default: 5 minutes)
   * @returns Timer handle that can be used to stop cleanup
   */
  startAutoCleanup(intervalMinutes: number = 5): NodeJS.Timeout {
    const intervalMs = intervalMinutes * 60 * 1000;
    return setInterval(() => {
      this.cleanExpired();
    }, intervalMs);
  }

  /**
   * Gets all cached session IDs for a project.
   */
  getProjectSessionIds(projectId: string): string[] {
    const sessionIds: string[] = [];

    for (const key of this.cache.keys()) {
      const parsed = DataCache.parseKey(key);
      if (parsed && this.matchesProjectOrComposite(parsed.projectId, projectId)) {
        sessionIds.push(parsed.sessionId);
      }
    }

    return sessionIds;
  }

  private matchesProjectOrComposite(projectId: string, baseProjectId: string): boolean {
    return projectId === baseProjectId || projectId.startsWith(`${baseProjectId}::`);
  }

  private isSubagentKeyForProject(key: string, baseProjectId: string): boolean {
    if (!key.startsWith('subagent-')) {
      return false;
    }
    const prefix = `subagent-${baseProjectId}`;
    return key.startsWith(`${prefix}-`) || key.startsWith(`${prefix}::`);
  }

  /**
   * Disposes the cache and prevents further use.
   * Clears all cached data and disables caching.
   *
   * Note: The auto-cleanup interval returned by startAutoCleanup() is managed
   * by the caller (ServiceContext), not stored internally, so we only need to
   * clear the cache and disable it.
   */
  dispose(): void {
    if (this.disposed) {
      logger.info('DataCache already disposed');
      return;
    }

    logger.info('Disposing DataCache');

    // Clear all cached data
    this.cache.clear();

    // Disable caching
    this.enabled = false;

    // Mark as disposed
    this.disposed = true;

    logger.info('DataCache disposed');
  }
}
