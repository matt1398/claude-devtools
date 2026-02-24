/**
 * Utilities for parsing JSONL (JSON Lines) files used by Claude Code sessions.
 *
 * JSONL format: One JSON object per line
 * - Each line is a complete, valid JSON object
 * - Lines are separated by newline characters
 * - Empty lines should be skipped
 */

import { isCommandOutputContent, sanitizeDisplayContent } from '@shared/utils/contentSanitizer';
import { createLogger } from '@shared/utils/logger';
import { calculateMessageCost } from '@shared/utils/pricing';
import * as readline from 'readline';

import { LocalFileSystemProvider } from '../services/infrastructure/LocalFileSystemProvider';
import {
  type ChatHistoryEntry,
  type ContentBlock,
  EMPTY_METRICS,
  isConversationalEntry,
  isParsedUserChunkMessage,
  isTextContent,
  type MessageType,
  type ParsedMessage,
  type SessionMetrics,
  type TokenUsage,
  type ToolCall,
} from '../types';

// Import from extracted modules
import { extractToolCalls, extractToolResults } from './toolExtraction';

import type { FileSystemProvider } from '../services/infrastructure/FileSystemProvider';
import type { PhaseTokenBreakdown } from '../types/domain';

const logger = createLogger('Util:jsonl');

const defaultProvider = new LocalFileSystemProvider();

// Re-export for backwards compatibility
export { extractCwd, extractFirstUserMessagePreview } from './metadataExtraction';
export { checkMessagesOngoing } from './sessionStateDetection';

// =============================================================================
// Core Parsing Functions
// =============================================================================

/**
 * Parse a JSONL file line by line using streaming.
 * This avoids loading the entire file into memory.
 */
export async function parseJsonlFile(
  filePath: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<ParsedMessage[]> {
  const messages: ParsedMessage[] = [];

  if (!(await fsProvider.exists(filePath))) {
    return messages;
  }

  const fileStream = fsProvider.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const parsed = parseJsonlLine(line);
      if (parsed) {
        messages.push(parsed);
      }
    } catch (error) {
      logger.error(`Error parsing line in ${filePath}:`, error);
    }
  }

  return messages;
}

/**
 * Parse a single JSONL line into a ParsedMessage.
 * Returns null for invalid/unsupported lines.
 */
export function parseJsonlLine(line: string): ParsedMessage | null {
  if (!line.trim()) {
    return null;
  }

  const entry = JSON.parse(line) as ChatHistoryEntry;
  return parseChatHistoryEntry(entry);
}

// =============================================================================
// Entry Parsing
// =============================================================================

/**
 * Parse a single JSONL entry into a ParsedMessage.
 */
function parseChatHistoryEntry(entry: ChatHistoryEntry): ParsedMessage | null {
  // Skip entries without uuid (usually metadata)
  if (!entry.uuid) {
    return null;
  }

  const type = parseMessageType(entry.type);
  if (!type) {
    return null;
  }

  // Handle different entry types
  let content: string | ContentBlock[] = '';
  let role: string | undefined;
  let usage: TokenUsage | undefined;
  let model: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let agentId: string | undefined;
  let requestId: string | undefined;
  let isSidechain = false;
  let isMeta = false;
  let userType: string | undefined;
  let sourceToolUseID: string | undefined;
  let sourceToolAssistantUUID: string | undefined;
  let toolUseResult: Record<string, unknown> | undefined;
  let parentUuid: string | null = null;

  // Extract properties based on entry type
  let isCompactSummary = false;
  if (isConversationalEntry(entry)) {
    // Common properties from ConversationalEntry base
    cwd = entry.cwd;
    gitBranch = entry.gitBranch;
    isSidechain = entry.isSidechain ?? false;
    userType = entry.userType;
    parentUuid = entry.parentUuid ?? null;

    // Type-specific properties
    if (entry.type === 'user') {
      content = entry.message.content ?? '';
      role = entry.message.role;
      agentId = entry.agentId;
      isMeta = entry.isMeta ?? false;
      sourceToolUseID = entry.sourceToolUseID;
      sourceToolAssistantUUID = entry.sourceToolAssistantUUID;
      toolUseResult = entry.toolUseResult;
      // Check for isCompactSummary on user entry (may exist on raw JSONL)
      isCompactSummary = 'isCompactSummary' in entry && entry.isCompactSummary === true;
    } else if (entry.type === 'assistant') {
      content = entry.message.content;
      role = entry.message.role;
      usage = entry.message.usage;
      model = entry.message.model;
      agentId = entry.agentId;
      requestId = entry.requestId;
    } else if (entry.type === 'system') {
      isMeta = entry.isMeta ?? false;
    }
  }

  // Extract tool calls and results
  const toolCalls = extractToolCalls(content);
  const toolResultsList = extractToolResults(content);

  return {
    uuid: entry.uuid,
    parentUuid,
    type,
    timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
    role,
    content,
    usage,
    model,
    // Metadata
    cwd,
    gitBranch,
    agentId,
    requestId,
    isSidechain,
    isMeta,
    userType,
    isCompactSummary,
    // Tool info
    toolCalls,
    toolResults: toolResultsList,
    sourceToolUseID,
    sourceToolAssistantUUID,
    toolUseResult,
  };
}

