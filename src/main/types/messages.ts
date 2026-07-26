/**
 * Parsed message types and type guards for claude-devtools.
 *
 * ParsedMessage is the application's internal representation after parsing
 * raw JSONL entries. This module also contains type guards for classifying
 * parsed messages into categories for chunk building.
 */

import {
  BASH_INPUT_TAG,
  BASH_STDERR_TAG,
  BASH_STDOUT_TAG,
  EMPTY_STDERR,
  EMPTY_STDOUT,
  HARD_NOISE_TAGS,
  LOCAL_COMMAND_STDERR_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
  SYSTEM_OUTPUT_TAGS,
  TASK_NOTIFICATION_TAG,
} from '../constants/messageTags';

import { type MessageType, type TokenUsage } from './domain';
import { type ContentBlock, type ToolUseResultData } from './jsonl';

// =============================================================================
// Tool Types
// =============================================================================

/**
 * Tool call extracted from assistant message.
 */
export interface ToolCall {
  /** Tool use ID for linking to results */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input parameters */
  input: Record<string, unknown>;
  /** Whether this is a Task (subagent) tool call */
  isTask: boolean;
  /** Task description if isTask */
  taskDescription?: string;
  /** Task subagent type if isTask */
  taskSubagentType?: string;
}

/**
 * Tool result extracted from user message.
 */
export interface ToolResult {
  /** Corresponding tool_use ID */
  toolUseId: string;
  /** Result content */
  content: string | unknown[];
  /** Whether the tool execution errored */
  isError: boolean;
}

// =============================================================================
// Parsed Message
// =============================================================================

/**
 * Parsed and enriched message from JSONL.
 * This is the application's internal representation after parsing raw JSONL entries.
 */
export interface ParsedMessage {
  /** Unique message identifier */
  uuid: string;
  /** Parent message UUID for threading */
  parentUuid: string | null;
  /** Message type */
  type: MessageType;
  /** Message timestamp */
  timestamp: Date;
  /** Message role if present */
  role?: string;
  /** Message content (string or content blocks) */
  content: ContentBlock[] | string;
  /** Token usage for this message */
  usage?: TokenUsage;
  /** Model used for this response */
  model?: string;
  // Metadata
  /** Current working directory when message was created */
  cwd?: string;
  /** Git branch context */
  gitBranch?: string;
  /** Agent ID for subagent messages */
  agentId?: string;
  /** Whether this is a sidechain message */
  isSidechain: boolean;
  /** Whether this is a meta message */
  isMeta: boolean;
  /** User type ("external" for user input) */
  userType?: string;
  // Extracted tool information
  /** Tool calls made in this message */
  toolCalls: ToolCall[];
  /** Tool results received in this message */
  toolResults: ToolResult[];
  /** Source tool use ID if this is a tool result message */
  sourceToolUseID?: string;
  /** Source assistant UUID if this is a tool result message */
  sourceToolAssistantUUID?: string;
  /** Tool use result information if this is a tool result message */
  toolUseResult?: ToolUseResultData;
  /** Whether this is a compact summary boundary message */
  isCompactSummary?: boolean;
  /** API request ID for deduplicating streaming entries */
  requestId?: string;
}

// =============================================================================
// ParsedMessage Type Guards
// =============================================================================

/**
 * Type guard to check if a ParsedMessage is a real user message.
 * This wraps the spec's type guard but works with ParsedMessage instead of UserEntry.
 *
 * Accepts both formats:
 * - Older sessions: content as string
 * - Newer sessions: content as array with text/image blocks
 *
 * Excludes command output messages (with <local-command-stdout>) which should
 * be treated as system responses, not user input that starts new chunks.
 */
export function isParsedRealUserMessage(msg: ParsedMessage): boolean {
  if (msg.type !== 'user') return false;
  if (msg.isMeta) return false;

  const content = msg.content;

  // String content format (older sessions)
  if (typeof content === 'string') {
    return true;
  }

  // Array content format (newer sessions)
  if (Array.isArray(content)) {
    // Check if it contains text or image blocks (real user input)
    // Exclude arrays with only tool_result blocks (those are internal messages)
    return content.some((block) => block.type === 'text' || block.type === 'image');
  }

  return false;
}

