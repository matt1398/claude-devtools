/**
 * Tests for cost calculation in jsonl.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { calculateMetrics } from '@main/utils/jsonl';
import type { ParsedMessage } from '@main/types';

describe('Cost Calculation', () => {
  describe('Basic Cost Calculation', () => {
    it('should calculate cost for simple token usage', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // Expected: (1000 * 0.000003) + (500 * 0.000015) = 0.003 + 0.0075 = 0.0105
      expect(metrics.costUsd).toBeCloseTo(0.0105, 6);
    });

    it('should calculate cost with cache tokens', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 300,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // Input: 1000 * 0.000003 = 0.003
      // Output: 500 * 0.000015 = 0.0075
      // Cache creation: 200 * 0.00000375 = 0.00075
      // Cache read: 300 * 0.0000003 = 0.00009
      // Total: 0.01134
      expect(metrics.costUsd).toBeCloseTo(0.01134, 6);
    });

    it('should return 0 cost when no model is specified', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);
      expect(metrics.costUsd).toBe(0);
    });

    it('should return 0 cost when model pricing not found', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'unknown-model',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);
      expect(metrics.costUsd).toBe(0);
      warnSpy.mockRestore();
    });
  });

  describe('Tiered Pricing', () => {
    it('should use base rates for tokens below 200k threshold', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 100_000,
            output_tokens: 50_000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // Input: 100000 * 0.000003 = 0.3
      // Output: 50000 * 0.000015 = 0.75
      // Total: 1.05
      expect(metrics.costUsd).toBeCloseTo(1.05, 6);
    });

    it('should use base rates for input tokens above 200k when model has no tiered pricing', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 250_000,
            output_tokens: 1_000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // claude-3-5-sonnet-20241022 has no tiered rates in pricing.json, so base rates apply
      // Input: 250000 * 0.000003 = 0.75
      // Output: 1000 * 0.000015 = 0.015
      // Total: 0.765
      expect(metrics.costUsd).toBeCloseTo(0.765, 6);
    });

    it('should use base rates for output tokens above 200k when model has no tiered pricing', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1_000,
            output_tokens: 250_000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // No tiered rates, so base rates for all tokens
      // Input: 1000 * 0.000003 = 0.003
      // Output: 250000 * 0.000015 = 3.75
      // Total: 3.753
      expect(metrics.costUsd).toBeCloseTo(3.753, 6);
    });

    it('should use base rates for cache tokens above 200k when model has no tiered pricing', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1_000,
            output_tokens: 1_000,
            cache_creation_input_tokens: 250_000,
            cache_read_input_tokens: 250_000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // No tiered rates for this model, so base rates apply
      // Input: 1000 * 0.000003 = 0.003
      // Output: 1000 * 0.000015 = 0.015
      // Cache creation: 250000 * 0.00000375 = 0.9375
      // Cache read: 250000 * 0.0000003 = 0.075
      // Total: 1.0305
      expect(metrics.costUsd).toBeCloseTo(1.0305, 6);
    });

    it('should handle model without tiered pricing', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-opus-20240229',
          usage: {
            input_tokens: 250_000,
            output_tokens: 250_000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // No tiered rates, so use base rates even above 200k
      // Input: 250000 * 0.000015 = 3.75
      // Output: 250000 * 0.000075 = 18.75
      // Total: 22.5
      expect(metrics.costUsd).toBeCloseTo(22.5, 6);
    });

    it('should use tiered rates for a model that has them (claude-4-sonnet)', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-4-sonnet-20250514',
          usage: {
            input_tokens: 250_000,
            output_tokens: 1_000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // claude-4-sonnet has tiered rates:
      // input base=0.000003, above_200k=0.000006
      // Input: (200000 * 0.000003) + (50000 * 0.000006) = 0.6 + 0.3 = 0.9
      // Output: 1000 * 0.000015 = 0.015
      // Total: 0.915
      expect(metrics.costUsd).toBeCloseTo(0.915, 6);
    });
  });

  describe('Multiple Messages', () => {
    it('should aggregate costs across multiple messages', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
        {
          type: 'assistant',
          uuid: 'msg-2',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 2000,
            output_tokens: 1000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // Message 1: (1000 * 0.000003) + (500 * 0.000015) = 0.0105
      // Message 2: (2000 * 0.000003) + (1000 * 0.000015) = 0.021
      // Total: 0.0315
      expect(metrics.costUsd).toBeCloseTo(0.0315, 6);
    });

    it("should calculate cost per-message using each message's model", () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
        {
          type: 'assistant',
          uuid: 'msg-2',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-opus-20240229', // Different model
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // Each message uses its own model's pricing
      // Message 1 (sonnet): (1000 * 0.000003) + (500 * 0.000015) = 0.003 + 0.0075 = 0.0105
      // Message 2 (opus): (1000 * 0.000015) + (500 * 0.000075) = 0.015 + 0.0375 = 0.0525
      // Total cost: 0.0105 + 0.0525 = 0.063
      expect(metrics.costUsd).toBeCloseTo(0.063, 6);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero tokens', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);
      expect(metrics.costUsd).toBe(0);
    });

    it('should handle messages without usage data', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);
      expect(metrics.costUsd).toBe(0);
    });

    it('should handle empty messages array', () => {
      const messages: ParsedMessage[] = [];
      const metrics = calculateMetrics(messages);
      expect(metrics.costUsd).toBe(0);
    });
  });

  describe('Model Name Lookup', () => {
    it('should find model with exact match', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);
      expect(metrics.costUsd).toBeGreaterThan(0);
    });

    it('should find model with case-insensitive match', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'CLAUDE-3-5-SONNET-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);
      expect(metrics.costUsd).toBeGreaterThan(0);
    });
  });

  describe('Per-Message Tiering', () => {
    it('should apply tiered pricing per-message, not to aggregated totals', () => {
      // Scenario: Many messages each with cache_read tokens < 200k,
      // but aggregated total > 200k
      // Each message should use base rates, not tiered rates
      const messages: ParsedMessage[] = [];

      // Create 10 messages, each with 50k cache_read tokens (500k total)
      for (let i = 0; i < 10; i++) {
        messages.push({
          type: 'assistant',
          uuid: `msg-${i}`,
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 50000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        });
      }

      const metrics = calculateMetrics(messages);

      // Per-message tiering: Each message uses base rate (< 200k threshold)
      // Each message: 50,000 * 0.0000003 = $0.015
      // Total: 10 * $0.015 = $0.15
      const expectedCost = 10 * 50000 * 0.0000003;
      expect(metrics.costUsd).toBeCloseTo(expectedCost, 6);

      // Verify this is NOT using tiered rate on aggregated total
      // If incorrectly aggregated: (200k * 0.0000003) + (300k * 0.0000006) = $0.24
      const incorrectAggregatedCost = 0.24;
      expect(metrics.costUsd).not.toBeCloseTo(incorrectAggregatedCost, 2);
    });

    it('should use base rates when individual messages exceed 200k and model has no tiered rates', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 300000, // Exceeds 200k threshold
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // No tiered rates for this model, so all 300k at base rate
      // 300,000 * 0.0000003 = $0.09
      const expectedCost = 300000 * 0.0000003;
      expect(metrics.costUsd).toBeCloseTo(expectedCost, 6);
    });
  });

  describe('Integration with Other Metrics', () => {
    it('should include cost alongside other session metrics', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date(),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
        },
      ];

      const metrics = calculateMetrics(messages);

      // Check that all expected metrics are present
      expect(metrics).toHaveProperty('totalTokens');
      expect(metrics).toHaveProperty('inputTokens');
      expect(metrics).toHaveProperty('outputTokens');
      expect(metrics).toHaveProperty('costUsd');
      expect(metrics.totalTokens).toBe(1500);
      expect(metrics.inputTokens).toBe(1000);
      expect(metrics.outputTokens).toBe(500);
      expect(metrics.costUsd).toBeCloseTo(0.0105, 6);
    });
  });

  describe('Streaming Deduplication', () => {
    it('should count cost only once for duplicate requestIds (last-entry-wins)', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1a',
          requestId: 'req_01ABC',
          timestamp: new Date('2026-01-01T10:00:00Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 100, // Intermediate streaming entry
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
        {
          type: 'assistant',
          uuid: 'msg-1b',
          requestId: 'req_01ABC', // Same requestId — streaming duplicate
          timestamp: new Date('2026-01-01T10:00:01Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500, // Final accumulated output tokens
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
      ];

      const metrics = calculateMetrics(messages);

      // Should use only the last entry (500 output tokens), not sum both (600)
      // Cost: (1000 * 0.000003) + (500 * 0.000015) = 0.003 + 0.0075 = 0.0105
      expect(metrics.costUsd).toBeCloseTo(0.0105, 6);
      expect(metrics.outputTokens).toBe(500);
      expect(metrics.inputTokens).toBe(1000);
    });

    it('should count distinct requestIds separately', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          requestId: 'req_01AAA',
          timestamp: new Date('2026-01-01T10:00:00Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
        {
          type: 'assistant',
          uuid: 'msg-2',
          requestId: 'req_01BBB', // Different request
          timestamp: new Date('2026-01-01T10:00:02Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 2000,
            output_tokens: 1000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
      ];

      const metrics = calculateMetrics(messages);

      // Both are unique requests, both counted
      expect(metrics.costUsd).toBeCloseTo(0.0315, 6);
      expect(metrics.inputTokens).toBe(3000);
      expect(metrics.outputTokens).toBe(1500);
    });

    it('should handle messages without requestId (legacy format)', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1',
          timestamp: new Date('2026-01-01T10:00:00Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
        {
          type: 'assistant',
          uuid: 'msg-2',
          timestamp: new Date('2026-01-01T10:00:01Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: {
            input_tokens: 2000,
            output_tokens: 1000,
          },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
      ];

      const metrics = calculateMetrics(messages);

      // No requestId = each message counted independently (backward compat)
      expect(metrics.costUsd).toBeCloseTo(0.0315, 6);
    });

    it('should deduplicate three streaming entries for same requestId', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1a',
          requestId: 'req_01XYZ',
          timestamp: new Date('2026-01-01T10:00:00Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: { input_tokens: 1000, output_tokens: 50 },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
        {
          type: 'assistant',
          uuid: 'msg-1b',
          requestId: 'req_01XYZ',
          timestamp: new Date('2026-01-01T10:00:01Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: { input_tokens: 1000, output_tokens: 200 },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
        {
          type: 'assistant',
          uuid: 'msg-1c',
          requestId: 'req_01XYZ',
          timestamp: new Date('2026-01-01T10:00:02Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: { input_tokens: 1000, output_tokens: 500 },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
      ];

      const metrics = calculateMetrics(messages);

      // Only the last entry (500 output tokens) should be counted
      expect(metrics.costUsd).toBeCloseTo(0.0105, 6);
      expect(metrics.outputTokens).toBe(500);
    });

    it('should not deduplicate user or system messages', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'user',
          uuid: 'msg-u1',
          timestamp: new Date('2026-01-01T10:00:00Z'),
          content: 'Hello',
          usage: { input_tokens: 100, output_tokens: 0 },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
        {
          type: 'assistant',
          uuid: 'msg-a1',
          requestId: 'req_01AAA',
          timestamp: new Date('2026-01-01T10:00:01Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: { input_tokens: 1000, output_tokens: 500 },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
      ];

      const metrics = calculateMetrics(messages);

      // User message tokens still counted (no requestId dedup applies)
      expect(metrics.inputTokens).toBe(1100);
      expect(metrics.outputTokens).toBe(500);
    });

    it('should preserve original messageCount including duplicates', () => {
      const messages: ParsedMessage[] = [
        {
          type: 'assistant',
          uuid: 'msg-1a',
          requestId: 'req_01ABC',
          timestamp: new Date('2026-01-01T10:00:00Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: { input_tokens: 1000, output_tokens: 100 },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
        {
          type: 'assistant',
          uuid: 'msg-1b',
          requestId: 'req_01ABC',
          timestamp: new Date('2026-01-01T10:00:01Z'),
          content: [],
          model: 'claude-3-5-sonnet-20241022',
          usage: { input_tokens: 1000, output_tokens: 500 },
          toolCalls: [],
          toolResults: [],
          isSidechain: false,
          isMeta: false,
          parentUuid: null,
        },
      ];

      const metrics = calculateMetrics(messages);
      // messageCount should reflect raw JSONL entries, not deduped count
      expect(metrics.messageCount).toBe(2);
    });
  });
});
