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

const SEVERITY_CSS_VAR: Record<Severity, string> = {
  good: '--assess-good',
  warning: '--assess-warning',
  danger: '--assess-danger',
  neutral: '--assess-neutral',
};

const SEVERITY_FALLBACKS: Record<Severity, string> = {
  good: '#4ade80',
  warning: '#fbbf24',
  danger: '#f87171',
  neutral: '#a1a1aa',
};

export function severityColor(severity: Severity): string {
  if (typeof document === 'undefined') return SEVERITY_FALLBACKS[severity];
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(SEVERITY_CSS_VAR[severity])
    .trim();
  return value || SEVERITY_FALLBACKS[severity];
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
// Metric Keys & Explanations
// =============================================================================

export type MetricKey =
  | 'costPerCommit'
  | 'costPerLine'
  | 'subagentCostShare'
  | 'cacheEfficiency'
  | 'cacheRatio'
  | 'toolHealth'
  | 'idle'
  | 'fileReads'
  | 'startup'
  | 'thrashing'
  | 'promptQuality'
  | 'testTrajectory';

const EXPLANATIONS: Record<string, Record<string, string>> = {
  costPerCommit: {
    efficient: `Under $${THRESHOLDS.costPerCommit.efficient}/commit`,
    normal: `$${THRESHOLDS.costPerCommit.efficient}\u2013$${THRESHOLDS.costPerCommit.normal}/commit`,
    expensive: `$${THRESHOLDS.costPerCommit.normal}\u2013$${THRESHOLDS.costPerCommit.expensive}/commit`,
    red_flag: `Over $${THRESHOLDS.costPerCommit.expensive}/commit`,
  },
  costPerLine: {
    efficient: `Under $${THRESHOLDS.costPerLine.efficient}/line`,
    normal: `$${THRESHOLDS.costPerLine.efficient}\u2013$${THRESHOLDS.costPerLine.normal}/line`,
    expensive: `$${THRESHOLDS.costPerLine.normal}\u2013$${THRESHOLDS.costPerLine.expensive}/line`,
    red_flag: `Over $${THRESHOLDS.costPerLine.expensive}/line`,
  },
  subagentCostShare: {
    normal: `Under ${THRESHOLDS.subagentCostShare.normal}% of total cost`,
    high: `${THRESHOLDS.subagentCostShare.normal}\u2013${THRESHOLDS.subagentCostShare.high}% of total cost`,
    very_high: `${THRESHOLDS.subagentCostShare.high}\u2013${THRESHOLDS.subagentCostShare.veryHigh}% of total cost`,
    red_flag: `Over ${THRESHOLDS.subagentCostShare.veryHigh}% of total cost`,
  },
  cacheEfficiency: {
    good: `${THRESHOLDS.cacheEfficiency.good}%+ cache hit rate`,
    concerning: `Below ${THRESHOLDS.cacheEfficiency.good}% cache hit rate`,
  },
  cacheRatio: {
    good: `${THRESHOLDS.cacheRwRatio.good}x+ read-to-write ratio`,
    concerning: `Below ${THRESHOLDS.cacheRwRatio.good}x read-to-write ratio`,
  },
  toolHealth: {
    healthy: `Over ${THRESHOLDS.toolSuccess.healthy}% success rate`,
    degraded: `${THRESHOLDS.toolSuccess.degraded}\u2013${THRESHOLDS.toolSuccess.healthy}% success rate`,
    unreliable: `Below ${THRESHOLDS.toolSuccess.degraded}% success rate`,
  },
  idle: {
    efficient: `Under ${THRESHOLDS.idle.efficient}% idle time`,
    moderate: `${THRESHOLDS.idle.efficient}\u2013${THRESHOLDS.idle.moderate}% idle time`,
    high_idle: `Over ${THRESHOLDS.idle.moderate}% idle time`,
  },
  fileReads: {
    normal: `${THRESHOLDS.fileReadsPerUnique.normal}x or fewer reads per unique file`,
    wasteful: `Over ${THRESHOLDS.fileReadsPerUnique.normal}x reads per unique file`,
  },
  startup: {
    normal: `${THRESHOLDS.startupOverhead.normal}% or less of tokens before first work`,
    heavy: `Over ${THRESHOLDS.startupOverhead.normal}% of tokens before first work`,
  },
  thrashing: {
    none: 'No repeated commands or reworked files',
    mild: '1\u20132 thrashing signals detected',
    severe: '3+ thrashing signals detected',
  },
  promptQuality: {
    well_specified: 'Clear first message with low friction rate',
    moderate_friction: 'Some corrections needed mid-session',
    underspecified: 'Short initial prompt led to many corrections',
    verbose_but_unclear: 'Long initial prompt but still high friction',
  },
  testTrajectory: {
    improving: 'Test failures decreased over the session',
    stable: 'Test results stayed roughly the same',
    regressing: 'Test failures increased over the session',
    insufficient_data: 'Not enough test runs to determine trend',
  },
};

export function assessmentExplanation(metricKey: MetricKey, assessment: string): string {
  return EXPLANATIONS[metricKey]?.[assessment] ?? '';
}

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

// =============================================================================
// Key Takeaways
// =============================================================================

export interface Takeaway {
  severity: Severity;
  title: string;
  detail: string;
  sectionTitle: string;
}

interface TakeawayReport {
  costAnalysis: {
    costPerCommitAssessment: string | null;
    costPerLineAssessment: string | null;
    totalSessionCostUsd: number;
  };
  cacheEconomics: {
    cacheEfficiencyAssessment: string | null;
    cacheEfficiencyPct: number;
  };
  toolUsage: {
    overallToolHealth: string;
  };
  thrashingSignals: {
    thrashingAssessment: string;
    bashNearDuplicates: unknown[];
    editReworkFiles: unknown[];
  };
  idleAnalysis: {
    idleAssessment: string;
    idlePct: number;
  };
  promptQuality: {
    assessment: string;
    frictionRate: number;
  };
  overview: {
    contextAssessment: string | null;
    compactionCount: number;
  };
  fileReadRedundancy: {
    redundancyAssessment: string;
    readsPerUniqueFile: number;
  };
  testProgression: {
    trajectory: string;
  };
}

export function computeTakeaways(report: TakeawayReport): Takeaway[] {
  const items: Takeaway[] = [];

  // Cost red flags
  const costSev = assessmentSeverity(report.costAnalysis.costPerCommitAssessment);
  if (costSev === 'danger') {
    items.push({
      severity: 'danger',
      title: 'High cost per commit',
      detail: `$${report.costAnalysis.totalSessionCostUsd.toFixed(2)} total \u2014 consider smaller, focused sessions`,
      sectionTitle: 'Cost Analysis',
    });
  } else if (costSev === 'warning') {
    items.push({
      severity: 'warning',
      title: 'Elevated cost per commit',
      detail: 'Cost per commit is above typical range',
      sectionTitle: 'Cost Analysis',
    });
  }

  // Cache efficiency
  if (report.cacheEconomics.cacheEfficiencyAssessment === 'concerning') {
    items.push({
      severity: 'warning',
      title: 'Low cache efficiency',
      detail: `${report.cacheEconomics.cacheEfficiencyPct}% cache hit rate \u2014 prompt structure may reduce caching`,
      sectionTitle: 'Token Usage',
    });
  }

  // Tool health
  const toolSev = assessmentSeverity(report.toolUsage.overallToolHealth);
  if (toolSev === 'danger') {
    items.push({
      severity: 'danger',
      title: 'Tool reliability issues',
      detail: 'Multiple tool calls are failing \u2014 check error section for details',
      sectionTitle: 'Tool Usage',
    });
  } else if (toolSev === 'warning') {
    items.push({
      severity: 'warning',
      title: 'Degraded tool health',
      detail: 'Some tools have elevated failure rates',
      sectionTitle: 'Tool Usage',
    });
  }

  // Thrashing
  if (report.thrashingSignals.thrashingAssessment === 'severe') {
    items.push({
      severity: 'danger',
      title: 'Significant thrashing detected',
      detail: 'Repeated commands and file rework suggest unclear direction',
      sectionTitle: 'Friction Signals',
    });
  } else if (report.thrashingSignals.thrashingAssessment === 'mild') {
    items.push({
      severity: 'warning',
      title: 'Mild thrashing detected',
      detail: 'Some repeated commands or file rework occurred',
      sectionTitle: 'Friction Signals',
    });
  }

  // Idle time
  if (report.idleAnalysis.idleAssessment === 'high_idle') {
    items.push({
      severity: 'warning',
      title: 'High idle time',
      detail: `${report.idleAnalysis.idlePct}% of wall-clock time was idle`,
      sectionTitle: 'Timeline & Activity',
    });
  }

  // Prompt quality
  const promptSev = assessmentSeverity(report.promptQuality.assessment);
  if (promptSev === 'danger') {
    items.push({
      severity: 'danger',
      title: 'Prompt quality issues',
      detail: `${(report.promptQuality.frictionRate * 100).toFixed(0)}% friction rate \u2014 try more detailed initial prompts`,
      sectionTitle: 'Quality Signals',
    });
  }

  // Context pressure
  if (
    report.overview.contextAssessment === 'critical' ||
    report.overview.contextAssessment === 'high'
  ) {
    items.push({
      severity: report.overview.contextAssessment === 'critical' ? 'danger' : 'warning',
      title: 'Context window pressure',
      detail: `${report.overview.compactionCount} compaction${report.overview.compactionCount !== 1 ? 's' : ''} occurred \u2014 session may lose early context`,
      sectionTitle: 'Overview',
    });
  }

  // File read redundancy
  if (report.fileReadRedundancy.redundancyAssessment === 'wasteful') {
    items.push({
      severity: 'warning',
      title: 'Redundant file reads',
      detail: `${report.fileReadRedundancy.readsPerUniqueFile}x reads per unique file`,
      sectionTitle: 'Quality Signals',
    });
  }

  // Test regression
  if (report.testProgression.trajectory === 'regressing') {
    items.push({
      severity: 'danger',
      title: 'Tests regressing',
      detail: 'Test failures increased over the session',
      sectionTitle: 'Quality Signals',
    });
  }

  // Sort by severity (danger first), then limit to 4
  const severityOrder: Record<Severity, number> = { danger: 0, warning: 1, neutral: 2, good: 3 };
  items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  if (items.length === 0) {
    return [
      {
        severity: 'good',
        title: 'Session looks healthy',
        detail: 'No significant issues detected across all metrics',
        sectionTitle: 'Overview',
      },
    ];
  }

  return items.slice(0, 4);
}
