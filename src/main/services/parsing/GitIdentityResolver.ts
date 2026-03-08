/**
 * GitIdentityResolver service - Resolves git repository identity from project paths.
 *
 * Responsibilities:
 * - Detect if a path is inside a git worktree vs main repository
 * - Extract the main repository path from worktree's .git file
 * - Get git remote URL for repository identity
 * - Build consistent repository identity across all worktrees
 *
 * Git worktree detection:
 * - Main repo: .git is a directory
 * - Worktree: .git is a file containing "gitdir: /path/to/main/.git/worktrees/<name>"
 */

import {
  AUTO_CLAUDE_DIR,
  CCSWITCH_DIR,
  CLAUDE_WORKTREES_DIR,
  CONDUCTOR_DIR,
  CURSOR_DIR,
  TASKS_DIR,
  TWENTYFIRST_DIR,
  VIBE_KANBAN_DIR,
  WORKSPACES_DIR,
  WORKTREES_DIR,
} from '@main/constants/worktreePatterns';
import { type RepositoryIdentity, type WorktreeSource } from '@main/types';
import { createLogger } from '@shared/utils/logger';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const logger = createLogger('Service:GitIdentityResolver');

class GitIdentityResolver {
  /**
   * Resolve repository identity from a project path.
   *
   * Algorithm:
   * 1. Check if path/.git exists on filesystem
   * 2. If .git is a file (worktree), read gitdir to find main repo
   * 3. If .git is a directory (main repo), use it directly
   * 4. Extract remote URL from .git/config
   * 5. Build RepositoryIdentity with consistent ID
   * 6. FALLBACK: If path doesn't exist, use heuristics based on path patterns
   *
   * @param projectPath - The filesystem path to check
   * @returns RepositoryIdentity or null if not a git repo
   */
  async resolveIdentity(projectPath: string): Promise<RepositoryIdentity | null> {
    try {
      const gitPath = path.join(projectPath, '.git');

      // First, try filesystem-based resolution
      let gitPathExists = false;
      try {
        await fs.promises.access(gitPath);
        gitPathExists = true;
      } catch {
        // Path doesn't exist
      }

      if (gitPathExists) {
        const stats = await fs.promises.stat(gitPath);

        let mainGitDir: string;

        if (stats.isFile()) {
          // This is a worktree - parse the .git file to find main repo
          const gitFileContent = (await fs.promises.readFile(gitPath, 'utf-8')).trim();
          const gitDirMatch = /^gitdir:\s*(\S[^\r\n]*)$/m.exec(gitFileContent);

          if (!gitDirMatch) {
            logger.warn(`Invalid .git file format at ${gitPath}`);
            return this.resolveIdentityFromPath(projectPath);
          }

          let worktreeGitDir = gitDirMatch[1].trim();

          // Handle relative paths in gitdir (resolve relative to the .git file location)
          if (!path.isAbsolute(worktreeGitDir)) {
            worktreeGitDir = path.resolve(projectPath, worktreeGitDir);
          }

          mainGitDir = this.extractMainGitDir(worktreeGitDir);
        } else if (stats.isDirectory()) {
          mainGitDir = gitPath;
        } else {
          return this.resolveIdentityFromPath(projectPath);
        }

        // Normalize the path to handle symlinks (e.g., /tmp -> /private/var/folders)
        // This ensures all worktrees of the same repo get the same ID
        try {
          mainGitDir = await fs.promises.realpath(mainGitDir);
        } catch {
          // If realpath fails (e.g., path doesn't exist), use as-is
        }

        // Extract remote URL from config
        const remoteUrl = await this.getRemoteUrl(mainGitDir);

        // Generate consistent repository ID based on the CANONICAL main git directory
        const repoId = this.generateRepoId(remoteUrl, mainGitDir);

        // Extract repository name from path or remote URL
        const repoName = this.extractRepoName(remoteUrl, mainGitDir);

        return {
          id: repoId,
          remoteUrl: remoteUrl ?? undefined,
          mainGitDir,
          name: repoName,
        };
      }

      // Fallback: path doesn't exist, use heuristic resolution
      return this.resolveIdentityFromPath(projectPath);
    } catch (error) {
      logger.error(`Error resolving git identity for ${projectPath}:`, error);
      // Try fallback even on error
      return this.resolveIdentityFromPath(projectPath);
    }
  }

