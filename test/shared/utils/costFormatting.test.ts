/**
 * Tests for cost formatting utilities
 */

import { describe, it, expect } from 'vitest';
import { formatCostUsd, formatCostCompact } from '@shared/utils/costFormatting';

describe('Cost Formatting', () => {
  describe('formatCostUsd', () => {
    describe('Zero values', () => {
      it('should format zero as $0.00', () => {
        expect(formatCostUsd(0)).toBe('$0.00');
      });

      it('should format negative zero as $0.00', () => {
        expect(formatCostUsd(-0)).toBe('$0.00');
      });
    });

    describe('Standard amounts (>= $0.01)', () => {
      it('should format 1 cent with 2 decimal places', () => {
        expect(formatCostUsd(0.01)).toBe('$0.01');
      });

      it('should format 1 dollar with 2 decimal places', () => {
        expect(formatCostUsd(1.0)).toBe('$1.00');
      });

      it('should format dollars and cents', () => {
        expect(formatCostUsd(1.23)).toBe('$1.23');
      });

      it('should format large amounts', () => {
        expect(formatCostUsd(999.99)).toBe('$999.99');
        expect(formatCostUsd(1234.56)).toBe('$1234.56');
      });

      it('should round to 2 decimal places for amounts >= 1 cent', () => {
        expect(formatCostUsd(1.234)).toBe('$1.23');
        expect(formatCostUsd(1.235)).toBe('$1.24'); // Rounds up
        expect(formatCostUsd(1.999)).toBe('$2.00');
      });
    });

    describe('Sub-cent amounts ($0.001 - $0.01)', () => {
      it('should format 1 tenth of a cent with 3 decimal places', () => {
        expect(formatCostUsd(0.001)).toBe('$0.001');
      });

      it('should format sub-cent amounts with 3 decimal places', () => {
        expect(formatCostUsd(0.005)).toBe('$0.005');
        expect(formatCostUsd(0.009)).toBe('$0.009');
      });

      it('should round to 3 decimal places for sub-cent amounts', () => {
        expect(formatCostUsd(0.0012)).toBe('$0.001');
        expect(formatCostUsd(0.0015)).toBe('$0.002'); // Rounds up
        expect(formatCostUsd(0.0099)).toBe('$0.010');
      });
    });

    describe('Very small amounts (< $0.001)', () => {
      it('should format tiny amounts with 4 decimal places', () => {
        expect(formatCostUsd(0.0001)).toBe('$0.0001');
        expect(formatCostUsd(0.0005)).toBe('$0.0005');
        expect(formatCostUsd(0.0009)).toBe('$0.0009');
      });

      it('should round to 4 decimal places for tiny amounts', () => {
        expect(formatCostUsd(0.00012)).toBe('$0.0001');
        expect(formatCostUsd(0.00016)).toBe('$0.0002'); // Rounds up
        expect(formatCostUsd(0.00099)).toBe('$0.0010');
      });

      it('should handle very tiny amounts', () => {
        expect(formatCostUsd(0.000001)).toBe('$0.0000');
      });
    });

    describe('Edge cases', () => {
      it('should handle negative amounts with 4 decimal places', () => {
        // Negative numbers don't match >= comparisons, so they use 4 decimals
        expect(formatCostUsd(-1.23)).toBe('$-1.2300');
        expect(formatCostUsd(-0.001)).toBe('$-0.0010');
        expect(formatCostUsd(-0.0001)).toBe('$-0.0001');
      });

      it('should handle very large amounts', () => {
        expect(formatCostUsd(1000000)).toBe('$1000000.00');
      });

      it('should handle precision boundaries', () => {
        // Boundary between 2 and 3 decimal places
        expect(formatCostUsd(0.01)).toBe('$0.01');
        expect(formatCostUsd(0.00999)).toBe('$0.010'); // Just below threshold, uses 3 decimals

        // Boundary between 3 and 4 decimal places
        expect(formatCostUsd(0.001)).toBe('$0.001');
        expect(formatCostUsd(0.00099)).toBe('$0.0010'); // Just below threshold, uses 4 decimals
      });
    });

    describe('Real-world API cost examples', () => {
      it('should format typical Claude API costs', () => {
        // 1M input tokens at $3.00/M
        expect(formatCostUsd(3.0)).toBe('$3.00');

        // 100k input tokens at $3.00/M
        expect(formatCostUsd(0.3)).toBe('$0.30');

        // 10k cache read tokens at $0.30/M
        expect(formatCostUsd(0.003)).toBe('$0.003');

        // 1k cache read tokens at $0.30/M
        expect(formatCostUsd(0.0003)).toBe('$0.0003');
      });

      it('should format session totals', () => {
        // Small session
        expect(formatCostUsd(0.15)).toBe('$0.15');

        // Medium session
        expect(formatCostUsd(5.67)).toBe('$5.67');

        // Large session
        expect(formatCostUsd(29.57)).toBe('$29.57');
      });
    });
  });

  describe('formatCostCompact', () => {
    describe('Zero values', () => {
      it('should format zero as 0.00', () => {
        expect(formatCostCompact(0)).toBe('0.00');
      });

      it('should format negative zero as 0.00', () => {
        expect(formatCostCompact(-0)).toBe('0.00');
      });
    });

    describe('Standard amounts (>= $0.01)', () => {
      it('should format amounts without $ prefix', () => {
        expect(formatCostCompact(0.01)).toBe('0.01');
        expect(formatCostCompact(1.0)).toBe('1.00');
        expect(formatCostCompact(1.23)).toBe('1.23');
      });

      it('should format large amounts', () => {
        expect(formatCostCompact(999.99)).toBe('999.99');
        expect(formatCostCompact(1234.56)).toBe('1234.56');
      });

      it('should round to 2 decimal places', () => {
        expect(formatCostCompact(1.234)).toBe('1.23');
        expect(formatCostCompact(1.235)).toBe('1.24'); // Rounds up
        expect(formatCostCompact(1.999)).toBe('2.00');
      });
    });

    describe('Sub-cent amounts ($0.001 - $0.01)', () => {
      it('should format sub-cent amounts with 3 decimal places', () => {
        expect(formatCostCompact(0.001)).toBe('0.001');
        expect(formatCostCompact(0.005)).toBe('0.005');
        expect(formatCostCompact(0.009)).toBe('0.009');
      });

      it('should round to 3 decimal places', () => {
        expect(formatCostCompact(0.0012)).toBe('0.001');
        expect(formatCostCompact(0.0015)).toBe('0.002'); // Rounds up
        expect(formatCostCompact(0.0099)).toBe('0.010');
      });
    });

    describe('Very small amounts (< $0.001)', () => {
      it('should format tiny amounts with 4 decimal places', () => {
        expect(formatCostCompact(0.0001)).toBe('0.0001');
        expect(formatCostCompact(0.0005)).toBe('0.0005');
        expect(formatCostCompact(0.0009)).toBe('0.0009');
      });

      it('should round to 4 decimal places', () => {
        expect(formatCostCompact(0.00012)).toBe('0.0001');
        expect(formatCostCompact(0.00016)).toBe('0.0002'); // Rounds up
        expect(formatCostCompact(0.00099)).toBe('0.0010');
      });
    });

    describe('Edge cases', () => {
      it('should handle negative amounts with 4 decimal places', () => {
        // Negative numbers don't match >= comparisons, so they use 4 decimals
        expect(formatCostCompact(-1.23)).toBe('-1.2300');
        expect(formatCostCompact(-0.001)).toBe('-0.0010');
        expect(formatCostCompact(-0.0001)).toBe('-0.0001');
      });

      it('should handle very large amounts', () => {
        expect(formatCostCompact(1000000)).toBe('1000000.00');
      });
    });

    describe('Comparison with formatCostUsd', () => {
      it('should match formatCostUsd except for $ prefix', () => {
        const testCases = [0, 0.0001, 0.001, 0.01, 1.23, 999.99];

        testCases.forEach((cost) => {
          const withPrefix = formatCostUsd(cost);
          const compact = formatCostCompact(cost);

          // Compact should equal the USD format without the $
          expect(compact).toBe(withPrefix.substring(1));
        });
      });
    });

    describe('Badge display use cases', () => {
      it('should format for badge display', () => {
        // Small per-message costs
        expect(formatCostCompact(0.0015)).toBe('0.002');
        expect(formatCostCompact(0.01)).toBe('0.01');

        // Session totals in badges
        expect(formatCostCompact(2.5)).toBe('2.50');
        expect(formatCostCompact(15.0)).toBe('15.00');
      });
    });
  });
});
