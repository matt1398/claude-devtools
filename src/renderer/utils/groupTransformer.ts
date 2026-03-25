/**
 * Transforms EnhancedChunk[] into SessionConversation structure.
 *
 * This module converts chunk-based data into a flat list of ChatItems
 * (UserGroups, SystemGroups, AIGroups) for a chat-style display.
 * Each item is independent - no pairing between user and AI chunks.
 *
 * Also provides an incremental update path that reuses unchanged ChatItem
 * objects to reduce allocation pressure during live-session refreshes.
 */

import {
  isAssistantMessage,
  isEnhancedAIChunk,
  isEnhancedCompactChunk,
  isEnhancedSystemChunk,
  isEnhancedUserChunk,
} from '@renderer/types/data';
import { getFirstSegment, hasPathSeparator, isRelativePath } from '@renderer/utils/pathUtils';
import { isCommandContent, sanitizeDisplayContent } from '@shared/utils/contentSanitizer';
import { createLogger } from '@shared/utils/logger';

import type {
  EnhancedAIChunk,
  EnhancedChunk,
  EnhancedCompactChunk,
  EnhancedSystemChunk,
  EnhancedUserChunk,
  ParsedMessage,
  Process,
  SemanticStep,
} from '@renderer/types/data';
import type {
  AIGroup,
  AIGroupStatus,
  AIGroupSummary,
  AIGroupTokens,
  ChatItem,
  CommandInfo,
  CompactGroup,
  FileReference,
  ImageData,
  SessionConversation,
  SystemGroup,
  UserGroup,
  UserGroupContent,
} from '@renderer/types/groups';

const logger = createLogger('Util:groupTransformer');

// =============================================================================
// Constants
// =============================================================================

/**
 * Regex pattern for detecting slash commands.
 * Matches: /command-name [optional args]
 * Uses non-greedy matching and limited repetition to prevent ReDoS.
 */
// eslint-disable-next-line security/detect-unsafe-regex -- Pattern is safe: limited to 1000 chars and used on bounded user input
const COMMAND_PATTERN = /\/([a-z][a-z-]{0,50})(?:\s+(\S[^\n]{0,1000}))?$/gim;

/**
 * Maximum characters to extract for thinking preview.
 */
const THINKING_PREVIEW_LENGTH = 100;

// =============================================================================
// Main Transformation Function
// =============================================================================

/**
 * Transforms EnhancedChunk[] into SessionConversation.
 *
 * Produces a flat list of independent ChatItems (user, system, AI).
 * Each chunk type becomes its own item - no pairing or grouping.
 *
 * @param chunks - Array of enhanced chunks with semantic steps
 * @param _subagents - Array of all subagents in the session (unused, processes come from chunks)
 * @param isOngoing - Whether the session is still in progress (marks last AI group)
 * @returns SessionConversation structure for chat-style rendering
 */
