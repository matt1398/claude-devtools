import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { analyzeSessionFileMetadata, calculateMetrics } from '../../../src/main/utils/jsonl';
import type { ParsedMessage } from '../../../src/main/types';

// Helper to create a minimal ParsedMessage
function createMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    uuid: 'test-uuid',
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date('2024-01-01T10:00:00Z'),
    content: '',
    isSidechain: false,
    isMeta: false,
    isCompactSummary: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

describe('jsonl', () => {
  describe('calculateMetrics', () => {
    it('should return empty metrics for empty messages array', () => {
      const result = calculateMetrics([]);
      expect(result.durationMs).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.messageCount).toBe(0);
    });

    it('should calculate total tokens from usage', () => {
      const messages = [
        createMessage({
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        }),
      ];

      const result = calculateMetrics(messages);
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.totalTokens).toBe(150);
    });

    it('should sum tokens across multiple messages', () => {
      const messages = [
        createMessage({
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        createMessage({
          usage: { input_tokens: 200, output_tokens: 100 },
        }),
      ];

      const result = calculateMetrics(messages);
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(150);
      expect(result.totalTokens).toBe(450);
    });

    it('should handle cache tokens', () => {
      const messages = [
        createMessage({
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 25,
            cache_creation_input_tokens: 10,
          },
        }),
      ];

      const result = calculateMetrics(messages);
      expect(result.cacheReadTokens).toBe(25);
      expect(result.cacheCreationTokens).toBe(10);
      expect(result.totalTokens).toBe(185); // 100 + 50 + 25 + 10
    });

    it('should calculate duration from timestamps', () => {
      const messages = [
        createMessage({ timestamp: new Date('2024-01-01T10:00:00Z') }),
        createMessage({ timestamp: new Date('2024-01-01T10:01:00Z') }),
        createMessage({ timestamp: new Date('2024-01-01T10:02:00Z') }),
      ];

      const result = calculateMetrics(messages);
      expect(result.durationMs).toBe(120000); // 2 minutes in ms
    });

    it('should count messages', () => {
      const messages = [createMessage(), createMessage(), createMessage()];

      const result = calculateMetrics(messages);
      expect(result.messageCount).toBe(3);
    });

    it('should handle messages without usage', () => {
      const messages = [
        createMessage({ type: 'user', content: 'Hello' }),
        createMessage({ type: 'system' }),
      ];

      const result = calculateMetrics(messages);
      expect(result.totalTokens).toBe(0);
      expect(result.messageCount).toBe(2);
    });

    it('should handle single message duration', () => {
      const messages = [createMessage({ timestamp: new Date('2024-01-01T10:00:00Z') })];

      const result = calculateMetrics(messages);
      expect(result.durationMs).toBe(0); // min === max
    });

    it('should handle undefined token values', () => {
      const messages = [
        createMessage({
          usage: {
            input_tokens: undefined as unknown as number,
            output_tokens: 50,
          },
        }),
      ];

      const result = calculateMetrics(messages);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(50);
    });
  });

  describe('analyzeSessionFileMetadata', () => {
    it('should extract first message, count, ongoing state, and git branch in one pass', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-meta-'));
      try {
        const filePath = path.join(tempDir, 'session.jsonl');
        const lines = [
          JSON.stringify({
            type: 'user',
            uuid: 'u1',
            timestamp: '2026-01-01T00:00:00.000Z',
            gitBranch: 'feature/test',
            message: { role: 'user', content: 'hello world' },
            isMeta: false,
          }),
          JSON.stringify({
            type: 'assistant',
            uuid: 'a1',
            timestamp: '2026-01-01T00:00:01.000Z',
            message: {
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'thinking...' }],
            },
          }),
        ];
        fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');

        const result = await analyzeSessionFileMetadata(filePath);

        expect(result.firstUserMessage?.text).toBe('hello world');
        expect(result.firstUserMessage?.timestamp).toBe('2026-01-01T00:00:00.000Z');
        expect(result.messageCount).toBe(2);
        expect(result.isOngoing).toBe(true);
        expect(result.gitBranch).toBe('feature/test');
      } finally {
        try {
          fs.rmSync(tempDir, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 200,
          });
        } catch {
          // Best-effort cleanup; ignore ENOTEMPTY on Windows when dir is in use
        }
      }
    });
  });
});
