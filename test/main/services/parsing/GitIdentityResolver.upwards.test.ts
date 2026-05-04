import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { gitIdentityResolver } from '@main/services/parsing/GitIdentityResolver';

describe('GitIdentityResolver - Upwards Search', () => {
  let tmpDir: string;
  let mainRepoDir: string;
  let worktreeDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.realpath(fs.mkdtempSync(path.join(os.tmpdir(), 'git-upwards-test-')));
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
      `gitdir: ../main-repo/.git/worktrees/my-worktree\n`
    );

    // Create subdirectories
    fs.mkdirSync(path.join(mainRepoDir, 'src'));
    fs.mkdirSync(path.join(worktreeDir, 'src'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves identity when path is a subdirectory of main repo', async () => {
    const identity = await gitIdentityResolver.resolveIdentity(path.join(mainRepoDir, 'src'));
    expect(identity).toBeDefined();
    expect(identity?.mainGitDir).toBe(await fs.promises.realpath(path.join(mainRepoDir, '.git')));
    expect(identity?.remoteUrl).toBe('git@github.com:matt1398/claude-devtools.git');
    expect(await gitIdentityResolver.isWorktree(path.join(mainRepoDir, 'src'))).toBe(false);
  });

  it('resolves identity when path is a subdirectory of a worktree (with relative gitdir)', async () => {
    const identity = await gitIdentityResolver.resolveIdentity(path.join(worktreeDir, 'src'));
    expect(identity).toBeDefined();
    expect(identity?.mainGitDir).toBe(await fs.promises.realpath(path.join(mainRepoDir, '.git')));
    expect(identity?.remoteUrl).toBe('git@github.com:matt1398/claude-devtools.git');
    expect(await gitIdentityResolver.isWorktree(path.join(worktreeDir, 'src'))).toBe(true);
  });
});
