/**
 * Tests for SubagentDisplayMetaBuilder.
 *
 * Verifies that pre-computed subagent display metadata correctly mirrors
 * what the renderer used to derive on-the-fly from `subagent.messages`.
 * Coverage:
 *   - Empty input
 *   - Single-message subagents
 *   - Multi-turn subagents (turnCount, lastUsage)
 *   - Tool-use id collection (both call and result ids)
 *   - Model extraction (skips <synthetic>)
 *   - isShutdownOnly detection
 *   - Phase breakdown (no compaction, single, multi)
 */

import { describe, expect, it } from 'vitest';

import { computeSubagentDisplayMeta } from '../../../../src/main/services/analysis/SubagentDisplayMetaBuilder';
import type { ParsedMessage, ToolCall, ToolResult } from '../../../../src/main/types';

function makeMsg(overrides: Partial<ParsedMessage>): ParsedMessage {
  return {
    uuid: `m-${Math.random().toString(36).slice(2, 9)}`,
    parentUuid: null,
    type: 'user',
    timestamp: new Date(),
    content: '',
    isSidechain: true,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

function makeAssistant(overrides: Partial<ParsedMessage>): ParsedMessage {
  return makeMsg({
    type: 'assistant',
    model: 'claude-opus-4',
    ...overrides,
  });
}

function makeToolCall(id: string, name: string, input?: Record<string, unknown>): ToolCall {
  return {
    id,
    name,
    input: input ?? {},
    isTask: false,
  };
}

function makeToolResult(toolUseId: string): ToolResult {
  return {
    toolUseId,
    content: 'ok',
    isError: false,
  };
}

describe('computeSubagentDisplayMeta', () => {
  it('returns zeros for empty message list', () => {
    const meta = computeSubagentDisplayMeta([]);
    expect(meta.toolCount).toBe(0);
    expect(meta.modelName).toBe(null);
    expect(meta.lastUsage).toBe(null);
    expect(meta.turnCount).toBe(0);
    expect(meta.isShutdownOnly).toBe(false);
    expect(meta.phaseBreakdown).toBeUndefined();
    expect(meta.toolUseIds).toEqual([]);
  });

  it('extracts model from the first non-synthetic assistant message', () => {
    const messages = [
      makeAssistant({ model: '<synthetic>' }),
      makeAssistant({ model: 'claude-opus-4' }),
      makeAssistant({ model: 'claude-sonnet-4' }),
    ];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.modelName).toBe('claude-opus-4');
  });

  it('counts assistant turns with usage and captures the last usage', () => {
    const messages = [
      makeAssistant({ usage: { input_tokens: 100, output_tokens: 50 } }),
      makeAssistant({}), // no usage — not counted
      makeAssistant({ usage: { input_tokens: 200, output_tokens: 75 } }),
    ];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.turnCount).toBe(2);
    expect(meta.lastUsage).toEqual({ input_tokens: 200, output_tokens: 75 });
  });

  it('counts assistant messages with at least one tool_use as toolCount', () => {
    const messages = [
      makeAssistant({ toolCalls: [makeToolCall('t1', 'Read')] }),
      makeAssistant({ toolCalls: [makeToolCall('t2', 'Bash'), makeToolCall('t3', 'Edit')] }),
      makeAssistant({}), // no tools
    ];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.toolCount).toBe(2);
  });

  it('collects every tool_use id and tool_result tool_use_id', () => {
    const messages = [
      makeAssistant({ toolCalls: [makeToolCall('use-1', 'Read'), makeToolCall('use-2', 'Bash')] }),
      makeMsg({
        type: 'user',
        toolResults: [makeToolResult('use-1'), makeToolResult('use-2'), makeToolResult('use-3')],
      }),
    ];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.toolUseIds).toContain('use-1');
    expect(meta.toolUseIds).toContain('use-2');
    expect(meta.toolUseIds).toContain('use-3');
    // Deduplicated.
    expect(new Set(meta.toolUseIds).size).toBe(meta.toolUseIds.length);
  });

  it('detects isShutdownOnly when single assistant turn is SendMessage shutdown_response', () => {
    const messages = [
      makeAssistant({
        toolCalls: [makeToolCall('t1', 'SendMessage', { type: 'shutdown_response', approve: true })],
      }),
    ];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.isShutdownOnly).toBe(true);
  });

  it('does not flag shutdown_only when there are extra assistant turns', () => {
    const messages = [
      makeAssistant({
        toolCalls: [makeToolCall('t1', 'SendMessage', { type: 'shutdown_response' })],
      }),
      makeAssistant({ toolCalls: [makeToolCall('t2', 'Read')] }),
    ];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.isShutdownOnly).toBe(false);
  });

  it('does not flag shutdown_only for non-SendMessage single tool', () => {
    const messages = [makeAssistant({ toolCalls: [makeToolCall('t1', 'Read')] })];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.isShutdownOnly).toBe(false);
  });

  it('returns null phaseBreakdown when there is no usage data', () => {
    const messages = [makeAssistant({})];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.phaseBreakdown).toBeUndefined();
  });

  it('returns single-phase breakdown when there is no compaction', () => {
    const messages = [
      makeAssistant({ usage: { input_tokens: 1000, output_tokens: 50 } }),
      makeAssistant({
        usage: {
          input_tokens: 1500,
          output_tokens: 100,
          cache_read_input_tokens: 200,
        },
      }),
    ];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.phaseBreakdown).toBeDefined();
    expect(meta.phaseBreakdown!.compactionCount).toBe(0);
    expect(meta.phaseBreakdown!.phases).toHaveLength(1);
    // Last assistant input contribution = 1500 + 200 = 1700
    expect(meta.phaseBreakdown!.phases[0].peakTokens).toBe(1700);
    expect(meta.phaseBreakdown!.totalConsumption).toBe(1700);
  });

  it('produces multi-phase breakdown across compaction events', () => {
    const messages = [
      makeAssistant({ usage: { input_tokens: 1000, output_tokens: 50 } }),
      makeMsg({ type: 'system', isCompactSummary: true }),
      makeAssistant({ usage: { input_tokens: 200, output_tokens: 25 } }),
      makeAssistant({ usage: { input_tokens: 800, output_tokens: 100 } }),
    ];
    const meta = computeSubagentDisplayMeta(messages);
    expect(meta.phaseBreakdown).toBeDefined();
    expect(meta.phaseBreakdown!.compactionCount).toBe(1);
    expect(meta.phaseBreakdown!.phases).toHaveLength(2);
    // Phase 1 was 1000 (pre), post = 200, phase 2 last = 800
    // total = 1000 + (800 - 200) = 1600
    expect(meta.phaseBreakdown!.totalConsumption).toBe(1600);
  });
});
