import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceContextRegistry } from '../../../src/main/services/infrastructure/ServiceContextRegistry';
import { CombinedWatcherManager } from '../../../src/main/utils/combinedWatcherManager';

import type { HttpServer } from '../../../src/main/services/infrastructure/HttpServer';
import type { ServiceContext } from '../../../src/main/services/infrastructure/ServiceContext';
import type { FileChangeEvent } from '../../../src/main/types';
import type { GlobalSessionFileInfo } from '../../../src/main/services/discovery/ProjectScanner';
import type { BrowserWindow } from 'electron';

interface MockContext {
  context: ServiceContext;
  scannerMock: ReturnType<typeof vi.fn>;
  fileWatcher: EventEmitter;
  startFileWatcher: ReturnType<typeof vi.fn>;
  stopFileWatcher: ReturnType<typeof vi.fn>;
}

function createMockContext(
  id: string,
  type: 'local' | 'ssh',
  rootId: string,
  rootName: string
): MockContext {
  const fileWatcher = new EventEmitter();
  const scannerMock = vi.fn<() => Promise<GlobalSessionFileInfo[]>>().mockResolvedValue([
    {
      projectId: '-Users-test-project',
      sessionId: `${id}-session`,
      filePath: `/tmp/${id}-session.jsonl`,
      mtimeMs: 1000,
      birthtimeMs: 900,
      size: 100,
    },
  ]);
  const startFileWatcher = vi.fn();
  const stopFileWatcher = vi.fn();

  const context = {
    id,
    type,
    rootId,
    rootName,
    fileWatcher,
    projectScanner: {
      listRecentSessionFileInfosGlobal: scannerMock,
    },
    startFileWatcher,
    stopFileWatcher,
    dispose: vi.fn(),
  } as unknown as ServiceContext;

  return {
    context,
    scannerMock,
    fileWatcher,
    startFileWatcher,
    stopFileWatcher,
  };
}

