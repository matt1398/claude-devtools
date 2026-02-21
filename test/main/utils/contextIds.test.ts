import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCAL_ROOT_ID,
  getContextIdForRoot,
  getLocalContextId,
  getRootIdForContextId,
} from '../../../src/main/utils/contextIds';

import type { SshConnectionProfile } from '../../../src/shared/types/api';
import type { DataRoot } from '../../../src/shared/types/roots';

describe('contextIds', () => {
  it('returns "local" for the default local root id', () => {
    expect(getLocalContextId(DEFAULT_LOCAL_ROOT_ID)).toBe('local');
  });

  it('builds ssh context id from root profile host and root id', () => {
    const root: DataRoot = {
      id: 'abcd1234wxyz',
      name: 'Remote Root',
      type: 'ssh',
      sshProfileId: 'profile-1',
      remoteClaudeRootPath: null,
      order: 1,
    };
    const profiles: SshConnectionProfile[] = [
      {
        id: 'profile-1',
        name: 'Primary',
        host: 'Example.Host',
        port: 22,
        username: 'ubuntu',
        authMethod: 'auto',
      },
    ];

    expect(getContextIdForRoot(root, profiles)).toBe('ssh-example.host-abcd1234');
  });

  it('generates unique context ids for two SSH roots on the same host', () => {
    const profiles: SshConnectionProfile[] = [
      {
        id: 'profile-1',
        name: 'Primary',
        host: 'same-host',
        port: 22,
        username: 'user',
        authMethod: 'auto',
      },
    ];
    const sshRootA: DataRoot = {
      id: 'aaaaaaaa11111111',
      name: 'Remote A',
      type: 'ssh',
      sshProfileId: 'profile-1',
      remoteClaudeRootPath: null,
      order: 0,
    };
    const sshRootB: DataRoot = {
      id: 'bbbbbbbb22222222',
      name: 'Remote B',
      type: 'ssh',
      sshProfileId: 'profile-1',
      remoteClaudeRootPath: null,
      order: 1,
    };

    expect(getContextIdForRoot(sshRootA, profiles)).toBe('ssh-same-host-aaaaaaaa');
    expect(getContextIdForRoot(sshRootB, profiles)).toBe('ssh-same-host-bbbbbbbb');
    expect(getContextIdForRoot(sshRootA, profiles)).not.toBe(getContextIdForRoot(sshRootB, profiles));
  });

  it('throws when ssh root references a missing profile', () => {
    const root: DataRoot = {
      id: 'missing-profile-root',
      name: 'Broken SSH Root',
      type: 'ssh',
      sshProfileId: 'missing-profile',
      remoteClaudeRootPath: null,
      order: 0,
    };

    expect(() => getContextIdForRoot(root, [])).toThrow(
      'SSH profile not found for root "Broken SSH Root" (missing-profile-root)'
    );
  });

  it('can still resolve root ids while ignoring invalid roots', () => {
    const roots: DataRoot[] = [
      {
        id: 'broken-root',
        name: 'Broken',
        type: 'ssh',
        sshProfileId: 'missing',
        remoteClaudeRootPath: null,
        order: 0,
      },
      {
        id: 'custom-local-root',
        name: 'Local 2',
        type: 'local',
        claudeRootPath: '/tmp/.claude',
        order: 1,
      },
    ];

    expect(getRootIdForContextId('local-custom-l', roots, [])).toBe('custom-local-root');
  });
});
