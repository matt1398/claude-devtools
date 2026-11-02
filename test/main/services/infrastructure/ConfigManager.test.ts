import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ConfigManager,
  resolveConfigPath,
} from '../../../../src/main/services/infrastructure/ConfigManager';

// The Docker image mounts ~/.claude read-only, so the default config path is
// not writable there and settings were lost on restart (#178). The override is
// what lets the container keep its config on a writable mount.

const DEFAULT_PATH = path.join(
  os.homedir(),
  '.claude',
  'claude-devtools-config.json'
);

describe('ConfigManager config path', () => {
  const original = process.env.CLAUDE_DEVTOOLS_CONFIG_PATH;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CLAUDE_DEVTOOLS_CONFIG_PATH;
    } else {
      process.env.CLAUDE_DEVTOOLS_CONFIG_PATH = original;
    }
  });

  it('defaults to ~/.claude/claude-devtools-config.json', () => {
    delete process.env.CLAUDE_DEVTOOLS_CONFIG_PATH;

    expect(resolveConfigPath()).toBe(DEFAULT_PATH);
  });

  it('honours CLAUDE_DEVTOOLS_CONFIG_PATH for a writable mount', () => {
    const target = path.join(
      os.tmpdir(),
      'devtools-state',
      'claude-devtools-config.json'
    );
    process.env.CLAUDE_DEVTOOLS_CONFIG_PATH = target;

    expect(resolveConfigPath()).toBe(target);

    const manager = new ConfigManager();
    expect(manager.getConfigPath()).toBe(target);
  });

  it('ignores a blank override', () => {
    process.env.CLAUDE_DEVTOOLS_CONFIG_PATH = '   ';

    expect(resolveConfigPath()).toBe(DEFAULT_PATH);
  });

  it('prefers the env override over a caller-provided default directory', () => {
    const target = path.join(os.tmpdir(), 'devtools-state', 'custom.json');
    process.env.CLAUDE_DEVTOOLS_CONFIG_PATH = target;

    expect(resolveConfigPath('/data/.claude')).toBe(target);
  });

  it('uses the caller-provided default directory when there is no override', () => {
    delete process.env.CLAUDE_DEVTOOLS_CONFIG_PATH;

    expect(resolveConfigPath('/data/.claude')).toBe(
      path.join('/data/.claude', 'claude-devtools-config.json')
    );
  });
});
