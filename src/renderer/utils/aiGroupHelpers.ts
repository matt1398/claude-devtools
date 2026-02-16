/**
 * AI Group Helpers - Utility functions for AI Group enhancement
 *
 * Small, focused utility functions used across the AI Group enhancement modules.
 */

import { createLogger } from '@shared/utils/logger';
import { estimateTokens } from '@shared/utils/tokenFormatting';

import type { ParsedMessage, PhaseTokenBreakdown, Process } from '../types/data';
import type { LinkedToolItem } from '../types/groups';

const logger = createLogger('Util:aiGroupHelpers');

// Re-export for backwards compatibility
export { estimateTokens };

/**
 * Safely converts a timestamp to a Date object.
 * Handles both Date objects and ISO string timestamps (from IPC serialization).
 */
export function toDate(timestamp: Date | string | number): Date {
  if (timestamp instanceof Date) {
    return timestamp;
  }
  return new Date(timestamp);
}

/**
 * Truncates text to a maximum length and adds ellipsis if needed.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Converts tool input object to a preview string.
 */
export function formatToolInput(input: Record<string, unknown>): string {
  try {
    const json = JSON.stringify(input, null, 2);
    return truncateText(json, 100);
  } catch (error) {
    logger.debug('formatToolInput failed:', error);
    return '[Invalid JSON]';
  }
}

/**
 * Converts tool result content to a preview string.
 */
export function formatToolResult(content: string | unknown[]): string {
  try {
    if (typeof content === 'string') {
      return truncateText(content, 200);
    }
    const json = JSON.stringify(content, null, 2);
    return truncateText(json, 200);
  } catch (error) {
    logger.debug('formatToolResult failed:', error);
    return '[Invalid content]';
  }
}

/**
 * Attaches main session impact tokens to subagents.
 * For each subagent with a parentTaskId, finds the matching Task tool
 * and extracts the callTokens and resultTokens that affect the main session.
 *
 * This allows SubagentItem to display both:
 * - Main session impact: tokens consumed by the Task tool_call + tool_result in the parent session
 * - Subagent isolated context: the subagent's internal token usage
 *
 * @param subagents - Array of subagents to enhance
 * @param linkedTools - Map of tool IDs to LinkedToolItem (includes Task tools)
 * @returns The same subagents array with mainSessionImpact populated
 */
export function attachMainSessionImpact(
  subagents: Process[],
  linkedTools: Map<string, LinkedToolItem>
): Process[] {
  for (const subagent of subagents) {
    if (subagent.parentTaskId) {
      const taskTool = linkedTools.get(subagent.parentTaskId);
      if (taskTool) {
        const callTokens = taskTool.callTokens ?? 0;
        const resultTokens = taskTool.result?.tokenCount ?? 0;
        subagent.mainSessionImpact = {
          callTokens,
          resultTokens,
          totalTokens: callTokens + resultTokens,
        };
      }
    }
  }
  return subagents;
}

/**
 * Computes multi-phase context breakdown for a subagent session.
 * Mirrors the algorithm in src/main/utils/jsonl.ts:500-576.
 *
 * Tracks assistant input tokens across compaction events to compute
 * per-phase contribution and total consumption across all phases.
 *
 * @param messages - Subagent's ParsedMessages
 * @returns Phase breakdown with total consumption, or null if no usage data
 */
export function computeSubagentPhaseBreakdown(messages: ParsedMessage[]): {
  phases: PhaseTokenBreakdown[];
  totalConsumption: number;
  compactionCount: number;
} | null {
  let lastMainAssistantInputTokens = 0;
  let awaitingPostCompaction = false;
  const compactionPhases: { pre: number; post: number }[] = [];

  for (const msg of messages) {
    // Track assistant input tokens.
    // Unlike jsonl.ts, we don't filter by isSidechain here because subagent messages
    // all have isSidechain=true (from the parent session's perspective).
    if (msg.type === 'assistant' && msg.model !== '<synthetic>') {
      const inputTokens =
        (msg.usage?.input_tokens ?? 0) +
        (msg.usage?.cache_read_input_tokens ?? 0) +
        (msg.usage?.cache_creation_input_tokens ?? 0);
      if (inputTokens > 0) {
        if (awaitingPostCompaction && compactionPhases.length > 0) {
          compactionPhases[compactionPhases.length - 1].post = inputTokens;
          awaitingPostCompaction = false;
        }
        lastMainAssistantInputTokens = inputTokens;
      }
    }

    // Detect compaction events
    if (msg.isCompactSummary) {
      compactionPhases.push({ pre: lastMainAssistantInputTokens, post: 0 });
      awaitingPostCompaction = true;
    }
  }

  if (lastMainAssistantInputTokens <= 0) {
    return null;
  }

  let phaseBreakdown: PhaseTokenBreakdown[];

  if (compactionPhases.length === 0) {
    // No compaction: single phase
    phaseBreakdown = [
      {
        phaseNumber: 1,
        contribution: lastMainAssistantInputTokens,
        peakTokens: lastMainAssistantInputTokens,
      },
    ];
    return {
      phases: phaseBreakdown,
      totalConsumption: lastMainAssistantInputTokens,
      compactionCount: 0,
    };
  }

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
  const lastPhase = compactionPhases[compactionPhases.length - 1];
  const lastContribution = lastMainAssistantInputTokens - lastPhase.post;
  total += lastContribution;
  phaseBreakdown.push({
    phaseNumber: compactionPhases.length + 1,
    contribution: lastContribution,
    peakTokens: lastMainAssistantInputTokens,
  });

  return {
    phases: phaseBreakdown,
    totalConsumption: total,
    compactionCount: compactionPhases.length,
  };
}
