/**
 * SubagentDisplayMetaBuilder - Pre-compute display data for a subagent.
 *
 * Walks a subagent's parsed messages once and extracts the small set of
 * fields the renderer needs to render the collapsed SubagentItem header
 * (model, last usage, turn count, tool count, shutdown-only flag, phase
 * breakdown, tool-use ids). The result is attached to `Process.displayMeta`,
 * letting the worker drop `Process.messages` from its IPC response.
 *
 * Pure logic — no Node, DOM, or React. Safe to run inside a worker.
 */

import {
  type ParsedMessage,
  type PhaseTokenBreakdown,
  type SubagentDisplayMeta,
  type TokenUsage,
} from '@main/types';

/**
 * Compute the full display metadata bundle for a subagent.
 *
 * @param messages - The subagent's parsed JSONL messages, in chronological order.
 * @returns A populated SubagentDisplayMeta. Always returns a value (zeros for
 *          empty input) so callers don't have to null-check.
 */
export function computeSubagentDisplayMeta(messages: ParsedMessage[]): SubagentDisplayMeta {
  let toolCount = 0;
  let modelName: string | null = null;
  let lastUsage: TokenUsage | null = null;
  let turnCount = 0;
  const toolUseIds: string[] = [];
  const seenToolUseIds = new Set<string>();

  // For shutdown-only detection: collect assistant messages and tool calls.
  // Cheap (we'd already iterate anyway), reuses the same loop.
  let assistantCount = 0;
  let onlyAssistantSendMessageShutdown = false;
  let firstAssistantSingleSendMessage = true;

  for (const msg of messages) {
    if (msg.type === 'assistant') {
      assistantCount++;

      // Model: first non-synthetic model encountered.
      if (!modelName && msg.model && msg.model !== '<synthetic>') {
        modelName = msg.model;
      }

      // Turn count + last usage: assistant messages with usage data.
      if (msg.usage) {
        turnCount++;
        lastUsage = msg.usage;
      }

      // Walk tool calls: count tool-using assistant turns and harvest ids.
      const toolCalls = msg.toolCalls ?? [];
      let hasToolUse = false;
      for (const tc of toolCalls) {
        hasToolUse = true;
        if (tc.id && !seenToolUseIds.has(tc.id)) {
          seenToolUseIds.add(tc.id);
          toolUseIds.push(tc.id);
        }
      }
      if (hasToolUse) {
        toolCount++;
      }

      // Shutdown-only check: a team activation is "shutdown only" when the
      // subagent has exactly one assistant message that contains exactly one
      // tool_use, and that tool_use is SendMessage(shutdown_response).
      if (firstAssistantSingleSendMessage) {
        if (assistantCount === 1 && toolCalls.length === 1) {
          const only = toolCalls[0];
          const input = (only.input ?? {});
          if (only.name === 'SendMessage' && input.type === 'shutdown_response') {
            onlyAssistantSendMessageShutdown = true;
          } else {
            firstAssistantSingleSendMessage = false;
          }
        } else {
          firstAssistantSingleSendMessage = false;
        }
      }
    }

    // Tool results contribute their tool_use_id to the highlight-id index.
    for (const tr of msg.toolResults ?? []) {
      if (tr.toolUseId && !seenToolUseIds.has(tr.toolUseId)) {
        seenToolUseIds.add(tr.toolUseId);
        toolUseIds.push(tr.toolUseId);
      }
    }
  }

  // isShutdownOnly is true only if we both saw exactly one assistant msg
  // matching the pattern AND no other assistant messages overrode the flag.
  const isShutdownOnly =
    assistantCount === 1 && onlyAssistantSendMessageShutdown && firstAssistantSingleSendMessage;

  const phaseBreakdown = computePhaseBreakdown(messages);

  return {
    toolCount,
    modelName,
    lastUsage,
    turnCount,
    isShutdownOnly,
    phaseBreakdown: phaseBreakdown ?? undefined,
    toolUseIds,
  };
}

/**
 * Multi-phase context breakdown for a subagent with compaction events.
 *
 * Mirrors the algorithm in src/renderer/utils/aiGroupHelpers.ts so the
 * collapsed SubagentItem can render its phase pills without re-iterating
 * the (now-empty) messages array. Returns null when there is no usage data.
 *
 * Note: subagent messages all have `isSidechain=true` from the parent
 * session's perspective, so unlike main-session phase tracking we do not
 * filter by sidechain here.
 */
function computePhaseBreakdown(messages: ParsedMessage[]): {
  phases: PhaseTokenBreakdown[];
  totalConsumption: number;
  compactionCount: number;
} | null {
  let lastMainAssistantInputTokens = 0;
  let awaitingPostCompaction = false;
  const compactionPhases: { pre: number; post: number }[] = [];

  for (const msg of messages) {
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

    if (msg.isCompactSummary) {
      compactionPhases.push({ pre: lastMainAssistantInputTokens, post: 0 });
      awaitingPostCompaction = true;
    }
  }

  if (lastMainAssistantInputTokens <= 0) {
    return null;
  }

  if (compactionPhases.length === 0) {
    return {
      phases: [
        {
          phaseNumber: 1,
          contribution: lastMainAssistantInputTokens,
          peakTokens: lastMainAssistantInputTokens,
        },
      ],
      totalConsumption: lastMainAssistantInputTokens,
      compactionCount: 0,
    };
  }

  const phases: PhaseTokenBreakdown[] = [];
  let total = 0;

  // Phase 1: tokens up to the first compaction.
  const phase1Contribution = compactionPhases[0].pre;
  total += phase1Contribution;
  phases.push({
    phaseNumber: 1,
    contribution: phase1Contribution,
    peakTokens: compactionPhases[0].pre,
    postCompaction: compactionPhases[0].post,
  });

  // Middle phases: contribution = pre[i] - post[i-1].
  for (let i = 1; i < compactionPhases.length; i++) {
    const contribution = compactionPhases[i].pre - compactionPhases[i - 1].post;
    total += contribution;
    phases.push({
      phaseNumber: i + 1,
      contribution,
      peakTokens: compactionPhases[i].pre,
      postCompaction: compactionPhases[i].post,
    });
  }

  // Final phase: residual tokens after the last compaction.
  const lastPhase = compactionPhases[compactionPhases.length - 1];
  const lastContribution = lastMainAssistantInputTokens - lastPhase.post;
  total += lastContribution;
  phases.push({
    phaseNumber: compactionPhases.length + 1,
    contribution: lastContribution,
    peakTokens: lastMainAssistantInputTokens,
  });

  return {
    phases,
    totalConsumption: total,
    compactionCount: compactionPhases.length,
  };
}
