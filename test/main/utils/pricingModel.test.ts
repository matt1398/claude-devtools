import { describe, expect, it } from 'vitest';

import {
  calculateTokenCost,
  getPricingForModel,
} from '../../../src/main/utils/pricingModel';

describe('pricingModel', () => {
  describe('getPricingForModel', () => {
    it('returns pricing for claude-sonnet-4-5', () => {
      const pricing = getPricingForModel('claude-sonnet-4-5');
      expect(pricing.inputPerMillion).toBeGreaterThan(0);
      expect(pricing.outputPerMillion).toBeGreaterThan(0);
    });

    it('returns pricing for claude-haiku-4-5', () => {
      const pricing = getPricingForModel('claude-haiku-4-5-20251001');
      expect(pricing.inputPerMillion).toBeGreaterThan(0);
      expect(pricing.outputPerMillion).toBeGreaterThan(0);
    });

    it('returns pricing for claude-opus-4 prefix', () => {
      const pricing = getPricingForModel('claude-opus-4-5');
      expect(pricing.inputPerMillion).toBeGreaterThan(0);
      expect(pricing.outputPerMillion).toBeGreaterThan(0);
    });

    it('matches sonnet family pricing for versioned model names', () => {
      const p1 = getPricingForModel('claude-sonnet-4-5');
      const p2 = getPricingForModel('claude-sonnet-4-5-20251022');
      expect(p1).toEqual(p2);
    });

    it('returns fallback pricing for completely unknown model', () => {
      const pricing = getPricingForModel('unknown-model-xyz');
      expect(pricing.inputPerMillion).toBeGreaterThan(0);
      expect(pricing.outputPerMillion).toBeGreaterThan(0);
    });

    it('opus costs more than haiku per token', () => {
      const opus = getPricingForModel('claude-opus-4-5');
      const haiku = getPricingForModel('claude-haiku-4-5');
      expect(opus.outputPerMillion).toBeGreaterThan(haiku.outputPerMillion);
    });
  });

  describe('calculateTokenCost', () => {
    it('returns 0 for zero tokens', () => {
      const cost = calculateTokenCost('claude-sonnet-4-5', 0, 0);
      expect(cost).toBe(0);
    });

    it('calculates cost for input tokens only', () => {
      const pricing = getPricingForModel('claude-sonnet-4-5');
      const cost = calculateTokenCost('claude-sonnet-4-5', 1_000_000, 0);
      expect(cost).toBeCloseTo(pricing.inputPerMillion, 6);
    });

    it('calculates cost for output tokens only', () => {
      const pricing = getPricingForModel('claude-sonnet-4-5');
      const cost = calculateTokenCost('claude-sonnet-4-5', 0, 1_000_000);
      expect(cost).toBeCloseTo(pricing.outputPerMillion, 6);
    });

    it('includes cache read and cache creation costs', () => {
      const pricingWithCache = getPricingForModel('claude-sonnet-4-5');
      const withoutCache = calculateTokenCost('claude-sonnet-4-5', 100_000, 10_000);
      const withCache = calculateTokenCost(
        'claude-sonnet-4-5',
        100_000,
        10_000,
        50_000,
        25_000
      );
      if (pricingWithCache.cacheReadPerMillion > 0 || pricingWithCache.cacheWritePerMillion > 0) {
        expect(withCache).toBeGreaterThan(withoutCache);
      } else {
        expect(withCache).toBe(withoutCache);
      }
    });

    it('output costs more than same-count input tokens', () => {
      const inputCost = calculateTokenCost('claude-sonnet-4-5', 1_000_000, 0);
      const outputCost = calculateTokenCost('claude-sonnet-4-5', 0, 1_000_000);
      expect(outputCost).toBeGreaterThan(inputCost);
    });

    it('scales linearly with token count', () => {
      const cost1M = calculateTokenCost('claude-sonnet-4-5', 1_000_000, 0);
      const cost2M = calculateTokenCost('claude-sonnet-4-5', 2_000_000, 0);
      expect(cost2M).toBeCloseTo(cost1M * 2, 6);
    });
  });
});
