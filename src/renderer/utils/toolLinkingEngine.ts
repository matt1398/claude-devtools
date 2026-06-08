/**
 * Tool Linking Engine - Link tool calls to their results
 *
 * Matches tool_call steps with their corresponding tool_result steps
 * and builds LinkedToolItem structures for display.
 */

import { estimateTokens, formatToolInput, formatToolResult, toDate } from './aiGroupHelpers';

import type { ParsedMessage, SemanticStep } from '../types/data';
import type { LinkedToolItem } from '../types/groups';

/**
 * Link tool calls to their results and build a map of LinkedToolItems.
 *
 * Strategy:
 * 1. Iterate through steps to find all tool_call steps
 * 2. For each tool call, search for matching tool_result by ID
 *    - Tool result step IDs are set to the tool_use_id, matching the call's ID
 * 3. Build LinkedToolItem with preview text
 * 4. Include orphaned calls (calls without results)
 * 5. For Skill tool calls, extract skill instructions from responses
 *
 * @param steps - Semantic steps from the AI Group
 * @param responses - Optional raw messages for extracting skill instructions
 * @returns Map of tool call ID to LinkedToolItem
 */
export function linkToolCallsToResults(
  steps: SemanticStep[],
  responses?: ParsedMessage[]
): Map<string, LinkedToolItem> {
  const linkedTools = new Map<string, LinkedToolItem>();

  // First pass: collect all tool calls
  const toolCalls = steps.filter((step) => step.type === 'tool_call');

  // Build a map of result steps by their ID for fast lookup
  const resultStepsById = new Map<string, SemanticStep>();
  for (const step of steps) {
    if (step.type === 'tool_result') {
      resultStepsById.set(step.id, step);
    }
  }

  // Build a map of skill instructions by source tool use ID
  // Skill tools have follow-up isMeta:true messages with instructions starting with "Base directory for this skill:"
  const skillInstructionsById = new Map<string, string>();

  if (responses) {
    for (const msg of responses) {
      // Extract skill instructions
      if (msg.type === 'user' && msg.isMeta && msg.sourceToolUseID && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            const text = block.text;
            if (text.startsWith('Base directory for this skill:')) {
              skillInstructionsById.set(msg.sourceToolUseID, text);
            }
          }
        }
      }
    }
  }

  for (const callStep of toolCalls) {
    const toolCallId = callStep.id;
    const toolName = callStep.content.toolName ?? 'Unknown';
    const toolInput = callStep.content.toolInput ?? {};

    // Search for matching tool result by ID
    // Tool result steps have their ID set to the tool_use_id (same as call ID)
    const resultStep = resultStepsById.get(toolCallId);

    // Convert timestamps to proper Date objects (handles IPC serialization)
    const callStartTime = toDate(callStep.startTime);
    const resultStartTime = resultStep ? toDate(resultStep.startTime) : undefined;

    // Get skill instructions for Skill tool calls
    const skillInstructions =
      toolName === 'Skill' ? skillInstructionsById.get(toolCallId) : undefined;

    // Calculate callTokens directly from tool name + input
    // This reflects what actually enters the context window (not proportioned output_tokens)
    // advisor input is empty ({}), so callTokens stays undefined and the fallback estimates ~0
    const callTokens =
      toolName === 'advisor' ? undefined : estimateTokens(toolName + JSON.stringify(toolInput));

    const linkedItem: LinkedToolItem = {
      id: toolCallId,
      name: toolName,
      input: toolInput as Record<string, unknown>,
      callTokens,
      sourceModel: callStep.content.sourceModel, // carried from the call step (advisor model)
      result: resultStep
        ? {
            content: resultStep.content.toolResultContent ?? '',
            isError: resultStep.content.isError ?? false,
            toolUseResult: resultStep.content.toolUseResult,
            tokenCount: resultStep.content.tokenCount, // Pre-computed token count for result
          }
        : undefined,
      inputPreview: formatToolInput(toolInput as Record<string, unknown>),
      outputPreview: resultStep
        ? formatToolResult(resultStep.content.toolResultContent ?? '')
        : undefined,
      startTime: callStartTime,
      endTime: resultStartTime,
      durationMs: resultStartTime ? resultStartTime.getTime() - callStartTime.getTime() : undefined,
      isOrphaned: !resultStep,
      skillInstructions,
      skillInstructionsTokenCount: skillInstructions
        ? estimateTokens(skillInstructions)
        : undefined,
    };

    linkedTools.set(toolCallId, linkedItem);
  }

  return linkedTools;
}
