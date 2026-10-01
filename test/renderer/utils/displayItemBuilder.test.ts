import { describe, expect, it } from 'vitest';
import { buildDisplayItemsFromMessages } from '../../../src/renderer/utils/displayItemBuilder';
import type { ParsedMessage } from '../../../src/main/types/messages';
import {
  ADVISOR_CALL_ID,
  ADVISOR_MODEL,
  ADVISOR_TEXT,
  advisorCallMessage,
  advisorResultMessage,
} from '../../mocks/advisorBlocks.fixture';

/**
 * Helper to create a minimal ParsedMessage for testing.
 */
function makeMessage(
  overrides: Partial<ParsedMessage> & Pick<ParsedMessage, 'type' | 'content'>
): ParsedMessage {
  return {
    uuid: `msg-${Math.random().toString(36).slice(2, 8)}`,
    parentUuid: null,
    timestamp: new Date('2025-01-01T00:00:00Z'),
    isMeta: false,
    isSidechain: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  } as ParsedMessage;
}

describe('buildDisplayItemsFromMessages', () => {
  describe('subagent tool results with isMeta=false', () => {
    it('should collect tool results from user messages without isMeta field', () => {
      // Simulates real subagent JSONL where user messages with tool_result
      // blocks have isMeta absent (defaults to false after parsing).
      const toolUseId = 'toolu_test123';

      const assistantMsg = makeMessage({
        uuid: 'assistant-1',
        type: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: toolUseId,
            name: 'Bash',
            input: { command: 'echo hello' },
          },
        ],
        timestamp: new Date('2025-01-01T00:00:00Z'),
      });

      // This is the key scenario: user message with tool_result but isMeta: false
      // (simulating subagent JSONL where isMeta field is absent)
      const toolResultMsg = makeMessage({
        uuid: 'user-result-1',
        type: 'user',
        isMeta: false,
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: 'hello\n',
            is_error: false,
          },
        ],
        toolResults: [
          {
            toolUseId: toolUseId,
            content: 'hello\n',
            isError: false,
          },
        ],
        timestamp: new Date('2025-01-01T00:00:01Z'),
      });

      const items = buildDisplayItemsFromMessages([assistantMsg, toolResultMsg], []);

      const toolItems = items.filter((item) => item.type === 'tool');
      expect(toolItems).toHaveLength(1);

      const tool = toolItems[0];
      if (tool.type !== 'tool') throw new Error('Expected tool item');

      // The critical assertion: result must be present, not orphaned
      expect(tool.tool.isOrphaned).toBe(false);
      expect(tool.tool.result).toBeDefined();
      expect(tool.tool.result?.content).toBe('hello\n');
      expect(tool.tool.name).toBe('Bash');
    });

    it('should still render subagent_input for plain text user messages without tool results', () => {
      const userMsg = makeMessage({
        uuid: 'user-input-1',
        type: 'user',
        isMeta: false,
        content: 'Please run the tests',
        toolResults: [],
        timestamp: new Date('2025-01-01T00:00:00Z'),
      });

      const items = buildDisplayItemsFromMessages([userMsg], []);

      const inputItems = items.filter((item) => item.type === 'subagent_input');
      expect(inputItems).toHaveLength(1);
      if (inputItems[0].type !== 'subagent_input') throw new Error('Expected subagent_input');
      expect(inputItems[0].content).toBe('Please run the tests');
    });
  });

  describe('advisor blocks (server_tool_use + advisor_tool_result)', () => {
    it('produces a tool display item for the advisor call+result pair', () => {
      const items = buildDisplayItemsFromMessages([advisorCallMessage, advisorResultMessage], []);

      const toolItems = items.filter((item) => item.type === 'tool');
      expect(toolItems).toHaveLength(1);

      const item = toolItems[0];
      if (item.type !== 'tool') throw new Error('Expected tool item');
      expect(item.tool.name).toBe('advisor');
      expect(item.tool.isOrphaned).toBe(false);
    });

    it('sets the result content from advisor_tool_result text', () => {
      const items = buildDisplayItemsFromMessages([advisorCallMessage, advisorResultMessage], []);
      const toolItem = items.find((i) => i.type === 'tool' && i.tool.name === 'advisor');
      if (toolItem?.type !== 'tool') throw new Error('Expected tool item');
      expect(toolItem.tool.result?.content).toBe(ADVISOR_TEXT);
    });

    it('carries sourceModel on the tool item', () => {
      const items = buildDisplayItemsFromMessages([advisorCallMessage, advisorResultMessage], []);
      const toolItem = items.find((i) => i.type === 'tool' && i.tool.name === 'advisor');
      if (toolItem?.type !== 'tool') throw new Error('Expected tool item');
      expect(toolItem.tool.sourceModel).toBe(ADVISOR_MODEL);
    });

    it('uses ADVISOR_CALL_ID as the tool id', () => {
      const items = buildDisplayItemsFromMessages([advisorCallMessage, advisorResultMessage], []);
      const toolItem = items.find((i) => i.type === 'tool' && i.tool.name === 'advisor');
      if (toolItem?.type !== 'tool') throw new Error('Expected tool item');
      expect(toolItem.tool.id).toBe(ADVISOR_CALL_ID);
    });
  });
});
