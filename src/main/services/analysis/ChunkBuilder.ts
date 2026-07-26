/**
 * ChunkBuilder service - Builds visualization chunks from parsed session data.
 *
 * Responsibilities:
 * - Group messages into chunks (user message + responses)
 * - Attach subagents to chunks
 * - Build waterfall chart data
 * - Calculate chunk metrics
 *
 * This module orchestrates chunk building using specialized modules:
 * - MessageClassifier: Classify messages into categories
 * - ChunkFactory: Create individual chunk objects
 * - ProcessLinker: Link subagent processes to chunks
 * - SemanticStepExtractor: Extract semantic steps from AI chunks
 * - SemanticStepGrouper: Group semantic steps for UI
 * - ToolExecutionBuilder: Build tool execution tracking
 * - SubagentDetailBuilder: Build subagent drill-down details
 * - ConversationGroupBuilder: Alternative grouping strategy
 */

import {
  type Chunk,
  type ConversationGroup,
  EMPTY_METRICS,
  type EnhancedChunk,
  type EnhancedShellCommandChunk,
  isAIChunk,
  isCompactChunk,
  isParsedShellOutputMessage,
  isSystemChunk,
  isUserChunk,
  type MessageCategory,
  type ParsedMessage,
  type Process,
  type Session,
  type SessionDetail,
  type SessionMetrics,
  type SubagentDetail,
  type TokenUsage,
} from '@main/types';
import { calculateMetrics } from '@main/utils/jsonl';
import { createLogger } from '@shared/utils/logger';

import type { WaterfallData, WaterfallItem } from '@shared/types';

const logger = createLogger('Service:ChunkBuilder');

import { classifyMessages } from '../parsing/MessageClassifier';

import {
  buildAIChunkFromBuffer,
  buildCompactChunk,
  buildNotificationChunk,
  buildShellCommandChunk,
  buildSystemChunk,
  buildUserChunk,
  mergeShellOutput,
} from './ChunkFactory';
import { buildGroups as buildConversationGroups } from './ConversationGroupBuilder';
import { buildSubagentDetail as buildSubagentDetailFn } from './SubagentDetailBuilder';

import type { SubagentResolver } from '../discovery/SubagentResolver';
import type { FileSystemProvider } from '../infrastructure/FileSystemProvider';
import type { SessionParser } from '../parsing/SessionParser';

export class ChunkBuilder {
  // ===========================================================================
  // Chunk Building
  // ===========================================================================

  /**
   * Build chunks from messages using 4-category classification.
   * Produces independent UserChunks, AIChunks, and SystemChunks.
   *
   * Categories:
   * - User: Genuine user input (creates UserChunk, renders RIGHT)
   * - System: Command output <local-command-stdout> (creates SystemChunk, renders LEFT)
   * - Hard Noise: Filtered out entirely (system metadata, caveats, reminders)
   * - AI: All other messages grouped into AIChunks (renders LEFT)
   *
   * All chunk types are INDEPENDENT - no pairing between User and AI.
   */
  buildChunks(messages: ParsedMessage[], subagents: Process[] = []): EnhancedChunk[] {
    const chunks: EnhancedChunk[] = [];

    // Filter to main thread messages (non-sidechain)
    const mainMessages = messages.filter((m) => !m.isSidechain);
    logger.debug(`Total messages: ${messages.length}, Main thread: ${mainMessages.length}`);

    // Classify each message into categories using MessageClassifier
    const classified = classifyMessages(mainMessages);

    // Log classification summary
    const categoryCounts = new Map<MessageCategory, number>();
    for (const { category } of classified) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
    logger.debug('Message classification:', Object.fromEntries(categoryCounts));

    // Build chunks from classification - AI chunks are INDEPENDENT
    let aiBuffer: ParsedMessage[] = [];
    // The shell-command chunk still open to absorb its immediately-following
    // `<bash-stdout>`/`<bash-stderr>` output entry. Reset whenever any other
    // (non-shell) category interrupts, so output only merges when contiguous.
    let pendingShellChunk: EnhancedShellCommandChunk | null = null;

    for (const { message, category } of classified) {
      if (category !== 'shell') pendingShellChunk = null;
      switch (category) {
        case 'hardNoise':
          // Skip - filtered out
          break;

        case 'compact':
          // Flush any buffered AI messages first
          if (aiBuffer.length > 0) {
            chunks.push(buildAIChunkFromBuffer(aiBuffer, subagents, messages));
            aiBuffer = [];
          }
          chunks.push(buildCompactChunk(message));
          break;

        case 'notification':
          // Flush any buffered AI messages first
          if (aiBuffer.length > 0) {
            chunks.push(buildAIChunkFromBuffer(aiBuffer, subagents, messages));
            aiBuffer = [];
          }
          chunks.push(buildNotificationChunk(message));
          break;

        case 'shell': {
          // An output-only entry (`<bash-stdout>`/`<bash-stderr>`) immediately
          // following a command merges into the open shell chunk.
          if (pendingShellChunk && isParsedShellOutputMessage(message)) {
            mergeShellOutput(pendingShellChunk, message);
            break;
          }
          // Otherwise this starts a new shell block (a `<bash-input>` command, or
          // an orphaned output entry with no preceding command → command === '').
          if (aiBuffer.length > 0) {
            chunks.push(buildAIChunkFromBuffer(aiBuffer, subagents, messages));
            aiBuffer = [];
          }
          const shellChunk = buildShellCommandChunk(message);
          chunks.push(shellChunk);
          // Only a command entry can absorb subsequent output; a standalone
          // output entry is already complete.
          pendingShellChunk = isParsedShellOutputMessage(message) ? null : shellChunk;
          break;
        }

        case 'user':
          // Flush any buffered AI messages first
          if (aiBuffer.length > 0) {
            chunks.push(buildAIChunkFromBuffer(aiBuffer, subagents, messages));
            aiBuffer = [];
          }
          chunks.push(buildUserChunk(message));
          break;

        case 'system':
          // Flush any buffered AI messages first
          if (aiBuffer.length > 0) {
            chunks.push(buildAIChunkFromBuffer(aiBuffer, subagents, messages));
            aiBuffer = [];
          }
          chunks.push(buildSystemChunk(message));
          break;

        case 'ai':
          aiBuffer.push(message);
          break;
      }
    }

    // Flush remaining AI buffer
    if (aiBuffer.length > 0) {
      chunks.push(buildAIChunkFromBuffer(aiBuffer, subagents, messages));
    }

    // Log final chunk summary
    const userChunkCount = chunks.filter(isUserChunk).length;
    const aiChunkCount = chunks.filter(isAIChunk).length;
    const systemChunkCount = chunks.filter(isSystemChunk).length;
    const compactChunkCount = chunks.filter(isCompactChunk).length;
    logger.debug(
      `Created ${chunks.length} chunks: ${userChunkCount} user, ${aiChunkCount} AI, ${systemChunkCount} system, ${compactChunkCount} compact`
    );

    return chunks;
  }

