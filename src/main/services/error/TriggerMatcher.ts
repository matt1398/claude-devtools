/**
 * TriggerMatcher service - Pattern matching utilities for trigger checking.
 *
 * Provides utilities for:
 * - Regex pattern matching (with ReDoS protection)
 * - Ignore pattern checking
 * - Extracting fields from tool_use blocks
 * - Getting content blocks from messages
 */

import { type ContentBlock, type ParsedMessage } from '@main/types';
import { createSafeRegExp } from '@main/utils/regexValidation';

// =============================================================================
// Regex Cache
// =============================================================================

const MAX_CACHE_SIZE = 500;

/**
 * Module-level cache for compiled RegExp objects.
 * Key: `${pattern}\0${flags}` (null byte separator avoids collisions).
 * Value: compiled RegExp, or null if the pattern is invalid/dangerous.
 */
const regexCache = new Map<string, RegExp | null>();

/**
 * Returns a cached RegExp for the given pattern and flags.
 * Compiles and caches on first access; returns null for invalid patterns.
 * Cache is bounded to MAX_CACHE_SIZE entries (oldest evicted first via Map insertion order).
 */
function getCachedRegex(pattern: string, flags: string): RegExp | null {
  const key = `${pattern}\0${flags}`;
  if (regexCache.has(key)) {
    return regexCache.get(key) ?? null;
  }

  // Evict oldest entries when cache is full
  if (regexCache.size >= MAX_CACHE_SIZE) {
    const firstKey = regexCache.keys().next().value;
    if (firstKey !== undefined) {
      regexCache.delete(firstKey);
    }
  }

  const regex = createSafeRegExp(pattern, flags);
  regexCache.set(key, regex);
  return regex;
}

// =============================================================================
// Pattern Matching
// =============================================================================

/**
 * Checks if content matches a pattern.
 * Uses validated regex to prevent ReDoS attacks.
 * Regex objects are cached to avoid recompilation on repeated calls.
 */
export function matchesPattern(content: string, pattern: string): boolean {
  const regex = getCachedRegex(pattern, 'i');
  if (!regex) {
    // Pattern is invalid or potentially dangerous, reject match
    return false;
  }
  return regex.test(content);
}

/**
 * Checks if content matches any of the ignore patterns.
 * Uses validated regex to prevent ReDoS attacks.
 * Regex objects are cached to avoid recompilation on repeated calls.
 */
export function matchesIgnorePatterns(content: string, ignorePatterns?: string[]): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) {
    return false;
  }

  for (const pattern of ignorePatterns) {
    const regex = getCachedRegex(pattern, 'i');
    if (regex?.test(content)) {
      return true;
    }
    // Invalid or potentially dangerous patterns are skipped
  }

  return false;
}

// =============================================================================
// Field Extraction
// =============================================================================

/**
 * Extracts the specified field from a tool_use block.
 */
export function extractToolUseField(
  toolUse: { name: string; input?: Record<string, unknown> },
  matchField?: string
): string | null {
  if (!matchField || !toolUse.input) return null;

  const value = toolUse.input[matchField];
  if (typeof value === 'string') {
    return value;
  }
  if (value !== undefined) {
    return JSON.stringify(value);
  }
  return null;
}

/**
 * Gets content blocks from a message, handling both array and object formats.
 */
export function getContentBlocks(message: ParsedMessage): ContentBlock[] {
  if (Array.isArray(message.content)) {
    return message.content;
  }
  return [];
}
