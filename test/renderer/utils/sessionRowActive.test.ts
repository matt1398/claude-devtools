import { describe, expect, it } from 'vitest';

import { isSessionRowActive } from '../../../src/renderer/utils/sessionRowActive';

describe('isSessionRowActive', () => {
  it('matches by session id in non-combined mode', () => {
    expect(
      isSessionRowActive(
        { id: 'session-1', projectId: 'project-a', contextId: 'local' },
        {
          selectedSessionId: 'session-1',
          selectedProjectId: 'project-b',
          activeProjectId: 'project-b',
          activeContextId: 'ssh-1',
          combinedModeEnabled: false,
        }
      )
    ).toBe(true);
  });

  it('disambiguates identical session ids by project in combined mode', () => {
    expect(
      isSessionRowActive(
        { id: 'shared-session', projectId: 'project-a', contextId: 'local' },
        {
          selectedSessionId: 'shared-session',
          selectedProjectId: 'project-b',
          activeProjectId: 'project-b',
          activeContextId: 'local',
          combinedModeEnabled: true,
        }
      )
    ).toBe(false);
  });

  it('disambiguates identical session ids by context in combined mode', () => {
    expect(
      isSessionRowActive(
        { id: 'shared-session', projectId: 'project-a', contextId: 'ssh-1' },
        {
          selectedSessionId: 'shared-session',
          selectedProjectId: 'project-a',
          activeProjectId: 'project-a',
          activeContextId: 'local',
          combinedModeEnabled: true,
        }
      )
    ).toBe(false);
  });

  it('falls back to activeProjectId when selectedProjectId is null', () => {
    expect(
      isSessionRowActive(
        { id: 'shared-session', projectId: 'project-a', contextId: 'local' },
        {
          selectedSessionId: 'shared-session',
          selectedProjectId: null,
          activeProjectId: 'project-a',
          activeContextId: 'local',
          combinedModeEnabled: true,
        }
      )
    ).toBe(true);
  });

  it('rejects sessions without contextId in combined mode', () => {
    expect(
      isSessionRowActive(
        { id: 'shared-session', projectId: 'project-a', contextId: undefined },
        {
          selectedSessionId: 'shared-session',
          selectedProjectId: 'project-a',
          activeProjectId: 'project-a',
          activeContextId: 'local',
          combinedModeEnabled: true,
        }
      )
    ).toBe(false);
  });
});
