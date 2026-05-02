/**
 * Claude API pricing model.
 *
 * Provides token-to-USD cost calculation for all Claude model families.
 * Prices are in USD per 1,000,000 tokens.
 *
 * Source: https://www.anthropic.com/api
 */

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPerMillion: number;
  /** USD per 1M output tokens */
  outputPerMillion: number;
  /** USD per 1M cache creation tokens (prompt caching write) */
  cacheWritePerMillion: number;
  /** USD per 1M cache read tokens (prompt caching read) */
  cacheReadPerMillion: number;
}

/**
 * Pricing table: [model-string-prefix, pricing].
 * Entries are ordered from most-specific to least-specific.
 * Matching is done via startsWith or includes on the lowercased model string.
 */
const PRICING_TABLE: [string, ModelPricing][] = [
  // ── Claude 4 ──────────────────────────────────────────────────────────
  [
    'claude-opus-4',
    { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheWritePerMillion: 18.75, cacheReadPerMillion: 1.5 },
  ],
  [
    'claude-sonnet-4',
    { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheWritePerMillion: 3.75, cacheReadPerMillion: 0.3 },
  ],
  [
    'claude-haiku-4',
    { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheWritePerMillion: 1.0, cacheReadPerMillion: 0.08 },
  ],

  // ── Claude 3.7 ────────────────────────────────────────────────────────
  [
    'claude-3-7-sonnet',
    { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheWritePerMillion: 3.75, cacheReadPerMillion: 0.3 },
  ],

  // ── Claude 3.5 ────────────────────────────────────────────────────────
  [
    'claude-3-5-sonnet',
    { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheWritePerMillion: 3.75, cacheReadPerMillion: 0.3 },
  ],
  [
    'claude-3-5-haiku',
    { inputPerMillion: 0.8, outputPerMillion: 4.0, cacheWritePerMillion: 1.0, cacheReadPerMillion: 0.08 },
  ],

  // ── Claude 3 ──────────────────────────────────────────────────────────
  [
    'claude-3-opus',
    { inputPerMillion: 15.0, outputPerMillion: 75.0, cacheWritePerMillion: 18.75, cacheReadPerMillion: 1.5 },
  ],
  [
    'claude-3-sonnet',
    { inputPerMillion: 3.0, outputPerMillion: 15.0, cacheWritePerMillion: 3.75, cacheReadPerMillion: 0.3 },
  ],
  [
    'claude-3-haiku',
    { inputPerMillion: 0.25, outputPerMillion: 1.25, cacheWritePerMillion: 0.3, cacheReadPerMillion: 0.03 },
  ],

  // ── Claude 2 ──────────────────────────────────────────────────────────
  [
    'claude-2',
    { inputPerMillion: 8.0, outputPerMillion: 24.0, cacheWritePerMillion: 8.0, cacheReadPerMillion: 8.0 },
  ],
  [
    'claude-instant',
    { inputPerMillion: 1.63, outputPerMillion: 5.51, cacheWritePerMillion: 1.63, cacheReadPerMillion: 1.63 },
  ],
];

/**
 * Fallback pricing used for unknown or future models.
 * Uses Claude Sonnet 4 pricing as a reasonable mid-tier estimate.
 */
export const FALLBACK_PRICING: ModelPricing = {
  inputPerMillion: 3.0,
  outputPerMillion: 15.0,
  cacheWritePerMillion: 3.75,
  cacheReadPerMillion: 0.3,
};

/**
 * Returns pricing for a given model string.
 * Matching is prefix-based and case-insensitive.
 * Falls back to Sonnet-tier pricing for unrecognized models.
 */
export function getPricingForModel(model: string | null | undefined): ModelPricing {
  if (!model) return FALLBACK_PRICING;

  const lower = model.toLowerCase();
  for (const [prefix, pricing] of PRICING_TABLE) {
    if (lower.startsWith(prefix) || lower.includes(prefix)) {
      return pricing;
    }
  }

  return FALLBACK_PRICING;
}

/**
 * Calculates the USD cost for a single API response given token counts and model.
 *
 * @param model           Model string (e.g. "claude-sonnet-4-5-20251022")
 * @param inputTokens     Prompt / input tokens
 * @param outputTokens    Completion / output tokens
 * @param cacheReadTokens     Tokens retrieved from prompt cache
 * @param cacheCreationTokens Tokens written to prompt cache
 * @returns Cost in USD
 */
export function calculateTokenCost(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheCreationTokens = 0
): number {
  const p = getPricingForModel(model);
  return (
    (inputTokens / 1_000_000) * p.inputPerMillion +
    (outputTokens / 1_000_000) * p.outputPerMillion +
    (cacheReadTokens / 1_000_000) * p.cacheReadPerMillion +
    (cacheCreationTokens / 1_000_000) * p.cacheWritePerMillion
  );
}
