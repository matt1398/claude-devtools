/**
 * ServiceContextRegistry - Manages the Map of ServiceContext instances.
 *
 * Responsibilities:
 * - Register and track all ServiceContext instances (local + SSH)
 * - Track active context ID
 * - Handle context switching (stop old watcher, start new watcher)
 * - Enforce lifecycle rules (local context cannot be destroyed)
 * - Provide safe disposal of contexts
 *
 * Lifecycle:
 * - App startup: registry created, local context registered
 * - SSH connect: new SSH context registered
 * - Context switch: switch() stops old watcher, starts new watcher
 * - SSH disconnect: destroy() removes SSH context
 * - App shutdown: dispose() cleans up all contexts
 */

import { createLogger } from '@shared/utils/logger';

import { type ServiceContext } from './ServiceContext';

const logger = createLogger('Infrastructure:ServiceContextRegistry');

/**
 * ServiceContextRegistry - Coordinator for all service contexts.
 *
 * Manages a Map of ServiceContext instances and tracks which one is active.
 * Enforces the rule that the 'local' context is permanent and cannot be destroyed.
 */
export class ServiceContextRegistry {
  private contexts = new Map<string, ServiceContext>();
  private activeContextId: string = '';
  private _combinedMode = false;
  private destroyListeners = new Set<(contextId: string, context: ServiceContext) => void>();

  get combinedMode(): boolean {
    return this._combinedMode;
  }

  set combinedMode(value: boolean) {
    this._combinedMode = value;
  }

  /**
   * Creates a new ServiceContextRegistry.
   * Does NOT create the local context - that must be done externally
   * where mainWindow and NotificationManager wiring exists.
   */
  constructor() {
    logger.info('ServiceContextRegistry created');
  }

  /**
   * Registers a listener invoked before a context is disposed and removed via destroy().
   * Returns an unsubscribe function.
   */
  onWillDestroy(listener: (contextId: string, context: ServiceContext) => void): () => void {
    this.destroyListeners.add(listener);
    return () => {
      this.destroyListeners.delete(listener);
    };
  }

  /**
   * Registers a new context.
   * @throws Error if a context with the same ID already exists
   */
  registerContext(context: ServiceContext): void {
    if (this.contexts.has(context.id)) {
      throw new Error(`Context already registered: ${context.id}`);
    }

    this.contexts.set(context.id, context);
    if (!this.activeContextId) {
      this.activeContextId = context.id;
    }
    logger.info(`Context registered: ${context.id} (${context.type})`);
  }

  /**
   * Replaces an existing context instance in-place (same context ID).
   * Used for local-context reconfiguration without changing activeContextId semantics.
   *
   * @throws Error if context does not exist or replacement ID mismatches
   */
  replaceContext(contextId: string, replacement: ServiceContext): void {
    const existing = this.contexts.get(contextId);
    if (!existing) {
      throw new Error(`Context not found: ${contextId}`);
    }

    if (replacement.id !== contextId) {
      throw new Error(
        `Replacement context ID mismatch: expected "${contextId}", got "${replacement.id}"`
      );
    }

    if (existing === replacement) {
      return;
    }

    this.contexts.set(contextId, replacement);
    existing.dispose();
    logger.info(`Context replaced: ${contextId} (${replacement.type})`);
  }

  /**
   * Gets the active ServiceContext.
   * @throws Error if active context not found (should never happen)
   */
  getActive(): ServiceContext {
    const context = this.contexts.get(this.activeContextId);
    if (!context) {
      throw new Error(`Active context not found: ${this.activeContextId}`);
    }
    return context;
  }

  /**
   * Gets a context by ID.
   * @returns ServiceContext or undefined if not found
   */
  get(contextId: string): ServiceContext | undefined {
    return this.contexts.get(contextId);
  }

  /**
   * Gets all contexts.
   */
  getAll(): ServiceContext[] {
    return Array.from(this.contexts.values());
  }

  /**
   * Gets a context by root ID.
   */
  getByRootId(rootId: string): ServiceContext | undefined {
    return Array.from(this.contexts.values()).find((context) => context.rootId === rootId);
  }

  /**
   * Checks if a context exists.
   */
  has(contextId: string): boolean {
    return this.contexts.has(contextId);
  }

  /**
   * Switches to a different context.
   * Stops the file watcher on the previous context and starts it on the new one.
   *
   * @param contextId - ID of context to switch to
   * @returns Object containing previous and current contexts for IPC re-init
   * @throws Error if target context not found
   */
  switch(contextId: string): { previous: ServiceContext; current: ServiceContext } {
    if (!this.contexts.has(contextId)) {
      throw new Error(`Cannot switch to unknown context: ${contextId}`);
    }

    const previous = this.getActive();
    const current = this.contexts.get(contextId)!;

    if (previous.id === current.id) {
      logger.info(`Already on context: ${contextId}`);
      return { previous, current };
    }

    logger.info(`Switching context: ${previous.id} → ${current.id}`);

    // Stop file watcher on previous context (pause, don't dispose)
    if (!this.combinedMode) {
      previous.stopFileWatcher();
    }

    // Update active context
    this.activeContextId = contextId;

    // Start file watcher on new context
    if (!this.combinedMode) {
      current.startFileWatcher();
    }

    logger.info(`Context switched: ${current.id} is now active`);

    return { previous, current };
  }

  /**
   * Destroys a context and removes it from the registry.
   * If the destroyed context was active, marks the first remaining context as active.
   * Caller is responsible for re-wiring and starting the new active watcher.
   *
   * @param contextId - ID of context to destroy
   * @throws Error if attempting to destroy the 'local' context
   * @throws Error if context not found
   */
  destroy(contextId: string): void {
    if (this.contexts.size <= 1) {
      throw new Error('Cannot destroy the last remaining context');
    }

    const context = this.contexts.get(contextId);
    if (!context) {
      throw new Error(`Context not found: ${contextId}`);
    }

    logger.info(`Destroying context: ${contextId}`);

    for (const listener of this.destroyListeners) {
      try {
        listener(contextId, context);
      } catch (error) {
        logger.error(`Destroy listener failed for context "${contextId}":`, error);
      }
    }

    // Dispose the context
    context.dispose();

    // Remove from map
    this.contexts.delete(contextId);

    // If this was the active context, switch to first remaining context
    if (this.activeContextId === contextId) {
      const fallback = this.contexts.values().next().value;
      if (fallback) {
        logger.info(`Destroyed context was active, switching to ${fallback.id}`);
        this.activeContextId = fallback.id;
      }
    }

    logger.info(`Context destroyed: ${contextId}`);
  }

  /**
   * Lists all registered contexts.
   * @returns Array of context metadata
   */
  list(): { id: string; type: 'local' | 'ssh'; rootId: string; rootName: string }[] {
    return Array.from(this.contexts.values()).map((context) => ({
      id: context.id,
      type: context.type,
      rootId: context.rootId,
      rootName: context.rootName,
    }));
  }

  /**
   * Gets the active context ID.
   */
  getActiveContextId(): string {
    return this.activeContextId;
  }

  /**
   * Disposes ALL contexts (including local).
   * Used only on app shutdown.
   */
  dispose(): void {
    logger.info('Disposing ServiceContextRegistry and all contexts');

    for (const context of this.contexts.values()) {
      context.dispose();
    }

    this.contexts.clear();

    logger.info('ServiceContextRegistry disposed');
  }
}
