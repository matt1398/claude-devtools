/**
 * Cost formatting utilities
 */

/**
 * Format USD cost with appropriate precision
 * - $0.001 or more: 2 decimal places ($1.23)
 * - Less than $0.001: 3-4 decimal places for precision ($0.0012)
 * - Zero: $0.00
 */
export function formatCostUsd(cost: number): string {
  if (cost === 0) {
    return '$0.00';
  }

  if (cost >= 0.01) {
    // Standard currency format for amounts >= 1 cent
    return `$${cost.toFixed(2)}`;
  } else if (cost >= 0.001) {
    // 3 decimal places for sub-cent amounts
    return `$${cost.toFixed(3)}`;
  } else {
    // 4 decimal places for very small amounts
    return `$${cost.toFixed(4)}`;
  }
}

/**
 * Format cost compactly for display in badges
 * - Rounds to 2 decimal places
 * - Omits $ prefix for brevity
 */
export function formatCostCompact(cost: number): string {
  if (cost === 0) {
    return '0.00';
  }

  if (cost >= 0.01) {
    return cost.toFixed(2);
  } else if (cost >= 0.001) {
    return cost.toFixed(3);
  } else {
    return cost.toFixed(4);
  }
}