export function transformChunksToConversation(
  chunks: EnhancedChunk[],
  _subagents: Process[],
  isOngoing: boolean = false
): SessionConversation {
  if (!chunks || chunks.length === 0) {
    return {
      sessionId: '',
      items: [],
      totalUserGroups: 0,
      totalSystemGroups: 0,
      totalAIGroups: 0,
      totalCompactGroups: 0,
    };
  }

  const items: ChatItem[] = [];
  let userCount = 0;
  let systemCount = 0;
  let aiCount = 0;
  let compactCount = 0;

  for (const chunk of chunks) {
    if (isEnhancedUserChunk(chunk)) {
      items.push({
        type: 'user',
        group: createUserGroupFromChunk(chunk, userCount++),
      });
    } else if (isEnhancedSystemChunk(chunk)) {
      items.push({
        type: 'system',
        group: createSystemGroup(chunk),
      });
      systemCount++;
    } else if (isEnhancedAIChunk(chunk)) {
      items.push({
        type: 'ai',
        group: createAIGroupFromChunk(chunk, aiCount),
      });
      aiCount++;
    } else if (isEnhancedCompactChunk(chunk)) {
      items.push({
        type: 'compact',
        group: createCompactGroup(chunk),
      });
      compactCount++;
    } else {
      const unhandledChunkType =
        'chunkType' in chunk ? (chunk as EnhancedChunk).chunkType : 'unknown';
      logger.warn('Unhandled chunk type:', unhandledChunkType);
    }
  }

  // Post-pass: enrich CompactGroups with token deltas
  let phaseCounter = 1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type === 'compact') {
      phaseCounter++;
      const compactItem = items[i] as { type: 'compact'; group: CompactGroup };
      compactItem.group.startingPhaseNumber = phaseCounter;

      // Find last AI group before and first AI group after
      const preAi = findLastAiBefore(items, i);
      const postAi = findFirstAiAfter(items, i);
      if (preAi && postAi) {
        const pre = getLastAssistantTotalTokens(preAi);
        // Use FIRST assistant message after compaction — it reflects the actual
        // compacted context size before the AI generates more content.
        const post = getFirstAssistantTotalTokens(postAi);
        if (pre !== undefined && post !== undefined) {
          compactItem.group.tokenDelta = {
            preCompactionTokens: pre,
            postCompactionTokens: post,
            delta: post - pre,
          };
        }
      }
    }
  }

  // If session is ongoing, mark the last AI group (but don't override interrupted status)
  if (isOngoing && aiCount > 0) {
    // Find the last AI item and mark it as ongoing
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type === 'ai') {
        const currentStatus = item.group.status;
        // Don't override 'interrupted' status - interruption takes precedence over ongoing
        if (currentStatus !== 'interrupted') {
          (item.group as AIGroup & { isOngoing?: boolean }).isOngoing = true;
          (item.group as AIGroup & { status?: AIGroupStatus }).status = 'in_progress';
        }
        break;
      }
    }
  }

  return {
    sessionId: chunks[0]?.id ?? 'unknown',
    items,
    totalUserGroups: userCount,
    totalSystemGroups: systemCount,
    totalAIGroups: aiCount,
    totalCompactGroups: compactCount,
  };
}

// =============================================================================
// Incremental Update
// =============================================================================

/**
 * Incrementally updates a conversation by reusing unchanged ChatItem objects.
 *
 * During live-session refreshes, only the last chunk may have streaming updates
 * and new chunks may have been appended. Instead of re-creating ALL ChatItem
 * objects (O(N) allocation), this function reuses the prefix of unchanged items
 * and only transforms the tail (O(delta) allocation).
 *
 * Falls back to full transformation if chunk count decreased (rare edge case).
 */
