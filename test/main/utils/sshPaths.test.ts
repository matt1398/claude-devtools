import { describe, expect, it } from 'vitest';

import { resolveRemoteWorkspacePaths } from '../../../src/main/utils/sshPaths';

describe('resolveRemoteWorkspacePaths', () => {
  it('uses POSIX join semantics for custom remote Claude root paths', () => {
    const result = resolveRemoteWorkspacePaths('/home/test/.claude', null);

    expect(result).toEqual({
      remoteProjectsPath: '/home/test/.claude/projects',
      remoteTodosPath: '/home/test/.claude/todos',
    });
  });

  it('derives todos path from detected remote projects path when custom root is absent', () => {
    const result = resolveRemoteWorkspacePaths(null, '/srv/claude/projects');

    expect(result).toEqual({
      remoteProjectsPath: '/srv/claude/projects',
      remoteTodosPath: '/srv/claude/todos',
    });
  });

  it('returns undefined paths when no custom root or detected projects path exists', () => {
    const result = resolveRemoteWorkspacePaths(null, null);

    expect(result).toEqual({
      remoteProjectsPath: undefined,
      remoteTodosPath: undefined,
    });
  });
});
