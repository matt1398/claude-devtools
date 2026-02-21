/**
 * Team Color Constants
 *
 * Shared color definitions for team member visualization.
 * Used by TeammateMessageItem and SubagentItem when displaying team members.
 */

export interface TeamColorSet {
  /** Border accent color */
  border: string;
  /** Badge background (semi-transparent) */
  badge: string;
  /** Text color for labels */
  text: string;
}

const TEAMMATE_COLORS: Record<string, TeamColorSet> = {
  blue: { border: '#3b82f6', badge: 'rgba(59, 130, 246, 0.15)', text: '#60a5fa' },
  green: { border: '#22c55e', badge: 'rgba(34, 197, 94, 0.15)', text: '#4ade80' },
  red: { border: '#ef4444', badge: 'rgba(239, 68, 68, 0.15)', text: '#f87171' },
  yellow: { border: '#eab308', badge: 'rgba(234, 179, 8, 0.15)', text: '#facc15' },
  purple: { border: '#a855f7', badge: 'rgba(168, 85, 247, 0.15)', text: '#c084fc' },
  cyan: { border: '#06b6d4', badge: 'rgba(6, 182, 212, 0.15)', text: '#22d3ee' },
  orange: { border: '#f97316', badge: 'rgba(249, 115, 22, 0.15)', text: '#fb923c' },
  pink: { border: '#ec4899', badge: 'rgba(236, 72, 153, 0.15)', text: '#f472b6' },
};

const DEFAULT_COLOR: TeamColorSet = TEAMMATE_COLORS.blue;

/**
 * Get a TeamColorSet from a color name or hex string.
 * Falls back to blue if unrecognized.
 */
const COLOR_NAMES = Object.keys(TEAMMATE_COLORS);

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getSubagentTypeColorSet(
  subagentType: string,
  agentConfigs?: Record<string, { color?: string }>
): TeamColorSet {
  // Use color from agent config if available
  const configColor = agentConfigs?.[subagentType]?.color;
  if (configColor) {
    return getTeamColorSet(configColor);
  }
  // Fallback: deterministic hash-based color
  const index = hashString(subagentType) % COLOR_NAMES.length;
  return TEAMMATE_COLORS[COLOR_NAMES[index]];
}

export function getTeamColorSet(colorName: string): TeamColorSet {
  if (!colorName) return DEFAULT_COLOR;

  // Check named colors
  const named = TEAMMATE_COLORS[colorName.toLowerCase()];
  if (named) return named;

  // If it's a hex color, generate a set from it
  if (colorName.startsWith('#')) {
    return {
      border: colorName,
      badge: `${colorName}26`,
      text: colorName,
    };
  }

  return DEFAULT_COLOR;
}
