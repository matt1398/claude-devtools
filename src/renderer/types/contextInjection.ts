/**
 * Type definitions for unified context injection tracking.
 * Extends CLAUDE.md tracking to include mentioned files (@mentions) and tool outputs.
 * This provides a comprehensive view of all context sources injected into the conversation.
 */

import type { ClaudeMdInjection } from './claudeMd';

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum tokens to estimate for a mentioned file.
 * Files larger than this are capped to prevent unrealistic token estimates.
 */
export const MAX_MENTIONED_FILE_TOKENS = 25000;

// =============================================================================
// Mentioned File Types
// =============================================================================

/**
 * Represents a file mentioned via @-mention that was injected into context.
 * Tracks the file path, token estimate, and where it first appeared in the session.
 */
export interface MentionedFileInjection {
  /** Unique identifier for this injection */
  id: string;
  /** Discriminator for type narrowing */
  category: 'mentioned-file';
  /** Absolute file path of the mentioned file */
  path: string;
  /** Relative path or filename for display purposes */
  displayName: string;
  /** Estimated token count for this file's content */
  estimatedTokens: number;
  /** Turn index where this file was first mentioned */
  firstSeenTurnIndex: number;
  /** AI group ID (e.g., "ai-0") where this file was first seen, for navigation */
  firstSeenInGroup: string;
  /** Whether the file exists on disk */
  exists: boolean;
}

/**
 * Information about a mentioned file returned from IPC.
 * Used to get file metadata before creating a MentionedFileInjection.
 */
export interface MentionedFileInfo {
  /** Absolute file path */
  path: string;
  /** Whether the file exists on disk */
  exists: boolean;
  /** Character count of file content */
  charCount: number;
  /** Estimated token count (typically charCount / 4) */
  estimatedTokens: number;
}

// =============================================================================
// Tool Output Types
// =============================================================================

/**
 * Breakdown of tokens contributed by a single tool in a turn.
 */
export interface ToolTokenBreakdown {
  /** Name of the tool (e.g., "Read", "Grep", "Bash") */
  toolName: string;
  /** Number of tokens in the tool's output */
  tokenCount: number;
  /** Whether the tool execution resulted in an error */
  isError: boolean;
  /** Tool use ID for deep-link navigation to specific tool in chat */
  toolUseId?: string;
}

/**
 * Represents aggregated tool output context for a single AI turn.
 * Multiple tools may execute in one turn; this aggregates their token contributions.
 */
export interface ToolOutputInjection {
  /** Unique identifier (e.g., "tool-output-ai-0") */
  id: string;
  /** Discriminator for type narrowing */
  category: 'tool-output';
  /** Turn index where these tool outputs occurred */
  turnIndex: number;
  /** AI group ID for navigation (e.g., "ai-0") */
  aiGroupId: string;
  /** Total estimated tokens from all tools in this turn */
  estimatedTokens: number;
  /** Number of tools that contributed output */
  toolCount: number;
  /** Detailed breakdown of tokens by individual tool */
  toolBreakdown: ToolTokenBreakdown[];
}

// =============================================================================
// Thinking/Text Output Types
// =============================================================================

/**
 * Breakdown of thinking vs text tokens within a turn.
 */
export interface ThinkingTextBreakdown {
  /** Type of content */
  type: 'thinking' | 'text';
  /** Estimated token count */
  tokenCount: number;
}

/**
 * Thinking and Text output token injection for a single turn.
 * Aggregates all thinking blocks and text outputs within one AI response turn.
 */
export interface ThinkingTextInjection {
  /** Unique identifier (e.g., "thinking-text-ai-0") */
  id: string;
  /** Discriminator for type narrowing */
  category: 'thinking-text';
  /** Turn index where this content occurred */
  turnIndex: number;
  /** AI group ID for navigation (e.g., "ai-0") */
  aiGroupId: string;
  /** Total estimated tokens from thinking + text in this turn */
  estimatedTokens: number;
  /** Detailed breakdown of thinking vs text tokens */
  breakdown: ThinkingTextBreakdown[];
}

// =============================================================================
// User Message Types
// =============================================================================

/**
 * Represents a user message injected into context for a single turn.
 * User prompts are a real part of the context window — tracking them
 * provides a more complete picture of what consumes tokens.
 */
export interface UserMessageInjection {
  /** Unique identifier (e.g., "user-msg-ai-0") */
  id: string;
  /** Discriminator for type narrowing */
  category: 'user-message';
  /** Turn index where this user message occurred */
  turnIndex: number;
  /** AI group ID for navigation (e.g., "ai-0") */
  aiGroupId: string;
  /** Estimated token count for the user message content */
  estimatedTokens: number;
  /** First ~80 characters of the message for preview */
  textPreview: string;
}

// =============================================================================
// Task Coordination Types
// =============================================================================

