import { describe, expect, it, vi } from 'vitest';

import {
  assembleToolContent,
  extractExportItems,
  type ToolExportFields,
} from '@renderer/utils/conversationExtractor';

import type {
  AIGroup,
  AIGroupDisplayItem,
  AIGroupLastOutput,
  ChatItem,
  CompactGroup,
  EnhancedAIGroup,
  LinkedToolItem,
  SessionConversation,
  UserGroup,
} from '@renderer/types/groups';

// =============================================================================
// Mocks
// =============================================================================

// Mock enhanceAIGroup to return a controlled EnhancedAIGroup. The extractor
// only consumes `displayItems` and `lastOutput` from the enhanced result, so
// the mock attaches them from a `__test` payload on the input AIGroup.
vi.mock('@renderer/utils/aiGroupEnhancer', () => ({
  enhanceAIGroup: (group: AIGroup): EnhancedAIGroup => {
    const test = (
      group as AIGroup & {
        __test?: { items: AIGroupDisplayItem[]; last: AIGroupLastOutput | null };
      }
    ).__test;
    return {
      ...group,
      lastOutput: test?.last ?? null,
      displayItems: test?.items ?? [],
      linkedTools: new Map(),
      itemsSummary: '',
      mainModel: null,
      subagentModels: [],
      claudeMdStats: null,
    };
  },
}));

// =============================================================================
// Fixtures
// =============================================================================

function makeUserGroup(text: string, id = 'u1'): UserGroup {
  return {
    id,
    timestamp: new Date('2025-01-01T00:00:00Z'),
    index: 0,
    message: {} as never,
    content: {
      text,
      rawText: text,
      commands: [],
      images: [],
      fileReferences: [],
    },
  };
}

function makeAIGroup(
  id: string,
  items: AIGroupDisplayItem[],
  last: AIGroupLastOutput | null
): AIGroup {
  return {
    id,
    turnIndex: 0,
    startTime: new Date('2025-01-01T00:00:01Z'),
    endTime: new Date('2025-01-01T00:00:02Z'),
    durationMs: 1000,
    steps: [],
    tokens: { input: 0, output: 0, cached: 0, total: 0 },
    summary: {
      toolCallCount: 0,
      outputMessageCount: 0,
      subagentCount: 0,
      totalDurationMs: 0,
      totalTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
    },
    status: 'complete',
    processes: [],
    chunkId: 'chunk-1',
    metrics: {} as never,
    responses: [],
    // Attached for the mocked enhancer to read back.
    ...({ __test: { items, last } } as object),
  } as AIGroup;
}

function makeCompactGroup(id = 'c1'): CompactGroup {
  return {
    id,
    timestamp: new Date('2025-01-01T00:00:05Z'),
    message: {} as never,
  };
}

function makeTool(overrides: Partial<LinkedToolItem> = {}): LinkedToolItem {
  return {
    id: 'tool-1',
    name: 'Read',
    input: { file_path: '/tmp/a.ts' },
    inputPreview: '',
    isOrphaned: false,
    startTime: new Date('2025-01-01T00:00:01Z'),
    ...overrides,
  };
}

function makeConversation(items: ChatItem[]): SessionConversation {
  return {
    sessionId: 'sess-1',
    items,
    totalUserGroups: 0,
    totalSystemGroups: 0,
    totalAIGroups: 0,
    totalCompactGroups: 0,
  };
}

// =============================================================================
// assembleToolContent
// =============================================================================

