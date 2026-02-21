import { describe, expect, it } from 'vitest';
import * as path from 'path';

import { validateConfigUpdatePayload } from '../../../src/main/ipc/configValidation';
import type { AppConfig } from '../../../src/main/services';

const baseConfig: AppConfig = {
  notifications: {
    enabled: true,
    soundEnabled: true,
    ignoredRegex: [],
    ignoredRepositories: [],
    snoozedUntil: null,
    snoozeMinutes: 30,
    includeSubagentErrors: true,
    triggers: [],
  },
  general: {
    launchAtLogin: false,
    showDockIcon: true,
    theme: 'dark',
    defaultTab: 'dashboard',
    claudeRootPath: null,
  },
  display: {
    showTimestamps: true,
    compactMode: false,
    syntaxHighlighting: true,
  },
  sessions: {
    pinnedSessions: {},
    hiddenSessions: {},
  },
  roots: {
    items: [
      {
        id: 'default-local',
        name: 'Local',
        type: 'local',
        claudeRootPath: null,
        order: 0,
      },
    ],
    activeRootId: 'default-local',
  },
  ssh: {
    lastConnection: null,
    autoReconnect: false,
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
    lastActiveContextId: 'local',
  },
  httpServer: {
    enabled: false,
    port: 3456,
  },
};

describe('configValidation', () => {
  it('accepts valid general updates', () => {
    const result = validateConfigUpdatePayload('general', {
      theme: 'system',
      launchAtLogin: true,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.section).toBe('general');
      expect(result.data).toEqual({
        theme: 'system',
        launchAtLogin: true,
      });
    }
  });

  it('accepts absolute general.claudeRootPath updates', () => {
    const result = validateConfigUpdatePayload('general', {
      claudeRootPath: '/Users/test/.claude',
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.section).toBe('general');
      expect(result.data).toEqual({
        claudeRootPath: path.resolve('/Users/test/.claude'),
      });
    }
  });

  it('rejects relative general.claudeRootPath updates', () => {
    const result = validateConfigUpdatePayload('general', {
      claudeRootPath: '.claude',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('absolute path');
    }
  });

  it('rejects invalid section names', () => {
    const result = validateConfigUpdatePayload('invalid-section', { theme: 'dark' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Section must be one of');
    }
  });

  it('rejects unknown notification keys', () => {
    const result = validateConfigUpdatePayload('notifications', { unknownField: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('not supported');
    }
  });

  it('accepts valid notifications.triggers payload', () => {
    const result = validateConfigUpdatePayload('notifications', {
      triggers: [
        {
          id: 'trigger-1',
          name: 'test',
          enabled: true,
          contentType: 'tool_result',
          mode: 'error_status',
          requireError: true,
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid notifications.triggers payload', () => {
    const result = validateConfigUpdatePayload('notifications', {
      triggers: [{ id: 'missing-required-fields' }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('valid trigger');
    }
  });

  it('rejects out-of-range snoozeMinutes', () => {
    const result = validateConfigUpdatePayload('notifications', { snoozeMinutes: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('between 1 and');
    }
  });

  it('accepts valid display updates', () => {
    const result = validateConfigUpdatePayload('display', {
      compactMode: true,
      syntaxHighlighting: false,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.section).toBe('display');
      expect(result.data).toEqual({
        compactMode: true,
        syntaxHighlighting: false,
      });
    }
  });

  it('accepts valid roots updates with profile references', () => {
    const result = validateConfigUpdatePayload(
      'roots',
      {
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
            name: 'Server',
            type: 'ssh',
            sshProfileId: 'profile-1',
            remoteClaudeRootPath: '/home/user/.claude',
            order: 1,
          },
        ],
        activeRootId: 'default-local',
      },
      baseConfig
    );

    expect(result.valid).toBe(true);
  });

  it('rejects roots updates with missing SSH profile reference', () => {
    const result = validateConfigUpdatePayload(
      'roots',
      {
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
            name: 'Server',
            type: 'ssh',
            sshProfileId: 'missing-profile',
            remoteClaudeRootPath: '/home/user/.claude',
            order: 1,
          },
        ],
      },
      baseConfig
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('missing SSH profile');
    }
  });

  it('rejects roots updates with duplicate root ids', () => {
    const result = validateConfigUpdatePayload(
      'roots',
      {
        items: [
          {
            id: 'dup-root',
            name: 'Local 1',
            type: 'local',
            claudeRootPath: null,
            order: 0,
          },
          {
            id: 'dup-root',
            name: 'Local 2',
            type: 'local',
            claudeRootPath: null,
            order: 1,
          },
        ],
      },
      baseConfig
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('unique');
    }
  });

  it('rejects roots updates without a local root', () => {
    const result = validateConfigUpdatePayload(
      'roots',
      {
        items: [
          {
            id: 'ssh-root-1',
            name: 'Server',
            type: 'ssh',
            sshProfileId: 'profile-1',
            remoteClaudeRootPath: '/home/user/.claude',
            order: 0,
          },
        ],
      },
      baseConfig
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('local root');
    }
  });

  it('rejects roots.activeRootId that is not present in roots.items', () => {
    const result = validateConfigUpdatePayload(
      'roots',
      {
        items: [
          {
            id: 'default-local',
            name: 'Local',
            type: 'local',
            claudeRootPath: null,
            order: 0,
          },
        ],
        activeRootId: 'missing-root-id',
      },
      baseConfig
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('activeRootId must reference');
    }
  });

  it('rejects roots updates with an empty roots.items array', () => {
    const result = validateConfigUpdatePayload(
      'roots',
      {
        items: [],
      },
      baseConfig
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('must contain at least one root');
    }
  });

  it('rejects roots updates with invalid root type values', () => {
    const result = validateConfigUpdatePayload(
      'roots',
      {
        items: [
          {
            id: 'default-local',
            name: 'Local',
            type: 'invalid',
            order: 0,
          },
        ],
      },
      baseConfig
    );

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('type must be "local" or "ssh"');
    }
  });
});
