import { describe, expect, it } from 'vitest';

import { processSessionContextWithPhases } from '../../../src/renderer/utils/contextTracker';

import type { AIGroup, ChatItem } from '../../../src/renderer/types/groups';
import type { ParsedMessage } from '../../../src/renderer/types/data';

describe('processSessionContextWithPhases hook context', () => {
  it('includes hook additionalContext in the turn context injections and token totals', () => {
    const reminderMessage: ParsedMessage = {
      uuid: 'hook-reminder',
      parentUuid: 'assistant-1',
      type: 'user',
      timestamp: new Date('2026-01-01T00:00:01Z'),
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'done',
        },
        {
          type: 'text',
          text: '<system-reminder>PostToolUse:Bash hook additional context: Run the focused checks before the next tool call.</system-reminder>',
        },
      ],
      isSidechain: false,
      isMeta: true,
      toolCalls: [],
      toolResults: [],
    };
    const aiGroup = {
      id: 'ai-0',
      turnIndex: 0,
      startTime: new Date('2026-01-01T00:00:00Z'),
      endTime: new Date('2026-01-01T00:00:02Z'),
      durationMs: 2000,
      steps: [],
      tokens: {},
      summary: {},
      status: 'complete',
      processes: [],
      chunkId: 'chunk-0',
      metrics: {},
      responses: [reminderMessage],
    } as AIGroup;
    const items: ChatItem[] = [{ type: 'ai', group: aiGroup }];

    const { statsMap } = processSessionContextWithPhases(items, '/project');
    const stats = statsMap.get('ai-0');
    const hookInjection = stats?.newInjections.find((item) => item.category === 'hook-context');

    expect(hookInjection).toMatchObject({
      category: 'hook-context',
      turnIndex: 0,
      breakdown: [
        {
          label: 'PostToolUse:Bash',
          text: 'Run the focused checks before the next tool call.',
        },
      ],
    });
    expect(stats?.tokensByCategory.hookContext).toBeGreaterThan(0);
    expect(stats?.accumulatedCounts.hookContext).toBe(1);
  });
});
