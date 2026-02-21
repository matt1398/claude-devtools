import { createLogger } from '@shared/utils/logger';

import type { ServiceContext, ServiceContextRegistry } from '@main/services';
import type { GlobalSessionFileInfo } from '@main/services/discovery/ProjectScanner';
import type { HttpServer } from '@main/services/infrastructure/HttpServer';
import type { FileChangeEvent } from '@main/types';
import type { BrowserWindow } from 'electron';

const logger = createLogger('Utils:CombinedWatcherManager');

const CACHE_TTL_MS = 30_000;
const CACHE_TOP_K = 50;
const MAX_CACHE_FETCH_ATTEMPTS = 2;

interface CombinedWatcherCallbacks {
  teardownSingleContextListeners: () => void;
  restoreSingleContextListeners: (context: ServiceContext) => void;
  getMainWindow: () => BrowserWindow | null;
  getHttpServer: () => HttpServer | null;
}

interface CacheEntry {
  fileInfos: GlobalSessionFileInfo[];
  cachedAt: number;
}

export class CombinedWatcherManager {
  private readonly registry: ServiceContextRegistry;
  private readonly callbacks: CombinedWatcherCallbacks;
  private enabled = false;
  private cleanupEntries: { contextId: string; cleanup: () => void }[] = [];
  private cache = new Map<string, CacheEntry>();
  /** Per-context generation counter — bumped on invalidation to detect stale fetches. */
  private cacheGeneration = new Map<string, number>();

  constructor(registry: ServiceContextRegistry, callbacks: CombinedWatcherCallbacks) {
    this.registry = registry;
    this.callbacks = callbacks;
    this.registry.onWillDestroy((contextId) => {
      this.handleContextRemoved(contextId);
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Returns the max number of file infos cached per context. */
  getCacheTopK(): number {
    return CACHE_TOP_K;
  }

  enable(): void {
    if (this.enabled) {
      return;
    }

    this.callbacks.teardownSingleContextListeners();
    this.enabled = true;
    this.registry.combinedMode = true;

    for (const context of this.registry.getAll()) {
      this.wireContext(context);
    }

    logger.info('Combined watcher mode enabled');
  }

  disable(): void {
    if (!this.enabled) {
      return;
    }

    for (const entry of this.cleanupEntries) {
      entry.cleanup();
    }
    this.cleanupEntries = [];

    for (const context of this.registry.getAll()) {
      if (context.id !== this.registry.getActiveContextId()) {
        context.stopFileWatcher();
      }
    }

    this.registry.combinedMode = false;
    this.enabled = false;
    this.cache.clear();
    this.cacheGeneration.clear();

    const activeContext = this.registry.getActive();
    // Ensure active watcher is running before restoring listeners — idempotent if already started.
    activeContext.startFileWatcher();
    this.callbacks.restoreSingleContextListeners(activeContext);

    logger.info('Combined watcher mode disabled');
  }

  handleContextAdded(context: ServiceContext): void {
    this.invalidateCache(context.id);
    if (!this.enabled) {
      return;
    }
    this.wireContext(context);
  }

  handleContextRemoved(contextId: string): void {
    this.invalidateCache(contextId);
    if (!this.enabled) {
      return;
    }
    const entries = this.cleanupEntries.filter((entry) => entry.contextId === contextId);
    for (const entry of entries) {
      entry.cleanup();
    }
    this.cleanupEntries = this.cleanupEntries.filter((entry) => entry.contextId !== contextId);
  }

  /**
   * Re-wire listeners for a context whose file watcher was replaced (e.g., SSH reconnect).
   * Detaches old listeners and attaches new ones to the (potentially new) watcher instance.
   */
  handleContextRewire(context: ServiceContext): void {
    this.invalidateCache(context.id);
    if (!this.enabled) {
      return;
    }
    // Detach old listeners
    const entries = this.cleanupEntries.filter((entry) => entry.contextId === context.id);
    for (const entry of entries) {
      entry.cleanup();
    }
    this.cleanupEntries = this.cleanupEntries.filter((entry) => entry.contextId !== context.id);
    // Re-wire with the (potentially new) watcher
    this.wireContext(context);
  }

  invalidateCache(contextId: string): void {
    this.cache.delete(contextId);
    this.cacheGeneration.set(contextId, (this.cacheGeneration.get(contextId) ?? 0) + 1);
  }

  async getCachedSessionFileInfos(context: ServiceContext): Promise<GlobalSessionFileInfo[] | null> {
    for (let attempt = 0; attempt < MAX_CACHE_FETCH_ATTEMPTS; attempt += 1) {
      const existing = this.cache.get(context.id);
      if (existing && Date.now() - existing.cachedAt <= CACHE_TTL_MS) {
        return existing.fileInfos;
      }

      // Capture generation before async work to detect concurrent invalidations.
      const genBefore = this.cacheGeneration.get(context.id) ?? 0;

      try {
        const fileInfos = await context.projectScanner.listRecentSessionFileInfosGlobal(CACHE_TOP_K);
        const genAfter = this.cacheGeneration.get(context.id) ?? 0;
        // Only write and return fetched data if no invalidation occurred during the fetch.
        if (genAfter === genBefore) {
          this.cache.set(context.id, {
            fileInfos,
            cachedAt: Date.now(),
          });
          return fileInfos;
        }
      } catch (error) {
        logger.debug(`Failed to populate combined cache for context "${context.id}"`, error);
        return null;
      }
    }

    logger.debug(
      `Combined cache fetch invalidated repeatedly for context "${context.id}"; falling back to uncached scan`
    );
    return null;
  }

  private wireContext(context: ServiceContext): void {
    context.startFileWatcher();

    // Capture the watcher reference at wire time — the context's watcher property
    // may be replaced later (e.g., SSH reconnect), so cleanup must target the
    // specific instance we attached listeners to.
    const watcher = context.fileWatcher;

    const fileHandler = (event: FileChangeEvent): void => {
      this.invalidateCache(context.id);
      const enriched: FileChangeEvent = {
        ...event,
        contextId: context.id,
      };
      const mainWindow = this.callbacks.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-change', enriched);
      }
      this.callbacks.getHttpServer()?.broadcast('file-change', enriched);
    };

    const todoHandler = (event: FileChangeEvent): void => {
      const enriched: FileChangeEvent = {
        ...event,
        contextId: context.id,
      };
      const mainWindow = this.callbacks.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('todo-change', enriched);
      }
      this.callbacks.getHttpServer()?.broadcast('todo-change', enriched);
    };

    watcher.on('file-change', fileHandler);
    watcher.on('todo-change', todoHandler);

    this.cleanupEntries.push({
      contextId: context.id,
      cleanup: () => {
        watcher.off('file-change', fileHandler);
        watcher.off('todo-change', todoHandler);
      },
    });
  }
}
