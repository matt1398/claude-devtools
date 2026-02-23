/**
 * Discovery services - Scanning and locating session data.
 *
 * Exports:
 * - ProjectScanner: Scans ~/.claude/projects/ for projects and sessions
 * - SessionSearcher: Searches session content
 * - SessionContentFilter: Filters session content for display
 * - SubagentLocator: Locates subagent JSONL files
 * - SubagentResolver: Resolves and links subagents to Task calls
 * - WorktreeGrouper: Groups projects by git worktree
 */

export * from './ProjectPathResolver';
export * from './ProjectScanner';
export * from './SearchTextCache';
export * from './SearchTextExtractor';
export * from './SessionContentFilter';
export * from './SessionSearcher';
export * from './SubagentLocator';
export * from './SubagentResolver';
export * from './SubprojectRegistry';
export * from './WorktreeGrouper';
