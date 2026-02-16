/**
 * Type definitions for the new chat history architecture.
 * These types separate user input from AI responses for a chat-style display.
 */

import type {
  ParsedMessage,
  Process,
  SemanticStep,
  SessionMetrics,
  ToolUseResultData,
} from './data';
export type { SemanticStep };
import type { ClaudeMdStats } from './claudeMd';
import type { CompactionTokenDelta } from './contextInjection';
import type { ModelInfo } from '@shared/utils/modelParser';

// =============================================================================
// Expansion Levels
// =============================================================================

/**
 * AI Group expansion levels for the collapsible UI.
 * - collapsed: Show only summary line "1 tool call, 3 messages"
 * - items: Show list of items (thinking, tool calls, etc.)
 * - full: Show full content of each item
 */
export type AIGroupExpansionLevel = 'collapsed' | 'items' | 'full';

// =============================================================================
// User Group Types
// =============================================================================

/**
 * Command reference extracted from user input (e.g., /isolate-context, /context).
 */
export interface CommandInfo {
  /** Command name without slash (e.g., "isolate-context") */
  name: string;
  /** Optional arguments after the command */
  args?: string;
  /** Full raw text including slash */
  raw: string;
  /** Position in the text where command starts */
  startIndex: number;
  /** Position in the text where command ends */
  endIndex: number;
}

/**
 * Image data from user message.
 */
export interface ImageData {
  /** Unique identifier */
  id: string;
  /** MIME type */
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** Base64 encoded data for display */
  data?: string;
}

/**
 * File reference mentioned in user message (e.g., @file.ts).
 */
export interface FileReference {
  /** File path */
  path: string;
  /** Optional line range */
  lineRange?: {
    start: number;
    end?: number;
  };
  /** Raw text as written */
  raw: string;
}

/**
 * Parsed content from a user message.
 */
export interface UserGroupContent {
  /** Plain text content (with commands removed for display) */
  text?: string;
  /** Raw text content (original) */
  rawText?: string;
  /** Extracted commands */
  commands: CommandInfo[];
  /** Extracted images */
  images: ImageData[];
  /** Extracted file references */
  fileReferences: FileReference[];
}

/**
 * User Group - represents a user's complete input.
 * This is one side of a conversation turn.
 */
export interface UserGroup {
  /** Unique identifier */
  id: string;
  /** Original ParsedMessage */
  message: ParsedMessage;
  /** Timestamp of the message */
  timestamp: Date;
  /** Parsed content */
  content: UserGroupContent;
  /** Index within the session (for ordering) */
  index: number;
}

/**
 * System Group - represents command output rendered like AI.
 */
export interface SystemGroup {
  id: string;
  message: ParsedMessage;
  timestamp: Date;
  commandOutput: string; // Raw output text
  commandName?: string; // Optional: extracted command name
}

// =============================================================================
// AI Group Types
// =============================================================================

/**
 * Summary statistics for the collapsed AI Group view.
 */
export interface AIGroupSummary {
  /** Preview of thinking content (first ~100 chars) */
  thinkingPreview?: string;
  /** Number of tool calls in this group */
  toolCallCount: number;
  /** Number of output messages */
  outputMessageCount: number;
  /** Number of subagent executions */
  subagentCount: number;
  /** Total duration in milliseconds */
  totalDurationMs: number;
  /** Total tokens used */
  totalTokens: number;
  /** Output tokens */
  outputTokens: number;
  /** Cached tokens */
  cachedTokens: number;
}

/**
 * Linked tool item pairing a tool call with its result.
 * Includes preview text for display in collapsed/item views.
 */
export interface LinkedToolItem {
  /** Tool call ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /**
   * Token count for the tool CALL (what Claude generated).
   * From message.usage.output_tokens, proportioned if multiple tools in message.
   * For Write: includes file content. For Edit: includes old_string + new_string.
   */
  callTokens?: number;
  /** Tool result if received */
  result?: {
    content: string | unknown[];
    isError: boolean;
    toolUseResult?: ToolUseResultData;
    /** Pre-computed token count for the result content */
    tokenCount?: number;
  };
  /** Preview of input (first 100 chars) */
  inputPreview: string;
  /** Preview of output (first 200 chars) */
  outputPreview?: string;
  /** When the tool was called */
  startTime: Date;
  /** When the result was received */
  endTime?: Date;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Whether this is an orphaned call (no result) */
  isOrphaned: boolean;
  /** Model used for the assistant message containing this tool call */
  sourceModel?: string;
  /**
   * Skill instructions content for Skill tool calls.
   * Contains the follow-up text message starting with "Base directory for this skill:".
   * This is captured from isMeta:true user messages with matching sourceToolUseID.
   */
  skillInstructions?: string;
  /** Pre-computed token count for skill instructions */
  skillInstructionsTokenCount?: number;
}

/**
 * Unified slash item - represents any slash command invocation.
 * All slash commands follow the same format:
 *   <command-name>/xxx</command-name>
 *   <command-message>xxx</command-message>
 *   <command-args>optional</command-args>
 *
 * This includes:
 * - Skills (e.g., /isolate-context)
 * - Built-in commands (e.g., /model, /context)
 * - Plugin commands
 * - MCP commands
 * - User-defined commands
 */
export interface SlashItem {
  /** Unique ID (generated from command message uuid) */
  id: string;
  /** Slash name extracted from <command-name>/xxx</command-name> */
  name: string;
  /** Message content from <command-message> */
  message?: string;
  /** Optional arguments from <command-args> */
  args?: string;
  /** The command message uuid */
  commandMessageUuid: string;
  /** Instructions/output content (from follow-up isMeta:true message with parentUuid) */
  instructions?: string;
  /** Pre-computed token count for instructions */
  instructionsTokenCount?: number;
  /** Timestamp of the command message */
  timestamp: Date;
}