/**
 * Type guard for User chunk creation - genuine user input that starts User chunks.
 *
 * Returns true if message should create a User chunk:
 * - type='user'
 * - isMeta!=true
 * - Has text/image content
 * - Content does NOT contain: <local-command-stdout>, <local-command-caveat>, <system-reminder>
 * - Content MAY contain: <command-name> (slash commands like /model ARE user input)
 *
 * Example User chunk messages:
 * - "Help me debug this code"
 * - "<command-name>/model</command-name> Switch to sonnet"
 *
 * NOT User chunks:
 * - "<local-command-stdout>Set model to...</local-command-stdout>" -> System chunk
 * - "<local-command-caveat>...</local-command-caveat>" -> Hard noise
 * - "<system-reminder>...</system-reminder>" -> Hard noise
 */
export function isParsedUserChunkMessage(msg: ParsedMessage): boolean {
  if (msg.type !== 'user') return false;
  if (msg.isMeta === true) return false;
  if (isParsedTeammateMessage(msg)) return false;
  // Auto-injected background-task notifications are NOT user input — they render
  // as a muted system divider, not a "You" bubble. (Classified separately.)
  if (isParsedTaskNotificationMessage(msg)) return false;
  // Interactive `!` shell commands (`<bash-input>`) and their paired output
  // (`<bash-stdout>`/`<bash-stderr>`) are NOT user input — they render as a
  // terminal-style command block. (Classified separately as 'shell'.)
  if (isParsedShellMessage(msg)) return false;

  const content = msg.content;

  // Check string content
  if (typeof content === 'string') {
    const trimmed = content.trim();

    // Exclude messages that are system output or system metadata
    // These tags indicate system-generated content, not user input
    for (const tag of SYSTEM_OUTPUT_TAGS) {
      if (trimmed.startsWith(tag)) {
        return false;
      }
    }

    // <command-name> is ALLOWED - it's user-initiated slash commands
    // Remaining content is genuine user input
    return trimmed.length > 0;
  }

  // Array content format (newer sessions)
  if (Array.isArray(content)) {
    // Must contain text or image blocks for real user input
    const hasUserContent = content.some((block) => block.type === 'text' || block.type === 'image');

    if (!hasUserContent) {
      return false;
    }

    // Filter out user interruption messages (should be part of AI response flow)
    // These have exactly 1 text block with content like "[Request interrupted by user]"
    // or "[Request interrupted by user for tool use]"
    if (
      content.length === 1 &&
      content[0].type === 'text' &&
      typeof content[0].text === 'string' &&
      content[0].text.startsWith('[Request interrupted by user')
    ) {
      return false;
    }

    // Check text blocks for excluded tags
    for (const block of content) {
      if (block.type === 'text') {
        const textBlock = block;
        for (const tag of SYSTEM_OUTPUT_TAGS) {
          if (textBlock.text.startsWith(tag)) {
            return false;
          }
        }
      }
    }

    return true;
  }

  return false;
}

/**
 * Type guard for System chunk creation - command output messages.
 *
 * Returns true if message should create a System chunk:
 * - type='user' (confusingly, command output comes as user entries in JSONL)
 * - Contains <local-command-stdout> tag
 *
 * System chunks render on the LEFT side (like AI responses) with neutral gray styling.
 *
 * Example:
 * ```
 * {
 *   type: "user",
 *   content: "<local-command-stdout>Set model to sonnet...</local-command-stdout>"
 * }
 * ```
 */
export function isParsedSystemChunkMessage(msg: ParsedMessage): boolean {
  if (msg.type !== 'user') return false;

  const content = msg.content;

  if (typeof content === 'string') {
    return (
      content.startsWith(LOCAL_COMMAND_STDOUT_TAG) || content.startsWith(LOCAL_COMMAND_STDERR_TAG)
    );
  }

  // Array content - check text blocks
  if (Array.isArray(content)) {
    return content.some(
      (block) => block.type === 'text' && block.text.startsWith(LOCAL_COMMAND_STDOUT_TAG)
    );
  }

  return false;
}

/**
 * Type guard to check if a ParsedMessage is an internal user message.
 * This wraps the spec's type guard but works with ParsedMessage instead of UserEntry.
 */
export function isParsedInternalUserMessage(msg: ParsedMessage): boolean {
  return msg.type === 'user' && msg.isMeta === true;
}

