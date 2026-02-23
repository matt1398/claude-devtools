import { describe, expect, it } from 'vitest';

import {
  extractSearchableEntries,
  extractUserText,
} from '../../../../src/main/services/discovery/SearchTextExtractor';

import type { ParsedMessage } from '../../../../src/main/types';

function makeUserMessage(
  uuid: string,
  content: string,
  timestamp = '2026-01-01T00:00:00.000Z'
): ParsedMessage {
  return {
    uuid,
    type: 'user',
    role: 'user',
    content,
    timestamp: new Date(timestamp),
    isMeta: false,
    isSidechain: false,
  } as ParsedMessage;
}

function makeAssistantMessage(
  uuid: string,
  textContent: string,
  timestamp = '2026-01-01T00:00:01.000Z'
): ParsedMessage {
  return {
    uuid,
    type: 'assistant',
    role: 'assistant',
    content: [{ type: 'text', text: textContent }],
    timestamp: new Date(timestamp),
    isMeta: false,
    isSidechain: false,
  } as ParsedMessage;
}

function makeAssistantWithThinking(
  uuid: string,
  thinking: string,
  textContent: string,
  timestamp = '2026-01-01T00:00:01.000Z'
): ParsedMessage {
  return {
    uuid,
    type: 'assistant',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking },
      { type: 'text', text: textContent },
    ],
    timestamp: new Date(timestamp),
    isMeta: false,
    isSidechain: false,
  } as ParsedMessage;
}

function makeToolResultMessage(
  uuid: string,
  timestamp = '2026-01-01T00:00:01.500Z'
): ParsedMessage {
  return {
    uuid,
    type: 'user',
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'result text' }],
    timestamp: new Date(timestamp),
    isMeta: true,
    isSidechain: false,
  } as ParsedMessage;
}

describe('SearchTextExtractor', () => {
  describe('extractSearchableEntries', () => {
    it('produces user-{uuid} groupIds for user messages', () => {
      const messages = [makeUserMessage('u1', 'hello world')];
      const result = extractSearchableEntries(messages);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].groupId).toBe('user-u1');
      expect(result.entries[0].itemType).toBe('user');
      expect(result.entries[0].messageType).toBe('user');
      expect(result.entries[0].text).toBe('hello world');
    });

    it('produces ai-{uuid} groupIds for AI groups (using first buffer message uuid)', () => {
      const messages = [
        makeUserMessage('u1', 'question'),
        makeToolResultMessage('tr1', '2026-01-01T00:00:01.000Z'),
        makeAssistantMessage('a1', 'thinking...', '2026-01-01T00:00:02.000Z'),
        makeAssistantMessage('a2', 'final answer', '2026-01-01T00:00:03.000Z'),
      ];
      const result = extractSearchableEntries(messages);

      const aiEntries = result.entries.filter((e) => e.itemType === 'ai');
      expect(aiEntries).toHaveLength(1);
      // groupId uses the first message in the AI buffer
      expect(aiEntries[0].groupId).toMatch(/^ai-/);
      // Text is from the last assistant message with text
      expect(aiEntries[0].text).toBe('final answer');
    });

    it('extracts last AI text output correctly (backward scan)', () => {
      const messages = [
        makeUserMessage('u1', 'question'),
        makeAssistantMessage('a1', 'older output', '2026-01-01T00:00:01.000Z'),
        makeAssistantMessage('a2', 'latest output', '2026-01-01T00:00:02.000Z'),
      ];
      const result = extractSearchableEntries(messages);

      const aiEntries = result.entries.filter((e) => e.itemType === 'ai');
      expect(aiEntries).toHaveLength(1);
      expect(aiEntries[0].text).toBe('latest output');
    });

    it('handles assistant messages with thinking + text blocks', () => {
      const messages = [
        makeUserMessage('u1', 'question'),
        makeAssistantWithThinking('a1', 'internal reasoning', 'visible answer'),
      ];
      const result = extractSearchableEntries(messages);

      const aiEntries = result.entries.filter((e) => e.itemType === 'ai');
      expect(aiEntries).toHaveLength(1);
      expect(aiEntries[0].text).toBe('visible answer');
    });

    it('skips sidechain messages', () => {
      const sidechain: ParsedMessage = {
        ...makeUserMessage('u-side', 'sidechain text'),
        isSidechain: true,
      } as ParsedMessage;
      const messages = [sidechain, makeUserMessage('u1', 'main thread')];
      const result = extractSearchableEntries(messages);

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].text).toBe('main thread');
    });

    it('extracts sessionTitle from first user message (truncated to 100 chars)', () => {
      const longText = 'a'.repeat(200);
      const messages = [
        makeUserMessage('u1', longText),
        makeUserMessage('u2', 'second message'),
      ];
      const result = extractSearchableEntries(messages);

      expect(result.sessionTitle).toBe('a'.repeat(100));
    });

    it('handles empty messages array', () => {
      const result = extractSearchableEntries([]);
      expect(result.entries).toHaveLength(0);
      expect(result.sessionTitle).toBeUndefined();
    });

    it('handles messages with no user messages', () => {
      const messages = [
        makeAssistantMessage('a1', 'just AI talking'),
      ];
      const result = extractSearchableEntries(messages);

      expect(result.sessionTitle).toBeUndefined();
      const aiEntries = result.entries.filter((e) => e.itemType === 'ai');
      expect(aiEntries).toHaveLength(1);
    });

    it('handles AI buffer with no text content', () => {
      const noTextAssistant: ParsedMessage = {
        uuid: 'a1',
        type: 'assistant',
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'just thinking' }],
        timestamp: new Date('2026-01-01T00:00:01.000Z'),
        isMeta: false,
        isSidechain: false,
      } as ParsedMessage;
      const messages = [makeUserMessage('u1', 'question'), noTextAssistant];
      const result = extractSearchableEntries(messages);

      const aiEntries = result.entries.filter((e) => e.itemType === 'ai');
      expect(aiEntries).toHaveLength(0);
    });

    it('flushes AI buffer on user messages', () => {
      const messages = [
        makeUserMessage('u1', 'first question'),
        makeAssistantMessage('a1', 'first answer', '2026-01-01T00:00:01.000Z'),
        makeUserMessage('u2', 'second question', '2026-01-01T00:00:02.000Z'),
        makeAssistantMessage('a2', 'second answer', '2026-01-01T00:00:03.000Z'),
      ];
      const result = extractSearchableEntries(messages);

      expect(result.entries).toHaveLength(4);
      const userEntries = result.entries.filter((e) => e.itemType === 'user');
      const aiEntries = result.entries.filter((e) => e.itemType === 'ai');
      expect(userEntries).toHaveLength(2);
      expect(aiEntries).toHaveLength(2);
      expect(aiEntries[0].text).toBe('first answer');
      expect(aiEntries[1].text).toBe('second answer');
    });
  });

  describe('extractUserText', () => {
    it('extracts string content', () => {
      const msg = makeUserMessage('u1', 'hello world');
      expect(extractUserText(msg)).toBe('hello world');
    });

    it('extracts array content with text blocks', () => {
      const msg: ParsedMessage = {
        uuid: 'u1',
        type: 'user',
        role: 'user',
        content: [
          { type: 'text', text: 'part one' },
          { type: 'text', text: ' part two' },
        ],
        timestamp: new Date(),
        isMeta: false,
        isSidechain: false,
      } as ParsedMessage;
      expect(extractUserText(msg)).toBe('part one part two');
    });
  });
});