export function incrementalUpdateConversation(
  prevConversation: SessionConversation,
  chunks: EnhancedChunk[],
  _subagents: Process[],
  isOngoing: boolean
): SessionConversation {
  const prevItems = prevConversation.items;
  const newChunkCount = chunks.length;
  const prevItemCount = prevItems.length;

  // Fall back to full transform if chunks decreased or no previous items
  if (newChunkCount < prevItemCount || prevItemCount === 0) {
    return transformChunksToConversation(chunks, _subagents, isOngoing);
  }

  // Reuse all items except the last one (it might have streaming updates)
  const reuseCount = prevItemCount - 1;
  const items: ChatItem[] = prevItems.slice(0, reuseCount);

  // Count type indices in reused items
  let userCount = 0;
  let systemCount = 0;
  let aiCount = 0;
  let compactCount = 0;
  for (const item of items) {
    switch (item.type) {
      case 'user':
        userCount++;
        break;
      case 'system':
        systemCount++;
        break;
      case 'ai':
        aiCount++;
        break;
      case 'compact':
        compactCount++;
        break;
    }
  }

  // Clear isOngoing from the last reused AI group (it may have been set
  // in the previous transform). Clone to avoid mutating React-referenced objects.
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].type === 'ai') {
      const group = items[i].group as AIGroup;
      if ((group as AIGroup & { isOngoing?: boolean }).isOngoing) {
        items[i] = {
          type: 'ai',
          group: {
            ...group,
            isOngoing: false,
            status: group.status === 'in_progress' ? 'complete' : group.status,
          },
        } as ChatItem;
      }
      break; // Only the last AI group could have isOngoing
    }
  }

  // Transform only the last old chunk + any new chunks
  for (let i = reuseCount; i < newChunkCount; i++) {
    const chunk = chunks[i];
    if (isEnhancedUserChunk(chunk)) {
      items.push({
        type: 'user',
        group: createUserGroupFromChunk(chunk, userCount++),
      });
    } else if (isEnhancedSystemChunk(chunk)) {
      items.push({
        type: 'system',
        group: createSystemGroup(chunk),
      });
      systemCount++;
    } else if (isEnhancedAIChunk(chunk)) {
      items.push({
        type: 'ai',
        group: createAIGroupFromChunk(chunk, aiCount),
      });
      aiCount++;
    } else if (isEnhancedCompactChunk(chunk)) {
      items.push({
        type: 'compact',
        group: createCompactGroup(chunk),
      });
      compactCount++;
    }
  }

  // Post-pass: CompactGroup token deltas — clone before mutating to avoid
  // changing objects still referenced by the previous store snapshot.
  let phaseCounter = 1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type === 'compact') {
      phaseCounter++;
      const compactItem = items[i] as { type: 'compact'; group: CompactGroup };
      const nextGroup: CompactGroup = {
        ...compactItem.group,
        startingPhaseNumber: phaseCounter,
      };

      const preAi = findLastAiBefore(items, i);
      const postAi = findFirstAiAfter(items, i);
      if (preAi && postAi) {
        const pre = getLastAssistantTotalTokens(preAi);
        const post = getFirstAssistantTotalTokens(postAi);
        if (pre !== undefined && post !== undefined) {
          nextGroup.tokenDelta = {
            preCompactionTokens: pre,
            postCompactionTokens: post,
            delta: post - pre,
          };
        }
      }
      items[i] = { type: 'compact', group: nextGroup };
    }
  }

  // Post-pass: isOngoing flag on last AI group — clone to preserve immutability
  if (isOngoing && aiCount > 0) {
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.type === 'ai') {
        const currentStatus = item.group.status;
        if (currentStatus !== 'interrupted') {
          items[i] = {
            type: 'ai',
            group: {
              ...item.group,
              isOngoing: true,
              status: 'in_progress',
            },
          } as ChatItem;
        }
        break;
      }
    }
  }

  return {
    sessionId: prevConversation.sessionId,
    items,
    totalUserGroups: userCount,
    totalSystemGroups: systemCount,
    totalAIGroups: aiCount,
    totalCompactGroups: compactCount,
  };
}

// =============================================================================
// UserGroup Creation
// =============================================================================

/**
 * Creates a UserGroup from an EnhancedUserChunk.
 *
 * @param chunk - The user chunk to transform
 * @param index - Index within the session (for ordering)
 * @returns UserGroup with parsed content
 */
function createUserGroupFromChunk(chunk: EnhancedUserChunk, index: number): UserGroup {
  return createUserGroup(chunk.userMessage, index);
}

/**
 * Creates a UserGroup from a ParsedMessage.
 *
 * @param message - The user's input message
 * @param index - Index within the session (for ordering)
 * @returns UserGroup with parsed content
 */
function createUserGroup(message: ParsedMessage, index: number): UserGroup {
  const content = extractUserGroupContent(message);

  return {
    id: `user-${message.uuid}`,
    message,
    timestamp: message.timestamp,
    content,
    index,
  };
}

/**
 * Extracts and parses content from a user message.
 *
 * @param message - The user message to parse
 * @returns Parsed UserGroupContent
 */
