import { describe, expect, it, vi } from 'vitest';

import { applyRootLifecycleCallbacks } from '../../../src/main/utils/rootLifecycleCallbacks';

import type { DataRoot } from '../../../src/shared/types/roots';

interface RootConfigSnapshot {
  roots: {
    items: DataRoot[];
    activeRootId: string;
  };
}

describe('rootLifecycleCallbacks', () => {
  it('invokes add, update, remove, and activate callbacks from root diffs', async () => {
    const previousConfig: RootConfigSnapshot = {
      roots: {
        items: [
          {
            id: 'local-1',
            name: 'Local',
            type: 'local',
            claudeRootPath: null,
            order: 0,
          },
          {
            id: 'ssh-1',
            name: 'Remote A',
            type: 'ssh',
            sshProfileId: 'profile-a',
            remoteClaudeRootPath: null,
            order: 1,
          },
        ],
        activeRootId: 'local-1',
      },
    };
    const updatedConfig: RootConfigSnapshot = {
      roots: {
        items: [
          {
            id: 'local-1',
            name: 'Local Updated',
            type: 'local',
            claudeRootPath: null,
            order: 0,
          },
          {
            id: 'ssh-2',
            name: 'Remote B',
            type: 'ssh',
            sshProfileId: 'profile-b',
            remoteClaudeRootPath: '/srv/.claude',
            order: 1,
          },
        ],
        activeRootId: 'ssh-2',
      },
    };

    const onRootAdded = vi.fn();
    const onRootUpdated = vi.fn();
    const onRootRemoved = vi.fn();
    const onRootActivated = vi.fn();

    await applyRootLifecycleCallbacks(previousConfig, updatedConfig, {
      onRootAdded,
      onRootUpdated,
      onRootRemoved,
      onRootActivated,
    });

    expect(onRootRemoved).toHaveBeenCalledTimes(1);
    expect(onRootRemoved).toHaveBeenCalledWith('ssh-1');
    expect(onRootUpdated).toHaveBeenCalledTimes(1);
    expect(onRootUpdated).toHaveBeenCalledWith(updatedConfig.roots.items[0]);
    expect(onRootAdded).toHaveBeenCalledTimes(1);
    expect(onRootAdded).toHaveBeenCalledWith(updatedConfig.roots.items[1]);
    expect(onRootActivated).toHaveBeenCalledTimes(1);
    expect(onRootActivated).toHaveBeenCalledWith('ssh-2');
  });

  it('does not invoke callbacks when roots are unchanged', async () => {
    const config: RootConfigSnapshot = {
      roots: {
        items: [
          {
            id: 'local-1',
            name: 'Local',
            type: 'local',
            claudeRootPath: null,
            order: 0,
          },
        ],
        activeRootId: 'local-1',
      },
    };

    const onRootAdded = vi.fn();
    const onRootUpdated = vi.fn();
    const onRootRemoved = vi.fn();
    const onRootActivated = vi.fn();

    await applyRootLifecycleCallbacks(config, config, {
      onRootAdded,
      onRootUpdated,
      onRootRemoved,
      onRootActivated,
    });

    expect(onRootAdded).not.toHaveBeenCalled();
    expect(onRootUpdated).not.toHaveBeenCalled();
    expect(onRootRemoved).not.toHaveBeenCalled();
    expect(onRootActivated).not.toHaveBeenCalled();
  });
});
