import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigManager } from '../../../../src/main/services/infrastructure/ConfigManager';
import type { LocalDataRoot } from '../../../../src/shared/types/roots';

function createTempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-devtools-config-test-'));
  return path.join(dir, 'config.json');
}

describe('ConfigManager roots', () => {
  afterEach(() => {
    ConfigManager.resetInstance();
  });

  it('migrates legacy general.claudeRootPath into default local root', () => {
    const configPath = createTempConfigPath();
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        general: {
          claudeRootPath: '/tmp/legacy-claude',
        },
      }),
      'utf8'
    );

    const manager = new ConfigManager(configPath);
    const config = manager.getConfig();

    expect(config.roots.activeRootId).toBe('default-local');
    expect(config.roots.items).toHaveLength(1);
    expect(config.roots.items[0]).toMatchObject({
      id: 'default-local',
      type: 'local',
      claudeRootPath: path.resolve('/tmp/legacy-claude'),
    });
  });

  it('initializes a fresh install with default local root and null claudeRootPath', () => {
    const manager = new ConfigManager(createTempConfigPath());
    const config = manager.getConfig();

    expect(config.roots.items).toHaveLength(1);
    expect(config.roots.items[0]).toMatchObject({
      id: 'default-local',
      type: 'local',
      claudeRootPath: null,
      order: 0,
    });
    expect(config.roots.activeRootId).toBe('default-local');
    expect(config.general.claudeRootPath).toBeNull();
  });

  it('strips SSH roots that reference missing profiles during config load', () => {
    const configPath = createTempConfigPath();
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        roots: {
          items: [
            {
              id: 'default-local',
              name: 'Local',
              type: 'local',
              claudeRootPath: null,
              order: 0,
            },
            {
              id: 'ssh-root-1',
              name: 'Broken SSH Root',
              type: 'ssh',
              sshProfileId: 'missing-profile',
              remoteClaudeRootPath: null,
              order: 1,
            },
          ],
          activeRootId: 'ssh-root-1',
        },
        ssh: {
          profiles: [],
        },
      }),
      'utf8'
    );

    const manager = new ConfigManager(configPath);
    const config = manager.getConfig();

    expect(config.roots.items).toHaveLength(1);
    expect(config.roots.items[0]).toMatchObject({
      id: 'default-local',
      type: 'local',
    });
    expect(config.roots.activeRootId).toBe('default-local');
  });

  it('sanitizes roots during mergeWithDefaults using fallback id/name/order', () => {
    const configPath = createTempConfigPath();
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        roots: {
          items: [
            {
              id: '',
              name: '   ',
              type: 'local',
              claudeRootPath: '/tmp/local-root',
            },
            {
              type: 'ssh',
              sshProfileId: 'profile-1',
              remoteClaudeRootPath: ' /remote/.claude ',
            },
          ],
          activeRootId: 'missing-root-id',
        },
        ssh: {
          profiles: [
            {
              id: 'profile-1',
              name: 'Profile 1',
              host: 'example.com',
              port: 22,
              username: 'user',
              authMethod: 'agent',
            },
          ],
        },
      }),
      'utf8'
    );

    const manager = new ConfigManager(configPath);
    const config = manager.getConfig();

    expect(config.roots.items).toHaveLength(2);
    expect(config.roots.items[0]).toMatchObject({
      id: 'local-root-1',
      name: 'Local Root 1',
      type: 'local',
      order: 0,
    });
    expect(config.roots.items[1]).toMatchObject({
      id: 'ssh-root-2',
      name: 'SSH Root 2',
      type: 'ssh',
      sshProfileId: 'profile-1',
      remoteClaudeRootPath: '/remote/.claude',
      order: 1,
    });
    expect(config.roots.activeRootId).toBe('local-root-1');
  });

  it('rejects adding SSH root with missing profile', () => {
    const manager = new ConfigManager(createTempConfigPath());

    expect(() =>
      manager.addRoot({
        type: 'ssh',
        name: 'missing-profile-root',
        sshProfileId: 'missing-profile',
        remoteClaudeRootPath: null,
      })
    ).toThrow('SSH profile not found');
  });

  it('blocks removing SSH profiles still referenced by roots', () => {
    const manager = new ConfigManager(createTempConfigPath());

    manager.updateConfig('ssh', {
      profiles: [
        {
          id: 'profile-1',
          name: 'server',
          host: 'example.com',
          port: 22,
          username: 'user',
          authMethod: 'agent',
        },
      ],
    });
    manager.addRoot({
      type: 'ssh',
      name: 'server-root',
      sshProfileId: 'profile-1',
      remoteClaudeRootPath: null,
    });

    expect(() => manager.updateConfig('ssh', { profiles: [] })).toThrow(
      'Remove the root first'
    );
  });

  it('prevents deleting the last remaining root', () => {
    const manager = new ConfigManager(createTempConfigPath());

    expect(() => manager.removeRoot('default-local')).toThrow('Cannot remove the last root');
  });

  it('rejects deleting default-local even when other roots exist', () => {
    const manager = new ConfigManager(createTempConfigPath());
    manager.addRoot({
      type: 'local',
      name: 'Work',
      claudeRootPath: '/tmp/work',
    });

    expect(() => manager.removeRoot('default-local')).toThrow('Default local root cannot be removed');
  });

  it('rejects setting active root to a missing root id', () => {
    const manager = new ConfigManager(createTempConfigPath());

    expect(() => manager.setActiveRoot('does-not-exist')).toThrow('Root not found: does-not-exist');
  });

  it('falls back active root when roots.items update removes current active root', () => {
    const manager = new ConfigManager(createTempConfigPath());
    manager.addRoot({
      type: 'local',
      name: 'Work',
      claudeRootPath: '/tmp/work-claude',
    });

    const workRoot = manager
      .getConfig()
      .roots.items.find((root): root is LocalDataRoot => root.type === 'local' && root.name === 'Work');
    expect(workRoot).toBeDefined();

    manager.updateConfig('roots', {
      items: [
        {
          ...workRoot!,
          order: 0,
        },
      ],
    });

    const updated = manager.getConfig();
    expect(updated.roots.activeRootId).toBe(workRoot?.id);
  });

  it('rejects blank root names in updateRoot', () => {
    const manager = new ConfigManager(createTempConfigPath());

    expect(() => manager.updateRoot('default-local', { name: '   ' })).toThrow('Root name is required');
  });

  it('does not clear local claudeRootPath when update payload only includes type', () => {
    const manager = new ConfigManager(createTempConfigPath());
    manager.updateRoot('default-local', { claudeRootPath: '/tmp/custom-local-root' });

    const beforeTypeOnlyUpdate = manager.getRoot('default-local');
    expect(beforeTypeOnlyUpdate?.type).toBe('local');
    expect(beforeTypeOnlyUpdate?.claudeRootPath).toBe(path.resolve('/tmp/custom-local-root'));

    manager.updateRoot('default-local', { type: 'local' });

    const afterTypeOnlyUpdate = manager.getRoot('default-local');
    expect(afterTypeOnlyUpdate?.type).toBe('local');
    expect(afterTypeOnlyUpdate?.claudeRootPath).toBe(path.resolve('/tmp/custom-local-root'));
  });

  it('rejects root reorder payloads with duplicate ids', () => {
    const manager = new ConfigManager(createTempConfigPath());
    manager.addRoot({
      type: 'local',
      name: 'Work',
      claudeRootPath: null,
    });

    expect(() => manager.reorderRoots(['default-local', 'default-local'])).toThrow(
      'duplicate root IDs'
    );
  });
});