  /**
   * Fallback: Resolve repository identity from path patterns when filesystem is unavailable.
   * Uses heuristics to detect common worktree path patterns.
   *
   * Patterns supported:
   * - /.cursor/worktrees/{repo}/{worktree-name}
   * - /vibe-kanban/worktrees/{issue-branch}/{repo}
   * - /T/vibe-kanban/worktrees/{issue-branch}/{repo}
   * - Regular paths: use last component as repo name
   */
  private resolveIdentityFromPath(projectPath: string): RepositoryIdentity | null {
    const repoName = this.extractRepoNameFromPath(projectPath);

    if (!repoName) {
      return null;
    }

    // Generate ID from full path (since no remote URL, avoids colliding same-named repos)
    const repoId = this.generateRepoId(null, projectPath);

    return {
      id: repoId,
      remoteUrl: undefined,
      mainGitDir: repoName, // Use repo name as placeholder
      name: repoName,
    };
  }

  /**
   * Extract repository name from path using heuristics.
   * Works for both existing and deleted worktrees based on path patterns.
   *
   * Patterns:
   * - /.cursor/worktrees/{repo}/{worktree} → repo
   * - /vibe-kanban/worktrees/{issue-branch}/{repo} → repo (last component)
   * - /conductor/workspaces/{repo}/{subpath} → repo
   * - /.auto-claude/worktrees/tasks/{task-id} → parent repo (2 levels up from .auto-claude)
   * - /.21st/worktrees/{id}/{name} → parent repo
   * - /.claude-worktrees/{repo}/{name} → repo
   * - /.ccswitch/worktrees/{repo}/{name} → repo
   * - Default: last path component
   */
  private extractRepoNameFromPath(projectPath: string): string | null {
    const parts = projectPath.split(path.sep).filter(Boolean);

    if (parts.length === 0) {
      return null;
    }

    // Pattern 1: /.cursor/worktrees/{repo}/{worktree-name}
    const cursorWorktreeIdx = parts.indexOf(CURSOR_DIR);
    if (cursorWorktreeIdx >= 0 && parts[cursorWorktreeIdx + 1] === WORKTREES_DIR) {
      if (parts[cursorWorktreeIdx + 2]) {
        return parts[cursorWorktreeIdx + 2];
      }
    }

    // Pattern 2: /vibe-kanban/worktrees/{issue-branch}/{repo}
    const vibeKanbanIdx = parts.indexOf(VIBE_KANBAN_DIR);
    if (vibeKanbanIdx >= 0 && parts[vibeKanbanIdx + 1] === WORKTREES_DIR) {
      // The repo name is the LAST component (after issue-branch)
      return parts[parts.length - 1];
    }

    // Pattern 3: /conductor/workspaces/{repo}/{subpath}
    const conductorIdx = parts.indexOf(CONDUCTOR_DIR);
    if (conductorIdx >= 0 && parts[conductorIdx + 1] === WORKSPACES_DIR) {
      if (parts[conductorIdx + 2]) {
        return parts[conductorIdx + 2];
      }
    }

    // Pattern 4: /.auto-claude/worktrees/tasks/{task-id}
    // Repo is typically the directory containing .auto-claude
    const autoClaudeIdx = parts.indexOf(AUTO_CLAUDE_DIR);
    if (autoClaudeIdx > 0 && parts[autoClaudeIdx + 1] === WORKTREES_DIR) {
      return parts[autoClaudeIdx - 1]; // Parent directory is the repo
    }

    // Pattern 5: /.21st/worktrees/{id}/{name}
    const twentyFirstIdx = parts.indexOf(TWENTYFIRST_DIR);
    if (twentyFirstIdx > 0 && parts[twentyFirstIdx + 1] === WORKTREES_DIR) {
      return parts[twentyFirstIdx - 1]; // Parent directory is the repo
    }

    // Pattern 6: /.claude-worktrees/{repo}/{name}
    const claudeWorktreesIdx = parts.indexOf(CLAUDE_WORKTREES_DIR);
    if (claudeWorktreesIdx >= 0 && parts[claudeWorktreesIdx + 1]) {
      return parts[claudeWorktreesIdx + 1];
    }

    // Pattern 7: /.ccswitch/worktrees/{repo}/{name}
    const ccswitchIdx = parts.indexOf(CCSWITCH_DIR);
    if (ccswitchIdx >= 0 && parts[ccswitchIdx + 1] === WORKTREES_DIR) {
      if (parts[ccswitchIdx + 2]) {
        return parts[ccswitchIdx + 2];
      }
    }

    // Default: use the last component
    return parts[parts.length - 1];
  }

