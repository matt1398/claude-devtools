/**
 * Tool extraction utilities for parsing tool calls and results from JSONL content blocks.
 */

import { isSubagentDispatchTool } from '@shared/constants';

import type { ContentBlock, ToolCall, ToolResult } from '../types';

/**
 * Extract tool calls from content blocks.
 */
export function extractToolCalls(content: ContentBlock[] | string): ToolCall[] {
  if (typeof content === 'string') {
    return [];
  }

  const toolCalls: ToolCall[] = [];

  for (const block of content) {
    if (block.type === 'tool_use' && block.id && block.name) {
      const input = block.input ?? {};
      const isTask = isSubagentDispatchTool(block.name);

      const toolCall: ToolCall = {
        id: block.id,
        name: block.name,
        input,
        isTask,
      };

      // Extract Task-specific info
      if (isTask) {
        toolCall.taskDescription = input.description as string | undefined;
        toolCall.taskSubagentType = input.subagent_type as string | undefined;
      }

      toolCalls.push(toolCall);
    }
  }

  return toolCalls;
}

/**
 * Extract tool results from content blocks.
 */
export function extractToolResults(content: ContentBlock[] | string): ToolResult[] {
  if (typeof content === 'string') {
    return [];
  }

  const toolResults: ToolResult[] = [];

  for (const block of content) {
    if (block.type === 'tool_result' && block.tool_use_id) {
      toolResults.push({
        toolUseId: block.tool_use_id,
        content: block.content ?? '',
        isError: block.is_error ?? false,
      });
    }
  }

  return toolResults;
}
