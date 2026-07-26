/**
 * Chunk and visualization types for claude-devtools.
 *
 * This module contains:
 * - Chunk types (UserChunk, AIChunk, SystemChunk, CompactChunk)
 * - Process/subagent execution types
 * - Conversation grouping types
 * - Semantic step types for detailed visualization
 * - Enhanced chunk types with visualization data
 * - Session detail types
 * - Chunk type guards
 * - Constants
 */

import { type Session, type SessionMetrics } from './domain';
import { type ChatHistoryEntry, type ToolUseResultData } from './jsonl';
import { type ParsedMessage, type ToolCall, type ToolResult } from './messages';

// =============================================================================
// Process Types (Subagent Execution)
// =============================================================================

/**
 * Resolved subagent information.
 */
export interface Process {
  /** Agent ID extracted from filename */
  id: string;
  /** Path to the subagent JSONL file */
  filePath: string;
  /** Parsed messages from the subagent session */
  messages: ParsedMessage[];
  /** When the subagent started */
  startTime: Date;
  /** When the subagent ended */
  endTime: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Aggregated metrics for the subagent */
  metrics: SessionMetrics;
  /** Task description from parent Task call */
  description?: string;
  /** Subagent type from Task call (e.g., "Explore", "Plan") */
  subagentType?: string;
  /** Whether executed in parallel with other subagents */
  isParallel: boolean;
  /** The tool_use ID of the Task call that spawned this */
  parentTaskId?: string;
  /** Whether this subagent is still in progress */
  isOngoing?: boolean;
  /**
   * Main session impact tokens - the tokens the Task tool_call and tool_result
   * consume in the main session's context window. This is different from the
   * subagent's internal token usage (metrics/messages).
   */
  mainSessionImpact?: {
    /** Task tool_use input tokens (prompt, config) */
    callTokens: number;
    /** Task tool_result output tokens (subagent's return value) */
    resultTokens: number;
    /** Total tokens affecting main session */
    totalTokens: number;
  };
  /** Team metadata - present when this subagent is a team member */
  team?: {
    teamName: string;
    memberName: string;
    memberColor: string;
  };
}

// =============================================================================
// Chunk Types (for visualization)
// =============================================================================

/**
 * Base chunk properties shared by all chunk types.
 */
interface BaseChunk {
  /** Unique chunk identifier */
  id: string;
  /** When the chunk started */
  startTime: Date;
  /** When the chunk ended */
  endTime: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Aggregated metrics for the chunk */
  metrics: SessionMetrics;
}

/**
 * User chunk - represents a single user input message.
 * This is separate from AI responses to support independent visualization.
 */
export interface UserChunk extends BaseChunk {
  /** Discriminator for chunk type */
  chunkType: 'user';
  /** The user message */
  userMessage: ParsedMessage;
}

/**
 * AI chunk - represents all assistant responses to a user message.
 * Contains responses, tool executions, and subagent spawns.
 *
 * NOTE: AI chunks are independent - they no longer reference a parent user chunk.
 */
export interface AIChunk extends BaseChunk {
  /** Discriminator for chunk type */
  chunkType: 'ai';
  /** All assistant responses and internal messages */
  responses: ParsedMessage[];
  /** Processes spawned during this chunk */
  processes: Process[];
  /** Sidechain messages within this chunk */
  sidechainMessages: ParsedMessage[];
  /** Tool executions in this chunk */
  toolExecutions: ToolExecution[];
}

/**
 * System chunk - represents command output rendered like AI.
 */
export interface SystemChunk extends BaseChunk {
  chunkType: 'system';
  message: ParsedMessage;
  commandOutput: string; // Extracted from <local-command-stdout>
}

/**
 * Compact boundary chunk - marks where conversation was compacted.
 */
export interface CompactChunk extends BaseChunk {
  chunkType: 'compact';
  message: ParsedMessage;
}

