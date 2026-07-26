/**
 * Tests for MessageClassifier service.
 *
 * Tests the 5-category message classification:
 * - user: Real user input (creates UserChunk)
 * - system: Command output (creates SystemChunk)
 * - compact: Summary messages from conversation compaction
 * - hardNoise: Filtered out (system metadata, caveats, reminders)
 * - ai: All other messages (creates AIChunk)
 */

import { describe, expect, it } from 'vitest';

import { classifyMessages } from '../../../../src/main/services/parsing/MessageClassifier';
import type { ParsedMessage } from '../../../../src/main/types';

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Creates a minimal ParsedMessage for testing.
 */
function createMessage(overrides: Partial<ParsedMessage>): ParsedMessage {
  return {
    uuid: 'test-uuid',
    parentUuid: null,
    type: 'user',
    timestamp: new Date(),
    content: '',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('MessageClassifier', () => {
  describe('classifyMessages', () => {
    it('should return empty array for empty input', () => {
      const result = classifyMessages([]);
      expect(result).toEqual([]);
    });

    it('should classify all messages', () => {
      const messages = [
        createMessage({ type: 'user', content: 'Hello', isMeta: false }),
        createMessage({ type: 'assistant', content: 'Hi there!' }),
      ];
      const result = classifyMessages(messages);
      expect(result).toHaveLength(2);
      expect(result[0].message).toBe(messages[0]);
      expect(result[1].message).toBe(messages[1]);
    });
  });

  describe('user category', () => {
    it('should classify real user message with string content', () => {
      const message = createMessage({
        type: 'user',
        content: 'Help me debug this code',
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('user');
    });

    it('should classify real user message with array content (text block)', () => {
      const message = createMessage({
        type: 'user',
        content: [{ type: 'text', text: 'Help me debug this code' }],
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('user');
    });

    it('should classify user message with image as user', () => {
      const message = createMessage({
        type: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('user');
    });

    it('should classify slash command as user input', () => {
      const message = createMessage({
        type: 'user',
        content: '<command-name>/model</command-name> Switch to sonnet',
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('user');
    });
  });

  describe('notification category', () => {
    const notificationContent =
      '<task-notification>\n<task-id>abc123</task-id>\n<status>completed</status>\n' +
      '<summary>Agent "PROJ-123 plan review round 1" finished</summary>\n</task-notification>';

    it('should classify a <task-notification> string message as notification, not user', () => {
      const message = createMessage({
        type: 'user',
        content: notificationContent,
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('notification');
    });

    it('should classify a background-command notification as notification', () => {
      const message = createMessage({
        type: 'user',
        content:
          '<task-notification>\n<status>completed</status>\n' +
          'Background command "npm run build" completed (exit code 0)\n</task-notification>',
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('notification');
    });

    it('should NOT reclassify a real user message that merely mentions task-notification', () => {
      const message = createMessage({
        type: 'user',
        content: 'What is a <task-notification> tag?',
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('user');
    });
  });

  describe('system category', () => {
    it('should classify local-command-stdout as system', () => {
      const message = createMessage({
        type: 'user',
        content:
          '<local-command-stdout>Set model to claude-sonnet-4-20250514</local-command-stdout>',
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('system');
    });

    it('should classify local-command-stderr as system', () => {
      const message = createMessage({
        type: 'user',
        content: '<local-command-stderr>Error: command failed</local-command-stderr>',
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('system');
    });

    it('should classify array content with stdout as system', () => {
      const message = createMessage({
        type: 'user',
        content: [{ type: 'text', text: '<local-command-stdout>output</local-command-stdout>' }],
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('system');
    });
  });

  describe('compact category', () => {
    it('should classify compact summary message', () => {
      const message = createMessage({
        type: 'user',
        content: 'Summary of previous conversation...',
        isCompactSummary: true,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('compact');
    });
  });

  describe('hardNoise category', () => {
    it('should classify system type as hardNoise', () => {
      const message = createMessage({
        type: 'system',
        content: 'System prompt',
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('hardNoise');
    });

    it('should classify summary type as hardNoise', () => {
      const message = createMessage({
        type: 'summary' as ParsedMessage['type'],
        content: 'Summary',
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('hardNoise');
    });

    it('should classify synthetic assistant message as hardNoise', () => {
      const message = createMessage({
        type: 'assistant',
        content: '',
        model: '<synthetic>',
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('hardNoise');
    });

    it('should classify local-command-caveat as hardNoise', () => {
      const message = createMessage({
        type: 'user',
        content: '<local-command-caveat>This is a caveat</local-command-caveat>',
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('hardNoise');
    });

    it('should classify system-reminder as hardNoise', () => {
      const message = createMessage({
        type: 'user',
        content: '<system-reminder>Remember to do X</system-reminder>',
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('hardNoise');
    });

    it('should classify empty stdout as hardNoise', () => {
      const message = createMessage({
        type: 'user',
        content: '<local-command-stdout></local-command-stdout>',
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('hardNoise');
    });

    it('should classify file-history-snapshot as hardNoise', () => {
      const message = createMessage({
        type: 'file-history-snapshot' as ParsedMessage['type'],
        content: '',
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('hardNoise');
    });
  });

  describe('ai category', () => {
    it('should classify assistant message as ai', () => {
      const message = createMessage({
        type: 'assistant',
        content: [{ type: 'text', text: "Here's how to fix your code..." }],
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('ai');
    });

    it('should classify assistant message with tool use as ai', () => {
      const message = createMessage({
        type: 'assistant',
        content: [
          { type: 'text', text: 'Let me read that file' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test.ts' } },
        ],
        toolCalls: [
          { id: 'tool-1', name: 'Read', input: { file_path: '/test.ts' }, isTask: false },
        ],
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('ai');
    });

    it('should classify internal user message (tool result) as ai', () => {
      const message = createMessage({
        type: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }],
        isMeta: true,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('ai');
    });

    it('should classify user interruption message as hardNoise', () => {
      const message = createMessage({
        type: 'user',
        content: [{ type: 'text', text: '[Request interrupted by user]' }],
        isMeta: false,
      });
      const [result] = classifyMessages([message]);
      expect(result.category).toBe('hardNoise');
    });
  });

  describe('mixed message sequence', () => {
    it('should correctly classify a typical conversation flow', () => {
      const messages = [
        createMessage({
          type: 'user',
          content: 'Fix the bug in app.ts',
          isMeta: false,
        }),
        createMessage({
          type: 'assistant',
          content: [
            { type: 'text', text: 'Let me read the file' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'app.ts' } },
          ],
        }),
        createMessage({
          type: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'const x = 1;' }],
          isMeta: true,
        }),
        createMessage({
          type: 'assistant',
          content: [{ type: 'text', text: 'I found the issue. Let me fix it.' }],
        }),
        createMessage({
          type: 'system',
          content: 'System message',
        }),
      ];

      const results = classifyMessages(messages);

      expect(results[0].category).toBe('user'); // User input
      expect(results[1].category).toBe('ai'); // Assistant with tool use
      expect(results[2].category).toBe('ai'); // Tool result (internal user)
      expect(results[3].category).toBe('ai'); // Assistant response
      expect(results[4].category).toBe('hardNoise'); // System message
    });
  });
});
