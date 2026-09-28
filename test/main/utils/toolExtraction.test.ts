/**
 * Tests for tool-call extraction (src/main/utils/toolExtraction.ts),
 * covering the Task → Agent tool rename in Claude Code 2.1.63.
 */
import { describe, expect, it } from 'vitest';

import { extractToolCalls } from '../../../src/main/utils/toolExtraction';
import type { ContentBlock } from '../../../src/main/types';

describe('extractToolCalls', () => {
  it('treats Agent-named blocks as subagent spawns (Task renamed in 2.1.63)', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'a1',
        name: 'Agent',
        input: { description: 'Explore X', prompt: 'go', subagent_type: 'Explore' },
      } as ContentBlock,
      {
        type: 'tool_use',
        id: 'a2',
        name: 'Task',
        input: { description: 'Legacy spawn' },
      } as ContentBlock,
    ];

    const calls = extractToolCalls(blocks);
    expect(calls).toHaveLength(2);
    expect(calls[0].isTask).toBe(true);
    expect(calls[0].taskDescription).toBe('Explore X');
    expect(calls[0].taskSubagentType).toBe('Explore');
    expect(calls[1].isTask).toBe(true);
    expect(calls[1].taskDescription).toBe('Legacy spawn');
  });

  it('keeps regular tools non-task', () => {
    const calls = extractToolCalls([
      { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } } as ContentBlock,
    ]);
    expect(calls[0].isTask).toBe(false);
    expect(calls[0].taskDescription).toBeUndefined();
  });
});
