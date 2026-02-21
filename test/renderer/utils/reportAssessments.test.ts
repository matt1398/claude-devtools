import { describe, it, expect } from 'vitest';

import {
  assessmentColor,
  assessmentLabel,
  assessmentSeverity,
  computeCacheEfficiencyAssessment,
  computeCacheRatioAssessment,
  computeCostPerCommitAssessment,
  computeCostPerLineAssessment,
  computeIdleAssessment,
  computeOverheadAssessment,
  computeRedundancyAssessment,
  computeSubagentCostShareAssessment,
  computeThrashingAssessment,
  computeToolHealthAssessment,
  detectModelMismatch,
  detectSwitchPattern,
  severityColor,
  THRESHOLDS,
} from '@renderer/utils/reportAssessments';

describe('reportAssessments', () => {
  describe('severityColor', () => {
    it('maps severity to hex color', () => {
      expect(severityColor('good')).toBe('#4ade80');
      expect(severityColor('warning')).toBe('#fbbf24');
      expect(severityColor('danger')).toBe('#f87171');
      expect(severityColor('neutral')).toBe('#a1a1aa');
    });
  });

  describe('assessmentSeverity', () => {
    it('maps known assessments to severity', () => {
      expect(assessmentSeverity('healthy')).toBe('good');
      expect(assessmentSeverity('efficient')).toBe('good');
      expect(assessmentSeverity('expensive')).toBe('warning');
      expect(assessmentSeverity('red_flag')).toBe('danger');
      expect(assessmentSeverity('very_high')).toBe('danger');
      expect(assessmentSeverity('degraded')).toBe('warning');
      expect(assessmentSeverity('unreliable')).toBe('danger');
      expect(assessmentSeverity('high_idle')).toBe('danger');
      expect(assessmentSeverity('moderate')).toBe('warning');
    });

    it('returns neutral for null/undefined/unknown', () => {
      expect(assessmentSeverity(null)).toBe('neutral');
      expect(assessmentSeverity(undefined)).toBe('neutral');
      expect(assessmentSeverity('unknown_value')).toBe('neutral');
    });
  });

  describe('assessmentColor', () => {
    it('returns correct color for assessment string', () => {
      expect(assessmentColor('healthy')).toBe('#4ade80');
      expect(assessmentColor('red_flag')).toBe('#f87171');
      expect(assessmentColor(null)).toBe('#a1a1aa');
    });
  });

  describe('assessmentLabel', () => {
    it('converts snake_case to Title Case', () => {
      expect(assessmentLabel('red_flag')).toBe('Red Flag');
      expect(assessmentLabel('well_specified')).toBe('Well Specified');
      expect(assessmentLabel('healthy')).toBe('Healthy');
      expect(assessmentLabel('high_idle')).toBe('High Idle');
      expect(assessmentLabel('opus_plan_mode')).toBe('Opus Plan Mode');
    });
  });

  describe('computeCostPerCommitAssessment', () => {
    it('returns efficient below threshold', () => {
      expect(computeCostPerCommitAssessment(0.3)).toBe('efficient');
    });
    it('returns normal in range', () => {
      expect(computeCostPerCommitAssessment(1.0)).toBe('normal');
    });
    it('returns expensive in range', () => {
      expect(computeCostPerCommitAssessment(3.0)).toBe('expensive');
    });
    it('returns red_flag above threshold', () => {
      expect(computeCostPerCommitAssessment(10.0)).toBe('red_flag');
    });
    it('respects threshold boundaries', () => {
      expect(computeCostPerCommitAssessment(THRESHOLDS.costPerCommit.efficient - 0.01)).toBe(
        'efficient'
      );
      expect(computeCostPerCommitAssessment(THRESHOLDS.costPerCommit.efficient)).toBe('normal');
    });
  });

  describe('computeCostPerLineAssessment', () => {
    it('returns efficient below threshold', () => {
      expect(computeCostPerLineAssessment(0.005)).toBe('efficient');
    });
    it('returns red_flag above threshold', () => {
      expect(computeCostPerLineAssessment(0.5)).toBe('red_flag');
    });
  });

  describe('computeSubagentCostShareAssessment', () => {
    it('returns normal below 30%', () => {
      expect(computeSubagentCostShareAssessment(20)).toBe('normal');
    });
    it('returns high in range', () => {
      expect(computeSubagentCostShareAssessment(45)).toBe('high');
    });
    it('returns very_high in range', () => {
      expect(computeSubagentCostShareAssessment(70)).toBe('very_high');
    });
    it('returns red_flag above 80%', () => {
      expect(computeSubagentCostShareAssessment(90)).toBe('red_flag');
    });
  });

  describe('computeCacheEfficiencyAssessment', () => {
    it('returns good above 95%', () => {
      expect(computeCacheEfficiencyAssessment(96)).toBe('good');
    });
    it('returns concerning below 95%', () => {
      expect(computeCacheEfficiencyAssessment(90)).toBe('concerning');
    });
  });

  describe('computeCacheRatioAssessment', () => {
    it('returns good above 20', () => {
      expect(computeCacheRatioAssessment(25)).toBe('good');
    });
    it('returns concerning below 20', () => {
      expect(computeCacheRatioAssessment(10)).toBe('concerning');
    });
  });

  describe('computeToolHealthAssessment', () => {
    it('returns healthy above 95%', () => {
      expect(computeToolHealthAssessment(98)).toBe('healthy');
    });
    it('returns degraded between 80-95%', () => {
      expect(computeToolHealthAssessment(85)).toBe('degraded');
    });
    it('returns unreliable below 80%', () => {
      expect(computeToolHealthAssessment(70)).toBe('unreliable');
    });
    it('boundary: 95 is degraded, 95.1 is healthy', () => {
      expect(computeToolHealthAssessment(95)).toBe('degraded');
      expect(computeToolHealthAssessment(95.1)).toBe('healthy');
    });
  });

  describe('computeIdleAssessment', () => {
    it('returns efficient below 20%', () => {
      expect(computeIdleAssessment(10)).toBe('efficient');
    });
    it('returns moderate between 20-50%', () => {
      expect(computeIdleAssessment(35)).toBe('moderate');
    });
    it('returns high_idle above 50%', () => {
      expect(computeIdleAssessment(60)).toBe('high_idle');
    });
  });

  describe('computeRedundancyAssessment', () => {
    it('returns normal at or below 2.0', () => {
      expect(computeRedundancyAssessment(1.5)).toBe('normal');
      expect(computeRedundancyAssessment(2.0)).toBe('normal');
    });
    it('returns wasteful above 2.0', () => {
      expect(computeRedundancyAssessment(3.0)).toBe('wasteful');
    });
  });

  describe('computeOverheadAssessment', () => {
    it('returns normal at or below 5%', () => {
      expect(computeOverheadAssessment(3)).toBe('normal');
      expect(computeOverheadAssessment(5)).toBe('normal');
    });
    it('returns heavy above 5%', () => {
      expect(computeOverheadAssessment(10)).toBe('heavy');
    });
  });

  describe('computeThrashingAssessment', () => {
    it('returns none for 0 signals', () => {
      expect(computeThrashingAssessment(0)).toBe('none');
    });
    it('returns mild for 1-2 signals', () => {
      expect(computeThrashingAssessment(1)).toBe('mild');
      expect(computeThrashingAssessment(2)).toBe('mild');
    });
    it('returns severe for 3+ signals', () => {
      expect(computeThrashingAssessment(3)).toBe('severe');
      expect(computeThrashingAssessment(5)).toBe('severe');
    });
  });

  describe('detectModelMismatch', () => {
    it('returns null for non-opus models', () => {
      expect(detectModelMismatch('rename files', 'claude-sonnet-4')).toBeNull();
    });

    it('detects mechanical tasks on opus', () => {
      const result = detectModelMismatch('rename all variables', 'claude-opus-4');
      expect(result).not.toBeNull();
      expect(result!.expectedComplexity).toBe('mechanical');
    });

    it('detects read-only tasks on opus', () => {
      const result = detectModelMismatch('explore the codebase', 'claude-opus-4');
      expect(result).not.toBeNull();
      expect(result!.expectedComplexity).toBe('read_only');
    });

    it('returns null for complex tasks on opus', () => {
      expect(detectModelMismatch('implement authentication system', 'claude-opus-4')).toBeNull();
    });

    it('detects various mechanical keywords', () => {
      for (const kw of ['lint', 'format', 'delete', 'move', 'copy', 'replace']) {
        expect(detectModelMismatch(`${kw} the code`, 'opus')).not.toBeNull();
      }
    });

    it('detects various read-only keywords', () => {
      for (const kw of ['search', 'find', 'verify', 'check', 'scan', 'discover']) {
        expect(detectModelMismatch(`${kw} for errors`, 'opus')).not.toBeNull();
      }
    });
  });

  describe('detectSwitchPattern', () => {
    it('returns null for no switches', () => {
      expect(detectSwitchPattern([])).toBeNull();
    });

    it('returns manual_switch for single switch', () => {
      expect(detectSwitchPattern([{ from: 'claude-sonnet-4', to: 'claude-haiku-4' }])).toBe(
        'manual_switch'
      );
    });

    it('detects opus_plan_mode pattern', () => {
      expect(
        detectSwitchPattern([
          { from: 'claude-sonnet-4', to: 'claude-opus-4' },
          { from: 'claude-opus-4', to: 'claude-sonnet-4' },
        ])
      ).toBe('opus_plan_mode');
    });

    it('returns manual_switch for non-plan-mode switches', () => {
      expect(
        detectSwitchPattern([
          { from: 'claude-sonnet-4', to: 'claude-haiku-4' },
          { from: 'claude-haiku-4', to: 'claude-sonnet-4' },
        ])
      ).toBe('manual_switch');
    });
  });
});