/**
 * Parse message type string into enum.
 */
function parseMessageType(type?: string): MessageType | null {
  switch (type) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
      return 'system';
    case 'summary':
      return 'summary';
    case 'file-history-snapshot':
      return 'file-history-snapshot';
    case 'queue-operation':
      return 'queue-operation';
    default:
      // Unknown types are skipped
      return null;
  }
}

// =============================================================================
// Metrics Calculation
// =============================================================================

/**
 * Calculate session metrics from parsed messages.
 */
export function calculateMetrics(messages: ParsedMessage[]): SessionMetrics {
  if (messages.length === 0) {
    return { ...EMPTY_METRICS };
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  // Get timestamps for duration (loop instead of Math.min/max spread to avoid stack overflow on large sessions)
  const timestamps = messages.map((m) => m.timestamp.getTime()).filter((t) => !isNaN(t));

  let minTime = 0;
  let maxTime = 0;
  if (timestamps.length > 0) {
    minTime = timestamps[0];
    maxTime = timestamps[0];
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < minTime) minTime = timestamps[i];
      if (timestamps[i] > maxTime) maxTime = timestamps[i];
    }
  }

  // Calculate cost per-message, then sum (tiered pricing applies per-API-call, not to aggregated totals)
  let costUsd = 0;

  for (const msg of messages) {
    if (msg.usage) {
      const msgInputTokens = msg.usage.input_tokens ?? 0;
      const msgOutputTokens = msg.usage.output_tokens ?? 0;
      const msgCacheReadTokens = msg.usage.cache_read_input_tokens ?? 0;
      const msgCacheCreationTokens = msg.usage.cache_creation_input_tokens ?? 0;

      inputTokens += msgInputTokens;
      outputTokens += msgOutputTokens;
      cacheReadTokens += msgCacheReadTokens;
      cacheCreationTokens += msgCacheCreationTokens;

      if (msg.model) {
        costUsd += calculateMessageCost(
          msg.model,
          msgInputTokens,
          msgOutputTokens,
          msgCacheReadTokens,
          msgCacheCreationTokens
        );
      }
    }
  }

  return {
    durationMs: maxTime - minTime,
    totalTokens: inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    messageCount: messages.length,
    costUsd,
  };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Extract text content from a message for display.
 * This version applies content sanitization to filter XML-like tags.
 */
export function extractTextContent(message: ParsedMessage): string {
  let rawText: string;

  if (typeof message.content === 'string') {
    rawText = message.content;
  } else {
    rawText = message.content
      .filter(isTextContent)
      .map((block) => block.text)
      .join('\n');
  }

  // Apply sanitization to remove XML-like tags for display
  return sanitizeDisplayContent(rawText);
}

/**
 * Get all Task calls from a list of messages.
 */
export function getTaskCalls(messages: ParsedMessage[]): ToolCall[] {
  return messages.flatMap((m) => m.toolCalls.filter((tc) => tc.isTask));
}

export interface SessionFileMetadata {
  firstUserMessage: { text: string; timestamp: string } | null;
  messageCount: number;
  isOngoing: boolean;
  gitBranch: string | null;
  /** Total context consumed (compaction-aware) */
  contextConsumption?: number;
  /** Number of compaction events */
  compactionCount?: number;
  /** Per-phase token breakdown */
  phaseBreakdown?: PhaseTokenBreakdown[];
}

/**
 * Analyze key session metadata in a single streaming pass.
 * This avoids multiple file scans when listing sessions.
 */