/**
 * Notification chunk - an auto-injected background-task / agent-completion event
 * (`<task-notification>`). Rendered as a muted, centered system divider, NOT a
 * user bubble.
 */
export interface NotificationChunk extends BaseChunk {
  chunkType: 'notification';
  message: ParsedMessage;
  /** Concise display label extracted from the notification payload. */
  label: string;
}

/**
 * Shell-command chunk - an interactive `!` shell command and its captured
 * output. Merges the `<bash-input>` command entry with the immediately-following
 * `<bash-stdout>`/`<bash-stderr>` output entries into a single terminal-style
 * block, NOT a user bubble.
 */
export interface ShellCommandChunk extends BaseChunk {
  chunkType: 'shell';
  /** The `<bash-input>` command message (source of the chunk). */
  message: ParsedMessage;
  /** The command text (contents of `<bash-input>`, tags stripped, trimmed). */
  command: string;
  /** Captured stdout (concatenated `<bash-stdout>` blocks, trimmed). */
  stdout: string;
  /** Captured stderr (concatenated `<bash-stderr>` blocks, trimmed). */
  stderr: string;
}

/**
 * A chunk can be either a user input, AI response, system output, compact
 * boundary, a background-task notification, or a shell command.
 * This discriminated union enables separate visualization and processing.
 */
export type Chunk =
  | UserChunk
  | AIChunk
  | SystemChunk
  | CompactChunk
  | NotificationChunk
  | ShellCommandChunk;

/**
 * Tool execution with timing information.
 */
export interface ToolExecution {
  /** The tool call */
  toolCall: ToolCall;
  /** The tool result if received */
  result?: ToolResult;
  /** When the tool was called */
  startTime: Date;
  /** When the result was received */
  endTime?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
}

// =============================================================================
// Conversation Group Types (Simplified Grouping Strategy)
// =============================================================================

/**
 * Task execution links a Task tool call to its subagent execution.
 * This provides a complete view of async subagent work initiated by Task tool.
 */
export interface TaskExecution {
  /** The Task tool_use block that initiated the subagent */
  taskCall: ToolCall;
  /** When the Task tool was called */
  taskCallTimestamp: Date;
  /** The linked subagent execution */
  subagent: Process;
  /** The isMeta:true tool_result message for this Task */
  toolResult: ParsedMessage;
  /** When the tool result was received */
  resultTimestamp: Date;
  /** Duration from task call to result */
  durationMs: number;
}

/**
 * ConversationGroup represents a natural grouping in the conversation flow:
 * - One real user message (isMeta: false, string content)
 * - All AI responses until the next user message (assistant messages + internal messages)
 * - Subagents spawned during this group
 * - Tool executions (excluding Task tools with subagents to avoid duplication)
 * - Task executions (Task tools with their subagent results)
 *
 * This is a simplified alternative to Chunks that focuses on natural conversation boundaries.
 */
export interface ConversationGroup {
  /** Unique group identifier */
  id: string;
  /** Group type - currently only one type but extensible */
  type: 'user-ai-exchange';
  /** The real user message that starts this group (isMeta: false) */
  userMessage: ParsedMessage;
  /** All AI responses: assistant messages and internal messages (tool results, etc.) */
  aiResponses: ParsedMessage[];
  /** Processes spawned during this group */
  processes: Process[];
  /** Tool executions (excluding Task tools that have matching processes) */
  toolExecutions: ToolExecution[];
  /** Task tool calls with their subagent executions */
  taskExecutions: TaskExecution[];
  /** When the group started (user message timestamp) */
  startTime: Date;
  /** When the group ended (last AI response timestamp) */
  endTime: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Aggregated metrics for the group */
  metrics: SessionMetrics;
}

// =============================================================================
// Semantic Step Types (Enhanced Chunk Visualization)
// =============================================================================

/**
 * Semantic step types for breakdown within responses.
 */
