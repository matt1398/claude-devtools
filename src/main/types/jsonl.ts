/**
 * JSONL format types - raw data structures from Claude Code session files.
 *
 * These types represent the exact format stored in .jsonl files at:
 * ~/.claude/projects/{project_name}/{session_uuid}.jsonl
 *
 * Content type guards and entry type guards are included here as they
 * operate directly on the raw JSONL structures.
 */

// =============================================================================
// Core Type Aliases
// =============================================================================

type EntryType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'file-history-snapshot'
  | 'queue-operation'
  | 'attachment';

type ContentType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';

type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;

// =============================================================================
// Content Blocks
// =============================================================================

interface BaseContent {
  type: ContentType;
}

export interface TextContent extends BaseContent {
  type: 'text';
  text: string;
}

export interface ThinkingContent extends BaseContent {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface ToolUseContent extends BaseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent extends BaseContent {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ImageContent extends BaseContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export type ContentBlock =
  | TextContent
  | ThinkingContent
  | ToolUseContent
  | ToolResultContent
  | ImageContent;

// =============================================================================
// Usage Metadata
// =============================================================================

export interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

// =============================================================================
// Messages
// =============================================================================

interface UserMessage {
  role: 'user';
  content: string | ContentBlock[];
}

interface AssistantMessage {
  role: 'assistant';
  model: string;
  id: string;
  type: 'message';
  content: ContentBlock[];
  stop_reason: StopReason;
  stop_sequence: string | null;
  usage: UsageMetadata;
}

// =============================================================================
// JSONL Entries
// =============================================================================

interface BaseEntry {
  type: EntryType;
  timestamp?: string;
  uuid?: string;
}

/**
 * Base for conversational entries (user, assistant, system).
 *
 * Sidechain behavior:
 * - isSidechain: false -> Main agent message
 * - isSidechain: true -> Subagent message
 * - sessionId: For subagents, points to parent session UUID
 */
interface ConversationalEntry extends BaseEntry {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: 'external';
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  slug?: string;
}

/**
 * Tool use result data - preserves full structure from JSONL entries.
 *
 * The structure varies significantly by tool type:
 * - File tools: { type, success, filePath, content, structuredPatch, ... }
 * - Task tools: { status, prompt, agentId, content, totalDurationMs, totalTokens, usage, ... }
 * - AskUserQuestion: { questions, answers }
 * - Bash: { stdout, stderr, exitCode, ... }
 *
 * Using Record<string, unknown> to preserve all data without loss.
 */
export type ToolUseResultData = Record<string, unknown>;

/**
 * CRITICAL: User entries serve two purposes:
 *
 * 1. Real User Input (chunk starters):
 *    - isMeta: false or undefined
 *    - content: string
 *    - These START new chunks
 *
 * 2. Response Messages (part of response flow):
 *    a) Internal (tool results):
 *       - isMeta: true
 *       - content: array with tool_result blocks
 *    b) Interruptions:
 *       - isMeta: false
 *       - content: array (not string)
 */
export interface UserEntry extends ConversationalEntry {
  type: 'user';
  message: UserMessage;
  isMeta?: boolean;
  agentId?: string;

