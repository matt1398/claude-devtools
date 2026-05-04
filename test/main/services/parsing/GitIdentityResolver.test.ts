import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { gitIdentityResolver } from '@main/services/parsing/GitIdentityResolver';

describe('GitIdentityResolver', () => {
  let tmpDir: string;
  let mainRepoDir: string;
  let worktreeDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-identity-test-')));
    mainRepoDir = path.join(tmpDir, 'main-repo');
    worktreeDir = path.join(tmpDir, 'my-worktree');

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
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves identity for main repo', async () => {
    const identity = await gitIdentityResolver.resolveIdentity(mainRepoDir);
    expect(identity).toBeDefined();
    expect(identity?.mainGitDir).toBe(fs.realpathSync(path.join(mainRepoDir, '.git')));
    expect(identity?.name).toBe('main-repo');
  });

  it('resolves identity for worktree', async () => {
    const identity = await gitIdentityResolver.resolveIdentity(worktreeDir);
    expect(identity).toBeDefined();
    expect(identity?.mainGitDir).toBe(fs.realpathSync(path.join(mainRepoDir, '.git')));
    expect(identity?.name).toBe('main-repo');
  });
});
