/**
 * Logical project slice unit tests.
 * Tests CRUD, cascade cleanup, assignment validation, resolution precedence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI, type MockElectronAPI } from '../../mocks/electronAPI';

import { createTestStore, type TestStore } from './storeTestUtils';

import type { LogicalProject } from '../../../src/shared/types/notifications';

function baseConfigResponse(
  sessions: Partial<{
    logicalProjects: Record<string, LogicalProject>;
    sessionProjectMap: Record<string, string>;
    cwdProjectMap: Record<string, string>;
    sidebarGroupBy: 'date' | 'logical-project';
  }> = {}
) {
  return {
    notifications: {
      enabled: true,
      soundEnabled: true,
      ignoredRegex: [],
      ignoredRepositories: [],
      snoozedUntil: null,
      snoozeMinutes: 30,
      triggers: [],
    },
    general: {
      launchAtLogin: false,
      showDockIcon: true,
      theme: 'dark',
      defaultTab: 'dashboard',
      claudeRootPath: null,
    },
    display: { showTimestamps: true, compactMode: false, syntaxHighlighting: true },
    sessions: {
      pinnedSessions: {},
      hiddenSessions: {},
      filterActiveOnly: false,
      logicalProjects: {},
      sessionProjectMap: {},
      cwdProjectMap: {},
      sidebarGroupBy: 'date' as const,
      ...sessions,
    },
  };
}

describe('logicalProjectSlice', () => {
  let store: TestStore;
  let mockAPI: MockElectronAPI;

  beforeEach(() => {
    mockAPI = installMockElectronAPI();
    mockAPI.config.update.mockResolvedValue(undefined);
    store = createTestStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createLogicalProject', () => {
    it('creates a project with generated id, default color, and order', async () => {
      const project = await store.getState().createLogicalProject('Cowork');

      expect(project).not.toBeNull();
      expect(project!.id).toMatch(/^lp_[0-9a-f]{32}$/);
      expect(project!.name).toBe('Cowork');
      expect(project!.color).toBeDefined();
      expect(project!.order).toBe(0);
      expect(store.getState().logicalProjects[project!.id]).toEqual(project);
      expect(mockAPI.config.update).toHaveBeenCalledWith(
        'sessions',
        expect.objectContaining({ logicalProjects: expect.any(Object) })
      );
    });

    it('rejects empty or whitespace-only names', async () => {
      expect(await store.getState().createLogicalProject('')).toBeNull();
      expect(await store.getState().createLogicalProject('   ')).toBeNull();
      expect(Object.keys(store.getState().logicalProjects)).toHaveLength(0);
    });

    it('rolls back state when persistence fails', async () => {
      mockAPI.config.update.mockRejectedValueOnce(new Error('disk full'));
      const project = await store.getState().createLogicalProject('Broken');
      expect(project).toBeNull();
      expect(Object.keys(store.getState().logicalProjects)).toHaveLength(0);
    });

    it('increments order for subsequent projects', async () => {
      const p1 = await store.getState().createLogicalProject('First');
      const p2 = await store.getState().createLogicalProject('Second');
      expect(p1!.order).toBe(0);
      expect(p2!.order).toBe(1);
    });
  });

  describe('updateLogicalProject', () => {
    it('renames and recolors an existing project', async () => {
      const project = await store.getState().createLogicalProject('Old');
      await store.getState().updateLogicalProject(project!.id, {
        name: 'New',
        color: '#123456',
      });
      const updated = store.getState().logicalProjects[project!.id];
      expect(updated?.name).toBe('New');
      expect(updated?.color).toBe('#123456');
    });

    it('no-ops for unknown id', async () => {
      await store.getState().updateLogicalProject('lp_nonexistent', { name: 'X' });
      expect(mockAPI.config.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteLogicalProject', () => {
    it('removes project and cascades cleanup of session/cwd maps', async () => {
      const project = await store.getState().createLogicalProject('Cowork');
      const id = project!.id;

      await store.getState().assignSessionToLogicalProject('session-a', id);
      await store.getState().assignCwdToLogicalProject('cwd-1', id);
      expect(store.getState().sessionProjectMap['session-a']).toBe(id);
      expect(store.getState().cwdProjectMap['cwd-1']).toBe(id);

      await store.getState().deleteLogicalProject(id);

      expect(store.getState().logicalProjects[id]).toBeUndefined();
      expect(store.getState().sessionProjectMap['session-a']).toBeUndefined();
      expect(store.getState().cwdProjectMap['cwd-1']).toBeUndefined();
    });

    it('leaves other projects and assignments intact', async () => {
      const keep = await store.getState().createLogicalProject('Keep');
      const drop = await store.getState().createLogicalProject('Drop');
      await store.getState().assignSessionToLogicalProject('s1', keep!.id);
      await store.getState().assignSessionToLogicalProject('s2', drop!.id);

      await store.getState().deleteLogicalProject(drop!.id);

      expect(store.getState().logicalProjects[keep!.id]).toBeDefined();
      expect(store.getState().sessionProjectMap['s1']).toBe(keep!.id);
      expect(store.getState().sessionProjectMap['s2']).toBeUndefined();
    });
  });

  describe('assignSessionToLogicalProject', () => {
    it('rejects assignment to unknown logical project id', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await store.getState().assignSessionToLogicalProject('sess', 'lp_ghost');
      expect(store.getState().sessionProjectMap['sess']).toBeUndefined();
      warnSpy.mockRestore();
    });

    it('clears assignment when id is null', async () => {
      const p = await store.getState().createLogicalProject('X');
      await store.getState().assignSessionToLogicalProject('sess', p!.id);
      expect(store.getState().sessionProjectMap['sess']).toBe(p!.id);

      await store.getState().assignSessionToLogicalProject('sess', null);
      expect(store.getState().sessionProjectMap['sess']).toBeUndefined();
    });
  });

  describe('assignCwdToLogicalProject', () => {
    it('rejects unknown logical project id', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await store.getState().assignCwdToLogicalProject('cwd-1', 'lp_ghost');
      expect(store.getState().cwdProjectMap['cwd-1']).toBeUndefined();
      warnSpy.mockRestore();
    });

    it('sets and clears cwd assignment', async () => {
      const p = await store.getState().createLogicalProject('X');
      await store.getState().assignCwdToLogicalProject('cwd-1', p!.id);
      expect(store.getState().cwdProjectMap['cwd-1']).toBe(p!.id);

      await store.getState().assignCwdToLogicalProject('cwd-1', null);
      expect(store.getState().cwdProjectMap['cwd-1']).toBeUndefined();
    });
  });

  describe('resolveLogicalProjectId', () => {
    it('prefers explicit session assignment over cwd default', async () => {
      const a = await store.getState().createLogicalProject('A');
      const b = await store.getState().createLogicalProject('B');
      await store.getState().assignCwdToLogicalProject('cwd-1', a!.id);
      await store.getState().assignSessionToLogicalProject('session-x', b!.id);

      expect(
        store.getState().resolveLogicalProjectId('session-x', 'cwd-1')
      ).toBe(b!.id);
    });

    it('falls back to cwd default when no explicit assignment', async () => {
      const a = await store.getState().createLogicalProject('A');
      await store.getState().assignCwdToLogicalProject('cwd-1', a!.id);
      expect(
        store.getState().resolveLogicalProjectId('session-y', 'cwd-1')
      ).toBe(a!.id);
    });

    it('returns null when nothing is assigned', () => {
      expect(store.getState().resolveLogicalProjectId('s', 'cwd')).toBeNull();
    });

    it('ignores orphan references to deleted projects', async () => {
      const a = await store.getState().createLogicalProject('A');
      await store.getState().assignSessionToLogicalProject('sess', a!.id);
      // Simulate orphan: manually drop the project without cascade.
      store.setState({ logicalProjects: {} });
      expect(store.getState().resolveLogicalProjectId('sess', 'cwd')).toBeNull();
    });
  });

  describe('loadLogicalProjects', () => {
    it('hydrates state from config', async () => {
      const existing: LogicalProject = {
        id: 'lp_existing',
        name: 'Existing',
        color: '#abcdef',
        order: 0,
        createdAt: 1,
      };
      mockAPI.config.get.mockResolvedValueOnce(
        baseConfigResponse({
          logicalProjects: { lp_existing: existing },
          sessionProjectMap: { 's1': 'lp_existing' },
          cwdProjectMap: { 'cwd-1': 'lp_existing' },
          sidebarGroupBy: 'logical-project',
        })
      );
      await store.getState().loadLogicalProjects();
      expect(store.getState().logicalProjects['lp_existing']).toEqual(existing);
      expect(store.getState().sessionProjectMap['s1']).toBe('lp_existing');
      expect(store.getState().cwdProjectMap['cwd-1']).toBe('lp_existing');
      expect(store.getState().sidebarGroupBy).toBe('logical-project');
    });

    it('falls back to defaults when sessions config is missing', async () => {
      mockAPI.config.get.mockResolvedValueOnce({
        notifications: {},
        general: {},
        display: {},
      });
      await store.getState().loadLogicalProjects();
      expect(store.getState().logicalProjects).toEqual({});
      expect(store.getState().sidebarGroupBy).toBe('date');
    });
  });

  describe('reorderLogicalProjects', () => {
    it('swaps the order field of two projects in a single persist call', async () => {
      const a = await store.getState().createLogicalProject('A');
      const b = await store.getState().createLogicalProject('B');
      mockAPI.config.update.mockClear();

      await store.getState().reorderLogicalProjects(a!.id, b!.id);

      expect(store.getState().logicalProjects[a!.id]?.order).toBe(b!.order);
      expect(store.getState().logicalProjects[b!.id]?.order).toBe(a!.order);
      expect(mockAPI.config.update).toHaveBeenCalledTimes(1);
    });

    it('is a no-op for unknown ids', async () => {
      const a = await store.getState().createLogicalProject('A');
      mockAPI.config.update.mockClear();
      await store.getState().reorderLogicalProjects(a!.id, 'lp_ghost');
      expect(mockAPI.config.update).not.toHaveBeenCalled();
    });
  });

  describe('setSidebarGroupBy', () => {
    it('updates mode and persists', async () => {
      await store.getState().setSidebarGroupBy('logical-project');
      expect(store.getState().sidebarGroupBy).toBe('logical-project');
      expect(mockAPI.config.update).toHaveBeenCalledWith('sessions', {
        sidebarGroupBy: 'logical-project',
      });
    });

    it('rolls back on persistence failure', async () => {
      mockAPI.config.update.mockRejectedValueOnce(new Error('boom'));
      await store.getState().setSidebarGroupBy('logical-project');
      expect(store.getState().sidebarGroupBy).toBe('date');
    });
  });
});