export type SemanticStepType =
  | 'thinking' // Extended thinking content
  | 'tool_call' // Tool invocation
  | 'tool_result' // Tool result received
  | 'subagent' // Subagent execution
  | 'output' // Main text output
  | 'interruption'; // User interruption

/**
 * A semantic step represents a logical unit of work within a response.
 *
 * Note: Task tool_use blocks are filtered during extraction when corresponding
 * subagents exist. Since Task calls spawn async subagents, the tool_call and
 * subagent represent the same execution. Filtering prevents duplicate entries
 * Orphaned Task calls (without matching subagents) are
 * retained as fallback to ensure visibility of all work.
 */
export interface SemanticStep {
  /** Unique step identifier */
  id: string;
  /** Step type */
  type: SemanticStepType;
  /** When the step started */
  startTime: Date;
  /** When the step ended */
  endTime?: Date;
  /** Duration in milliseconds */
  durationMs: number;

  /** Content varies by type */
  content: {
    thinkingText?: string; // For thinking
    toolName?: string; // For tool_call/result
    toolInput?: unknown; // For tool_call
    toolResultContent?: string; // For tool_result
    isError?: boolean; // For tool_result
    toolUseResult?: ToolUseResultData; // For tool_result - enriched data from message
    tokenCount?: number; // For tool_result - pre-computed token count
    subagentId?: string; // For subagent
    subagentDescription?: string;
    outputText?: string; // For output
    sourceModel?: string; // For tool_call - model from source assistant message
    interruptionText?: string; // For interruption - the interruption message text
  };

  /** Token attribution */
  tokens?: {
    input: number;
    output: number;
    cached?: number;
  };

  /** Parallel execution */
  isParallel?: boolean;
  groupId?: string;

  /** Context (main agent vs subagent) */
  context: 'main' | 'subagent';
  agentId?: string;

  /** Source message UUID (for grouping steps by assistant message) */
  sourceMessageId?: string;

  /** Effective end time after gap filling (extends to next step or chunk end) */
  effectiveEndTime?: Date;

  /** Effective duration including waiting time until next step */
  effectiveDurationMs?: number;

  /** Whether timing was gap-filled vs having original endTime */
  isGapFilled?: boolean;

  /** Context tokens for this step (cache_read + cache_creation + input) */
  contextTokens?: number;

  /** Cumulative context up to this step (session-wide accumulation) */
  accumulatedContext?: number;

  /** Token breakdown for step-level estimation */
  tokenBreakdown?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  };
}

/**
 * Semantic step group for collapsible visualization.
 * Groups multiple micro-steps by their source assistant message.
 */
export interface SemanticStepGroup {
  /** Unique group ID */
  id: string;
  /** Display label (e.g., "Assistant Response", "Tool: Read") */
  label: string;
  /** Steps in this group */
  steps: SemanticStep[];
  /** true if multiple steps grouped, false if standalone */
  isGrouped: boolean;
  /** Assistant message UUID if grouped */
  sourceMessageId?: string;
  /** Earliest step start */
  startTime: Date;
  /** Latest step end */
  endTime: Date;
  /** Sum of all step durations */
  totalDuration: number;
}

// =============================================================================
// Enhanced Chunk Types
// =============================================================================

/**
 * Enhanced AI chunk with semantic step breakdown.
 * This extends AIChunk with additional visualization data.
 */