function extractUserGroupContent(message: ParsedMessage): UserGroupContent {
  let rawText = '';
  const images: ImageData[] = [];
  const fileReferences: FileReference[] = [];

  // Extract text from content
  // Note: Image handling not yet implemented - images are not part of ContentBlock type
  if (typeof message.content === 'string') {
    rawText = message.content;
  } else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block.type === 'text' && block.text) {
        rawText += block.text;
      }
    }
  }

  // Sanitize content for display (handles XML tags from command messages)
  // This converts <command-name>/model</command-name> to "/model"
  const sanitizedText = sanitizeDisplayContent(rawText);

  // Check if this is a command message (for special handling)
  const isCommand = isCommandContent(rawText);

  // Extract commands from the sanitized text (for inline /commands in regular messages)
  // For command messages, the command is already extracted as sanitizedText
  const commands = isCommand ? [] : extractCommands(sanitizedText);

  // Extract file references (@file.ts) from sanitized text
  fileReferences.push(...extractFileReferences(sanitizedText));

  // For command messages, use the sanitized command as display text
  // For regular messages, remove inline commands from display
  let displayText = sanitizedText;
  if (!isCommand) {
    for (const cmd of commands) {
      displayText = displayText.replace(cmd.raw, '').trim();
    }
  }

  return {
    text: displayText || undefined,
    rawText: sanitizedText, // Use sanitized version as rawText for display
    commands,
    images,
    fileReferences,
  };
}

/**
 * Extracts commands from text using regex.
 *
 * @param text - Text to parse for commands
 * @returns Array of CommandInfo objects
 */
function extractCommands(text: string): CommandInfo[] {
  if (!text) return [];

  const commands: CommandInfo[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  COMMAND_PATTERN.lastIndex = 0;

  while ((match = COMMAND_PATTERN.exec(text)) !== null) {
    const [fullMatch, commandName, args] = match;
    commands.push({
      name: commandName,
      args: args?.trim(),
      raw: fullMatch,
      startIndex: match.index,
      endIndex: match.index + fullMatch.length,
    });
  }

  return commands;
}

/**
 * Known directory prefixes that identify file references.
 */
const KNOWN_DIRS = new Set([
  'src',
  'apps',
  'app',
  'lib',
  'types',
  'packages',
  'components',
  'utils',
  'services',
  'hooks',
  'store',
  'renderer',
  'main',
  'preload',
  'public',
  'assets',
  'config',
  'tests',
  'test',
  'specs',
  'spec',
  'e2e',
  'docs',
  'scripts',
  'screens',
  'features',
  'pages',
  'views',
  'models',
  'controllers',
  'routes',
  'middleware',
  'api',
  'common',
  'shared',
  'core',
  'modules',
  'client',
  'server',
  'web',
  'mobile',
  'native',
  'electron',
  'node_modules',
]);

/**
 * Simple pattern for detecting @ mentions that could be file paths.
 * The filtering logic in extractFileReferences determines validity.
 */
const FILE_REF_PATTERN = /@([~a-zA-Z0-9._/-]+)/g;

/**
 * Checks if a path looks like a valid file reference.
 * Must start with known dir, contain /, or start with ./ or ../
 */
function isValidFileRef(path: string): boolean {
  // Check for relative path indicators
  if (isRelativePath(path)) {
    return true;
  }
  // Check if starts with known directory
  const first = getFirstSegment(path);
  if (KNOWN_DIRS.has(first)) {
    return true;
  }
  // Check if contains a path separator (indicates directory structure)
  if (hasPathSeparator(path) && path.length > 2) {
    return true;
  }
  return false;
}

/**
 * Extracts file references (@file.ts) from text.
 *
 * @param text - Text to parse for file references
 * @returns Array of FileReference objects
 */
export function extractFileReferences(text: string): FileReference[] {
  if (!text) return [];

  const references: FileReference[] = [];
  // Reset regex state before use
  FILE_REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FILE_REF_PATTERN.exec(text)) !== null) {
    const [fullMatch, path] = match;
    // Only include if it looks like a valid file reference
    if (isValidFileRef(path)) {
      references.push({
        path,
        raw: fullMatch,
      });
    }
  }

  return references;
}

// =============================================================================
// SystemGroup Creation
// =============================================================================

/**
 * Creates a SystemGroup from an EnhancedSystemChunk.
 *
 * @param chunk - The system chunk to transform
 * @returns SystemGroup with command output
 */
function createSystemGroup(chunk: EnhancedSystemChunk): SystemGroup {
  return {
    id: chunk.id, // Use stable chunk ID instead of array index
    message: chunk.message,
    timestamp: chunk.startTime,
    commandOutput: chunk.commandOutput,
  };
}

