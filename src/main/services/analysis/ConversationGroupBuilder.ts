/**
 * ConversationGroupBuilder - Alternative grouping strategy for conversation flow.
 *
 * Groups one user message with all AI responses until the next user message.
 * This is a cleaner alternative to buildChunks() that:
 * - Uses simpler time-based grouping
 * - Separates Task executions from regular tool executions
 * - Links subagents more explicitly via TaskExecution
 */

import {
  type ConversationGroup,
  isParsedUserChunkMessage,
  type ParsedMessage,
  type Process,
  type TaskExecution,
  type ToolCall,
  type ToolExecution,
} from '@main/types';
import { calculateMetrics } from '@main/utils/jsonl';
import { isSubagentDispatchTool } from '@shared/constants';

/**
 * Build conversation groups using simplified grouping strategy.
 * Groups one user message with all AI responses until the next user message.
 */
export function buildGroups(messages: ParsedMessage[], subagents: Process[]): ConversationGroup[] {
  const groups: ConversationGroup[] = [];

  // Step 1: Filter to main thread only (not sidechain)
  const mainMessages = messages.filter((m) => !m.isSidechain);

  // Step 2: Find all REAL user messages (these start groups)
  // Use isParsedUserChunkMessage to filter out noise
  const userMessages = mainMessages.filter(isParsedUserChunkMessage);

  // Step 3: For each user message, collect all AI responses until next user message
  for (let i = 0; i < userMessages.length; i++) {
    const userMsg = userMessages[i];
    const nextUserMsg = userMessages[i + 1];

    // Collect all messages between this user message and the next
    const aiResponses = collectAIResponses(mainMessages, userMsg, nextUserMsg);

    // Separate Task tool results from regular tool executions
    const { taskExecutions, regularToolExecutions } = separateTaskExecutions(
      aiResponses,
      subagents
    );

    // Link subagents to this group
    const groupSubagents = linkSubagentsToGroup(userMsg, nextUserMsg, subagents);

    // Calculate metrics
    const { startTime, endTime, durationMs } = calculateGroupTiming(userMsg, aiResponses);
    const metrics = calculateMetrics([userMsg, ...aiResponses]);

    groups.push({
      id: `group-${i + 1}`,
      type: 'user-ai-exchange',
      userMessage: userMsg,
      aiResponses,
      processes: groupSubagents,
      toolExecutions: regularToolExecutions,
      taskExecutions,
      startTime,
      endTime,
      durationMs,
      metrics,
    });
  }

  return groups;
}

/**
 * Collect AI responses between a user message and the next user message.
 * Simpler than collectResponses - just uses timestamp boundaries.
 */
function collectAIResponses(
  messages: ParsedMessage[],
  userMsg: ParsedMessage,
  nextUserMsg: ParsedMessage | undefined
): ParsedMessage[] {
  const responses: ParsedMessage[] = [];
  const startTime = userMsg.timestamp;
  const endTime = nextUserMsg?.timestamp;

  for (const msg of messages) {
    // Skip if before this user message
    if (msg.timestamp <= startTime) continue;

    // Skip if at or after next user message
    if (endTime && msg.timestamp >= endTime) continue;

    // Include ALL non-user messages (assistant + internal user messages)
    if (msg.type === 'assistant' || (msg.type === 'user' && msg.isMeta === true)) {
      responses.push(msg);
    }
  }

  return responses;
}

/**
 * Separate Task executions from regular tool executions.
 * Task tools spawn subagents, so we track them separately to avoid duplication.
 */
function separateTaskExecutions(
  responses: ParsedMessage[],
  allSubagents: Process[]
): { taskExecutions: TaskExecution[]; regularToolExecutions: ToolExecution[] } {
  const taskExecutions: TaskExecution[] = [];
  const regularToolExecutions: ToolExecution[] = [];

  // Build map of tool_use_id -> subagent for Task calls
  const taskIdToSubagent = new Map<string, Process>();
  for (const subagent of allSubagents) {
    if (subagent.parentTaskId) {
      taskIdToSubagent.set(subagent.parentTaskId, subagent);
    }
  }

  // Collect all tool calls
  const toolCalls = new Map<string, { call: ToolCall; timestamp: Date }>();
  for (const msg of responses) {
    if (msg.type === 'assistant') {
      for (const toolCall of msg.toolCalls) {
        toolCalls.set(toolCall.id, { call: toolCall, timestamp: msg.timestamp });
      }
    }
  }

  // Match with results
  for (const msg of responses) {
    if (msg.type === 'user' && msg.isMeta === true && msg.sourceToolUseID) {
      const callInfo = toolCalls.get(msg.sourceToolUseID);
      if (!callInfo) continue;

      // Check if this is a Task call with a subagent
      const subagent = taskIdToSubagent.get(msg.sourceToolUseID);
      if (isSubagentDispatchTool(callInfo.call.name) && subagent) {
        // This is a Task execution
        taskExecutions.push({
          taskCall: callInfo.call,
          taskCallTimestamp: callInfo.timestamp,
          subagent,
          toolResult: msg,
          resultTimestamp: msg.timestamp,
          durationMs: msg.timestamp.getTime() - callInfo.timestamp.getTime(),
        });
      } else {
        // Regular tool execution
        const result = msg.toolResults[0];
        if (result) {
          regularToolExecutions.push({
            toolCall: callInfo.call,
            result,
            startTime: callInfo.timestamp,
            endTime: msg.timestamp,
            durationMs: msg.timestamp.getTime() - callInfo.timestamp.getTime(),
          });
        }
      }
    }
  }

  return { taskExecutions, regularToolExecutions };
}

/**
 * Link subagents to a conversation group based on timing.
 */
function linkSubagentsToGroup(
  userMsg: ParsedMessage,
  nextUserMsg: ParsedMessage | undefined,
  allSubagents: Process[]
): Process[] {
  const groupSubagents: Process[] = [];
  const startTime = userMsg.timestamp;
  const endTime = nextUserMsg?.timestamp ?? new Date(Date.now() + 1000 * 60 * 60 * 24); // Far future if no next message

  // Collect subagents that start within this group's time range
  for (const subagent of allSubagents) {
    if (subagent.startTime >= startTime && subagent.startTime < endTime) {
      groupSubagents.push(subagent);
    }
  }

  return groupSubagents;
}

/**
 * Calculate group timing from user message and AI responses.
 */
function calculateGroupTiming(
  userMsg: ParsedMessage,
  aiResponses: ParsedMessage[]
): { startTime: Date; endTime: Date; durationMs: number } {
  const startTime = userMsg.timestamp;

  let endTime = startTime;
  for (const resp of aiResponses) {
    if (resp.timestamp > endTime) {
      endTime = resp.timestamp;
    }
  }

  return {
    startTime,
    endTime,
    durationMs: endTime.getTime() - startTime.getTime(),
  };
}
