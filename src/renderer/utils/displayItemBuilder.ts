/**
 * Display Item Builder - Build display items from semantic steps or messages
 *
 * Creates a flat chronological list of display items for the AI Group UI.
 */

import { parseAllTeammateMessages } from '@shared/utils/teammateMessageParser';

import { estimateTokens, formatToolInput, formatToolResult, toDate } from './aiGroupHelpers';
import { extractSlashes, type PrecedingSlashInfo } from './slashCommandExtractor';
import { linkToolCallsToResults } from './toolLinkingEngine';

import type { ParsedMessage, Process, SemanticStep } from '../types/data';
import type { AIGroupDisplayItem, AIGroupLastOutput, LinkedToolItem } from '../types/groups';

/**
 * Get the timestamp from a display item for sorting.
 */
function getDisplayItemTimestamp(item: AIGroupDisplayItem): Date {
  switch (item.type) {
    case 'thinking':
    case 'output':
      return toDate(item.timestamp);
    case 'tool':
      return toDate(item.tool.startTime);
    case 'subagent':
      return toDate(item.subagent.startTime);
    case 'slash':
      return toDate(item.slash.timestamp);
    case 'teammate_message':
      return toDate(item.teammateMessage.timestamp);
    case 'subagent_input':
    case 'compact_boundary':
      return toDate(item.timestamp);
  }
}

/**
 * Sort display items chronologically.
 */
function sortDisplayItemsChronologically(items: AIGroupDisplayItem[]): void {
  items.sort((a, b) => getDisplayItemTimestamp(a).getTime() - getDisplayItemTimestamp(b).getTime());
}

/**
 * Link TeammateMessages to their triggering SendMessage calls.
 * For each TeammateMessage, scans backwards through chronologically sorted items
 * to find the most recent SendMessage to that teammate.
 * Only matches type: "message" or "broadcast" (not shutdown_request/shutdown_response).
 * Proactive messages (no preceding SendMessage) get no badge.
 */
function linkTeammateReplies(items: AIGroupDisplayItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type !== 'teammate_message') continue;
    const tmMsg = item.teammateMessage;

    // Scan backwards for the most recent SendMessage to this teammate
    for (let j = i - 1; j >= 0; j--) {
      const prev = items[j];
      if (prev.type !== 'tool') continue;
      if (prev.tool.name !== 'SendMessage') continue;
      const input = prev.tool.input;
      // Only match outbound messages (not shutdown_request, shutdown_response, etc.)
      if (input.type !== 'message' && input.type !== 'broadcast') continue;
      // Match by recipient (broadcast goes to all, so always matches)
      if (input.type === 'message' && input.recipient !== tmMsg.teammateId) continue;

      tmMsg.replyToSummary = (input.summary as string) || 'message';
      tmMsg.replyToToolId = prev.tool.id;
      break;
    }
  }
}

/**
 * Build a flat chronological list of display items for the AI Group.
 *
 * Strategy:
 * 1. Skip the step that represents lastOutput (to avoid duplication)
 * 2. For tool_call steps, use the LinkedToolItem (which includes the result)
 * 3. Skip standalone tool_result steps (already linked to calls)
 * 4. Skip Task tool_call steps that have associated subagents (avoid duplication)
 * 5. Include thinking, subagent, and output steps
 * 6. Return items in chronological order
 *
 * @param steps - Semantic steps from the AI Group
 * @param lastOutput - The last output to skip
 * @param subagents - Subagents associated with this group
 * @param responses - Optional raw messages for extracting slash instructions
 * @param precedingSlash - Optional slash info from the preceding UserGroup
 * @returns Flat array of display items
 */