describe('assembleToolContent', () => {
  const fields: ToolExportFields = {
    name: 'Bash',
    summary: 'list files',
    input: 'ls -la',
    output: 'a.ts\nb.ts',
  };

  it('returns name + summary header when both enabled', () => {
    expect(assembleToolContent(fields, new Set(['name', 'summary']))).toBe(
      '**Tool: Bash** — list files'
    );
  });

  it('returns name-only header when only name enabled', () => {
    expect(assembleToolContent(fields, new Set(['name']))).toBe('**Tool: Bash**');
  });

  it('returns italic summary when only summary enabled', () => {
    expect(assembleToolContent(fields, new Set(['summary']))).toBe('*list files*');
  });

  it('emits input block when input enabled', () => {
    const result = assembleToolContent(fields, new Set(['input']));
    expect(result).toBe('*Input:*\n```\nls -la\n```');
  });

  it('emits output block when output enabled', () => {
    const result = assembleToolContent(fields, new Set(['output']));
    expect(result).toBe('*Output:*\n```\na.ts\nb.ts\n```');
  });

  it('joins enabled sections with blank lines', () => {
    const result = assembleToolContent(fields, new Set(['name', 'summary', 'input', 'output']));
    expect(result).toBe(
      '**Tool: Bash** — list files\n\n*Input:*\n```\nls -la\n```\n\n*Output:*\n```\na.ts\nb.ts\n```'
    );
  });

  it('returns empty string when nothing enabled', () => {
    expect(assembleToolContent(fields, new Set())).toBe('');
  });

  it('skips summary section when summary is empty even if enabled', () => {
    const noSummary = { ...fields, summary: '' };
    expect(assembleToolContent(noSummary, new Set(['name', 'summary']))).toBe('**Tool: Bash**');
    expect(assembleToolContent(noSummary, new Set(['summary']))).toBe('');
  });

  it('skips input section when input is empty', () => {
    const noInput = { ...fields, input: '' };
    expect(assembleToolContent(noInput, new Set(['name', 'input']))).toBe('**Tool: Bash**');
  });

  it('skips output section when output is empty', () => {
    const noOutput = { ...fields, output: '' };
    expect(assembleToolContent(noOutput, new Set(['output']))).toBe('');
  });

  it('does not truncate long input or output', () => {
    const big = 'x'.repeat(5000);
    const bigFields: ToolExportFields = {
      name: 'Bash',
      summary: '',
      input: big,
      output: big,
    };
    const result = assembleToolContent(bigFields, new Set(['input', 'output']));
    expect(result).toContain(big);
    // 5000 + 5000 = 10000 chars of payload, plus markdown fencing.
    expect(result.length).toBeGreaterThan(10000);
  });
});

// =============================================================================
// extractExportItems
// =============================================================================

