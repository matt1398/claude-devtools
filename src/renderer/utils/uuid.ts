/**
 * Generate a UUID v4 string.
 *
 * `crypto.randomUUID()` is only available in **secure contexts** (HTTPS or
 * localhost). When the app is served over plain HTTP on a LAN IP (e.g.
 * Docker accessed from another machine), the browser will not expose
 * `randomUUID`. This helper falls back to `crypto.getRandomValues()` which
 * is available in all modern browsers regardless of secure context.
 *
 * @see https://github.com/matt1398/claude-devtools/issues/132
 */
export function generateUUID(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback: construct a v4 UUID from getRandomValues
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Set version (4) and variant (RFC 4122)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
