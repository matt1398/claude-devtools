/**
 * Tests for cost calculation in jsonl.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import { calculateMetrics } from '@main/utils/jsonl';
import type { ParsedMessage } from '@main/types';

// Mock fs module
vi.mock('fs');

describe('Cost Calculation', () => {
  // Sample pricing data matching Claude models
  const mockPricingData = {
    'claude-3-5-sonnet-20241022': {
      input_cost_per_token: 0.000003,
      output_cost_per_token: 0.000015,
      cache_creation_input_token_cost: 0.00000375,
      cache_read_input_token_cost: 0.0000003,
      input_cost_per_token_above_200k_tokens: 0.000006,
      output_cost_per_token_above_200k_tokens: 0.00003,
      cache_creation_input_token_cost_above_200k_tokens: 0.0000075,
      cache_read_input_token_cost_above_200k_tokens: 0.0000006,
    },
    'claude-3-opus-20240229': {
      input_cost_per_token: 0.000015,
      output_cost_per_token: 0.000075,
      cache_creation_input_token_cost: 0.00001875,
      cache_read_input_token_cost: 0.0000015,
    },
  };

  beforeEach(() => {
    // Reset modules to clear pricing cache
    vi.resetModules();

    // Mock fs.readFileSync to return our test pricing data
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockPricingData));
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

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

    it('should use tiered rates for input tokens above 200k threshold', () => {
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

      // Input: (200000 * 0.000003) + (50000 * 0.000006) = 0.6 + 0.3 = 0.9
      // Output: 1000 * 0.000015 = 0.015
      // Total: 0.915
      expect(metrics.costUsd).toBeCloseTo(0.915, 6);
    });

    it('should use tiered rates for output tokens above 200k threshold', () => {
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

      // Input: 1000 * 0.000003 = 0.003
      // Output: (200000 * 0.000015) + (50000 * 0.00003) = 3.0 + 1.5 = 4.5
      // Total: 4.503
      expect(metrics.costUsd).toBeCloseTo(4.503, 6);
    });

    it('should use tiered rates for cache tokens above 200k threshold', () => {
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

      // Input: 1000 * 0.000003 = 0.003
      // Output: 1000 * 0.000015 = 0.015
      // Cache creation: (200000 * 0.00000375) + (50000 * 0.0000075) = 0.75 + 0.375 = 1.125
      // Cache read: (200000 * 0.0000003) + (50000 * 0.0000006) = 0.06 + 0.03 = 0.09
      // Total: 1.233
      expect(metrics.costUsd).toBeCloseTo(1.233, 6);
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

    it('should handle pricing data load failure gracefully', async () => {
      // Suppress expected console.error for this test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Reset modules to clear the pricing cache
      vi.resetModules();

      // Mock fs to throw error BEFORE importing calculateMetrics
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      // Re-import calculateMetrics to get fresh instance with cleared cache
      const { calculateMetrics: freshCalculateMetrics } = await import('@main/utils/jsonl');

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

      const metrics = freshCalculateMetrics(messages);
      expect(metrics.costUsd).toBe(0);

      // Verify that console.error was called (error was logged)
      expect(consoleErrorSpy).toHaveBeenCalled();

      // Restore console.error
      consoleErrorSpy.mockRestore();
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

    it('should apply tiered rates when individual messages exceed 200k', () => {
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

      // Single message with 300k cache_read tokens
      // First 200k: 200,000 * 0.0000003 = $0.06
      // Remaining 100k: 100,000 * 0.0000006 = $0.06
      // Total: $0.12
      const expectedCost = 200000 * 0.0000003 + 100000 * 0.0000006;
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
});