export interface EnhancedAIChunk extends AIChunk {
  /** Semantic steps extracted from messages */
  semanticSteps: SemanticStep[];
  /** Semantic steps grouped for collapsible UI */
  semanticStepGroups?: SemanticStepGroup[];
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced user chunk with additional metadata.
 */
export interface EnhancedUserChunk extends UserChunk {
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced system chunk with additional metadata.
 */
export interface EnhancedSystemChunk extends SystemChunk {
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced compact chunk with additional metadata.
 */
export interface EnhancedCompactChunk extends CompactChunk {
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced notification chunk with additional metadata.
 */
export interface EnhancedNotificationChunk extends NotificationChunk {
  /** Raw messages for debug sidebar */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced shell-command chunk with additional metadata.
 */
export interface EnhancedShellCommandChunk extends ShellCommandChunk {
  /** Raw messages for debug sidebar (command + any merged output entries). */
  rawMessages: ParsedMessage[];
}

/**
 * Enhanced chunk can be user, AI, system, compact, notification, or shell type.
 */
export type EnhancedChunk =
  | EnhancedUserChunk
  | EnhancedAIChunk
  | EnhancedSystemChunk
  | EnhancedCompactChunk
  | EnhancedNotificationChunk
  | EnhancedShellCommandChunk;

// =============================================================================
// Session Detail (complete parsed session)
// =============================================================================

/**
 * Complete parsed session with all data.
 */
export interface SessionDetail {
  /** Session metadata */
  session: Session;
  /** All messages in the session */
  messages: ParsedMessage[];
  /** Messages grouped into chunks */
  chunks: Chunk[];
  /** All processes in the session */
  processes: Process[];
  /** Aggregated metrics for the entire session */
  metrics: SessionMetrics;
  /**
   * Opaque file-state fingerprint (mtimeMs+size) attached by the IPC handler.
   * The renderer treats this as opaque — it's compared by string equality only,
   * never parsed. Used to short-circuit `getSessionDetail` calls when the
   * underlying file hasn't changed since the last successful fetch.
   */
  fingerprint?: string;
  /**
   * Byte length of the session file read to build this payload. It is the baseline for
   * incremental streaming: the renderer stores it and the SessionTailer emits
   * `session-append` deltas starting from exactly this offset (no gap/overlap).
   * Attached by the `getSessionDetail` HTTP route.
   */
  tailOffset?: number;
}

/**
 * Sentinel response from `getSessionDetail` indicating the file is unchanged
 * since the renderer's last fetch. Returned only when the caller passes a
 * `knownFingerprint` that matches the current file state. Lets the renderer
 * skip transformation and re-render entirely on no-op refreshes.
 */
export interface SessionDetailUnchanged {
  unchanged: true;
  fingerprint: string;
}

/**
 * Discriminated union for `getSessionDetail` IPC responses.
 * - `SessionDetail`: full payload (initial load OR file changed since last fetch)
 * - `SessionDetailUnchanged`: file unchanged, renderer should no-op
 * - `null`: error or session not found
 */
export type SessionDetailResponse = SessionDetail | SessionDetailUnchanged;

/**
 * Detailed subagent information for drill-down modal.
 * Contains parsed execution data for a specific subagent.
 */
export interface SubagentDetail {
  /** Agent ID */
  id: string;
  /** Task description */
  description: string;
  /** Subagent's chunks with semantic breakdown */
  chunks: EnhancedChunk[];
  /** Semantic step groups for visualization */
  semanticStepGroups?: SemanticStepGroup[];
  /** Start time */
  startTime: Date;
  /** End time */
  endTime: Date;
  /** Duration in milliseconds */
  duration: number;
  /** Token and message metrics */
  metrics: {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    messageCount: number;
  };
}

// =============================================================================
// Utility Types
// =============================================================================

/**
 * Payload for the `session-append` event (SSE + Electron IPC).
 *
 * Emitted only for baselined (open) sessions on clean forward growth. Carries the
 * newly-appended raw entries (for gap-detection/observability) AND the fully-rebuilt
 * `chunks` array — the SAME shape `getSessionDetail` returns — so the renderer applies
 * it identically to a full detail payload, with NO re-fetch and NO re-parse.
 */
export interface SessionAppendEvent {
  sessionId: string;
  /** Project id when known (state-file changes carry none — those are never tailed). */
  projectId?: string;
  /**
   * Raw parsed JSONL line objects for this delta, in file order (the direct
   * `JSON.parse` of each complete appended line). The renderer does not transform
   * these — it consumes `chunks` — but they are kept for gap-detection/debugging.
   */
  entries: ChatHistoryEntry[];
  /**
   * FULL rebuilt chunk array (all messages seen so far), identical in shape to
   * `SessionDetail.chunks`. Rebuilt in-memory by running the existing ChunkBuilder
   * over the tailer's cached parsed-message list — no disk read, no re-JSON.parse of
   * previously-seen entries. The renderer runs this through
   * `incrementalUpdateConversation` exactly as it does a full refresh.
   */
  chunks: Chunk[];
  /**
   * Byte offset (complete-line boundary) this delta STARTS at. Equals the previous
   * `tailOffset` (or the `getSessionDetail` baseline for the first delta). The renderer
   * compares this against its stored baseline to detect a gap/overlap and refetch.
   */
  baseOffset: number;
  /** Byte offset (complete-line boundary) AFTER this delta. The renderer's new baseline. */
  tailOffset: number;
}

/**
 * File watching event.
 */
export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
  projectId?: string;
  sessionId?: string;
  isSubagent: boolean;
}

/**
 * Live terminal-state change for a single session, from the wezterm hook's
 * `${CLAUDE_ROOT}/devtools-state/<sessionId>.json`.
 *
 * Deliberately NOT emitted on the `file-change` channel: these fire on every
 * prompt submit and every PreToolUse, and routing them through `file-change`
 * made the renderer refetch the whole sidebar page on each one. They carry the
 * state inline so the renderer can patch it in place with no IPC round-trip —
 * which also fixes the chat pane, whose `getSessionDetail` refresh is
 * short-circuited by an unchanged JSONL fingerprint.
 *
 * `state` is undefined ONLY when the file was removed (session ended / cleaned
 * up); the renderer treats that as "clear this session's live state". An
 * unreadable or malformed file must NOT be reported this way — the emitter
 * stays silent so the last known state stands. See FileWatcher.processStateChange.
 *
 * Producer contract: the hook writes non-atomically and `ts` is unix SECONDS,
 * not milliseconds (`getTerminalVisual` multiplies by 1000). `state` carries the
 * wezterm vocabulary — ready | working | attention | done | default — typed as
 * `string` because it crosses a process boundary unvalidated by the compiler.
 */
export interface TerminalStateChangeEvent {
  sessionId: string;
  state?: { state: string; ts: number; cwd?: string };
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Empty metrics constant for initialization.
 */
export const EMPTY_METRICS: SessionMetrics = {
  durationMs: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  messageCount: 0,
};

// =============================================================================
// Chunk Type Guards
// =============================================================================

/**
 * Type guard to check if a chunk is a UserChunk.
 */
export function isUserChunk(chunk: Chunk | EnhancedChunk): chunk is UserChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'user';
}

/**
 * Type guard to check if a chunk is an AIChunk.
 */
export function isAIChunk(chunk: Chunk | EnhancedChunk): chunk is AIChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'ai';
}

/**
 * Type guard to check if a chunk is an EnhancedAIChunk.
 */
export function isEnhancedAIChunk(chunk: Chunk | EnhancedChunk): chunk is EnhancedAIChunk {
  return isAIChunk(chunk) && 'semanticSteps' in chunk;
}

/**
 * Type guard to check if a chunk is a SystemChunk.
 */
export function isSystemChunk(chunk: Chunk | EnhancedChunk): chunk is SystemChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'system';
}

/**
 * Type guard to check if a chunk is a CompactChunk.
 */
export function isCompactChunk(chunk: Chunk | EnhancedChunk): chunk is CompactChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'compact';
}

/**
 * Type guard to check if a chunk is a NotificationChunk.
 */
export function isNotificationChunk(chunk: Chunk | EnhancedChunk): chunk is NotificationChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'notification';
}

/**
 * Type guard to check if a chunk is a ShellCommandChunk.
 */
export function isShellCommandChunk(chunk: Chunk | EnhancedChunk): chunk is ShellCommandChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'shell';
}