  /**
   * Determine if a path is a worktree (vs main repo).
   * Worktrees have a .git file, main repos have a .git directory.
   * Uses path heuristics if filesystem is not available (for deleted worktrees).
   */
  async isWorktree(projectPath: string): Promise<boolean> {
    // First, try path-based heuristics (works for deleted worktrees)
    const parts = projectPath.split(path.sep).filter(Boolean);

    // Check for known worktree patterns - these are ALWAYS worktrees
    if (parts.includes(CURSOR_DIR) && parts.includes(WORKTREES_DIR)) {
      return true;
    }
    if (parts.includes(VIBE_KANBAN_DIR) && parts.includes(WORKTREES_DIR)) {
      return true;
    }
    if (parts.includes(AUTO_CLAUDE_DIR) && parts.includes(WORKTREES_DIR)) {
      return true;
    }
    if (parts.includes(TWENTYFIRST_DIR) && parts.includes(WORKTREES_DIR)) {
      return true;
    }
    if (parts.includes(CLAUDE_WORKTREES_DIR)) {
      return true;
    }
    if (parts.includes(CCSWITCH_DIR) && parts.includes(WORKTREES_DIR)) {
      return true;
    }
    if (parts.includes(CONDUCTOR_DIR) && parts.includes(WORKSPACES_DIR)) {
      // Subpaths in conductor/workspaces are worktrees
      const conductorIdx = parts.indexOf(CONDUCTOR_DIR);
      if (conductorIdx >= 0 && parts.length > conductorIdx + 3) {
        return true; // Has subpath after workspaces/{repo}
      }
    }

    // Fallback: check filesystem if available
    try {
      const gitPath = path.join(projectPath, '.git');
      try {
        const stats = await fs.promises.stat(gitPath);
        return stats.isFile();
      } catch {
        // Path doesn't exist
      }
    } catch {
      // Ignore errors - filesystem might not be available
    }

    return false;
  }

  /**
   * Extract the main .git directory path from a worktree's gitdir.
   *
   * @param worktreeGitDir - Path like "/path/to/main/.git/worktrees/<name>"
   * @returns Path to main .git directory like "/path/to/main/.git"
   */
  private extractMainGitDir(worktreeGitDir: string): string {
    // worktreeGitDir is typically: /path/to/main/.git/worktrees/<worktree-name>
    // We need to go up two levels to get to .git
    const parts = worktreeGitDir.split(path.sep);
    const worktreesIndex = parts.lastIndexOf(WORKTREES_DIR);

    if (worktreesIndex > 0) {
      // Return everything up to and including .git
      return parts.slice(0, worktreesIndex).join(path.sep);
    }

    // Fallback: try to find .git in the path
    const gitIndex = worktreeGitDir.lastIndexOf('.git');
    if (gitIndex > 0) {
      return worktreeGitDir.substring(0, gitIndex + 4); // +4 for ".git"
    }

    // Last resort: return as-is
    return worktreeGitDir;
  }

  /**
   * Get git remote URL from a repository's config file.
   *
   * @param gitDir - Path to the .git directory
   * @returns Remote URL or null if not found
   */
  private async getRemoteUrl(gitDir: string): Promise<string | null> {
    try {
      const configPath = path.join(gitDir, 'config');
      try {
        await fs.promises.access(configPath);
      } catch {
        return null;
      }

      const configContent = await fs.promises.readFile(configPath, 'utf-8');

      // Parse git config to find [remote "origin"] section
      const lines = configContent.split(/\r?\n/);
      let inOriginRemote = false;

      for (const line of lines) {
        const trimmed = line.trim();

        // Check for remote "origin" section
        if (/^\[remote\s+"origin"\]$/.exec(trimmed)) {
          inOriginRemote = true;
          continue;
        }

        // Check for new section (exit origin remote)
        if (trimmed.startsWith('[') && inOriginRemote) {
          break;
        }

        // Look for url = ... in origin remote section
        if (inOriginRemote && trimmed.startsWith('url')) {
          const urlMatch = /^url\s*=\s*(\S[^\r\n]*)$/.exec(trimmed);
          if (urlMatch) {
            return urlMatch[1].trim();
          }
        }
      }

      return null;
    } catch (error) {
      logger.error(`Error reading git config at ${gitDir}:`, error);
      return null;
    }
  }