// =============================================================================
// CompactGroup Creation
// =============================================================================

/**
 * Creates a CompactGroup from an EnhancedCompactChunk.
 *
 * @param chunk - The compact chunk to transform
 * @returns CompactGroup marking where conversation was compacted, with message content
 */
function createCompactGroup(chunk: EnhancedCompactChunk): CompactGroup {
  return {
    id: chunk.id, // Use stable chunk ID instead of array index
    timestamp: chunk.startTime,
    message: chunk.message, // Pass through the compact summary message
  };
}

// =============================================================================
// AIGroup Creation
// =============================================================================

/**
 * Creates an AIGroup from an EnhancedAIChunk.
 *
 * @param chunk - The AI chunk to transform
 * @param turnIndex - 0-based index of this AI group within the session
 * @returns AIGroup with semantic steps and metrics
 */
function createAIGroupFromChunk(chunk: EnhancedAIChunk, turnIndex: number): AIGroup {
  const steps = chunk.semanticSteps;

  // Calculate timing from all steps
  const startTime = steps.length > 0 ? steps[0].startTime : chunk.startTime;
  const endTime =
    steps.length > 0
      ? (steps[steps.length - 1].endTime ?? steps[steps.length - 1].startTime)
      : chunk.endTime;
  const durationMs = endTime.getTime() - startTime.getTime();

  // Find any source assistant message for token calculation
  const sourceMessage = chunk.responses.find((msg) => isAssistantMessage(msg)) ?? null;

  // Calculate tokens from all steps
  const tokens = calculateTokensFromSteps(steps, sourceMessage);

  // Generate summary from all steps
  const summary = computeAIGroupSummary(steps);

  // Determine status from all steps
  const status = determineAIGroupStatus(steps);

  return {
    id: chunk.id, // Use stable chunk ID instead of array index
    turnIndex,
    startTime,
    endTime,
    durationMs,
    steps,
    tokens,
    summary,
    status,
    processes: chunk.processes,
    chunkId: chunk.id,
    metrics: chunk.metrics,
    responses: chunk.responses,
  };
}

/**
 * Calculates token metrics from semantic steps and source message.
 *
 * @param steps - Semantic steps in this AI Group
 * @param sourceMessage - Source assistant message (if available)
 * @returns Token metrics
 */
function calculateTokensFromSteps(
  steps: SemanticStep[],
  sourceMessage: ParsedMessage | null | undefined
): AIGroupTokens {
  let input = 0;
  let output = 0;
  let cached = 0;
  let thinking = 0;

  // Sum from steps
  for (const step of steps) {
    if (step.tokens) {
      input += step.tokens.input ?? 0;
      output += step.tokens.output ?? 0;
      cached += step.tokens.cached ?? 0;
    }
    if (step.tokenBreakdown) {
      input += step.tokenBreakdown.input ?? 0;
      output += step.tokenBreakdown.output ?? 0;
      cached += step.tokenBreakdown.cacheRead ?? 0;
    }
    if (step.type === 'thinking' && step.tokens?.output) {
      thinking += step.tokens.output;
    }
  }

  // Override with source message usage if available (more accurate)
  if (sourceMessage?.usage) {
    input = sourceMessage.usage.input_tokens ?? 0;
    output = sourceMessage.usage.output_tokens ?? 0;
    cached = sourceMessage.usage.cache_read_input_tokens ?? 0;
  }

  return {
    input,
    output,
    cached,
    thinking,
  };
}

// =============================================================================
// AIGroup Summary & Status Computation
// =============================================================================

/**
 * Computes summary statistics for an AIGroup's collapsed view.
 *
 * @param steps - Semantic steps in the AI Group
 * @returns Summary statistics
 */
