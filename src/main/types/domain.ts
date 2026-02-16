/**
 * Domain/business entity types for claude-devtools.
 *
 * These types represent the application's domain model:
 * - Projects and sessions
 * - Repository and worktree grouping
 * - Search and pagination
 * - Token usage and metrics
 */

import { type UsageMetadata } from './jsonl';

// =============================================================================
// Application-Specific Type Aliases
// =============================================================================

/**
 * Token usage statistics (alias for API compatibility).
 * Maps to UsageMetadata from the spec.
 */
export type TokenUsage = UsageMetadata;

/**
 * Message type classification for parsed messages.
 */
export type MessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'file-history-snapshot'
  | 'queue-operation';

/**
 * Message category for chunk building.
 * Used to classify messages into one of four categories for independent chunk creation.
 */
export type MessageCategory = 'user' | 'system' | 'hardNoise' | 'ai' | 'compact';

// =============================================================================
// Project & Session Types
// =============================================================================

/**
 * Project information derived from ~/.claude/projects/ directory.
 */
export interface Project {
  /** Encoded directory name (e.g., "-Users-username-projectname") */
  id: string;
  /** Decoded actual filesystem path */
  path: string;
  /** Display name (last path segment) */
  name: string;
  /** List of session IDs (JSONL filenames without extension) */
  sessions: string[];
  /** Unix timestamp when project directory was created */
  createdAt: number;
  /** Unix timestamp of most recent session activity */
  mostRecentSession?: number;
}

/**
 * Session metadata and summary.
 */
export type SessionMetadataLevel = 'light' | 'deep';

/**
 * Per-phase token breakdown for compaction-aware context consumption.
 */
export interface PhaseTokenBreakdown {
  /** 1-based phase number */
  phaseNumber: number;
  /** Tokens added during this phase */
  contribution: number;
  /** Context window at peak (pre-compaction or final) */
  peakTokens: number;
  /** Tokens after compaction (undefined for the last/current phase) */
  postCompaction?: number;
}

export interface Session {
  /** Session UUID (JSONL filename without extension) */
  id: string;
  /** Parent project ID */
  projectId: string;
  /** Project filesystem path */
  projectPath: string;
  /** Task list data from ~/.claude/todos/{id}.json if exists */
  todoData?: unknown;
  /** Unix timestamp when session file was created */
  createdAt: number;
  /** First user message text (for preview) */
  firstMessage?: string;
  /** Timestamp of first user message (RFC3339) */
  messageTimestamp?: string;
  /** Whether this session has subagents */
  hasSubagents: boolean;
  /** Total message count in the session */
  messageCount: number;
  /** Whether the session is ongoing (last AI response has no output yet) */
  isOngoing?: boolean;
  /** Git branch name if available */
  gitBranch?: string;
  /** Metadata completeness level */
  metadataLevel?: SessionMetadataLevel;
  /** Total context consumed (compaction-aware sum of all phases) */
  contextConsumption?: number;
  /** Number of compaction events */
  compactionCount?: number;
  /** Per-phase token breakdown for tooltip display */
  phaseBreakdown?: PhaseTokenBreakdown[];
}

/**
 * Aggregated metrics for a session or chunk.
 */
export interface SessionMetrics {
  /** Duration in milliseconds */
  durationMs: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** Input tokens */
  inputTokens: number;
  /** Output tokens */
  outputTokens: number;
  /** Cache read tokens */
  cacheReadTokens: number;
  /** Cache creation tokens */
  cacheCreationTokens: number;
  /** Number of messages */
  messageCount: number;
  /** Estimated cost in USD */
  costUsd?: number;
}

// =============================================================================
// Repository & Worktree Grouping Types
// =============================================================================

/**
 * Worktree source identifies how/where the worktree was created.
 * Used for badge display and source-specific naming strategies.
 */
export type WorktreeSource =
  | 'vibe-kanban' // /tmp/vibe-kanban/worktrees/{issue-branch}/{repo}
  | 'conductor' // /Users/.../conductor/workspaces/{repo}/{workspace}
  | 'auto-claude' // /Users/.../.auto-claude/worktrees/tasks/{task-id}
  | '21st' // /Users/.../.21st/worktrees/{id}/{name [bracket-id]}
  | 'claude-desktop' // /Users/.../.claude-worktrees/{repo}/{name}
  | 'ccswitch' // /Users/.../.ccswitch/worktrees/{repo}/{name}
  | 'git' // Standard git worktree (main repo or detached)
  | 'unknown'; // Non-git project or undetectable

/**
 * Git repository identity for grouping worktrees.
 * Multiple projects (worktrees) can share the same RepositoryIdentity.
 */
export interface RepositoryIdentity {
  /** Unique identifier - hash of remote URL or main repo path */
  id: string;
  /** Git remote URL if available (e.g., "https://github.com/org/repo.git") */
  remoteUrl?: string;
  /** Path to the main git directory (e.g., "/Users/username/projectname/.git") */
  mainGitDir: string;
  /** Display name for the repository (e.g., "projectname") */
  name: string;
}

