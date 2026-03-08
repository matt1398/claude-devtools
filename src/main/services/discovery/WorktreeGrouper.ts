/**
 * WorktreeGrouper - Groups projects by git repository.
 *
 * Responsibilities:
 * - Group projects that belong to the same git repository
 * - Handle worktrees (main repo + worktrees grouped together)
 * - Filter out empty worktrees (no visible sessions)
 * - Sort worktrees by main first, then by most recent activity
 */

import {
  type Project,
  type RepositoryGroup,
  type RepositoryIdentity,
  type Worktree,
} from '@main/types';
import { extractBaseDir } from '@main/utils/pathDecoder';
import * as path from 'path';

import { LocalFileSystemProvider } from '../infrastructure/LocalFileSystemProvider';
import { gitIdentityResolver } from '../parsing/GitIdentityResolver';

import { SessionContentFilter } from './SessionContentFilter';
import { subprojectRegistry } from './SubprojectRegistry';

import type { FileSystemProvider } from '../infrastructure/FileSystemProvider';

/**
 * WorktreeGrouper provides methods for grouping projects by git repository.
 */
export class WorktreeGrouper {
  private readonly projectsDir: string;
  private readonly fsProvider: FileSystemProvider;

  constructor(projectsDir: string, fsProvider?: FileSystemProvider) {
    this.projectsDir = projectsDir;
    this.fsProvider = fsProvider ?? new LocalFileSystemProvider();
  }

  /**
   * Groups projects by git repository.
   * Projects belonging to the same git repository (main repo + worktrees)
   * are grouped together under a single RepositoryGroup.
   * Non-git projects are represented as single-worktree groups.
   *
   * Sessions are filtered to exclude noise-only sessions, so counts
   * accurately reflect visible sessions in the UI.
   *
   * @param projects - List of projects to group
   * @returns Promise resolving to RepositoryGroups sorted by most recent activity
   */
  async groupByRepository(projects: Project[]): Promise<RepositoryGroup[]> {
    if (projects.length === 0) {
      return [];
    }

    // 1. Resolve repository identity for each project
    const projectIdentities = new Map<string, RepositoryIdentity | null>();
    const projectBranches = new Map<string, string | null>();

    await Promise.all(
      projects.map(async (project) => {
        const identity = await gitIdentityResolver.resolveIdentity(project.path);
        projectIdentities.set(project.id, identity);

        // Also get branch name for display
        const branch = await gitIdentityResolver.getBranch(project.path);
        projectBranches.set(project.id, branch);
      })
    );

    // 2. Filter sessions for each project to only include non-noise sessions
    const projectFilteredSessions = new Map<string, string[]>();
    // Fast-first default for both local and SSH: avoid full-file scans during dashboard load.
    // Can be re-enabled for strict parity debugging.
    const shouldFilterNoise = process.env.CLAUDE_DEVTOOLS_STRICT_SESSION_FILTER === '1';
    await Promise.all(
      projects.map(async (project) => {
        const baseDir = extractBaseDir(project.id);
        const projectPath = path.join(this.projectsDir, baseDir);
        const sessionFilter = subprojectRegistry.getSessionFilter(project.id);
        const filteredSessions: string[] = [];

        for (const sessionId of project.sessions) {
          // Skip sessions that don't belong to this subproject
          if (sessionFilter && !sessionFilter.has(sessionId)) {
            continue;
          }
          if (!shouldFilterNoise) {
            filteredSessions.push(sessionId);
            continue;
          }

          const sessionPath = path.join(projectPath, `${sessionId}.jsonl`);
          if (await SessionContentFilter.hasNonNoiseMessages(sessionPath, this.fsProvider)) {
            filteredSessions.push(sessionId);
          }
        }

        projectFilteredSessions.set(project.id, filteredSessions);
      })
    );

    // 3. Group projects by repository
    const repoGroups = new Map<
      string,
      {
        identity: RepositoryIdentity | null;
        projects: Project[];
        branches: Map<string, string | null>;
      }
    >();

    for (const project of projects) {
      const identity = projectIdentities.get(project.id) ?? null;
      const branch = projectBranches.get(project.id) ?? null;

      // Use repository ID if available, otherwise use project ID (for non-git projects)
      const groupId = identity?.id ?? project.id;

      if (!repoGroups.has(groupId)) {
        repoGroups.set(groupId, {
          identity,
          projects: [],
          branches: new Map(),
        });
      }

      const group = repoGroups.get(groupId)!;
      group.projects.push(project);
      group.branches.set(project.id, branch);
    }

    // 4. Convert to RepositoryGroup[]
    const repositoryGroups: RepositoryGroup[] = [];

    for (const [groupId, group] of repoGroups) {
      const worktrees: Worktree[] = await Promise.all(group.projects.map(async (project) => {
        const branch = group.branches.get(project.id) ?? null;
        const isMainWorktree = !(await gitIdentityResolver.isWorktree(project.path));
        // Use filtered sessions instead of raw sessions
        const filteredSessions = projectFilteredSessions.get(project.id) ?? [];
        // Detect worktree source for badge display
        const source = await gitIdentityResolver.detectWorktreeSource(project.path);
        // Use source-aware display name generation
        const displayName = await gitIdentityResolver.getWorktreeDisplayName(
          project.path,
          source,
          branch,
          isMainWorktree
        );

        return {
          id: project.id,
          path: project.path,
          name: displayName,
          gitBranch: branch ?? undefined,
          isMainWorktree,
          source,
          sessions: filteredSessions,
          createdAt: project.createdAt,
          mostRecentSession: project.mostRecentSession,
        };
      }));

      // Filter out worktrees with 0 visible sessions
      const nonEmptyWorktrees = worktrees.filter((wt) => wt.sessions.length > 0);

      // Skip this repository group if all worktrees are empty
      if (nonEmptyWorktrees.length === 0) {
        continue;
      }

      // Sort worktrees: main first, then by most recent activity
      nonEmptyWorktrees.sort((a, b) => {
        if (a.isMainWorktree && !b.isMainWorktree) return -1;
        if (!a.isMainWorktree && b.isMainWorktree) return 1;
        return (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0);
      });

      const totalSessions = nonEmptyWorktrees.reduce((sum, wt) => sum + wt.sessions.length, 0);
      const mostRecentSession = Math.max(
        ...nonEmptyWorktrees.map((wt) => wt.mostRecentSession ?? 0)
      );

      repositoryGroups.push({
        id: groupId,
        identity: group.identity,
        worktrees: nonEmptyWorktrees,
        name: group.identity?.name ?? group.projects[0].name,
        mostRecentSession: mostRecentSession > 0 ? mostRecentSession : undefined,
        totalSessions,
      });
    }

    // 5. Sort repository groups by most recent activity
    repositoryGroups.sort((a, b) => (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0));

    return repositoryGroups;
  }

  /**
   * Lists sessions for a specific worktree.
   * This is a convenience method that returns the worktree ID.
   *
   * @param worktreeId - The worktree ID (same as project ID)
   * @returns The worktree ID for delegation to listSessions
   */
  getWorktreeProjectId(worktreeId: string): string {
    // Worktree ID is the same as project ID
    return worktreeId;
  }
}
