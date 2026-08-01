/**
 * Model string parser utility.
 * Parses supported model identifiers into friendly display names and metadata.
 */

/** Known model families with specific styling */
export type KnownModelFamily = 'sonnet' | 'opus' | 'haiku';

/** Model family can be a known family or any arbitrary string for new/unknown models */
export type ModelFamily = KnownModelFamily | (string & Record<never, never>);

export interface ModelInfo {
  /** Friendly name like "sonnet4.5" */
  name: string;
  /** Model family used for display grouping and styling */
  family: ModelFamily;
  /** Major version like 4 or 3 */
  majorVersion: number;
  /** Minor version like 5 or 1 (null if not present) */
  minorVersion: number | null;
}

const KNOWN_FAMILIES: KnownModelFamily[] = ['sonnet', 'opus', 'haiku'];

const MINIMAX_MODELS: Record<string, ModelInfo> = {
  'minimax-m3': {
    name: 'MiniMax-M3',
    family: 'minimax',
    majorVersion: 3,
    minorVersion: null,
  },
  'minimax-m2.7': {
    name: 'MiniMax-M2.7',
    family: 'minimax',
    majorVersion: 2,
    minorVersion: 7,
  },
};

/**
 * Parses a supported model string into friendly display info.
 * Returns null if model string is invalid, synthetic, or empty.
 *
 * Supported formats:
 * - MiniMax format: MiniMax-M{major}[.{minor}]
 * - New format: claude-{family}-{major}-{minor}-{date} (e.g., "claude-sonnet-4-5-20250929")
 * - Old format: claude-{major}-{family}-{date} (e.g., "claude-3-opus-20240229")
 * - Old format with minor: claude-{major}-{minor}-{family}-{date} (e.g., "claude-3-5-sonnet-20241022")
 */
export function parseModelString(model: string | undefined): ModelInfo | null {
  // Handle null, undefined, empty, or synthetic models
  if (!model || model.trim() === '' || model === '<synthetic>') {
    return null;
  }

  const normalized = model.toLowerCase().trim();

  const miniMaxModel = MINIMAX_MODELS[normalized];
  if (miniMaxModel) {
    return { ...miniMaxModel };
  }

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