  // ===========================================================================
  // Simplified Grouping Strategy (delegates to ConversationGroupBuilder)
  // ===========================================================================

  /**
   * Build conversation groups using simplified grouping strategy.
   * Groups one user message with all AI responses until the next user message.
   *
   * This is a cleaner alternative to buildChunks() that:
   * - Uses simpler time-based grouping
   * - Separates Task executions from regular tool executions
   * - Links subagents more explicitly via TaskExecution
   */
  buildGroups(messages: ParsedMessage[], subagents: Process[]): ConversationGroup[] {
    return buildConversationGroups(messages, subagents);
  }

  // ===========================================================================
  // Session Detail Building
  // ===========================================================================

  /**
   * Build a complete SessionDetail from parsed data.
   */
  buildSessionDetail(
    session: Session,
    messages: ParsedMessage[],
    subagents: Process[]
  ): SessionDetail {
    // Build chunks
    const chunks = this.buildChunks(messages, subagents);

    // Calculate overall metrics
    const metrics = calculateMetrics(messages);

    return {
      session,
      messages,
      chunks,
      processes: subagents,
      metrics,
    };
  }

  /**
   * Build waterfall chart data from chunks and resolved processes.
   */
  buildWaterfallData(chunks: Chunk[], processes: Process[]): WaterfallData {
    const items: WaterfallItem[] = [];

    for (const chunk of chunks) {
      const baseChunkItem: WaterfallItem = {
        id: chunk.id,
        label: this.getChunkLabel(chunk),
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        durationMs: chunk.durationMs,
        tokenUsage: this.toTokenUsage(chunk.metrics),
        level: 0,
        type: 'chunk',
        isParallel: false,
      };
      items.push(baseChunkItem);

      if (isAIChunk(chunk)) {
        for (const toolExec of chunk.toolExecutions) {
          const endTime = toolExec.endTime ?? toolExec.startTime;
          items.push({
            id: `tool-${toolExec.toolCall.id}`,
            label: toolExec.toolCall.name,
            startTime: toolExec.startTime,
            endTime,
            durationMs:
              toolExec.durationMs ?? Math.max(endTime.getTime() - toolExec.startTime.getTime(), 0),
            tokenUsage: {
              input_tokens: 0,
              output_tokens: 0,
            },
            level: 1,
            type: 'tool',
            isParallel: false,
            parentId: chunk.id,
          });
        }

        for (const process of chunk.processes) {
          items.push({
            id: `subagent-${process.id}`,
            label: process.description || process.subagentType || process.id,
            startTime: process.startTime,
            endTime: process.endTime,
            durationMs: process.durationMs,
            tokenUsage: this.toTokenUsage(process.metrics),
            level: 1,
            type: 'subagent',
            isParallel: process.isParallel,
            parentId: chunk.id,
            metadata: {
              subagentType: process.subagentType,
              messageCount: process.messages.length,
            },
          });
        }
      }
    }

    // Add any process that was not attached to an AI chunk (defensive fallback)
    for (const process of processes) {
      const itemId = `subagent-${process.id}`;
      if (items.some((item) => item.id === itemId)) {
        continue;
      }
      items.push({
        id: itemId,
        label: process.description || process.subagentType || process.id,
        startTime: process.startTime,
        endTime: process.endTime,
        durationMs: process.durationMs,
        tokenUsage: this.toTokenUsage(process.metrics),
        level: 0,
        type: 'subagent',
        isParallel: process.isParallel,
        metadata: {
          subagentType: process.subagentType,
          messageCount: process.messages.length,
        },
      });
    }

    const sortedItems = [...items];
    sortedItems.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    if (sortedItems.length === 0) {
      const now = new Date();
      return {
        items: [],
        minTime: now,
        maxTime: now,
        totalDurationMs: 0,
      };
    }

    const minTime = sortedItems.reduce(
      (min, item) => (item.startTime.getTime() < min.getTime() ? item.startTime : min),
      sortedItems[0].startTime
    );
    const maxTime = sortedItems.reduce(
      (max, item) => (item.endTime.getTime() > max.getTime() ? item.endTime : max),
      sortedItems[0].endTime
    );

    return {
      items: sortedItems,
      minTime,
      maxTime,
      totalDurationMs: Math.max(maxTime.getTime() - minTime.getTime(), 0),
    };
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Get total metrics for all chunks.
   */
  getTotalChunkMetrics(chunks: (Chunk | EnhancedChunk)[]): SessionMetrics {
    if (chunks.length === 0) {
      return { ...EMPTY_METRICS };
    }

    let durationMs = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let messageCount = 0;

    for (const chunk of chunks) {
      durationMs += chunk.durationMs;
      inputTokens += chunk.metrics.inputTokens;
      outputTokens += chunk.metrics.outputTokens;
      cacheReadTokens += chunk.metrics.cacheReadTokens;
      cacheCreationTokens += chunk.metrics.cacheCreationTokens;
      messageCount += chunk.metrics.messageCount;
    }

    return {
      durationMs,
      totalTokens: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      messageCount,
    };
  }

  /**
   * Find chunk containing a specific message UUID.
   */
  findChunkByMessageId(
    chunks: (Chunk | EnhancedChunk)[],
    messageUuid: string
  ): Chunk | EnhancedChunk | undefined {
    return chunks.find((c) => {
      // UserChunk: check userMessage
      if (isUserChunk(c)) {
        return c.userMessage.uuid === messageUuid;
      }
      // AIChunk: check responses
      if (isAIChunk(c)) {
        return c.responses.some((r) => r.uuid === messageUuid);
      }
      return false;
    });
  }

  /**
   * Find chunk containing a specific subagent.
   * Only AIChunks have processes.
   */
  findChunkBySubagentId(
    chunks: (Chunk | EnhancedChunk)[],
    subagentId: string
  ): Chunk | EnhancedChunk | undefined {
    return chunks.find((c) => {
      if (isAIChunk(c)) {
        return c.processes.some((s: Process) => s.id === subagentId);
      }
      return false;
    });
  }

  private getChunkLabel(chunk: Chunk): string {
    switch (chunk.chunkType) {
      case 'user':
        return 'User';
      case 'ai':
        return 'Assistant';
      case 'system':
        return 'System';
      case 'compact':
        return 'Compact';
      case 'shell':
        return 'Shell';
      default:
        return 'Chunk';
    }
  }

  private toTokenUsage(metrics: SessionMetrics): TokenUsage {
    return {
      input_tokens: metrics.inputTokens,
      output_tokens: metrics.outputTokens,
      cache_read_input_tokens: metrics.cacheReadTokens || undefined,
      cache_creation_input_tokens: metrics.cacheCreationTokens || undefined,
    };
  }

  // ===========================================================================
  // Subagent Detail Building (for drill-down)
  // ===========================================================================

  /**
   * Build detailed information for a specific subagent.
   * Used for drill-down modal to show subagent's internal execution.
   *
   * @param projectId - Project ID
   * @param sessionId - Parent session ID (currently unused, kept for API consistency)
   * @param subagentId - Subagent ID to load
   * @param sessionParser - SessionParser instance for parsing subagent file
   * @param subagentResolver - SubagentResolver instance for nested subagents
   * @returns SubagentDetail or null if not found
   */
  async buildSubagentDetail(
    projectId: string,
    sessionId: string,
    subagentId: string,
    sessionParser: SessionParser,
    subagentResolver: SubagentResolver,
    fsProvider: FileSystemProvider,
    projectsDir: string
  ): Promise<SubagentDetail | null> {
    // Delegate to the extracted module, passing buildChunks as a callback
    return buildSubagentDetailFn(
      projectId,
      sessionId,
      subagentId,
      sessionParser,
      subagentResolver,
      (messages, subagents) => this.buildChunks(messages, subagents),
      fsProvider,
      projectsDir
    );
  }
}