/**
 * Hard noise message (ParsedMessage version) - NEVER rendered or counted in the UI.
 * This wraps isHardNoiseMessage() but works with ParsedMessage instead of ChatHistoryEntry.
 *
 * Filtered messages:
 * - Messages with parentUuid: null (orphaned/root messages that shouldn't display)
 *   - e.g., compact_boundary system messages, root-level meta messages
 *
 * Filtered types:
 * - 'system' entries
 * - 'summary' entries
 * - 'file-history-snapshot' entries
 * - 'queue-operation' entries
 *
 * Filtered user messages:
 * - Messages containing ONLY these system metadata tags (no real content):
 *   - <local-command-caveat>
 *   - <system-reminder>
 * - Empty command output: <local-command-stdout></local-command-stdout>
 * - Interruption messages: [Request interrupted by user...]
 *
 * Filtered assistant messages:
 * - Synthetic messages with model='<synthetic>' (system-generated placeholders)
 */
export function isParsedHardNoiseMessage(msg: ParsedMessage): boolean {
  // Filter structural metadata types - these should never be displayed
  if (msg.type === 'system') return true;
  if (msg.type === 'summary') return true;
  if (msg.type === 'file-history-snapshot') return true;
  if (msg.type === 'queue-operation') return true;

  // Filter synthetic assistant messages (system-generated placeholders)
  if (msg.type === 'assistant' && msg.model === '<synthetic>') {
    return true;
  }

  // Filter user messages with ONLY system metadata tags (no real content)
  if (msg.type === 'user') {
    const content = msg.content;

    if (typeof content === 'string') {
      // Check if content contains ONLY noise tags (trim whitespace)
      const trimmedContent = content.trim();

      // If the content is wrapped in a noise tag, it's hard noise
      for (const tag of HARD_NOISE_TAGS) {
        const openTag = tag;
        const closeTag = tag.replace('<', '</');
        if (trimmedContent.startsWith(openTag) && trimmedContent.endsWith(closeTag)) {
          return true;
        }
      }

      // Filter empty command output (e.g., /clear with no output)
      if (trimmedContent === EMPTY_STDOUT || trimmedContent === EMPTY_STDERR) {
        return true;
      }

      // Filter interruption messages (rendered via session state detection instead)
      if (trimmedContent.startsWith('[Request interrupted by user')) {
        return true;
      }
    }

    // Filter array content with single interruption text block
    if (Array.isArray(content)) {
      if (
        content.length === 1 &&
        content[0].type === 'text' &&
        typeof content[0].text === 'string' &&
        content[0].text.startsWith('[Request interrupted by user')
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detect compact summary messages.
 * These are markers indicating conversation was compacted.
 */
export function isParsedCompactMessage(msg: ParsedMessage): boolean {
  return msg.isCompactSummary === true;
}

/**
 * Detect auto-injected background-task notification messages.
 *
 * Claude Code wraps background-task / subagent-completion events (and
 * `Background command "..." completed (exit code N)` events) as `type: "user"`
 * entries whose STRING content begins with `<task-notification>`. These are
 * machine-generated events, NOT genuine user input, so they must not create a
 * UserChunk / render as a "You" bubble.
 *
 * NOTE: this only matches STRING content (the wrapped notification form). It does
 * NOT touch `type: "attachment"` queued-command entries, `isMeta: true`
 * slash-command expansions (array content), or `<local-command-*>` output.
 */
export function isParsedTaskNotificationMessage(msg: ParsedMessage): boolean {
  if (msg.type !== 'user') return false;
  if (msg.isMeta === true) return false;
  const content = msg.content;
  if (typeof content !== 'string') return false;
  return content.trimStart().startsWith(TASK_NOTIFICATION_TAG);
}

/**
 * Extract a concise, human-readable label from a `<task-notification>` payload
 * for the muted divider. Preference order:
 *   1. `<summary>…</summary>` text (e.g. `Agent "X" finished`)
 *   2. `Background command "X" completed (exit code N)`
 *   3. generic `Background task completed`
 */
export function extractTaskNotificationLabel(content: string): string {
  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(content);
  if (summaryMatch) {
    const summary = summaryMatch[1].trim();
    if (summary.length > 0) return summary;
  }

  const bgCommandMatch = /Background command "[^"]*" completed \(exit code \d+\)/.exec(content);
  if (bgCommandMatch) {
    return bgCommandMatch[0];
  }

  return 'Background task completed';
}

// =============================================================================
// Shell command (`!`) detection
// =============================================================================

/**
 * Matches a complete `<bash-input>`/`<bash-stdout>`/`<bash-stderr>` wrapper block.
 * Non-greedy body, bounded by the recognized closing tags.
 */
const BASH_BLOCK_REGEX = /<bash-(?:input|stdout|stderr)>[\s\S]*?<\/bash-(?:input|stdout|stderr)>/g;

/**
 * True when `content` (after trimming) consists EXCLUSIVELY of one or more bash
 * wrapper blocks (plus whitespace between them) — i.e. it is a genuine `!`
 * shell-command record, not a user message that merely quotes/pastes such tags.
 *
 * This is the scope guard that separates real shell records (line contains ONLY
 * the wrappers) from a typed user message that happens to start with a pasted
 * `<bash-input>…` snippet followed by their own prose (which must stay a "You"
 * bubble).
 */
function isBashWrapperOnly(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) return false;
  return trimmed.replace(BASH_BLOCK_REGEX, '').trim().length === 0;
}

/**
 * Detect the COMMAND entry of an interactive `!` shell command.
 *
 * Format: `type: "user"`, `isMeta` absent, STRING content that starts with
 * `<bash-input>` and consists solely of bash wrapper blocks (the command, and —
 * in the combined form — its inline `<bash-stdout>`/`<bash-stderr>` output).
 */
export function isParsedShellInputMessage(msg: ParsedMessage): boolean {
  if (msg.type !== 'user') return false;
  if (msg.isMeta === true) return false;
  const content = msg.content;
  if (typeof content !== 'string') return false;
  return content.trimStart().startsWith(BASH_INPUT_TAG) && isBashWrapperOnly(content);
}

/**
 * Detect the OUTPUT entry of an interactive `!` shell command — the
 * `type: "user"` entry (immediately following the command) whose STRING content
 * is only `<bash-stdout>`/`<bash-stderr>` wrapper blocks.
 */
export function isParsedShellOutputMessage(msg: ParsedMessage): boolean {
  if (msg.type !== 'user') return false;
  if (msg.isMeta === true) return false;
  const content = msg.content;
  if (typeof content !== 'string') return false;
  const start = content.trimStart();
  if (!start.startsWith(BASH_STDOUT_TAG) && !start.startsWith(BASH_STDERR_TAG)) return false;
  return isBashWrapperOnly(content);
}

/**
 * Detect any interactive `!` shell-command entry (command OR its paired output).
 * Used to keep these entries out of UserChunks and route them to the 'shell'
 * category.
 */
export function isParsedShellMessage(msg: ParsedMessage): boolean {
  return isParsedShellInputMessage(msg) || isParsedShellOutputMessage(msg);
}

/**
 * Extract the command text, stdout, and stderr from a `!` shell-command entry's
 * string content. `command` is the concatenation of `<bash-input>` blocks;
 * `stdout`/`stderr` concatenate their respective blocks. All are trimmed.
 */
export function extractShellCommandParts(content: string): {
  command: string;
  stdout: string;
  stderr: string;
} {
  const collect = (tag: 'input' | 'stdout' | 'stderr'): string => {
    const re = new RegExp(`<bash-${tag}>([\\s\\S]*?)</bash-${tag}>`, 'g');
    let out = '';
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      out += match[1];
    }
    return out.trim();
  };

  return {
    command: collect('input'),
    stdout: collect('stdout'),
    stderr: collect('stderr'),
  };
}

/**
 * Detect teammate messages - messages from team member agents.
 * Format: <teammate-message teammate_id="name" ...>content</teammate-message>
 */
const TEAMMATE_MESSAGE_REGEX = /^<teammate-message\s+teammate_id="([^"]+)"/;

function isParsedTeammateMessage(msg: ParsedMessage): boolean {
  if (msg.type !== 'user' || msg.isMeta) return false;
  const content = msg.content;
  if (typeof content === 'string') return TEAMMATE_MESSAGE_REGEX.test(content.trim());
  if (Array.isArray(content)) {
    return content.some(
      (block) => block.type === 'text' && TEAMMATE_MESSAGE_REGEX.test(block.text.trim())
    );
  }
  return false;
}
