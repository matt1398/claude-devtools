/**
 * SemanticStepExtractor - Extracts semantic steps from AI chunks.
 *
 * Semantic steps represent logical units of work within AI responses:
 * - thinking: Claude's reasoning process
 * - tool_call: Tool invocation
 * - tool_result: Tool execution result
 * - output: Text output from Claude
 * - subagent: Nested agent execution
 * - interruption: User interruption
 */

import { countContentTokens } from '@main/utils/tokenizer';

import type { AIChunk, EnhancedAIChunk, SemanticStep } from '@main/types';

/**
 * Extract semantic steps from AI chunk responses.
 * Semantic steps represent logical units of work within responses.
 *
 * Note: ALL tool calls are included, including Task tools with subagents.
 * Task tools are filtered in the renderer's buildDisplayItems,
 * but they are kept here for accurate context token tracking in aggregateToolOutputs.
 */
export function extractSemanticStepsFromAIChunk(chunk: AIChunk | EnhancedAIChunk): SemanticStep[] {
  const steps: SemanticStep[] = [];
  let stepIdCounter = 0;

  // Note: Task tool calls are included in semantic steps for context token tracking.
  // The renderer's buildDisplayItems filters Task tools with subagents.

  // Process only AI responses (no user message in AIChunk)
  for (const msg of chunk.responses) {
    if (msg.type === 'assistant') {
      // Extract from content blocks
      const content = Array.isArray(msg.content) ? msg.content : [];

      for (const block of content) {
        if (block.type === 'thinking' && block.thinking) {
          // Calculate tokens for thinking content (output from Claude)
          const thinkingTokens = countContentTokens(block.thinking);

          steps.push({
            id: `${msg.uuid}-thinking-${stepIdCounter++}`,
            type: 'thinking',
            startTime: new Date(msg.timestamp),
            durationMs: 0, // Estimated from token count
            content: {
              thinkingText: block.thinking,
              tokenCount: thinkingTokens, // Pre-computed token count
            },
            tokens: {
              input: 0,
              output: thinkingTokens, // Thinking is output from Claude
            },
            context: msg.agentId ? 'subagent' : 'main',
            agentId: msg.agentId,
            sourceMessageId: msg.uuid,
          });
        }

        if (block.type === 'tool_use' && block.id && block.name) {
          // Include ALL tool calls in semantic steps, including Task tools with processes.
          // Task tools with processes are filtered from DISPLAY in the renderer's buildDisplayItems,
          // but they should be included here for accurate context token tracking.
          // The renderer's aggregateToolOutputs will correctly count Task tool tokens
          // as part of the main session's context consumption.

          // Calculate tool call tokens directly from name + input
          // This reflects what actually enters the context window
          const callTokens = countContentTokens(block.name + JSON.stringify(block.input));

          steps.push({
            id: block.id,
            type: 'tool_call',
            startTime: new Date(msg.timestamp),
            durationMs: 0,
            content: {
              toolName: block.name,
              toolInput: block.input,
              sourceModel: msg.model,
            },
            tokens: {
              input: callTokens,
              output: 0,
            },
            context: msg.agentId ? 'subagent' : 'main',
            agentId: msg.agentId,
            sourceMessageId: msg.uuid,
          });
        }

        if (block.type === 'server_tool_use' && block.name === 'advisor' && block.id) {
          // advisor CALL — input is empty so callTokens stay undefined (fallback estimates ~0)
          steps.push({
            id: block.id,
            type: 'tool_call',
            startTime: new Date(msg.timestamp),
            durationMs: 0,
            content: {
              toolName: 'advisor',
              toolInput: {},
              sourceModel: msg.advisorModel,
            },
            context: msg.agentId ? 'subagent' : 'main',
            agentId: msg.agentId,
            sourceMessageId: msg.uuid,
          });
        }

        if (block.type === 'advisor_tool_result' && block.tool_use_id) {
          // advisor RESULT — advice text is real consumed context, counted like any tool result
          const advisorText = block.content?.text ?? '';
          steps.push({
            id: block.tool_use_id,
            type: 'tool_result',
            startTime: new Date(msg.timestamp),
            durationMs: 0,
            content: {
              toolResultContent: advisorText,
              isError: false,
              tokenCount: advisorText ? countContentTokens(advisorText) : 0,
            },
            context: msg.agentId ? 'subagent' : 'main',
            agentId: msg.agentId,
          });
        }

        if (block.type === 'text' && block.text) {
          // Calculate tokens for text output (Claude's generated text)
          const textTokens = countContentTokens(block.text);

          steps.push({
            id: `${msg.uuid}-output-${stepIdCounter++}`,
            type: 'output',
            startTime: new Date(msg.timestamp),
            durationMs: 0,
            content: {
              outputText: block.text,
              tokenCount: textTokens, // Pre-computed token count for consistency
            },
            tokens: {
              input: 0, // Text output is generated by Claude, not input
              output: textTokens,
            },
            context: msg.agentId ? 'subagent' : 'main',
            agentId: msg.agentId,
            sourceMessageId: msg.uuid,
          });
        }
      }
    }

    // Tool results from internal user messages
    // Note: isMeta can be true or null in JSONL, so check for toolResults presence directly
    if (msg.type === 'user' && msg.toolResults && msg.toolResults.length > 0) {
      for (const result of msg.toolResults) {
        steps.push({
          id: result.toolUseId,
          type: 'tool_result',
          startTime: new Date(msg.timestamp),
          durationMs: 0,
          content: {
            toolResultContent:
              typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
            isError: result.isError,
            toolUseResult: msg.toolUseResult, // Enriched data from message
            tokenCount: countContentTokens(result.content), // Pre-computed token count
          },
          context: msg.agentId ? 'subagent' : 'main',
          agentId: msg.agentId,
        });
      }
    }

    // User interruption messages
    // These are user messages with array content containing text like "[Request interrupted by user]"
    if (msg.type === 'user' && Array.isArray(msg.content)) {
      let foundInterruption = false;
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          const textContent = block.text;
          // Check for interruption patterns
          if (
            textContent.includes('[Request interrupted by user]') ||
            textContent.includes('[Request interrupted by user for tool use]')
          ) {
            steps.push({
              id: `${msg.uuid}-interruption-${stepIdCounter++}`,
              type: 'interruption',
              startTime: new Date(msg.timestamp),
              durationMs: 0,
              content: {
                interruptionText: textContent,
              },
              context: msg.agentId ? 'subagent' : 'main',
              agentId: msg.agentId,
            });
            foundInterruption = true;
          }
        }
      }

      // User-rejected tool use (toolUseResult field is "User rejected tool use")
      if (!foundInterruption && (msg.toolUseResult as unknown) === 'User rejected tool use') {
        steps.push({
          id: `${msg.uuid}-interruption-${stepIdCounter++}`,
          type: 'interruption',
          startTime: new Date(msg.timestamp),
          durationMs: 0,
          content: {
            interruptionText: 'Request interrupted by user',
          },
          context: msg.agentId ? 'subagent' : 'main',
          agentId: msg.agentId,
        });
      }
    }
  }

  // Link processes as steps
  for (const process of chunk.processes) {
    steps.push({
      id: process.id,
      type: 'subagent',
      startTime: process.startTime,
      endTime: process.endTime,
      durationMs: process.durationMs,
      content: {
        subagentId: process.id,
        subagentDescription: process.description,
      },
      tokens: {
        input: process.metrics.inputTokens,
        output: process.metrics.outputTokens,
        cached: process.metrics.cacheReadTokens,
      },
      isParallel: process.isParallel,
      context: 'subagent',
      agentId: process.id,
    });
  }

  // Sort by startTime
  return steps.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}