/**
 * Teammate message received from a team member agent.
 */
export interface TeammateMessage {
  id: string;
  teammateId: string;
  color: string;
  summary: string;
  content: string;
  timestamp: Date;
  tokenCount?: number;
  /** Summary of the SendMessage that triggered this response (reply context) */
  replyToSummary?: string;
  /** Tool call ID of the SendMessage that triggered this response */
  replyToToolId?: string;
}

/**
 * Display item for the AI Group - union of possible items to show.
 * These are flattened and shown in chronological order.
 */
export type AIGroupDisplayItem =
  | { type: 'thinking'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'tool'; tool: LinkedToolItem }
  | { type: 'subagent'; subagent: Process }
  | { type: 'output'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'slash'; slash: SlashItem }
  | { type: 'teammate_message'; teammateMessage: TeammateMessage }
  | { type: 'subagent_input'; content: string; timestamp: Date; tokenCount?: number }
  | {
      type: 'compact_boundary';
      content: string;
      timestamp: Date;
      tokenDelta?: CompactionTokenDelta;
      phaseNumber: number;
    };

/**
 * The last output in an AI Group - what user sees as "the answer".
 * Either text output, the last tool result, an interruption, ongoing (still in progress),
 * or plan_exit (ExitPlanMode tool call with plan content).
 */
export interface AIGroupLastOutput {
  /** Output type */
  type: 'text' | 'tool_result' | 'interruption' | 'ongoing' | 'plan_exit';
  /** Text content if type === 'text' */
  text?: string;
  /** Tool name if type === 'tool_result' */
  toolName?: string;
  /** Tool result content if type === 'tool_result' */
  toolResult?: string;
  /** Whether the tool result was an error */
  isError?: boolean;
  /** Interruption message text if type === 'interruption' */
  interruptionMessage?: string;
  /** Plan content if type === 'plan_exit' (from ExitPlanMode tool input) */
  planContent?: string;
  /** Preamble text before plan exit (e.g., "The plan is complete. Let me exit plan mode...") */
  planPreamble?: string;
  /** Timestamp of this output */
  timestamp: Date;
}

/**
 * Enhanced AI Group with display-ready data for the new UI.
 * Extends the base AIGroup with computed properties for rendering.
 */
export interface EnhancedAIGroup extends AIGroup {
  /** The last visible output (text or tool result) */
  lastOutput: AIGroupLastOutput | null;
  /** Flattened display items in chronological order */
  displayItems: AIGroupDisplayItem[];
  /** Map of tool call IDs to linked tool items */
  linkedTools: Map<string, LinkedToolItem>;
  /** Human-readable summary of items (e.g., "2 thinking, 4 tool calls, 3 subagents") */
  itemsSummary: string;
  /** Model used by main agent (most common if mixed) */
  mainModel: ModelInfo | null;
  /** Unique models used by subagents (if different from main) */
  subagentModels: ModelInfo[];
  /** CLAUDE.md injection statistics for this group */
  claudeMdStats: ClaudeMdStats | null;
}

/**
 * Status of an AI Group.
 */
export type AIGroupStatus = 'complete' | 'interrupted' | 'error' | 'in_progress';

/**
 * Token metrics for an AI Group.
 */
export interface AIGroupTokens {
  input: number;
  output: number;
  cached: number;
  thinking?: number;
}

/**
 * AI Group - represents a single assistant response cycle.
 * AI Groups are independent items in the flat conversation list.
 */
export interface AIGroup {
  /** Unique identifier */
  id: string;
  /** 0-based index of this AI group within the session (for turn navigation) */
  turnIndex: number;
  /** Start timestamp */
  startTime: Date;
  /** End timestamp */
  endTime: Date;
  /** Duration in milliseconds */
  durationMs: number;
  /** Semantic steps within this response */
  steps: SemanticStep[];
  /** Token metrics */
  tokens: AIGroupTokens;
  /** Summary for collapsed view */
  summary: AIGroupSummary;
  /** Completion status */
  status: AIGroupStatus;
  /** Associated processes */
  processes: Process[];
  /** Source chunk ID */
  chunkId: string;
  /** Metrics for this AI response (summed across all messages) */
  metrics: SessionMetrics;
  /** All response messages (assistant + internal user messages) for accessing raw usage data */
  responses: ParsedMessage[];
  /** Whether this is the last AI group in an ongoing session */
  isOngoing?: boolean;
}

// =============================================================================
// Conversation Types
// =============================================================================

/**
 * Compact Group - marks where conversation was compacted.
 * Contains the compact summary message with the conversation summary.
 */
export interface CompactGroup {
  id: string;
  timestamp: Date;
  message: ParsedMessage; // Contains compact summary in message.content
  tokenDelta?: CompactionTokenDelta;
  startingPhaseNumber?: number;
}

/**
 * Chat item - can be user, system, ai, or compact.
 * These are INDEPENDENT items in a flat list, not paired turns.
 */
export type ChatItem =
  | { type: 'user'; group: UserGroup }
  | { type: 'system'; group: SystemGroup }
  | { type: 'ai'; group: AIGroup }
  | { type: 'compact'; group: CompactGroup };

/**
 * Session conversation as a flat list of independent chat items.
 * NO LONGER uses turns - each item stands alone.
 */
export interface SessionConversation {
  /** Session ID */
  sessionId: string;
  /** All chat items in chronological order */
  items: ChatItem[];
  /** Total count of user groups */
  totalUserGroups: number;
  /** Total count of system groups */
  totalSystemGroups: number;
  /** Total count of AI groups */
  totalAIGroups: number;
  /** Total count of compact groups */
  totalCompactGroups: number;
}
