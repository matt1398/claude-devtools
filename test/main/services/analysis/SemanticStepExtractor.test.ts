import { describe, expect, it } from 'vitest';
import { extractSemanticStepsFromAIChunk } from '../../../../src/main/services/analysis/SemanticStepExtractor';
import type { AIChunk } from '../../../../src/main/types/chunks';
import type { ParsedMessage } from '../../../../src/main/types/messages';
import {
  ADVISOR_CALL_ID,
  ADVISOR_MODEL,
  ADVISOR_TEXT,
  advisorCallMessage,
  advisorResultMessage,
} from '../../../mocks/advisorBlocks.fixture';

function makeChunk(responses: ParsedMessage[]): AIChunk {
  return {
    chunkType: 'ai',
    id: 'chunk-1',
    startTime: new Date('2026-06-06T10:00:00Z'),
    responses,
    processes: [],
    sidechainMessages: [],
    toolExecutions: [],
    userMessage: null as unknown as ParsedMessage,
  } as unknown as AIChunk;
}

describe('SemanticStepExtractor — advisor blocks', () => {
  it('extracts a tool_call step from server_tool_use(advisor)', () => {
    const chunk = makeChunk([advisorCallMessage]);
    const steps = extractSemanticStepsFromAIChunk(chunk);

    const callStep = steps.find((s) => s.type === 'tool_call' && s.content.toolName === 'advisor');
    expect(callStep).toBeDefined();
    expect(callStep!.id).toBe(ADVISOR_CALL_ID);
    expect(callStep!.content.toolInput).toEqual({});
    expect(callStep!.content.sourceModel).toBe(ADVISOR_MODEL);
  });

  it('does NOT add tokens to the advisor tool_call step', () => {
    const chunk = makeChunk([advisorCallMessage]);
    const steps = extractSemanticStepsFromAIChunk(chunk);

    const callStep = steps.find((s) => s.type === 'tool_call' && s.content.toolName === 'advisor');
    expect(callStep).toBeDefined();
    expect(callStep!.tokens).toBeUndefined();
    expect(callStep!.content.tokenCount).toBeUndefined();
  });

  it('extracts a tool_result step from advisor_tool_result', () => {
    const chunk = makeChunk([advisorResultMessage]);
    const steps = extractSemanticStepsFromAIChunk(chunk);

    const resultStep = steps.find((s) => s.type === 'tool_result' && s.id === ADVISOR_CALL_ID);
    expect(resultStep).toBeDefined();
    expect(resultStep!.content.toolResultContent).toBe(ADVISOR_TEXT);
    expect(resultStep!.content.isError).toBe(false);
  });

  it('counts the advisor result tokens from the advice text', () => {
    const chunk = makeChunk([advisorResultMessage]);
    const steps = extractSemanticStepsFromAIChunk(chunk);

    const resultStep = steps.find((s) => s.type === 'tool_result' && s.id === ADVISOR_CALL_ID);
    expect(resultStep).toBeDefined();
    // 40 = countContentTokens(ADVISOR_TEXT) — literal guards against tautological re-import
    expect(resultStep!.content.tokenCount).toBe(40);
    expect(resultStep!.content.tokenCount).toBeGreaterThan(0);
  });
});
