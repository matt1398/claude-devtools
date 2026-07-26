/**
 * Claude model string parser utility.
 * Parses model identifiers into friendly display names and metadata.
 */

/** Known model families with specific styling */
export type KnownModelFamily = 'sonnet' | 'opus' | 'haiku';

/** Model family can be a known family or any arbitrary string for new/unknown models */
export type ModelFamily = KnownModelFamily | (string & Record<never, never>);

export interface ModelInfo {
  /** Friendly name like "sonnet4.5" */
  name: string;
  /** Model family: sonnet, opus, haiku, or any other string for unknown families */
  family: ModelFamily;
  /** Major version like 4 or 3 */
  majorVersion: number;
  /** Minor version like 5 or 1 (null if not present) */
  minorVersion: number | null;
}

const KNOWN_FAMILIES: KnownModelFamily[] = ['sonnet', 'opus', 'haiku'];

/**
 * Parses a Claude model string into friendly display info.
 * Returns null if model string is invalid, synthetic, or empty.
 *
 * Supported formats:
 * - New format: claude-{family}-{major}-{minor}-{date} (e.g., "claude-sonnet-4-5-20250929")
 * - Old format: claude-{major}-{family}-{date} (e.g., "claude-3-opus-20240229")
 * - Old format with minor: claude-{major}-{minor}-{family}-{date} (e.g., "claude-3-5-sonnet-20241022")
 */
export function parseModelString(model: string | undefined): ModelInfo | null {
  // Handle null, undefined, empty, or synthetic models
  if (!model || model.trim() === '' || model === '<synthetic>') {
    return null;
  }

  // Strip bracketed context markers like "[1m]" (e.g. "claude-opus-4-8[1m]") so they
  // don't corrupt version parsing. The marker is preserved on the raw string that
  // callers pass to friendlyModelLabel for 1M-context detection.
  const normalized = model
    .toLowerCase()
    .trim()
    .replace(/\[[^\]]*\]/g, '');

  // Must start with "claude"
  if (!normalized.startsWith('claude')) {
    return null;
  }

  // Split into parts (e.g., ["claude", "sonnet", "4", "5", "20250929"])
  const parts = normalized.split('-');

  if (parts.length < 3) {
    return null;
  }

  // Detect model family - first check known families, then accept any non-numeric string
  let family: ModelFamily | null = null;
  let familyIndex = -1;

  // First pass: look for known families
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (KNOWN_FAMILIES.includes(part as KnownModelFamily)) {
      family = part as KnownModelFamily;
      familyIndex = i;
      break;
    }
  }

  // Second pass: if no known family found, look for any non-numeric, non-date string as family
  if (family === null) {
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      // Skip numeric parts and date-like parts (8 digits)
      if (!/^\d+$/.test(part) && !/^\d{8}$/.test(part) && part.length > 1) {
        family = part;
        familyIndex = i;
        break;
      }
    }
  }

  if (family === null || familyIndex === -1) {
    return null;
  }

  let majorVersion: number;
  let minorVersion: number | null = null;

  // Determine format based on family position
  if (familyIndex === 1) {
    // New format: claude-{family}-{major}-{minor}-{date}
    // e.g., claude-sonnet-4-5-20250929 -> ["claude", "sonnet", "4", "5", "20250929"]
    if (parts.length < 4) {
      return null;
    }

    majorVersion = parseInt(parts[2], 10);
    if (isNaN(majorVersion)) {
      return null;
    }

    // Check if there's a minor version (next part is a number and not a date)
    if (parts.length >= 4 && parts[3].length <= 2) {
      const potentialMinor = parseInt(parts[3], 10);
      if (!isNaN(potentialMinor)) {
        minorVersion = potentialMinor;
      }
    }
  } else {
    // Old format: claude-{major}[-{minor}]-{family}-{date}
    // e.g., claude-3-opus-20240229 -> ["claude", "3", "opus", "20240229"]
    // e.g., claude-3-5-sonnet-20241022 -> ["claude", "3", "5", "sonnet", "20241022"]

    majorVersion = parseInt(parts[1], 10);
    if (isNaN(majorVersion)) {
      return null;
    }

    // Check if there's a minor version between major and family
    if (familyIndex > 2) {
      const potentialMinor = parseInt(parts[2], 10);
      if (!isNaN(potentialMinor)) {
        minorVersion = potentialMinor;
      }
    }
  }

  // Build friendly name
  const versionString =
    minorVersion !== null ? `${majorVersion}.${minorVersion}` : `${majorVersion}`;
  const name = `${family}${versionString}`;

  return {
    name,
    family,
    majorVersion,
    minorVersion,
  };
}

/**
 * Map a raw model id + parsed info to a user-friendly label, e.g.
 * "claude-opus-4-8[1m]" → "Opus 4.8 (1M context)", "claude-sonnet-5" → "Sonnet 5".
 *
 * The raw string is needed because `parseModelString` drops the "[1m]" context
 * marker; pass it through so the 1M context can be surfaced.
 */
export function friendlyModelLabel(raw: string | null, info: ModelInfo | null): string {
  const family = info?.family ?? '';
  const titled = family ? family.charAt(0).toUpperCase() + family.slice(1) : (raw ?? '');
  const version = info
    ? info.minorVersion != null
      ? `${info.majorVersion}.${info.minorVersion}`
      : `${info.majorVersion}`
    : '';
  const base = version ? `${titled} ${version}` : titled;
  return raw && /1m/i.test(raw) ? `${base} (1M context)` : base;
}

/**
 * Gets the color class for a model family (for Tailwind).
 * Uses consistent neutral gray styling for a clean, Linear-like design.
 * All models use the same muted color for visual consistency.
 */
export function getModelColorClass(family: ModelFamily): string {
  // All families use consistent neutral gray for clean design
  switch (family) {
    case 'opus':
    case 'sonnet':
    case 'haiku':
      return 'text-zinc-400';
    default:
      return 'text-zinc-500';
  }
}