describe('CombinedWatcherManager', () => {
  let registry: ServiceContextRegistry;
  let local: MockContext;
  let remote: MockContext;
  let send: ReturnType<typeof vi.fn>;
  let broadcast: ReturnType<typeof vi.fn>;
  let teardownSingleContextListeners: ReturnType<typeof vi.fn>;
  let restoreSingleContextListeners: ReturnType<typeof vi.fn>;
  let manager: CombinedWatcherManager;

  const event: FileChangeEvent = {
    type: 'add',
    path: '/tmp/session.jsonl',
    projectId: '-Users-test-project',
    sessionId: 'session-1',
    isSubagent: false,
  };

  beforeEach(() => {
    registry = new ServiceContextRegistry();
    local = createMockContext('local', 'local', 'default-local', 'Local');
    remote = createMockContext('ssh-context', 'ssh', 'ssh-root-1', 'Remote');
    registry.registerContext(local.context);
    registry.registerContext(remote.context);

    send = vi.fn();
    broadcast = vi.fn();
    teardownSingleContextListeners = vi.fn();
    restoreSingleContextListeners = vi.fn();

    manager = new CombinedWatcherManager(registry, {
      teardownSingleContextListeners,
      restoreSingleContextListeners,
      getMainWindow: () =>
        ({
          isDestroyed: () => false,
          webContents: {
            send,
          },
        }) as unknown as BrowserWindow,
      getHttpServer: () =>
        ({
          broadcast,
        }) as unknown as HttpServer,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enables combined watchers and enriches file/todo events with contextId', () => {
    manager.enable();

    expect(teardownSingleContextListeners).toHaveBeenCalledTimes(1);
    expect(registry.combinedMode).toBe(true);
    expect(local.startFileWatcher).toHaveBeenCalledTimes(1);
    expect(remote.startFileWatcher).toHaveBeenCalledTimes(1);

    remote.fileWatcher.emit('file-change', event);
    expect(send).toHaveBeenCalledWith(
      'file-change',
      expect.objectContaining({
        contextId: remote.context.id,
        projectId: event.projectId,
        sessionId: event.sessionId,
      })
    );
    expect(broadcast).toHaveBeenCalledWith(
      'file-change',
      expect.objectContaining({ contextId: remote.context.id })
    );

    remote.fileWatcher.emit('todo-change', event);
    expect(send).toHaveBeenCalledWith(
      'todo-change',
      expect.objectContaining({ contextId: remote.context.id })
    );
    expect(broadcast).toHaveBeenCalledWith(
      'todo-change',
      expect.objectContaining({ contextId: remote.context.id })
    );
  });

  it('disables combined watchers, restores single-context ownership, and removes listeners', () => {
    manager.enable();
    remote.fileWatcher.emit('file-change', event);
    const callCountBeforeDisable = send.mock.calls.length;

    manager.disable();

    expect(registry.combinedMode).toBe(false);
    expect(restoreSingleContextListeners).toHaveBeenCalledWith(local.context);
    expect(remote.stopFileWatcher).toHaveBeenCalledTimes(1);
    // Active context watcher must NOT be stopped — it stays alive for single-context mode
    expect(local.stopFileWatcher).not.toHaveBeenCalled();

    remote.fileWatcher.emit('file-change', event);
    expect(send).toHaveBeenCalledTimes(callCountBeforeDisable);
  });

  it('invalidates and repopulates cached file infos on file-change events', async () => {
    manager.enable();

    await manager.getCachedSessionFileInfos(remote.context);
    await manager.getCachedSessionFileInfos(remote.context);
    expect(remote.scannerMock).toHaveBeenCalledTimes(1);

    remote.fileWatcher.emit('file-change', event);
    await manager.getCachedSessionFileInfos(remote.context);
    expect(remote.scannerMock).toHaveBeenCalledTimes(2);
  });

  it('retries cache fetch when invalidated during an in-flight scan', async () => {
    manager.enable();

    let resolveFirstFetch: ((value: GlobalSessionFileInfo[]) => void) | null = null;
    const firstFetch = new Promise<GlobalSessionFileInfo[]>((resolve) => {
      resolveFirstFetch = resolve;
    });
    const freshFileInfos: GlobalSessionFileInfo[] = [
      {
        projectId: '-Users-test-project',
        sessionId: 'fresh-session',
        filePath: '/tmp/fresh-session.jsonl',
        mtimeMs: 2000,
        birthtimeMs: 1900,
        size: 110,
      },
    ];
    remote.scannerMock.mockImplementationOnce(() => firstFetch).mockResolvedValueOnce(freshFileInfos);

    const pending = manager.getCachedSessionFileInfos(remote.context);
    await vi.waitFor(() => expect(remote.scannerMock).toHaveBeenCalledTimes(1));

    // Simulate a file watcher invalidation while the first read is still in flight.
    remote.fileWatcher.emit('file-change', event);

    resolveFirstFetch?.([
      {
        projectId: '-Users-test-project',
        sessionId: 'stale-session',
        filePath: '/tmp/stale-session.jsonl',
        mtimeMs: 1000,
        birthtimeMs: 900,
        size: 100,
      },
    ]);

    await expect(pending).resolves.toEqual(freshFileInfos);
    expect(remote.scannerMock).toHaveBeenCalledTimes(2);
  });

  it('handles context add/remove while enabled without leaking listeners', () => {
    manager.enable();

    const extra = createMockContext('ssh-extra', 'ssh', 'ssh-root-2', 'Remote 2');
    registry.registerContext(extra.context);
    manager.handleContextAdded(extra.context);
    expect(extra.startFileWatcher).toHaveBeenCalledTimes(1);

    extra.fileWatcher.emit('file-change', event);
    expect(send).toHaveBeenCalledWith(
      'file-change',
      expect.objectContaining({ contextId: extra.context.id })
    );

    const callsBeforeRemoval = send.mock.calls.length;
    manager.handleContextRemoved(extra.context.id);
    extra.fileWatcher.emit('file-change', event);
    expect(send).toHaveBeenCalledTimes(callsBeforeRemoval);
  });

  it('prunes listeners when contexts are destroyed through the registry', () => {
    manager.enable();

    remote.fileWatcher.emit('file-change', event);
    const callsBeforeDestroy = send.mock.calls.length;

    registry.destroy(remote.context.id);
    remote.fileWatcher.emit('file-change', event);

    expect(send).toHaveBeenCalledTimes(callsBeforeDestroy);
  });

  it('preserves correct watcher after enable → switch context → disable', () => {
    manager.enable();

    // Switch active context from local → remote while combined mode is on
    // registry.switch() skips watcher stop/start because combinedMode === true
    registry.switch(remote.context.id);
    expect(local.stopFileWatcher).not.toHaveBeenCalled(); // combinedMode skips stop
    expect(remote.startFileWatcher).toHaveBeenCalledTimes(1); // only from enable(), not switch()

    // Now disable combined mode — should preserve the NEW active context (remote)
    // and stop the OLD active context (local)
    manager.disable();

    // Remote is now active — must NOT be stopped
    expect(remote.stopFileWatcher).not.toHaveBeenCalled();
    // Local is now non-active — must be stopped
    expect(local.stopFileWatcher).toHaveBeenCalledTimes(1);
    // Single-context wiring restored for the new active context (remote)
    expect(restoreSingleContextListeners).toHaveBeenCalledWith(remote.context);

    // Verify no stale listeners: events from local should not fire
    const callsAfterDisable = send.mock.calls.length;
    local.fileWatcher.emit('file-change', event);
    expect(send).toHaveBeenCalledTimes(callsAfterDisable);
  });

  it('re-wires listeners on context rewire (SSH reconnect)', () => {
    manager.enable();

    // Emit an event — should be forwarded
    remote.fileWatcher.emit('file-change', event);
    const callsBeforeRewire = send.mock.calls.length;

    // Simulate SSH reconnect: new watcher instance
    const newWatcher = new EventEmitter();
    (remote.context as unknown as { fileWatcher: EventEmitter }).fileWatcher = newWatcher;

    manager.handleContextRewire(remote.context);

    // Old watcher should no longer forward events
    remote.fileWatcher.emit('file-change', event);
    // (remote.fileWatcher still points to old emitter in our test variable)
    // But since we replaced context.fileWatcher, the old emitter's listener was removed
    // Let's verify via the new watcher:
    newWatcher.emit('file-change', event);
    expect(send).toHaveBeenCalledTimes(callsBeforeRewire + 1);
    expect(send).toHaveBeenLastCalledWith(
      'file-change',
      expect.objectContaining({ contextId: remote.context.id })
    );

    // No duplicate listeners on the new watcher
    expect(newWatcher.listenerCount('file-change')).toBe(1);
    expect(newWatcher.listenerCount('todo-change')).toBe(1);
  });

  it('does not duplicate listeners across enable/disable/enable lifecycle', () => {
    manager.enable();
    manager.disable();
    manager.enable();

    expect(remote.fileWatcher.listenerCount('file-change')).toBe(1);
    expect(remote.fileWatcher.listenerCount('todo-change')).toBe(1);

    remote.fileWatcher.emit('file-change', event);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