export async function analyzeSessionFileMetadata(
  filePath: string,
  fsProvider: FileSystemProvider = defaultProvider
): Promise<SessionFileMetadata> {
  if (!(await fsProvider.exists(filePath))) {
    return {
      firstUserMessage: null,
      messageCount: 0,
      isOngoing: false,
      gitBranch: null,
    };
  }

  const fileStream = fsProvider.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let firstUserMessage: { text: string; timestamp: string } | null = null;
  let firstCommandMessage: { text: string; timestamp: string } | null = null;
  let messageCount = 0;
  // After a UserGroup, await the first main-thread assistant message to count the AIGroup
  let awaitingAIGroup = false;
  let gitBranch: string | null = null;

  let activityIndex = 0;
  let lastEndingIndex = -1;
  let hasAnyOngoingActivity = false;
  let hasActivityAfterLastEnding = false;
  // Track tool_use IDs that are shutdown responses so their tool_results are also ending events
  const shutdownToolIds = new Set<string>();

  // Context consumption tracking

  let lastMainAssistantInputTokens = 0;
  const compactionPhases: { pre: number; post: number }[] = [];

  let awaitingPostCompaction = false;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let entry: ChatHistoryEntry;
    try {
      entry = JSON.parse(trimmed) as ChatHistoryEntry;
    } catch {
      continue;
    }

    const parsed = parseChatHistoryEntry(entry);
    if (!parsed) {
      continue;
    }

    if (isParsedUserChunkMessage(parsed)) {
      messageCount++;
      awaitingAIGroup = true;
    } else if (
      awaitingAIGroup &&
      parsed.type === 'assistant' &&
      parsed.model !== '<synthetic>' &&
      !parsed.isSidechain
    ) {
      messageCount++;
      awaitingAIGroup = false;
    }

    if (!gitBranch && 'gitBranch' in entry && entry.gitBranch) {
      gitBranch = entry.gitBranch;
    }

    if (!firstUserMessage && entry.type === 'user') {
      const content = entry.message?.content;
      if (typeof content === 'string') {
        if (isCommandOutputContent(content)) {
          // Skip
        } else if (content.startsWith('[Request interrupted by user')) {
          // Skip interruption messages
        } else if (content.startsWith('<command-name>')) {
          if (!firstCommandMessage) {
            const commandMatch = /<command-name>\/([^<]+)<\/command-name>/.exec(content);
            const commandName = commandMatch ? `/${commandMatch[1]}` : '/command';
            firstCommandMessage = {
              text: commandName,
              timestamp: entry.timestamp ?? new Date().toISOString(),
            };
          }
        } else {
          const sanitized = sanitizeDisplayContent(content);
          if (sanitized.length > 0) {
            firstUserMessage = {
              text: sanitized.substring(0, 500),
              timestamp: entry.timestamp ?? new Date().toISOString(),
            };
          }
        }
      } else if (Array.isArray(content)) {
        const textContent = content
          .filter(isTextContent)
          .map((b) => b.text)
          .join(' ');
        if (
          textContent &&
          !textContent.startsWith('<command-name>') &&
          !textContent.startsWith('[Request interrupted by user')
        ) {
          const sanitized = sanitizeDisplayContent(textContent);
          if (sanitized.length > 0) {
            firstUserMessage = {
              text: sanitized.substring(0, 500),
              timestamp: entry.timestamp ?? new Date().toISOString(),
            };
          }
        }
      }
    }

    // Ongoing detection with one-pass activity tracking.
    if (parsed.type === 'assistant' && Array.isArray(parsed.content)) {
      for (const block of parsed.content) {
        if (block.type === 'thinking' && block.thinking) {
          hasAnyOngoingActivity = true;
          if (lastEndingIndex >= 0) {
            hasActivityAfterLastEnding = true;
          }
          activityIndex++;
        } else if (block.type === 'tool_use' && block.id) {
          if (block.name === 'ExitPlanMode') {
            lastEndingIndex = activityIndex++;
            hasActivityAfterLastEnding = false;
          } else if (
            block.name === 'SendMessage' &&
            block.input?.type === 'shutdown_response' &&
            block.input?.approve === true
          ) {
            // SendMessage shutdown_response = agent is shutting down (ending event)
            shutdownToolIds.add(block.id);
            lastEndingIndex = activityIndex++;
            hasActivityAfterLastEnding = false;
          } else {
            hasAnyOngoingActivity = true;
            if (lastEndingIndex >= 0) {
              hasActivityAfterLastEnding = true;
            }
            activityIndex++;
          }
        } else if (block.type === 'text' && block.text && String(block.text).trim().length > 0) {
          lastEndingIndex = activityIndex++;
          hasActivityAfterLastEnding = false;
        }
      }
    } else if (parsed.type === 'user' && Array.isArray(parsed.content)) {
      // Check if this is a user-rejected tool use (ending event, not ongoing activity)
      const isRejection =
        'toolUseResult' in entry &&
        (entry as unknown as Record<string, unknown>).toolUseResult === 'User rejected tool use';

      for (const block of parsed.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          if (shutdownToolIds.has(block.tool_use_id) || isRejection) {
            // Shutdown tool result or user rejection = ending event
            lastEndingIndex = activityIndex++;
            hasActivityAfterLastEnding = false;
          } else {
            hasAnyOngoingActivity = true;
            if (lastEndingIndex >= 0) {
              hasActivityAfterLastEnding = true;
            }
            activityIndex++;
          }
        } else if (
          block.type === 'text' &&
          typeof block.text === 'string' &&
          block.text.startsWith('[Request interrupted by user')
        ) {
          lastEndingIndex = activityIndex++;
          hasActivityAfterLastEnding = false;
        }
      }
    }

    // Context consumption: track main-thread assistant input tokens
    if (parsed.type === 'assistant' && !parsed.isSidechain && parsed.model !== '<synthetic>') {
      const inputTokens =
        (parsed.usage?.input_tokens ?? 0) +
        (parsed.usage?.cache_read_input_tokens ?? 0) +
        (parsed.usage?.cache_creation_input_tokens ?? 0);
      if (inputTokens > 0) {
        if (awaitingPostCompaction && compactionPhases.length > 0) {
          compactionPhases[compactionPhases.length - 1].post = inputTokens;
          awaitingPostCompaction = false;
        }
        lastMainAssistantInputTokens = inputTokens;
      }
    }

    // Context consumption: detect compaction events
    if (parsed.isCompactSummary) {
      compactionPhases.push({ pre: lastMainAssistantInputTokens, post: 0 });
      awaitingPostCompaction = true;
    }
  }

  // Compute context consumption from tracked phases
  let contextConsumption: number | undefined;
  let phaseBreakdown: PhaseTokenBreakdown[] | undefined;

  if (lastMainAssistantInputTokens > 0) {
    if (compactionPhases.length === 0) {
      // No compaction: just the final input tokens
      contextConsumption = lastMainAssistantInputTokens;
      phaseBreakdown = [
        {
          phaseNumber: 1,
          contribution: lastMainAssistantInputTokens,
          peakTokens: lastMainAssistantInputTokens,
        },
      ];
    } else {
      phaseBreakdown = [];
      let total = 0;

      // Phase 1: tokens up to first compaction
      const phase1Contribution = compactionPhases[0].pre;
      total += phase1Contribution;
      phaseBreakdown.push({
        phaseNumber: 1,
        contribution: phase1Contribution,
        peakTokens: compactionPhases[0].pre,
        postCompaction: compactionPhases[0].post,
      });

      // Middle phases: contribution = pre[i] - post[i-1]
      for (let i = 1; i < compactionPhases.length; i++) {
        const contribution = compactionPhases[i].pre - compactionPhases[i - 1].post;
        total += contribution;
        phaseBreakdown.push({
          phaseNumber: i + 1,
          contribution,
          peakTokens: compactionPhases[i].pre,
          postCompaction: compactionPhases[i].post,
        });
      }

      // Last phase: final tokens - last post-compaction
      // Guard: if the last compaction had no subsequent assistant message, post is 0.
      // In that case, skip the final phase to avoid double-counting.
      const lastPhase = compactionPhases[compactionPhases.length - 1];
      if (lastPhase.post > 0) {
        const lastContribution = lastMainAssistantInputTokens - lastPhase.post;
        total += lastContribution;
        phaseBreakdown.push({
          phaseNumber: compactionPhases.length + 1,
          contribution: lastContribution,
          peakTokens: lastMainAssistantInputTokens,
        });
      }

      contextConsumption = total;
    }
  }

  return {
    firstUserMessage: firstUserMessage ?? firstCommandMessage,
    messageCount,
    isOngoing: lastEndingIndex === -1 ? hasAnyOngoingActivity : hasActivityAfterLastEnding,
    gitBranch,
    contextConsumption,
    compactionCount: compactionPhases.length > 0 ? compactionPhases.length : undefined,
    phaseBreakdown,
  };
}