export function buildDisplayItems(
  steps: SemanticStep[],
  lastOutput: AIGroupLastOutput | null,
  subagents: Process[],
  responses?: ParsedMessage[],
  precedingSlash?: PrecedingSlashInfo
): AIGroupDisplayItem[] {
  const displayItems: AIGroupDisplayItem[] = [];
  const linkedTools = linkToolCallsToResults(steps, responses);

  // Build set of Task IDs that have associated subagents
  // This prevents duplicate display of Task tool calls when subagents are shown
  const taskIdsWithSubagents = new Set<string>(
    subagents.map((s) => s.parentTaskId).filter((id): id is string => !!id)
  );

  // Find the step ID of lastOutput to skip it
  let lastOutputStepId: string | undefined;
  if (lastOutput) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (
        lastOutput.type === 'text' &&
        step.type === 'output' &&
        step.content.outputText === lastOutput.text
      ) {
        lastOutputStepId = step.id;
        break;
      }
      if (
        lastOutput.type === 'tool_result' &&
        step.type === 'tool_result' &&
        step.content.toolResultContent === lastOutput.toolResult
      ) {
        lastOutputStepId = step.id;
        break;
      }
      if (
        lastOutput.type === 'interruption' &&
        step.type === 'interruption' &&
        step.content.interruptionText === lastOutput.interruptionMessage
      ) {
        lastOutputStepId = step.id;
        break;
      }
    }
  }

  // Build display items
  for (const step of steps) {
    // Skip the last output step
    if (lastOutputStepId && step.id === lastOutputStepId) {
      continue;
    }

    switch (step.type) {
      case 'thinking':
        if (step.content.thinkingText) {
          displayItems.push({
            type: 'thinking',
            content: step.content.thinkingText,
            timestamp: step.startTime,
            tokenCount: estimateTokens(step.content.thinkingText),
          });
        }
        break;

      case 'tool_call': {
        const linkedTool = linkedTools.get(step.id);
        if (linkedTool) {
          // Skip Task tool calls that have associated subagents
          // The subagent will be shown separately, so showing the Task call is redundant
          const isTaskWithSubagent =
            linkedTool.name === 'Task' && taskIdsWithSubagents.has(step.id);
          if (!isTaskWithSubagent) {
            displayItems.push({
              type: 'tool',
              tool: linkedTool,
            });
          }
        }
        break;
      }

      case 'tool_result':
        // Skip - these are already included in LinkedToolItem
        break;

      case 'subagent': {
        const subagentId = step.content.subagentId;
        const subagent = subagents.find((s) => s.id === subagentId);
        if (subagent) {
          displayItems.push({
            type: 'subagent',
            subagent: subagent,
          });
        }
        break;
      }

      case 'output':
        if (step.content.outputText) {
          displayItems.push({
            type: 'output',
            content: step.content.outputText,
            timestamp: step.startTime,
            tokenCount: estimateTokens(step.content.outputText),
          });
        }
        break;

      case 'interruption':
        if (step.content.interruptionText) {
          displayItems.push({
            type: 'output',
            content: step.content.interruptionText,
            timestamp: step.startTime,
            tokenCount: estimateTokens(step.content.interruptionText),
          });
        }
        break;
    }
  }

  // Add slashes as display items
  if (responses) {
    const slashes = extractSlashes(responses, precedingSlash);
    for (const slash of slashes) {
      displayItems.push({
        type: 'slash',
        slash,
      });
    }
  }

  // Add teammate messages from responses (one user message may contain multiple blocks)
  if (responses) {
    for (const msg of responses) {
      if (msg.type !== 'user' || msg.isMeta) continue;
      const rawText =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('')
            : '';
      const parsedBlocks = parseAllTeammateMessages(rawText);
      for (const parsed of parsedBlocks) {
        displayItems.push({
          type: 'teammate_message',
          teammateMessage: {
            id: `${msg.uuid}-${parsed.teammateId}-${displayItems.length}`,
            teammateId: parsed.teammateId,
            color: parsed.color,
            summary: parsed.summary,
            content: parsed.content,
            timestamp: toDate(msg.timestamp),
            tokenCount: estimateTokens(parsed.content),
          },
        });
      }
    }
  }

  // Sort all items chronologically to ensure slashes appear in correct order
  sortDisplayItemsChronologically(displayItems);

  // Link TeammateMessages to their triggering SendMessage calls
  linkTeammateReplies(displayItems);

  return displayItems;
}

/**
 * Build display items from raw ParsedMessages (used by subagents).
 * This mirrors the logic of buildDisplayItems but works with messages instead of SemanticSteps.
 *
 * Strategy:
 * 1. Extract thinking blocks from assistant messages
 * 2. Extract tool_use blocks from assistant messages -> collect in a Map by ID
 * 3. Extract text output blocks from assistant messages
 * 4. Extract tool_result blocks from user messages (isMeta or toolResults exist)
 * 5. Link tool calls with their results using LinkedToolItem structure
 * 6. Filter Task tool calls that have matching subagents
 * 7. Include subagents as separate items
 * 8. Sort all items chronologically
 *
 * @param messages - Raw ParsedMessages to process
 * @param subagents - Subagents associated with these messages
 * @returns Flat array of display items
 */
