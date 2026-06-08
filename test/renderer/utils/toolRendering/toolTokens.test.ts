import { describe, expect, it } from 'vitest';
import type { LinkedToolItem } from '../../../../src/renderer/types/groups';
import { getToolContextTokens } from '../../../../src/renderer/utils/toolRendering/toolTokens';
import { ADVISOR_CALL_ID, ADVISOR_TEXT } from '../../../mocks/advisorBlocks.fixture';

const makeAdvisorItem = (resultTokens: number): LinkedToolItem =>
  ({
    id: ADVISOR_CALL_ID,
    name: 'advisor',
    input: {},
    callTokens: undefined,
    result: { content: ADVISOR_TEXT, isError: false, tokenCount: resultTokens },
    isOrphaned: false,
  }) as LinkedToolItem;

describe('getToolContextTokens', () => {
  it('counts the advisor result tokens instead of short-circuiting to zero', () => {
    const advisor = makeAdvisorItem(100);
    const total = getToolContextTokens(advisor);
    expect(total).not.toBe(0);
    expect(total).toBeGreaterThanOrEqual(100);
  });
});