function computeAIGroupSummary(steps: SemanticStep[]): AIGroupSummary {
  let thinkingPreview: string | undefined;
  let toolCallCount = 0;
  let outputMessageCount = 0;
  let subagentCount = 0;
  let totalDurationMs = 0;
  let totalTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;

  for (const step of steps) {
    // Extract thinking preview from first thinking step
    if (!thinkingPreview && step.type === 'thinking' && step.content.thinkingText) {
      const fullText = step.content.thinkingText;
      thinkingPreview =
        fullText.length > THINKING_PREVIEW_LENGTH
          ? fullText.slice(0, THINKING_PREVIEW_LENGTH) + '...'
          : fullText;
    }

    // Count step types
    if (step.type === 'tool_call') toolCallCount++;
    if (step.type === 'output') outputMessageCount++;
    if (step.type === 'subagent') subagentCount++;

    // Sum duration
    totalDurationMs += step.durationMs ?? 0;

    // Sum tokens
    if (step.tokens) {
      totalTokens += (step.tokens.input ?? 0) + (step.tokens.output ?? 0);
      outputTokens += step.tokens.output ?? 0;
      cachedTokens += step.tokens.cached ?? 0;
    }
    if (step.tokenBreakdown) {
      totalTokens += step.tokenBreakdown.input + step.tokenBreakdown.output;
      outputTokens += step.tokenBreakdown.output;
      cachedTokens += step.tokenBreakdown.cacheRead;
    }
  }

  return {
    thinkingPreview,
    toolCallCount,
    outputMessageCount,
    subagentCount,
    totalDurationMs,
    totalTokens,
    outputTokens,
    cachedTokens,
  };
}

/**
 * Determines the status of an AIGroup based on its steps.
 *
 * @param steps - Semantic steps in the AI Group
 * @returns AIGroupStatus
 */
function determineAIGroupStatus(steps: SemanticStep[]): AIGroupStatus {
  if (steps.length === 0) return 'error';

  // Check for interruption
  const hasInterruption = steps.some((step) => step.type === 'interruption');
  if (hasInterruption) return 'interrupted';

  // Check for errors
  const hasError = steps.some((step) => step.type === 'tool_result' && step.content.isError);
  if (hasError) return 'error';

  // Check if any step is incomplete (no endTime)
  const hasIncomplete = steps.some((step) => !step.endTime);
  if (hasIncomplete) return 'in_progress';

  // Otherwise, complete
  return 'complete';
}

// =============================================================================
// CompactGroup Enrichment Helpers
// =============================================================================

/**
 * Find the last AI group before a given index in the items array.
 */
function findLastAiBefore(items: ChatItem[], index: number): AIGroup | null {
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].type === 'ai') return items[i].group as AIGroup;
  }
  return null;
}

/**
 * Find the first AI group after a given index in the items array.
 */
function findFirstAiAfter(items: ChatItem[], index: number): AIGroup | null {
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].type === 'ai') return items[i].group as AIGroup;
  }
  return null;
}

/**
 * Get total tokens from the last assistant message in an AI group.
 * Sums input_tokens, output_tokens, cache_read_input_tokens, and cache_creation_input_tokens.
 */
function getLastAssistantTotalTokens(aiGroup: AIGroup): number | undefined {
  const responses = aiGroup.responses || [];
  for (let i = responses.length - 1; i >= 0; i--) {
    const msg = responses[i];
    if (msg.type === 'assistant' && msg.usage) {
      return (
        (msg.usage.input_tokens ?? 0) +
        (msg.usage.output_tokens ?? 0) +
        (msg.usage.cache_read_input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0)
      );
    }
  }
  return undefined;
}

/**
 * Get total tokens from the FIRST assistant message in an AI group.
 * Used for post-compaction token measurement: the first response after compaction
 * reflects the actual compacted context size before the AI generates more content.
 */
function getFirstAssistantTotalTokens(aiGroup: AIGroup): number | undefined {
  const responses = aiGroup.responses || [];
  for (const msg of responses) {
    if (msg.type === 'assistant' && msg.usage) {
      return (
        (msg.usage.input_tokens ?? 0) +
        (msg.usage.output_tokens ?? 0) +
        (msg.usage.cache_read_input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0)
      );
    }
  }
  return undefined;
}

// =============================================================================
// Helper Functions
// =============================================================================