export function buildDisplayItemsFromMessages(
  messages: ParsedMessage[],
  subagents: Process[] = []
): AIGroupDisplayItem[] {
  const displayItems: AIGroupDisplayItem[] = [];

  // Maps for tool call/result linking
  const toolCallsById = new Map<
    string,
    {
      id: string;
      name: string;
      input: Record<string, unknown>;
      timestamp: Date;
      sourceMessageId: string;
      sourceModel?: string;
    }
  >();

  const toolResultsById = new Map<
    string,
    {
      content: string | unknown[];
      isError: boolean;
      toolUseResult?: Record<string, unknown>;
      timestamp: Date;
    }
  >();

  // Map to collect skill instructions by source tool use ID
  // Skill tools have follow-up isMeta:true messages with instructions starting with "Base directory for this skill:"
  const skillInstructionsById = new Map<string, string>();

  // Build set of Task IDs that have associated subagents
  // This prevents duplicate display of Task tool calls when subagents are shown
  const taskIdsWithSubagents = new Set<string>(
    subagents.map((s) => s.parentTaskId).filter((id): id is string => !!id)
  );

  // Track compaction events for compact_boundary display items
  let compactionCount = 0;

  // Helper to get the last assistant's total input tokens before a given index
  // Note: don't filter by isSidechain — subagent messages all have isSidechain=true
  function getLastAssistantInputTokens(idx: number): number {
    for (let i = idx - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === 'assistant' && m.usage && m.model !== '<synthetic>') {
        return (
          (m.usage.input_tokens ?? 0) +
          (m.usage.cache_read_input_tokens ?? 0) +
          (m.usage.cache_creation_input_tokens ?? 0)
        );
      }
    }
    return 0;
  }

  // Helper to get the first assistant's total input tokens after a given index
  function getFirstAssistantInputTokens(idx: number): number {
    for (let i = idx + 1; i < messages.length; i++) {
      const m = messages[i];
      if (m.type === 'assistant' && m.usage && m.model !== '<synthetic>') {
        return (
          (m.usage.input_tokens ?? 0) +
          (m.usage.cache_read_input_tokens ?? 0) +
          (m.usage.cache_creation_input_tokens ?? 0)
        );
      }
    }
    return 0;
  }

  // First pass: collect tool calls and tool results from messages
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const msg = messages[messageIndex];
    const msgTimestamp = toDate(msg.timestamp);

    // Detect compact boundary (before regular user message handling)
    if (msg.isCompactSummary) {
      const preTokens = getLastAssistantInputTokens(messageIndex);
      const postTokens = getFirstAssistantInputTokens(messageIndex);
      const rawText =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((b: { type: string; text?: string }) => b.type === 'text')
                .map((b: { type: string; text?: string }) => b.text ?? '')
                .join('\n\n')
            : '';
      displayItems.push({
        type: 'compact_boundary',
        content: rawText,
        timestamp: msgTimestamp,
        tokenDelta:
          preTokens > 0
            ? {
                preCompactionTokens: preTokens,
                postCompactionTokens: postTokens,
                delta: postTokens - preTokens,
              }
            : undefined,
        phaseNumber: compactionCount + 2,
      });
      compactionCount++;
      continue;
    }

    // Check for teammate messages (non-meta user messages with <teammate-message> content)
    // One user message may contain multiple <teammate-message> blocks
    if (msg.type === 'user' && !msg.isMeta) {
      const rawText =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('')
            : '';
      const parsedBlocks = parseAllTeammateMessages(rawText);
      if (parsedBlocks.length > 0) {
        for (const parsed of parsedBlocks) {
          displayItems.push({
            type: 'teammate_message',
            teammateMessage: {
              id: `${msg.uuid}-${parsed.teammateId}-${displayItems.length}`,
              teammateId: parsed.teammateId,
              color: parsed.color,
              summary: parsed.summary,
              content: parsed.content,
              timestamp: msgTimestamp,
              tokenCount: estimateTokens(parsed.content),
            },
          });
        }
        continue;
      }
      // Plain-text user message (subagent input prompt)
      if (rawText.trim()) {
        displayItems.push({
          type: 'subagent_input',
          content: rawText.trim(),
          timestamp: msgTimestamp,
          tokenCount: estimateTokens(rawText),
        });
      }
      continue;
    }

    if (msg.type === 'assistant' && Array.isArray(msg.content)) {
      // Process assistant message content blocks
      for (const block of msg.content) {
        if (block.type === 'thinking' && block.thinking) {
          // Add thinking block
          displayItems.push({
            type: 'thinking',
            content: block.thinking,
            timestamp: msgTimestamp,
            tokenCount: estimateTokens(block.thinking),
          });
        } else if (block.type === 'tool_use' && block.id && block.name) {
          // Collect tool call for later linking
          toolCallsById.set(block.id, {
            id: block.id,
            name: block.name,
            input: block.input ?? {},
            timestamp: msgTimestamp,
            sourceMessageId: msg.uuid,
            sourceModel: msg.model,
          });
        } else if (block.type === 'text' && block.text) {
          // Add text output
          displayItems.push({
            type: 'output',
            content: block.text,
            timestamp: msgTimestamp,
            tokenCount: estimateTokens(block.text),
          });
        }
      }
    } else if (msg.type === 'user' && (msg.isMeta || msg.toolResults.length > 0)) {
      // Process tool results from internal user messages
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            // Collect tool result for linking
            toolResultsById.set(block.tool_use_id, {
              content: block.content ?? '',
              isError: block.is_error ?? false,
              toolUseResult: msg.toolUseResult,
              timestamp: msgTimestamp,
            });
          }

          // Check for skill instructions: isMeta:true messages with sourceToolUseID
          // containing text starting with "Base directory for this skill:"
          if (block.type === 'text' && block.text && msg.sourceToolUseID) {
            const text = block.text;
            if (text.startsWith('Base directory for this skill:')) {
              skillInstructionsById.set(msg.sourceToolUseID, text);
            }
          }
        }
      }

      // Also check msg.toolResults array (pre-extracted results)
      for (const result of msg.toolResults) {
        if (!toolResultsById.has(result.toolUseId)) {
          toolResultsById.set(result.toolUseId, {
            content: result.content,
            isError: result.isError,
            toolUseResult: msg.toolUseResult,
            timestamp: msgTimestamp,
          });
        }
      }
    }
  }

  // Second pass: Build LinkedToolItems by matching calls with results
  for (const [toolId, call] of toolCallsById.entries()) {
    const result = toolResultsById.get(toolId);

    // Skip Task tool calls that have associated subagents
    // The subagent will be shown separately, so showing the Task call is redundant
    const isTaskWithSubagent = call.name === 'Task' && taskIdsWithSubagents.has(toolId);
    if (isTaskWithSubagent) {
      continue;
    }

    // Get skill instructions for Skill tool calls
    const skillInstructions = call.name === 'Skill' ? skillInstructionsById.get(toolId) : undefined;

    const linkedItem: LinkedToolItem = {
      id: toolId,
      name: call.name,
      input: call.input,
      result: result
        ? {
            content: result.content,
            isError: result.isError,
            toolUseResult: result.toolUseResult,
          }
        : undefined,
      inputPreview: formatToolInput(call.input),
      outputPreview: result ? formatToolResult(result.content) : undefined,
      startTime: call.timestamp,
      endTime: result?.timestamp,
      durationMs: result?.timestamp
        ? result.timestamp.getTime() - call.timestamp.getTime()
        : undefined,
      isOrphaned: !result,
      sourceModel: call.sourceModel,
      skillInstructions,
      skillInstructionsTokenCount: skillInstructions
        ? estimateTokens(skillInstructions)
        : undefined,
    };

    displayItems.push({
      type: 'tool',
      tool: linkedItem,
    });
  }

  // Add subagents as display items
  for (const subagent of subagents) {
    displayItems.push({
      type: 'subagent',
      subagent: subagent,
    });
  }

  // Add slashes as display items
  const slashes = extractSlashes(messages);
  for (const slash of slashes) {
    displayItems.push({
      type: 'slash',
      slash,
    });
  }

  // Sort all items chronologically
  sortDisplayItemsChronologically(displayItems);

  // Link TeammateMessages to their triggering SendMessage calls
  linkTeammateReplies(displayItems);

  return displayItems;
}
