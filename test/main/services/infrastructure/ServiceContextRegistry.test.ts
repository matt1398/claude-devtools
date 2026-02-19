import { describe, expect, it, vi } from 'vitest';

import { ServiceContextRegistry } from '../../../../src/main/services/infrastructure/ServiceContextRegistry';

import type { ServiceContext } from '../../../../src/main/services/infrastructure/ServiceContext';

function createMockContext(
  id: string,
  type: 'local' | 'ssh',
  rootId: string
): ServiceContext {
  return {
    id,
    type,
    rootId,
    rootName: rootId,
    stopFileWatcher: vi.fn(),
    startFileWatcher: vi.fn(),
    dispose: vi.fn(),
  } as unknown as ServiceContext;
}

describe('ServiceContextRegistry', () => {
  it('rejects duplicate context registration', () => {
    const registry = new ServiceContextRegistry();
    const local = createMockContext('local', 'local', 'default-local');

    registry.registerContext(local);

    expect(() => registry.registerContext(local)).toThrow('Context already registered: local');
  });

  it('switch stops previous watcher and starts target watcher', () => {
    const registry = new ServiceContextRegistry();
    const local = createMockContext('local', 'local', 'default-local');
    const ssh = createMockContext('ssh-server-1234', 'ssh', 'ssh-root-1');
    registry.registerContext(local);
    registry.registerContext(ssh);

    const result = registry.switch(ssh.id);

    expect(result.previous.id).toBe(local.id);
    expect(result.current.id).toBe(ssh.id);
    expect(local.stopFileWatcher).toHaveBeenCalledTimes(1);
    expect(ssh.startFileWatcher).toHaveBeenCalledTimes(1);
  });

  it('throws when switching to an unknown context', () => {
    const registry = new ServiceContextRegistry();
    registry.registerContext(createMockContext('local', 'local', 'default-local'));

    expect(() => registry.switch('missing-context')).toThrow(
      'Cannot switch to unknown context: missing-context'
    );
  });

  it('replaceContext swaps and disposes previous instance', () => {
    const registry = new ServiceContextRegistry();
    const local = createMockContext('local', 'local', 'default-local');
    const replacement = createMockContext('local', 'local', 'default-local');
    registry.registerContext(local);

    registry.replaceContext('local', replacement);

    expect(local.dispose).toHaveBeenCalledTimes(1);
    expect(registry.get('local')).toBe(replacement);
    expect(registry.getActiveContextId()).toBe('local');
  });

  it('replaceContext throws when context is missing', () => {
    const registry = new ServiceContextRegistry();
    const replacement = createMockContext('local', 'local', 'default-local');

    expect(() => registry.replaceContext('missing', replacement)).toThrow(
      'Context not found: missing'
    );
  });

  it('replaceContext throws when replacement id mismatches target id', () => {
    const registry = new ServiceContextRegistry();
    const local = createMockContext('local', 'local', 'default-local');
    const replacement = createMockContext('local-2', 'local', 'local-2');
    registry.registerContext(local);

    expect(() => registry.replaceContext('local', replacement)).toThrow(
      'Replacement context ID mismatch: expected "local", got "local-2"'
    );
  });

  it('replaceContext no-ops when replacement is same instance', () => {
    const registry = new ServiceContextRegistry();
    const local = createMockContext('local', 'local', 'default-local');
    registry.registerContext(local);

    registry.replaceContext('local', local);

    expect(local.dispose).not.toHaveBeenCalled();
    expect(registry.get('local')).toBe(local);
  });

  it('switches to remaining context when active one is destroyed', () => {
    const registry = new ServiceContextRegistry();
    const local = createMockContext('local', 'local', 'default-local');
    const ssh = createMockContext('ssh-server-1234', 'ssh', 'ssh-root-1');

    registry.registerContext(local);
    registry.registerContext(ssh);
    registry.switch(ssh.id);
    registry.destroy(ssh.id);

    expect(registry.getActiveContextId()).toBe(local.id);
    expect(local.startFileWatcher).not.toHaveBeenCalled();
  });

  it('cannot destroy the last remaining context', () => {
    const registry = new ServiceContextRegistry();
    const local = createMockContext('local', 'local', 'default-local');
    registry.registerContext(local);

    expect(() => registry.destroy(local.id)).toThrow('last remaining context');
  });

  it('finds contexts by root id', () => {
    const registry = new ServiceContextRegistry();
    const local = createMockContext('local', 'local', 'default-local');
    registry.registerContext(local);

    expect(registry.getByRootId('default-local')?.id).toBe('local');
    expect(registry.getByRootId('missing-root')).toBeUndefined();
  });

  it('lists enriched context metadata', () => {
    const registry = new ServiceContextRegistry();
    registry.registerContext(createMockContext('local', 'local', 'default-local'));
    registry.registerContext(createMockContext('ssh-server-1234', 'ssh', 'ssh-root-1'));

    expect(registry.list()).toEqual([
      {
        id: 'local',
        type: 'local',
        rootId: 'default-local',
        rootName: 'default-local',
      },
      {
        id: 'ssh-server-1234',
        type: 'ssh',
        rootId: 'ssh-root-1',
        rootName: 'ssh-root-1',
      },
    ]);
  });
});