  /**
   * Generate consistent repository ID.
   * Uses the LOCAL DIRECTORY NAME as the primary identifier to ensure consistent grouping
   * across filesystem-based and path-based resolution.
   *
   * IMPORTANT: We prioritize local directory name over remote URL repo name because:
   * 1. Path-based resolution (for deleted worktrees) can only use directory names
   * 2. Users may clone repos with different local names than remote names
   * 3. We need consistent grouping regardless of whether filesystem exists
   *
   * @param _remoteUrl - Git remote URL (unused, kept for API compatibility)
   * @param mainGitDirOrName - Path to main .git directory, or repo name for path-based resolution
   * @returns Consistent hash-based ID
   */
  private generateRepoId(remoteUrl: string | null, mainGitDirOrName: string): string {
    // When a remote URL is available, use directory name for grouping
    // (worktrees of the same repo have same dir name but different paths)
    // When NO remote URL, use the full path to avoid colliding repos with same name
    let identity: string;

    if (mainGitDirOrName.includes(path.sep) || mainGitDirOrName.includes('/')) {
      if (remoteUrl) {
        // Has remote → use dir name (allows worktree grouping)
        const parentDir = path.dirname(mainGitDirOrName);
        identity = path.basename(parentDir);
      } else {
        // No remote → use full path to distinguish same-named repos.
        // For filesystem-based calls, mainGitDirOrName is like /path/.git → strip .git
        // For fallback calls, mainGitDirOrName is the project path itself
        identity = mainGitDirOrName.endsWith('.git')
          ? path.dirname(mainGitDirOrName)
          : mainGitDirOrName;
      }
    } else {
      // It's already just a name (from path-based resolution fallback)
      identity = mainGitDirOrName;
    }

    // Normalize and generate hash
    const normalized = identity.toLowerCase().trim();

    // Generate SHA-256 hash and take first 12 characters
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    return hash.substring(0, 12);
  }

  /**
   * Extract repository name from git directory path.
   * Always uses the LOCAL directory name for consistency with path-based resolution.
   *
   * @param _remoteUrl - Git remote URL (unused, kept for API compatibility)
   * @param mainGitDir - Path to main .git directory
   * @returns Repository name for display
   */
  private extractRepoName(_remoteUrl: string | null, mainGitDir: string): string {
    // Always use local directory name for consistency
    // /Users/username/projectname/.git -> projectname
    // /Users/username/projectname/.git -> projectname
    const parentDir = path.dirname(mainGitDir);
    return path.basename(parentDir);
  }

  /**
   * Get the git branch for a worktree.
   *
   * @param projectPath - The filesystem path to check
   * @returns Branch name or null
   */
  async getBranch(projectPath: string): Promise<string | null> {
    try {
      const gitPath = path.join(projectPath, '.git');

      try {
        await fs.promises.access(gitPath);
      } catch {
        return null;
      }

      const stats = await fs.promises.stat(gitPath);
      let headPath: string;

      if (stats.isFile()) {
        // Worktree - read .git file to find the HEAD location
        const gitFileContent = (await fs.promises.readFile(gitPath, 'utf-8')).trim();
        const gitDirMatch = /^gitdir:\s*(\S[^\r\n]*)$/.exec(gitFileContent);

        if (!gitDirMatch) {
          return null;
        }

        headPath = path.join(gitDirMatch[1], 'HEAD');
      } else {
        // Main repo
        headPath = path.join(gitPath, 'HEAD');
      }

      try {
        await fs.promises.access(headPath);
      } catch {
        return null;
      }

      const headContent = (await fs.promises.readFile(headPath, 'utf-8')).trim();

      // Check if HEAD is a symbolic ref (branch)
      const refMatch = /^ref:\s*refs\/heads\/(.+)$/.exec(headContent);
      if (refMatch) {
        return refMatch[1];
      }

      // HEAD is detached (commit hash)
      return 'detached HEAD';
    } catch (error) {
      logger.error(`Error reading git branch for ${projectPath}:`, error);
      return null;
    }
  }