/**
 * A worktree represents a single working directory of a git repository.
 * In the grouped view, projects become worktrees under a RepositoryGroup.
 */
export interface Worktree {
  /** Encoded directory name (same as Project.id) */
  id: string;
  /** Decoded actual filesystem path */
  path: string;
  /** Display name (worktree-specific, e.g., branch name or "main") */
  name: string;
  /** Git branch name if available */
  gitBranch?: string;
  /** Whether this is the main worktree (not a detached worktree) */
  isMainWorktree: boolean;
  /** Worktree source for badge display (vibe-kanban, conductor, etc.) */
  source: WorktreeSource;
  /** List of session IDs */
  sessions: string[];
  /** Unix timestamp when first session was created */
  createdAt: number;
  /** Unix timestamp of most recent session activity */
  mostRecentSession?: number;
}

/**
 * A repository group contains all worktrees of a single git repository.
 * This is the top-level entity when worktree grouping is enabled.
 * Non-git projects are represented as single-worktree RepositoryGroups.
 */
export interface RepositoryGroup {
  /** Unique identifier from RepositoryIdentity.id (or project.id for non-git) */
  id: string;
  /** Repository identity information (null for non-git projects) */
  identity: RepositoryIdentity | null;
  /** All worktrees of this repository */
  worktrees: Worktree[];
  /** Display name (derived from repo name) */
  name: string;
  /** Unix timestamp of most recent session across all worktrees */
  mostRecentSession?: number;
  /** Total session count across all worktrees */
  totalSessions: number;
}

// =============================================================================
// Search Types
// =============================================================================

/**
 * A single search result from searching sessions.
 */
export interface SearchResult {
  /** Session ID where match was found */
  sessionId: string;
  /** Project ID */
  projectId: string;
  /** Session title/first message */
  sessionTitle: string;
  /** The matched text (trimmed) */
  matchedText: string;
  /** Context around the match */
  context: string;
  /** Message type (user/assistant) */
  messageType: 'user' | 'assistant';
  /** Timestamp of the message */
  timestamp: number;
  /** Stable chat group ID used by in-session navigation (e.g., "user-..." or "ai-...") */
  groupId?: string;
  /** Searchable item type used for in-session matching */
  itemType?: 'user' | 'ai';
  /** Match index within the item's searchable text (0-based) */
  matchIndexInItem?: number;
  /** Character offset of the match within the searchable text */
  matchStartOffset?: number;
  /** Source message UUID for diagnostics/fallback mapping */
  messageUuid?: string;
}

/**
 * Result of a search operation.
 */
export interface SearchSessionsResult {
  /** Search results */
  results: SearchResult[];
  /** Total matches found */
  totalMatches: number;
  /** Sessions searched */
  sessionsSearched: number;
  /** Search query used */
  query: string;
  /** True when fast mode intentionally returns only a recent subset */
  isPartial?: boolean;
}

// =============================================================================
// Pagination Types
// =============================================================================

/**
 * Cursor for session pagination.
 * Uses timestamp + sessionId as a composite cursor for stable pagination.
 */
export interface SessionCursor {
  /** Unix timestamp (birthtimeMs) of the session file */
  timestamp: number;
  /** Session ID for tie-breaking when timestamps are equal */
  sessionId: string;
}

/**
 * Result of paginated session listing.
 */
export interface PaginatedSessionsResult {
  /** Sessions for this page */
  sessions: Session[];
  /** Cursor for next page (null if no more pages) */
  nextCursor: string | null;
  /** Whether there are more sessions to load */
  hasMore: boolean;
  /** Total count of sessions (for display purposes) */
  totalCount: number;
}

/**
 * Options controlling paginated session listing behavior.
 */
export interface SessionsPaginationOptions {
  /**
   * Whether to compute an accurate totalCount by scanning all sessions.
   * Disable for faster background refreshes.
   * @default true
   */
  includeTotalCount?: boolean;
  /**
   * Whether to pre-filter all session files before paging.
   * Disable for faster top-of-list refreshes.
   * @default true
   */
  prefilterAll?: boolean;
  /**
   * Metadata depth to return for listed sessions.
   * - light: filesystem metadata only (fast)
   * - deep: includes parsed session content summary fields (slower)
   * @default 'deep'
   */
  metadataLevel?: SessionMetadataLevel;
}

/**
 * Options for targeted session fetches by session ID.
 */
export interface SessionsByIdsOptions {
  /**
   * Metadata depth to return for each session.
   * - light: fast preview fields suitable for list/sidebar
   * - deep: full summary metadata (slower)
   * @default provider-specific default (SSH=light, local=deep)
   */
  metadataLevel?: SessionMetadataLevel;
}