describe('extractExportItems', () => {
  describe('user groups', () => {
    it('emits one item per user message with markdown header', () => {
      const conv = makeConversation([{ type: 'user', group: makeUserGroup('Hi Claude') }]);
      const items = extractExportItems(conv);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'user-u1',
        type: 'user',
        turnIndex: 1,
        content: '## You\n\nHi Claude',
        selected: true,
      });
    });

    it('truncates long user text in the label but keeps full content', () => {
      const long = 'a'.repeat(200);
      const conv = makeConversation([{ type: 'user', group: makeUserGroup(long) }]);
      const items = extractExportItems(conv);

      expect(items[0].label.length).toBeLessThanOrEqual(81); // 80 + ellipsis
      expect(items[0].label.endsWith('…')).toBe(true);
      expect(items[0].content).toContain(long);
    });

    it('skips user groups whose text is empty or whitespace', () => {
      const conv = makeConversation([
        { type: 'user', group: makeUserGroup('   ', 'u-empty') },
        { type: 'user', group: makeUserGroup('real', 'u-real') },
      ]);
      const items = extractExportItems(conv);

      expect(items.map((i) => i.id)).toEqual(['user-u-real']);
    });

    it('falls back to rawText when content.text is missing', () => {
      const group: UserGroup = {
        ...makeUserGroup(''),
        content: {
          text: undefined,
          rawText: '/model opus',
          commands: [],
          images: [],
          fileReferences: [],
        },
      };
      const items = extractExportItems(makeConversation([{ type: 'user', group }]));
      expect(items[0].content).toContain('/model opus');
    });

    it('increments turnIndex for each non-empty user message', () => {
      const conv = makeConversation([
        { type: 'user', group: makeUserGroup('first', 'u1') },
        { type: 'user', group: makeUserGroup('second', 'u2') },
        { type: 'user', group: makeUserGroup('third', 'u3') },
      ]);
      const items = extractExportItems(conv);
      expect(items.map((i) => i.turnIndex)).toEqual([1, 2, 3]);
    });
  });

  describe('AI display items', () => {
    it('emits thinking items with markdown blockquote and unselected by default', () => {
      const ai = makeAIGroup(
        'a1',
        [{ type: 'thinking', content: 'pondering', timestamp: new Date() }],
        null
      );
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'ai-a1-0',
        type: 'thinking',
        selected: false,
      });
      expect(items[0].content).toContain('> *Thinking:*');
      expect(items[0].content).toContain('pondering');
    });

    it('prefixes multiline thinking with > on every line', () => {
      const ai = makeAIGroup(
        'a1',
        [{ type: 'thinking', content: 'line1\nline2', timestamp: new Date() }],
        null
      );
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));
      expect(items[0].content).toBe('> *Thinking:*\n> line1\n> line2');
    });

    it('emits intermediate output items with Claude header', () => {
      const ai = makeAIGroup(
        'a1',
        [{ type: 'output', content: 'partial answer', timestamp: new Date() }],
        null
      );
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items[0]).toMatchObject({
        id: 'ai-a1-0',
        type: 'ai-text',
        selected: true,
      });
      expect(items[0].content).toBe('## Claude\n\npartial answer');
    });

    it('emits tool items with full toolFields and default name+summary+output content', () => {
      const tool = makeTool({
        id: 't-1',
        name: 'Bash',
        input: { command: 'ls' },
        result: { content: 'a.ts\nb.ts', isError: false },
      });
      const ai = makeAIGroup('a1', [{ type: 'tool', tool }], null);
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items).toHaveLength(1);
      expect(items[0].type).toBe('tool');
      expect(items[0].toolFields).toEqual({
        name: 'Bash',
        summary: expect.any(String),
        input: 'ls',
        output: 'a.ts\nb.ts',
      });
      // Default content excludes the input section
      expect(items[0].content).toContain('**Tool: Bash**');
      expect(items[0].content).toContain('*Output:*');
      expect(items[0].content).not.toContain('*Input:*');
    });

    it('formats Bash input as raw command, JSON for everything else', () => {
      const bash = makeTool({ id: 'b', name: 'Bash', input: { command: 'echo hi' } });
      const read = makeTool({ id: 'r', name: 'Read', input: { file_path: '/x.ts' } });
      const ai = makeAIGroup(
        'a1',
        [
          { type: 'tool', tool: bash },
          { type: 'tool', tool: read },
        ],
        null
      );
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items[0].toolFields?.input).toBe('echo hi');
      expect(items[1].toolFields?.input).toBe(JSON.stringify({ file_path: '/x.ts' }, null, 2));
    });

    it('preserves full tool output without truncation', () => {
      const big = 'x'.repeat(5000);
      const tool = makeTool({ result: { content: big, isError: false } });
      const ai = makeAIGroup('a1', [{ type: 'tool', tool }], null);
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items[0].toolFields?.output).toBe(big);
    });

    it('prefixes error output with "Error: "', () => {
      const tool = makeTool({ result: { content: 'permission denied', isError: true } });
      const ai = makeAIGroup('a1', [{ type: 'tool', tool }], null);
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items[0].toolFields?.output).toBe('Error: permission denied');
    });

    it('marks orphaned tools as "No result received"', () => {
      const tool = makeTool({ isOrphaned: true, result: undefined });
      const ai = makeAIGroup('a1', [{ type: 'tool', tool }], null);
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items[0].toolFields?.output).toBe('No result received');
    });

    it('stringifies non-string tool output content as JSON', () => {
      const tool = makeTool({
        result: { content: [{ type: 'text', text: 'a' }], isError: false },
      });
      const ai = makeAIGroup('a1', [{ type: 'tool', tool }], null);
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items[0].toolFields?.output).toBe(
        JSON.stringify([{ type: 'text', text: 'a' }], null, 2)
      );
    });

    it('skips subagent, slash, teammate_message, subagent_input, and compact_boundary items', () => {
      const ai = makeAIGroup(
        'a1',
        [
          { type: 'subagent', subagent: { id: 'p1' } as never },
          { type: 'slash', slash: { name: 'model' } as never },
          { type: 'teammate_message', teammateMessage: { id: 'tm1' } as never },
          { type: 'subagent_input', content: 'in', timestamp: new Date() },
          {
            type: 'compact_boundary',
            content: 'c',
            timestamp: new Date(),
            phaseNumber: 1,
          },
        ],
        null
      );
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));
      expect(items).toHaveLength(0);
    });

    it('uses an extractable-only counter so IDs stay stable across non-extractable items', () => {
      // Sequence: thinking, slash (skipped), output, subagent (skipped), tool
      // Expected counter: 0, _, 1, _, 2
      const ai = makeAIGroup(
        'a1',
        [
          { type: 'thinking', content: 't', timestamp: new Date() },
          { type: 'slash', slash: { name: 'model' } as never },
          { type: 'output', content: 'o', timestamp: new Date() },
          { type: 'subagent', subagent: { id: 'p1' } as never },
          { type: 'tool', tool: makeTool() },
        ],
        null
      );
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));
      expect(items.map((i) => i.id)).toEqual(['ai-a1-0', 'ai-a1-1', 'ai-a1-2']);
    });
  });

  describe('AI last output', () => {
    it('emits a text last output as ai-text with the ai-last- prefix', () => {
      const ai = makeAIGroup('a1', [], {
        type: 'text',
        text: 'final answer',
        timestamp: new Date(),
      });
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items).toEqual([
        expect.objectContaining({
          id: 'ai-last-a1',
          type: 'ai-text',
          content: '## Claude\n\nfinal answer',
          selected: true,
        }),
      ]);
    });

    it('emits a tool_result last output as tool with toolFields and synthetic summary', () => {
      const ai = makeAIGroup('a1', [], {
        type: 'tool_result',
        toolName: 'Bash',
        toolResult: 'done',
        isError: false,
        timestamp: new Date(),
      });
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items[0]).toMatchObject({
        id: 'ai-last-a1',
        type: 'tool',
        toolFields: { name: 'Bash', summary: 'final result', input: '', output: 'done' },
      });
    });

    it('prefixes tool_result error output with "Error: "', () => {
      const ai = makeAIGroup('a1', [], {
        type: 'tool_result',
        toolName: 'Bash',
        toolResult: 'oops',
        isError: true,
        timestamp: new Date(),
      });
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));
      expect(items[0].toolFields?.output).toBe('Error: oops');
    });

    it('falls back to "Tool" when toolName is missing on a tool_result last output', () => {
      const ai = makeAIGroup('a1', [], {
        type: 'tool_result',
        toolResult: 'done',
        timestamp: new Date(),
      });
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));
      expect(items[0].toolFields?.name).toBe('Tool');
    });

    it('emits a plan_exit last output as ai-text with "Plan ready" label', () => {
      const ai = makeAIGroup('a1', [], {
        type: 'plan_exit',
        planContent: '1. step one',
        timestamp: new Date(),
      });
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));

      expect(items[0]).toMatchObject({
        id: 'ai-last-a1',
        type: 'ai-text',
        label: 'Claude — Plan ready for approval',
      });
      expect(items[0].content).toContain('## Claude (Plan)');
      expect(items[0].content).toContain('1. step one');
    });

    it('emits an interruption last output as a single blockquote line', () => {
      const ai = makeAIGroup('a1', [], { type: 'interruption', timestamp: new Date() });
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));
      expect(items[0].content).toBe('> *Request interrupted by user*');
    });

    it('skips ongoing last output entirely', () => {
      const ai = makeAIGroup('a1', [], { type: 'ongoing', timestamp: new Date() });
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));
      expect(items).toHaveLength(0);
    });

    it('skips a text last output when text is empty', () => {
      const ai = makeAIGroup('a1', [], { type: 'text', text: '', timestamp: new Date() });
      const items = extractExportItems(makeConversation([{ type: 'ai', group: ai }]));
      expect(items).toHaveLength(0);
    });
  });

  describe('compact groups', () => {
    it('emits a compact item with the divider content', () => {
      const conv = makeConversation([{ type: 'compact', group: makeCompactGroup('c1') }]);
      const items = extractExportItems(conv);

      expect(items).toEqual([
        expect.objectContaining({
          id: 'compact-c1',
          type: 'compact',
          selected: true,
        }),
      ]);
      expect(items[0].content).toContain('Context was compacted');
    });
  });

  describe('system groups', () => {
    it('skips system items entirely', () => {
      const conv = makeConversation([
        {
          type: 'system',
          group: {
            id: 's1',
            timestamp: new Date(),
            commandOutput: 'set model',
            message: {} as never,
          },
        },
      ]);
      expect(extractExportItems(conv)).toEqual([]);
    });
  });

  describe('end-to-end ordering and turn association', () => {
    it('associates AI items with the turnIndex of the preceding user message', () => {
      const ai1 = makeAIGroup(
        'a1',
        [{ type: 'output', content: 'first reply', timestamp: new Date() }],
        null
      );
      const ai2 = makeAIGroup(
        'a2',
        [{ type: 'output', content: 'second reply', timestamp: new Date() }],
        null
      );
      const conv = makeConversation([
        { type: 'user', group: makeUserGroup('first', 'u1') },
        { type: 'ai', group: ai1 },
        { type: 'user', group: makeUserGroup('second', 'u2') },
        { type: 'ai', group: ai2 },
      ]);
      const items = extractExportItems(conv);

      const byId = new Map(items.map((i) => [i.id, i]));
      expect(byId.get('user-u1')?.turnIndex).toBe(1);
      expect(byId.get('ai-a1-0')?.turnIndex).toBe(1);
      expect(byId.get('user-u2')?.turnIndex).toBe(2);
      expect(byId.get('ai-a2-0')?.turnIndex).toBe(2);
    });

    it('preserves the chronological order of chat items', () => {
      const ai = makeAIGroup(
        'a1',
        [
          { type: 'thinking', content: 't', timestamp: new Date() },
          { type: 'tool', tool: makeTool() },
        ],
        { type: 'text', text: 'done', timestamp: new Date() }
      );
      const conv = makeConversation([
        { type: 'user', group: makeUserGroup('hi', 'u1') },
        { type: 'ai', group: ai },
        { type: 'compact', group: makeCompactGroup('c1') },
      ]);
      const items = extractExportItems(conv);

      expect(items.map((i) => i.id)).toEqual([
        'user-u1',
        'ai-a1-0', // thinking
        'ai-a1-1', // tool
        'ai-last-a1', // text last output
        'compact-c1',
      ]);
    });

    it('returns an empty array for an empty conversation', () => {
      expect(extractExportItems(makeConversation([]))).toEqual([]);
    });
  });
});