  /**
   * Detect the worktree source based on path patterns.
   * This method works purely on path patterns and does NOT require filesystem access,
   * ensuring detection works even for deleted worktrees.
   *
   * Supported patterns:
   * - vibe-kanban: /tmp/vibe-kanban/worktrees/{issue-branch}/{repo}
   * - conductor: /Users/.../conductor/workspaces/{repo}/{workspace}
   * - auto-claude: /Users/.../.auto-claude/worktrees/tasks/{task-id}
   * - 21st: /Users/.../.21st/worktrees/{id}/{name}
   * - claude-desktop: /Users/.../.claude-worktrees/{repo}/{name}
   * - ccswitch: /Users/.../.ccswitch/worktrees/{repo}/{name}
   * - git: Standard git worktree (fallback if none of the above match)
   * - unknown: Non-git or undetectable
   *
   * @param projectPath - The filesystem path to check
   * @returns WorktreeSource identifier
   */
  async detectWorktreeSource(projectPath: string): Promise<WorktreeSource> {
    const parts = projectPath.split(path.sep).filter(Boolean);

    // Pattern: vibe-kanban
    // /tmp/vibe-kanban/worktrees/{issue-branch}/{repo}
    // /private/var/folders/.../vibe-kanban/worktrees/{issue-branch}/{repo}
    if (parts.includes(VIBE_KANBAN_DIR) && parts.includes(WORKTREES_DIR)) {
      return 'vibe-kanban';
    }

    // Pattern: conductor
    // /Users/.../conductor/workspaces/{repo}/{workspace}
    if (parts.includes(CONDUCTOR_DIR) && parts.includes(WORKSPACES_DIR)) {
      return 'conductor';
    }

    // Pattern: auto-claude
    // /Users/.../.auto-claude/worktrees/tasks/{task-id}
    if (parts.includes(AUTO_CLAUDE_DIR) && parts.includes(WORKTREES_DIR)) {
      return 'auto-claude';
    }

    // Pattern: 21st (1code)
    // /Users/.../.21st/worktrees/{id}/{name}
    if (parts.includes(TWENTYFIRST_DIR) && parts.includes(WORKTREES_DIR)) {
      return '21st';
    }

    // Pattern: claude-desktop
    // /Users/.../.claude-worktrees/{repo}/{name}
    if (parts.includes(CLAUDE_WORKTREES_DIR)) {
      return 'claude-desktop';
    }

    // Pattern: ccswitch
    // /Users/.../.ccswitch/worktrees/{repo}/{name}
    if (parts.includes(CCSWITCH_DIR) && parts.includes(WORKTREES_DIR)) {
      return 'ccswitch';
    }

    // Check if it's a standard git repo (only if filesystem exists)
    // For deleted repos, we'll return 'git' as fallback since we can't verify
    try {
      const gitPath = path.join(projectPath, '.git');
      try {
        await fs.promises.access(gitPath);
        return 'git';
      } catch {
        // Path doesn't exist
      }
    } catch {
      // Ignore errors - filesystem might not be available
    }

    // Default to 'git' for paths that don't match known patterns
    // This is a reasonable default since most worktrees come from git
    return 'git';
  }

