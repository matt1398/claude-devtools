import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI } from '../../mocks/electronAPI';
import { createTestStore, type TestStore } from './storeTestUtils';

describe('Deep Link Navigation', () => {
  let store: TestStore;

  beforeEach(() => {
    installMockElectronAPI();
    store = createTestStore();

    let uuidCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `test-uuid-${++uuidCounter}`,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens settings tab with section', () => {
    store.getState().openSettingsTab('advanced');
    expect(store.getState().openTabs).toHaveLength(1);
    expect(store.getState().openTabs[0].type).toBe('settings');
    expect(store.getState().pendingSettingsSection).toBe('advanced');
  });

  it('opens notifications tab', () => {
    store.getState().openNotificationsTab();
    expect(store.getState().openTabs).toHaveLength(1);
    expect(store.getState().openTabs[0].type).toBe('notifications');
  });

  it('sets pending projects query', () => {
    store.getState().setPendingProjectsQuery('dotfiles');
    expect(store.getState().pendingProjectsQuery).toBe('dotfiles');
  });

  it('clears pending projects query', () => {
    store.getState().setPendingProjectsQuery('dotfiles');
    store.getState().clearPendingProjectsQuery();
    expect(store.getState().pendingProjectsQuery).toBeNull();
  });

  it('selectRepositoryByName selects matching repo', () => {
    store.setState({
      repositoryGroups: [
        {
          id: 'repo-1',
          name: 'dotfiles',
          identity: null,
          worktrees: [
            {
              id: '-Users-test-dotfiles',
              path: '/Users/test/dotfiles',
              name: 'main',
              isMainWorktree: true,
              source: 'standard' as const,
              sessions: ['s1'],
              createdAt: 0,
              mostRecentSession: 0,
            },
          ],
          totalSessions: 1,
          mostRecentSession: 0,
        },
      ],
    });

    store.getState().selectRepositoryByName('dotfiles');

    expect(store.getState().selectedRepositoryId).toBe('repo-1');
    // dashboard tab should open
    const tabs = store.getState().openTabs;
    expect(tabs.some((t) => t.type === 'dashboard')).toBe(true);
  });

  it('selectRepositoryByName with query opens command palette', () => {
    store.setState({
      repositoryGroups: [
        {
          id: 'repo-1',
          name: 'dotfiles',
          identity: null,
          worktrees: [
            {
              id: '-Users-test-dotfiles',
              path: '/Users/test/dotfiles',
              name: 'main',
              isMainWorktree: true,
              source: 'standard' as const,
              sessions: ['s1'],
              createdAt: 0,
              mostRecentSession: 0,
            },
          ],
          totalSessions: 1,
          mostRecentSession: 0,
        },
      ],
    });

    store.getState().selectRepositoryByName('dotfiles', 'clock');

    expect(store.getState().commandPaletteOpen).toBe(true);
    expect(store.getState().pendingSearchQuery).toBe('clock');
  });

  it('selectRepositoryByName defers when repos not loaded', () => {
    store.setState({ repositoryGroups: [] });
    store.getState().selectRepositoryByName('dotfiles');
    expect(store.getState().pendingDeepLinkNavigation).toMatchObject({
      type: 'select-repo',
      projectName: 'dotfiles',
    });
  });

  it('navigateToSessionByProjectName uses worktree id', () => {
    store.setState({
      repositoryGroups: [
        {
          id: 'repo-1',
          name: 'dotfiles',
          identity: null,
          worktrees: [
            {
              id: '-Users-test-dotfiles',
              path: '/Users/test/dotfiles',
              name: 'main',
              isMainWorktree: true,
              source: 'standard' as const,
              sessions: ['s1'],
              createdAt: 0,
              mostRecentSession: 0,
            },
          ],
          totalSessions: 1,
          mostRecentSession: 0,
        },
      ],
    });

    store.getState().navigateToSessionByProjectName('dotfiles', 'session-abc');

    const tabs = store.getState().openTabs;
    expect(tabs.some((t) => t.type === 'session' && t.sessionId === 'session-abc')).toBe(true);
  });
});
