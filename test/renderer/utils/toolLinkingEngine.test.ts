import { describe, expect, it } from 'vitest';
import { linkToolCallsToResults } from '../../../src/renderer/utils/toolLinkingEngine';
import type { SemanticStep } from '../../../src/renderer/types/data';
import { ADVISOR_CALL_ID, ADVISOR_MODEL, ADVISOR_TEXT } from '../../mocks/advisorBlocks.fixture';

function makeAdvisorCallStep(): SemanticStep {
  return {
    id: ADVISOR_CALL_ID,
    type: 'tool_call',
    startTime: new Date('2026-06-06T10:00:00Z'),
    durationMs: 0,
    content: {
      toolName: 'advisor',
      toolInput: {},
      sourceModel: ADVISOR_MODEL,
    },
    context: 'main',
  };
}

function makeAdvisorResultStep(): SemanticStep {
  return {
    id: ADVISOR_CALL_ID,
    type: 'tool_result',
    startTime: new Date('2026-06-06T10:00:11Z'),
    durationMs: 0,
    content: {
      toolResultContent: ADVISOR_TEXT,
      isError: false,
    },
    context: 'main',
  };
}

describe('linkToolCallsToResults — advisor', () => {
  it('carries sourceModel from the call step', () => {
    const steps = [makeAdvisorCallStep(), makeAdvisorResultStep()];
    const linked = linkToolCallsToResults(steps);

    const item = linked.get(ADVISOR_CALL_ID);
    expect(item).toBeDefined();
    expect(item!.sourceModel).toBe(ADVISOR_MODEL);
  });

  it('does NOT synthesize callTokens for advisor', () => {
    const steps = [makeAdvisorCallStep(), makeAdvisorResultStep()];
    const linked = linkToolCallsToResults(steps);

    const item = linked.get(ADVISOR_CALL_ID);
    expect(item).toBeDefined();
    expect(item!.callTokens).toBeUndefined();
  });

  it('links call to result correctly', () => {
    const steps = [makeAdvisorCallStep(), makeAdvisorResultStep()];
    const linked = linkToolCallsToResults(steps);

    const item = linked.get(ADVISOR_CALL_ID);
    expect(item).toBeDefined();
    expect(item!.name).toBe('advisor');
    expect(item!.result?.content).toBe(ADVISOR_TEXT);
    expect(item!.isOrphaned).toBe(false);
  });

  it('counts advisor in the linked tool map (part of tool total)', () => {
    const normalCallStep: SemanticStep = {
      id: 'toolu_normal',
      type: 'tool_call',
      startTime: new Date('2026-06-06T10:00:00Z'),
      durationMs: 0,
      content: { toolName: 'Bash', toolInput: { command: 'ls' } },
      context: 'main',
    };
    const steps = [makeAdvisorCallStep(), makeAdvisorResultStep(), normalCallStep];
    const linked = linkToolCallsToResults(steps);

    // Both advisor and the normal tool should be in the map
    expect(linked.size).toBe(2);
    expect(linked.has(ADVISOR_CALL_ID)).toBe(true);
    expect(linked.has('toolu_normal')).toBe(true);
  });
});