  /**
   * Get the display name for a worktree based on its source.
   * Extracts the meaningful identifier from the path based on the pattern.
   *
   * @param projectPath - The filesystem path
   * @param source - The detected worktree source
   * @param branch - The git branch (if available)
   * @param isMainWorktree - Whether this is the main worktree
   * @returns Display name for the worktree
   */
  async getWorktreeDisplayName(
    projectPath: string,
    source: WorktreeSource,
    branch: string | null,
    isMainWorktree: boolean
  ): Promise<string> {
    const parts = projectPath.split(path.sep).filter(Boolean);

    switch (source) {
      case 'vibe-kanban': {
        // Pattern: vibe-kanban/worktrees/{issue-branch}/{repo}
        // Display: {issue-branch} (e.g., "92a6-kanban-extension")
        const worktreesIdx = parts.indexOf(WORKTREES_DIR);
        if (worktreesIdx >= 0 && parts[worktreesIdx + 1]) {
          return parts[worktreesIdx + 1];
        }
        break;
      }

      case 'conductor': {
        // Pattern: conductor/workspaces/{repo}/{workspace}
        // Display: {workspace} (e.g., "san-francisco")
        const workspacesIdx = parts.indexOf(WORKSPACES_DIR);
        if (workspacesIdx >= 0 && parts[workspacesIdx + 2]) {
          return parts[workspacesIdx + 2];
        }
        break;
      }

      case 'auto-claude': {
        // Pattern: .auto-claude/worktrees/tasks/{task-id}
        // Display: {task-id} (e.g., "002-hjell")
        const tasksIdx = parts.indexOf(TASKS_DIR);
        if (tasksIdx >= 0 && parts[tasksIdx + 1]) {
          return parts[tasksIdx + 1];
        }
        // Fallback: last component
        return parts[parts.length - 1];
      }

      case '21st': {
        // Pattern: .21st/worktrees/{id}/{name with [bracket-id]}
        // e.g., "mkp2f9a3y7x1s2nr 3b06478 [colonial-swordfish-fcad5f]"
        // Display: Extract from brackets (e.g., "colonial-swordfish-fcad5f")
        const lastPart = parts[parts.length - 1];
        // Extract content from square brackets using indexOf to avoid regex backtracking
        const bracketStart = lastPart.indexOf('[');
        const bracketEnd = lastPart.indexOf(']', bracketStart);
        if (bracketStart !== -1 && bracketEnd !== -1 && bracketEnd > bracketStart + 1) {
          return lastPart.slice(bracketStart + 1, bracketEnd);
        }
        // Fallback: use the last part as-is
        return lastPart;
      }

      case 'claude-desktop': {
        // Pattern: .claude-worktrees/{repo}/{name}
        // Display: {name} (e.g., "keen-sinoussi")
        const claudeWorktreesIdx = parts.indexOf(CLAUDE_WORKTREES_DIR);
        if (claudeWorktreesIdx >= 0 && parts[claudeWorktreesIdx + 2]) {
          return parts[claudeWorktreesIdx + 2];
        }
        break;
      }

      case 'ccswitch': {
        // Pattern: .ccswitch/worktrees/{repo}/{name}
        // Display: {name} (e.g., "just-explain-my-repo-briefly")
        const ccswitchWorktreesIdx = parts.indexOf(CCSWITCH_DIR);
        if (ccswitchWorktreesIdx >= 0) {
          const worktreesIdx = parts.indexOf(WORKTREES_DIR, ccswitchWorktreesIdx);
          if (worktreesIdx >= 0 && parts[worktreesIdx + 2]) {
            return parts[worktreesIdx + 2];
          }
        }
        break;
      }

      case 'git':
        // Standard git worktree - use branch or path-based name
        if (isMainWorktree) {
          return branch ?? 'main';
        }
        // For non-main git worktrees, try to get the worktree name from .git file
        return (await this.getGitWorktreeName(projectPath)) ?? branch ?? parts[parts.length - 1];

      case 'unknown':
      default:
        // Non-git project - use last path component
        return parts[parts.length - 1] ?? 'unknown';
    }

    // Fallback for any case that didn't return
    return branch ?? parts[parts.length - 1] ?? 'unknown';
  }

  /**
   * Get the worktree name from git's internal tracking.
   * Reads .git file to find the worktree name in .git/worktrees/{name}
   *
   * @param projectPath - The filesystem path
   * @returns Worktree name or null
   */
  private async getGitWorktreeName(projectPath: string): Promise<string | null> {
    try {
      const gitPath = path.join(projectPath, '.git');
      let stats: fs.Stats;
      try {
        stats = await fs.promises.stat(gitPath);
      } catch {
        return null;
      }
      if (!stats.isFile()) return null;

      const content = await fs.promises.readFile(gitPath, 'utf-8');
      const match = /gitdir:\s*(\S[^\r\n]*)/.exec(content);
      if (!match) return null;

      // gitdir: /main/.git/worktrees/my-worktree-name
      const gitdirParts = match[1].trim().split(path.sep);
      const worktreesIdx = gitdirParts.lastIndexOf(WORKTREES_DIR);
      if (worktreesIdx >= 0 && gitdirParts[worktreesIdx + 1]) {
        return gitdirParts[worktreesIdx + 1];
      }
      return null;
    } catch {
      return null;
    }
  }
}

// Export singleton instance
export const gitIdentityResolver = new GitIdentityResolver();
