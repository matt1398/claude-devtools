/**
 * String utilities for display formatting and ID generation.
 */

/**
 * Generates a UUID v4.
 *
 * Prefers `crypto.randomUUID()` (available in secure contexts, i.e. in HTTPS or localhost).
 * Falls back to `crypto.getRandomValues()` for non-secure contexts.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // UUID v4 via getRandomValues - available in non-secure contexts
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

const isMacPlatform =
  typeof window !== 'undefined' && window.navigator.userAgent.includes('Macintosh');

/** Returns '⌘' on macOS, 'Ctrl' on Windows/Linux. */
export const modKey = isMacPlatform ? '⌘' : 'Ctrl+';

/** Returns '⇧' on macOS, 'Shift+' on Windows/Linux. */
export const shiftKey = isMacPlatform ? '⇧' : 'Shift+';

/**
 * Formats a keyboard shortcut for the current platform.
 * @example formatShortcut('R') → '⌘R' on Mac, 'Ctrl+R' on Windows/Linux
 * @example formatShortcut('W', { shift: true }) → '⇧⌘W' on Mac, 'Ctrl+Shift+W' on Windows/Linux
 */
export function formatShortcut(key: string, opts?: { shift?: boolean }): string {
  if (opts?.shift) {
    return isMacPlatform ? `${shiftKey}${modKey}${key}` : `${modKey}${shiftKey}${key}`;
  }
  return `${modKey}${key}`;
}

/**
 * Truncates a string in the middle to preserve both the beginning and end.
 * Useful for branch names where the unique identifier is often at the end.
 *
 * @example
 * truncateMiddle("feature/very-long-branch-name-with-ticket-12345", 25)
 * // Returns: "feature/ver...ticket-12345"
 *
 * @param text - The string to truncate
 * @param maxLen - Maximum length of the resulting string (default: 25)
 * @returns The truncated string with "..." in the middle, or original if short enough
 */
export function truncateMiddle(text: string, maxLen: number = 25): string {
  if (!text || text.length <= maxLen) return text;

  // Account for the 3-character ellipsis
  const availableChars = maxLen - 3;
  const startLen = Math.ceil(availableChars / 2);
  const endLen = Math.floor(availableChars / 2);

  const start = text.slice(0, startLen);
  const end = text.slice(-endLen);

  return `${start}...${end}`;
}