  toolUseResult?: ToolUseResultData;
  sourceToolUseID?: string;
  sourceToolAssistantUUID?: string;
}

export interface AssistantEntry extends ConversationalEntry {
  type: 'assistant';
  message: AssistantMessage;
  requestId: string;
  agentId?: string;
}

export interface SystemEntry extends ConversationalEntry {
  type: 'system';
  subtype: 'turn_duration' | 'init';
  durationMs: number;
  isMeta: boolean;
}

export interface SummaryEntry extends BaseEntry {
  type: 'summary';
  summary: string;
  leafUuid: string;
}

export interface FileHistorySnapshotEntry extends BaseEntry {
  type: 'file-history-snapshot';
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, string>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
}

export interface QueueOperationEntry extends BaseEntry {
  type: 'queue-operation';
  operation: string;
}

/**
 * A queued command attachment: the text a user typed while the assistant was
 * mid-turn ("queued"/interrupt message). Claude Code records the message text
 * ONLY here (`origin.kind === 'human'`) — there is no separate `type:"user"`
 * entry for it, so if this attachment is skipped the user's words are invisible.
 * Agent-generated queued_commands (e.g. task-notifications) carry a non-human
 * origin and are NOT user input.
 */
export interface QueuedCommandAttachment {
  type: 'queued_command';
  prompt: string;
  commandMode?: string;
  origin?: { kind?: string };
  timestamp?: string;
}

/**
 * Attachment entries carry out-of-band payloads Claude Code appends to the
 * transcript: hook output, diagnostics, and — critically — queued human
 * messages (see {@link QueuedCommandAttachment}). Only the human queued_command
 * variant is conversational; every other attachment payload is skipped by the
 * parser.
 */
export interface AttachmentEntry extends BaseEntry {
  type: 'attachment';
  parentUuid?: string | null;
  isSidechain?: boolean;
  cwd?: string;
  gitBranch?: string;
  attachment: QueuedCommandAttachment | { type: string; [key: string]: unknown };
}

export type ChatHistoryEntry =
  | UserEntry
  | AssistantEntry
  | SystemEntry
  | SummaryEntry
  | FileHistorySnapshotEntry
  | QueueOperationEntry
  | AttachmentEntry;

/**
 * Conversational entries - entries that represent chat messages.
 * These share common properties like message, cwd, gitBranch, etc.
 */
export type ConversationalChatEntry = UserEntry | AssistantEntry | SystemEntry;

// =============================================================================
// Content Type Guards
// =============================================================================

export function isTextContent(content: ContentBlock): content is TextContent {
  return content.type === 'text';
}

export function isToolResultContent(content: ContentBlock): content is ToolResultContent {
  return content.type === 'tool_result';
}

/**
 * Type guard to check if an entry is a conversational entry.
 */
export function isConversationalEntry(entry: ChatHistoryEntry): entry is ConversationalChatEntry {
  return entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system';
}

// =============================================================================
// Subagent Directory Structures
// =============================================================================

/**
 * Claude Code supports two subagent directory structures:
 *
 * NEW STRUCTURE (Current):
 * ~/.claude/projects/
 *   {project_name}/
 *     {session_uuid}.jsonl              <- Main agent
 *     {session_uuid}/
 *       agent_{agent_uuid}.jsonl         <- Subagents
 *
 * OLD STRUCTURE (Legacy, still supported):
 * ~/.claude/projects/
 *   {project_name}/
 *     {session_uuid}.jsonl              <- Main agent
 *     agent_{agent_uuid}.jsonl           <- Subagents (at root)
 *
 * Identification:
 * - Main agent: isSidechain: false (or undefined)
 * - Subagent: isSidechain: true
 * - Linking: subagent.sessionId === parent session UUID
 *
 * When scanning for subagents:
 * 1. First check {session_uuid}/ subdirectory (new structure)
 * 2. Fall back to project root for agent_*.jsonl (old structure)
 * 3. Match by sessionId field to link to parent
 */

// =============================================================================
// Message Flow Pattern
// =============================================================================

/**
 * Typical conversation flow:
 *
 * 1. User types -> type: "user", isMeta: false, content: string -> TRIGGER MESSAGE (STARTS CHUNK)
 * 2. Assistant responds -> type: "assistant", may contain tool_use -> FLOW MESSAGE (PART OF RESPONSE)
 * 3. Tool executes -> type: "user", isMeta: true, contains tool_result -> FLOW MESSAGE (PART OF RESPONSE)
 * 4. User interrupts -> type: "user", isMeta: false, content: array -> FLOW MESSAGE (PART OF RESPONSE)
 * 5. Assistant continues -> type: "assistant" -> FLOW MESSAGE (PART OF RESPONSE)
 *
 * Message Categories (New 4-Category System):
 *
 * 1. USER MESSAGES (create UserChunks):
 *    - Genuine user input that initiates a new request/response cycle
 *    - Detected by: isParsedUserChunkMessage() type guard
 *    - Requirements: type='user', isMeta!=true, has text/image content
 *    - Excludes: <local-command-stdout>, <local-command-caveat>, <system-reminder>
 *    - Allows: <command-name> (slash commands like /model are visible user input)
 *
 * 2. SYSTEM MESSAGES (create SystemChunks):
 *    - Command output from slash commands
 *    - Detected by: isParsedSystemChunkMessage() type guard
 *    - Contains <local-command-stdout> tag
 *    - Renders on LEFT side like AI responses
 *
 * 3. HARD NOISE MESSAGES (filtered out):
 *    - System-generated metadata that should NEVER be displayed
 *    - Detected by: isParsedHardNoiseMessage() type guard
 *    - Includes: system/summary/file-history-snapshot/queue-operation entries
 *    - Includes: User messages with ONLY <local-command-caveat> or <system-reminder>
 *
 * 4. AI MESSAGES (create AIChunks):
 *    - All assistant messages and flow messages between User/System/HardNoise
 *    - Includes: assistant messages, tool results, interruptions
 *    - Consecutive AI messages are grouped into single AIChunk
 *    - AIChunks are INDEPENDENT - no longer paired with UserChunks
 *
 * Key Rules:
 * - User messages START UserChunks (render on RIGHT)
 * - System messages START SystemChunks (render on LEFT)
 * - AI messages are GROUPED into independent AIChunks (render on LEFT)
 * - Hard noise messages are FILTERED OUT entirely
 *
 * Tool Linking:
 * - tool_use.id in assistant message
 * - tool_result.tool_use_id in internal user message
 * - Also: sourceToolUseID field directly on internal user entry
 */
