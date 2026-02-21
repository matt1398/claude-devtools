/**
 * Centralized assessment severity/color utilities for session reports.
 *
 * Maps raw assessment values to severity levels and colors,
 * replacing duplicated assessmentColor() functions across report sections.
 */

// =============================================================================
// Types
// =============================================================================

export type Severity = 'good' | 'warning' | 'danger' | 'neutral';

// =============================================================================
// Colors
// =============================================================================

const SEVERITY_COLORS: Record<Severity, string> = {
  good: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
  neutral: '#a1a1aa',
};

export function severityColor(severity: Severity): string {
  return SEVERITY_COLORS[severity];
}

// =============================================================================
// Assessment → Severity Mapping
// =============================================================================

const ASSESSMENT_SEVERITY: Record<string, Severity> = {
  // Context
  healthy: 'good',
  moderate: 'warning',
  high: 'danger',
  critical: 'danger',

  // Cost / subagent share
  efficient: 'good',
  normal: 'good',
  expensive: 'warning',
  red_flag: 'danger',
  very_high: 'danger',

  // Cache
  good: 'good',
  concerning: 'warning',

  // Tool health
  degraded: 'warning',
  unreliable: 'danger',

  // Idle ('moderate' already mapped above under Context)
  high_idle: 'danger',

  // File read
  wasteful: 'warning',

  // Startup
  heavy: 'warning',

  // Thrashing
  none: 'good',
  mild: 'warning',
  severe: 'danger',

  // Prompt quality
  well_specified: 'good',
  moderate_friction: 'warning',
  underspecified: 'danger',
  verbose_but_unclear: 'danger',

  // Test trajectory
  improving: 'good',
  stable: 'warning',
  regressing: 'danger',
  insufficient_data: 'neutral',

  // Model switch
  opus_plan_mode: 'good',
  manual_switch: 'neutral',
};

export function assessmentSeverity(assessment: string | null | undefined): Severity {
  if (!assessment) return 'neutral';
  return ASSESSMENT_SEVERITY[assessment] ?? 'neutral';
}

export function assessmentColor(assessment: string | null | undefined): string {
  return severityColor(assessmentSeverity(assessment));
}

// =============================================================================
// Label Formatting
// =============================================================================

