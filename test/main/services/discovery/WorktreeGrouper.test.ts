import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorktreeGrouper } from '@main/services/discovery/WorktreeGrouper';
import { LocalFileSystemProvider } from '@main/services/infrastructure/LocalFileSystemProvider';
import { Project } from '@main/types';
import { gitIdentityResolver } from '@main/services/parsing/GitIdentityResolver';

describe('WorktreeGrouper', () => {
  let tmpDir: string;
  let mainRepoDir: string;
  let worktreeDir: string;
  let projectsDir: string;
  let grouper: WorktreeGrouper;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-grouper-test-'));
    mainRepoDir = path.join(tmpDir, 'main-repo');
    worktreeDir = path.join(tmpDir, 'my-worktree');
    projectsDir = path.join(tmpDir, 'projects');

    fs.mkdirSync(mainRepoDir);
    fs.mkdirSync(path.join(mainRepoDir, '.git'));
    fs.mkdirSync(path.join(mainRepoDir, '.git', 'worktrees'));
    fs.mkdirSync(path.join(mainRepoDir, '.git', 'worktrees', 'my-worktree'));

    fs.writeFileSync(
      path.join(mainRepoDir, '.git', 'config'),
      '[remote "origin"]\n\turl = git@github.com:matt1398/claude-devtools.git\n'
    );

    fs.mkdirSync(worktreeDir);
    fs.writeFileSync(
      path.join(worktreeDir, '.git'),
      `gitdir: ${path.join(mainRepoDir, '.git', 'worktrees', 'my-worktree')}\n`
    );

    fs.mkdirSync(projectsDir);

    grouper = new WorktreeGrouper(projectsDir, new LocalFileSystemProvider());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('groups main repo and worktree together', async () => {
    // Mock the SubprojectRegistry so it returns no session filter, which allows all sessions
    vi.mock('@main/services/discovery/SubprojectRegistry', () => ({
      subprojectRegistry: {
        getSessionFilter: () => null,
      },
    }));

    // Mock SessionContentFilter to always return true (not noise)
    vi.mock('@main/services/discovery/SessionContentFilter', () => ({
      SessionContentFilter: {
        hasNonNoiseMessages: vi.fn().mockResolvedValue(true),
      },
    }));

    const projects: Project[] = [
      {
        id: 'main-repo-id',
        path: mainRepoDir,
        name: 'main-repo',
        sessions: ['session1'],
        createdAt: 1000,
        mostRecentSession: 2000,
      },
      {
        id: 'worktree-id',
        path: worktreeDir,
        name: 'my-worktree',
        sessions: ['session2'],
        createdAt: 1500,
        mostRecentSession: 2500,
      },
    ];

    const groups = await grouper.groupByRepository(projects);

    expect(groups).toHaveLength(1);
    expect(groups[0].worktrees).toHaveLength(2);
    expect(groups[0].worktrees.find(w => w.isMainWorktree)?.path).toBe(mainRepoDir);
    expect(groups[0].worktrees.find(w => !w.isMainWorktree)?.path).toBe(worktreeDir);
  });
});
