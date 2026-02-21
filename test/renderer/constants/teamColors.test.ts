import { describe, expect, it } from 'vitest';

import { getSubagentTypeColorSet, getTeamColorSet, TeamColorSet } from '@renderer/constants/teamColors';

function isValidColorSet(cs: TeamColorSet): boolean {
  return typeof cs.border === 'string' && typeof cs.badge === 'string' && typeof cs.text === 'string';
}

// =============================================================================
// getTeamColorSet
// =============================================================================

describe('getTeamColorSet', () => {
  it('returns blue (default) for empty string', () => {
    const result = getTeamColorSet('');
    expect(result.border).toBe('#3b82f6');
  });

  it('resolves named colors', () => {
    expect(getTeamColorSet('green').border).toBe('#22c55e');
    expect(getTeamColorSet('red').border).toBe('#ef4444');
    expect(getTeamColorSet('purple').border).toBe('#a855f7');
  });

  it('is case-insensitive for named colors', () => {
    expect(getTeamColorSet('Green')).toEqual(getTeamColorSet('green'));
    expect(getTeamColorSet('BLUE')).toEqual(getTeamColorSet('blue'));
  });

  it('generates a color set from hex strings', () => {
    const result = getTeamColorSet('#ff5500');
    expect(result.border).toBe('#ff5500');
    expect(result.badge).toBe('#ff550026');
    expect(result.text).toBe('#ff5500');
  });

  it('falls back to blue for unknown non-hex strings', () => {
    const result = getTeamColorSet('nonexistent');
    expect(result.border).toBe('#3b82f6');
  });
});

// =============================================================================
// getSubagentTypeColorSet
// =============================================================================

describe('getSubagentTypeColorSet', () => {
  it('always returns a valid TeamColorSet without agent configs', () => {
    const types = ['test-agent', 'quality-fixer', 'Explore', 'Plan', 'my-custom-agent', 'anything'];
    for (const t of types) {
      const result = getSubagentTypeColorSet(t);
      expect(isValidColorSet(result)).toBe(true);
    }
  });

  it('is deterministic — same input always returns same color', () => {
    const a = getSubagentTypeColorSet('my-custom-agent');
    const b = getSubagentTypeColorSet('my-custom-agent');
    expect(a).toEqual(b);
  });

  it('different types can produce different colors', () => {
    const results = new Set(
      ['Explore', 'Plan', 'test-agent', 'quality-fixer', 'claude-md-auditor', 'Bash', 'general-purpose', 'statusline-setup']
        .map((t) => getSubagentTypeColorSet(t).border)
    );
    expect(results.size).toBeGreaterThan(1);
  });

  it('uses color from agent config when available', () => {
    const configs = {
      'test-agent': { name: 'test-agent', color: 'red' },
    };
    const result = getSubagentTypeColorSet('test-agent', configs);
    // Should use the named "red" color from getTeamColorSet
    expect(result.border).toBe('#ef4444');
    expect(result.text).toBe('#f87171');
  });

  it('uses hex color from agent config', () => {
    const configs = {
      'my-agent': { name: 'my-agent', color: '#ff00ff' },
    };
    const result = getSubagentTypeColorSet('my-agent', configs);
    expect(result.border).toBe('#ff00ff');
  });

  it('falls back to hash when agent config has no color', () => {
    const configs = {
      'my-agent': { name: 'my-agent' },
    };
    const withConfig = getSubagentTypeColorSet('my-agent', configs);
    const withoutConfig = getSubagentTypeColorSet('my-agent');
    // Should be the same — both use hash fallback
    expect(withConfig).toEqual(withoutConfig);
  });

  it('falls back to hash when agent type not in configs', () => {
    const configs = {
      'other-agent': { name: 'other-agent', color: 'green' },
    };
    const withConfig = getSubagentTypeColorSet('unknown-agent', configs);
    const withoutConfig = getSubagentTypeColorSet('unknown-agent');
    expect(withConfig).toEqual(withoutConfig);
  });

  it('does not interfere with getTeamColorSet', () => {
    const teamGreen = getTeamColorSet('green');
    expect(teamGreen.border).toBe('#22c55e');

    const configs = { green: { name: 'green', color: 'purple' } };
    getSubagentTypeColorSet('green', configs);
    // Team API remains unaffected
    expect(getTeamColorSet('green').border).toBe('#22c55e');
  });
});