export function assessmentLabel(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// =============================================================================
// Threshold Constants
// =============================================================================

export const THRESHOLDS = {
  costPerCommit: {
    efficient: 0.5,
    normal: 2,
    expensive: 5,
  },
  costPerLine: {
    efficient: 0.01,
    normal: 0.05,
    expensive: 0.2,
  },
  subagentCostShare: {
    normal: 30,
    high: 60,
    veryHigh: 80,
  },
  cacheEfficiency: {
    good: 95,
  },
  cacheRwRatio: {
    good: 20,
  },
  toolSuccess: {
    healthy: 95,
    degraded: 80,
  },
  idle: {
    efficient: 20,
    moderate: 50,
  },
  fileReadsPerUnique: {
    normal: 2.0,
  },
  startupOverhead: {
    normal: 5,
  },
} as const;

// =============================================================================
// Assessment Computers
// =============================================================================

export type CostAssessment = 'efficient' | 'normal' | 'expensive' | 'red_flag';
export type CacheAssessment = 'good' | 'concerning';
export type ToolHealthAssessment = 'healthy' | 'degraded' | 'unreliable';
export type IdleAssessment = 'efficient' | 'moderate' | 'high_idle';
export type RedundancyAssessment = 'normal' | 'wasteful';
export type OverheadAssessment = 'normal' | 'heavy';
export type ThrashingAssessment = 'none' | 'mild' | 'severe';
export type SubagentCostShareAssessment = 'normal' | 'high' | 'very_high' | 'red_flag';
export type SwitchPattern = 'opus_plan_mode' | 'manual_switch' | 'none';

export function computeCostPerCommitAssessment(costPerCommit: number): CostAssessment {
  if (costPerCommit < THRESHOLDS.costPerCommit.efficient) return 'efficient';
  if (costPerCommit < THRESHOLDS.costPerCommit.normal) return 'normal';
  if (costPerCommit < THRESHOLDS.costPerCommit.expensive) return 'expensive';
  return 'red_flag';
}

export function computeCostPerLineAssessment(costPerLine: number): CostAssessment {
  if (costPerLine < THRESHOLDS.costPerLine.efficient) return 'efficient';
  if (costPerLine < THRESHOLDS.costPerLine.normal) return 'normal';
  if (costPerLine < THRESHOLDS.costPerLine.expensive) return 'expensive';
  return 'red_flag';
}

export function computeSubagentCostShareAssessment(pct: number): SubagentCostShareAssessment {
  if (pct < THRESHOLDS.subagentCostShare.normal) return 'normal';
  if (pct < THRESHOLDS.subagentCostShare.high) return 'high';
  if (pct < THRESHOLDS.subagentCostShare.veryHigh) return 'very_high';
  return 'red_flag';
}

export function computeCacheEfficiencyAssessment(pct: number): CacheAssessment {
  return pct >= THRESHOLDS.cacheEfficiency.good ? 'good' : 'concerning';
}

export function computeCacheRatioAssessment(ratio: number): CacheAssessment {
  return ratio >= THRESHOLDS.cacheRwRatio.good ? 'good' : 'concerning';
}

export function computeToolHealthAssessment(successPct: number): ToolHealthAssessment {
  if (successPct > THRESHOLDS.toolSuccess.healthy) return 'healthy';
  if (successPct >= THRESHOLDS.toolSuccess.degraded) return 'degraded';
  return 'unreliable';
}

export function computeIdleAssessment(idlePct: number): IdleAssessment {
  if (idlePct < THRESHOLDS.idle.efficient) return 'efficient';
  if (idlePct < THRESHOLDS.idle.moderate) return 'moderate';
  return 'high_idle';
}

export function computeRedundancyAssessment(readsPerUnique: number): RedundancyAssessment {
  return readsPerUnique <= THRESHOLDS.fileReadsPerUnique.normal ? 'normal' : 'wasteful';
}

export function computeOverheadAssessment(pctOfTotal: number): OverheadAssessment {
  return pctOfTotal <= THRESHOLDS.startupOverhead.normal ? 'normal' : 'heavy';
}

export function computeThrashingAssessment(signalCount: number): ThrashingAssessment {
  if (signalCount === 0) return 'none';
  if (signalCount <= 2) return 'mild';
  return 'severe';
}

export interface ModelMismatch {
  description: string;
  expectedComplexity: 'mechanical' | 'read_only';
  recommendation: string;
}

const MECHANICAL_PATTERNS = /\b(rename|move|lint|format|delete|remove|copy|replace)\b/i;
const READ_ONLY_PATTERNS = /\b(explore|search|find|verify|check|scan|discover|list|read)\b/i;

export function detectModelMismatch(description: string, model: string): ModelMismatch | null {
  const isOpus = model.toLowerCase().includes('opus');
  if (!isOpus) return null;

  if (MECHANICAL_PATTERNS.test(description)) {
    return {
      description,
      expectedComplexity: 'mechanical',
      recommendation: 'Consider using Haiku for mechanical tasks to reduce cost.',
    };
  }

  if (READ_ONLY_PATTERNS.test(description)) {
    return {
      description,
      expectedComplexity: 'read_only',
      recommendation: 'Consider using Haiku or Sonnet for read-only exploration tasks.',
    };
  }

  return null;
}

export function detectSwitchPattern(
  switches: { from: string; to: string }[]
): SwitchPattern | null {
  if (switches.length === 0) return null;
  if (switches.length < 2) return 'manual_switch';

  // Look for Sonnet→Opus→Sonnet pattern (plan mode)
  for (let i = 0; i < switches.length - 1; i++) {
    const s1 = switches[i];
    const s2 = switches[i + 1];
    if (
      s1.from.toLowerCase().includes('sonnet') &&
      s1.to.toLowerCase().includes('opus') &&
      s2.from.toLowerCase().includes('opus') &&
      s2.to.toLowerCase().includes('sonnet')
    ) {
      return 'opus_plan_mode';
    }
  }

  return 'manual_switch';
}