/**
 * Breakdown of tokens contributed by a single task coordination item.
 */
export interface TaskCoordinationBreakdown {
  /** Type of task coordination item */
  type: 'teammate-message' | 'send-message' | 'task-tool';
  /** Tool name (e.g., "TeamCreate", "TaskCreate", "SendMessage") */
  toolName?: string;
  /** Estimated token count */
  tokenCount: number;
  /** Display label (e.g., teammate name, "TaskCreate #3") */
  label: string;
}

/**
 * Represents aggregated task coordination context for a single AI turn.
 * Tracks SendMessage, TeamCreate, TaskCreate, and other task tools separately
 * from generic tool outputs.
 */
export interface TaskCoordinationInjection {
  /** Unique identifier (e.g., "task-coord-ai-0") */
  id: string;
  /** Discriminator for type narrowing */
  category: 'task-coordination';
  /** Turn index where these task coordination items occurred */
  turnIndex: number;
  /** AI group ID for navigation (e.g., "ai-0") */
  aiGroupId: string;
  /** Total estimated tokens from all task coordination items in this turn */
  estimatedTokens: number;
  /** Detailed breakdown of tokens by individual item */
  breakdown: TaskCoordinationBreakdown[];
}

// =============================================================================
// Union Types
// =============================================================================

/**
 * Extended ClaudeMdInjection with category discriminator for union compatibility.
 */
export type ClaudeMdContextInjection = ClaudeMdInjection & { category: 'claude-md' };

/**
 * Discriminated union of all context injection types.
 * Use the `category` field to narrow the type:
 * - 'claude-md': CLAUDE.md configuration injections
 * - 'mentioned-file': User @-mentioned file injections
 * - 'tool-output': Tool execution output injections
 * - 'thinking-text': Thinking and text output token injections
 * - 'task-coordination': Task coordination tool and message injections
 * - 'user-message': User message prompt injections
 */
export type ContextInjection =
  | ClaudeMdContextInjection
  | MentionedFileInjection
  | ToolOutputInjection
  | ThinkingTextInjection
  | TaskCoordinationInjection
  | UserMessageInjection;

// =============================================================================
// Statistics Types
// =============================================================================

/**
 * Token counts broken down by context source category.
 */
export interface TokensByCategory {
  /** Tokens from CLAUDE.md injections */
  claudeMd: number;
  /** Tokens from mentioned files */
  mentionedFiles: number;
  /** Tokens from tool outputs */
  toolOutputs: number;
  /** Tokens from thinking blocks and text outputs */
  thinkingText: number;
  /** Tokens from task coordination (SendMessage, TeamCreate, TaskCreate, etc.) */
  taskCoordination: number;
  /** Tokens from user messages */
  userMessages: number;
}

/**
 * Counts of new injections broken down by context source category.
 */
export interface NewCountsByCategory {
  /** Count of new CLAUDE.md injections */
  claudeMd: number;
  /** Count of new mentioned file injections */
  mentionedFiles: number;
  /** Count of new tool output injections */
  toolOutputs: number;
  /** Count of new thinking/text injections */
  thinkingText: number;
  /** Count of new task coordination injections */
  taskCoordination: number;
  /** Count of new user message injections */
  userMessages: number;
}

/**
 * Comprehensive statistics about context injections for an AI group.
 * Tracks both new injections in the current group and accumulated totals,
 * with breakdowns by category.
 */
export interface ContextStats {
  /** Injections that are new in THIS group */
  newInjections: ContextInjection[];
  /** All injections accumulated up to and including this group */
  accumulatedInjections: ContextInjection[];
  /** Total estimated tokens from all accumulated injections */
  totalEstimatedTokens: number;
  /** Token counts broken down by category */
  tokensByCategory: TokensByCategory;
  /** Counts of new injections in this group, by category */
  newCounts: NewCountsByCategory;
  /** Which context phase this stats belongs to (1-based) */
  phaseNumber?: number;
}

// =============================================================================
// Context Phase Types
// =============================================================================

/** Token change at a compaction boundary */
export interface CompactionTokenDelta {
  preCompactionTokens: number;
  postCompactionTokens: number;
  delta: number; // negative = context freed
}

/** Metadata about a single context phase */
export interface ContextPhase {
  phaseNumber: number; // 1-based
  firstAIGroupId: string;
  lastAIGroupId: string;
  compactGroupId: string | null; // null for phase 1
  startTokens?: number;
  endTokens?: number;
}

/** Session-wide phase information */
export interface ContextPhaseInfo {
  phases: ContextPhase[];
  compactionCount: number;
  aiGroupPhaseMap: Map<string, number>; // aiGroupId → phaseNumber
  compactionTokenDeltas: Map<string, CompactionTokenDelta>; // compactGroupId → delta
}
