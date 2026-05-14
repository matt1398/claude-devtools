import { describe, expect, it } from 'vitest';
import * as path from 'path';

import { validateConfigUpdatePayload } from '../../../src/main/ipc/configValidation';

describe('configValidation', () => {
  it('accepts valid general updates', () => {
    const result = validateConfigUpdatePayload('general', {
      theme: 'system',
      launchAtLogin: true,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.section).toBe('general');
      expect(result.data).toEqual({
        theme: 'system',
        launchAtLogin: true,
      });
    }
  });

  it('accepts general.autoExpandAIGroups boolean toggle', () => {
    const resultOn = validateConfigUpdatePayload('general', { autoExpandAIGroups: true });
    expect(resultOn.valid).toBe(true);
    if (resultOn.valid) {
      expect(resultOn.data).toEqual({ autoExpandAIGroups: true });
    }

    const resultOff = validateConfigUpdatePayload('general', { autoExpandAIGroups: false });
    expect(resultOff.valid).toBe(true);
    if (resultOff.valid) {
      expect(resultOff.data).toEqual({ autoExpandAIGroups: false });
    }
  });

  it('rejects non-boolean general.autoExpandAIGroups', () => {
    const result = validateConfigUpdatePayload('general', { autoExpandAIGroups: 'yes' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('boolean');
    }
  });

  it('accepts absolute general.claudeRootPath updates', () => {
    const result = validateConfigUpdatePayload('general', {
      claudeRootPath: '/Users/test/.claude',
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.section).toBe('general');
      expect(result.data).toEqual({
        claudeRootPath: path.resolve('/Users/test/.claude'),
      });
    }
  });

  it('rejects relative general.claudeRootPath updates', () => {
    const result = validateConfigUpdatePayload('general', {
      claudeRootPath: '.claude',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('absolute path');
    }
  });

  it('rejects invalid section names', () => {
    const result = validateConfigUpdatePayload('invalid-section', { theme: 'dark' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Section must be one of');
    }
  });

  it('rejects unknown notification keys', () => {
    const result = validateConfigUpdatePayload('notifications', { unknownField: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('not supported');
    }
  });

  it('accepts valid notifications.triggers payload', () => {
    const result = validateConfigUpdatePayload('notifications', {
      triggers: [
        {
          id: 'trigger-1',
          name: 'test',
          enabled: true,
          contentType: 'tool_result',
          mode: 'error_status',
          requireError: true,
        },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects invalid notifications.triggers payload', () => {
    const result = validateConfigUpdatePayload('notifications', {
      triggers: [{ id: 'missing-required-fields' }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('valid trigger');
    }
  });

  it('rejects out-of-range snoozeMinutes', () => {
    const result = validateConfigUpdatePayload('notifications', { snoozeMinutes: 0 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('between 1 and');
    }
  });

  it('accepts valid display updates', () => {
    const result = validateConfigUpdatePayload('display', {
      compactMode: true,
      syntaxHighlighting: false,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.section).toBe('display');
      expect(result.data).toEqual({
        compactMode: true,
        syntaxHighlighting: false,
      });
    }
  });

  describe('subscriptions section', () => {
    const validEntry = {
      id: 'entry-1',
      date: '2026-03-05',
      plan: 'Pro',
      amountUsd: 20,
    };

    it('accepts valid subscriptions update with empty entries', () => {
      const result = validateConfigUpdatePayload('subscriptions', { entries: [] });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.section).toBe('subscriptions');
        expect(result.data).toEqual({ entries: [] });
      }
    });

    it('accepts valid subscriptions update with one entry', () => {
      const result = validateConfigUpdatePayload('subscriptions', { entries: [validEntry] });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.entries).toHaveLength(1);
        expect(result.data.entries?.[0]).toMatchObject(validEntry);
      }
    });

    it('accepts entry with optional note field', () => {
      const entryWithNote = { ...validEntry, note: 'annual plan charge' };
      const result = validateConfigUpdatePayload('subscriptions', { entries: [entryWithNote] });
      expect(result.valid).toBe(true);
    });

    it('accepts multiple entries in the same month', () => {
      const entries = [
        validEntry,
        { id: 'entry-2', date: '2026-03-27', plan: 'Max', amountUsd: 100 },
      ];
      const result = validateConfigUpdatePayload('subscriptions', { entries });
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.data.entries).toHaveLength(2);
      }
    });

    it('rejects subscriptions update that is not an object', () => {
      const result = validateConfigUpdatePayload('subscriptions', 'bad');
      expect(result.valid).toBe(false);
    });

    it('rejects subscriptions update without entries field', () => {
      const result = validateConfigUpdatePayload('subscriptions', { something: [] });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('entries');
      }
    });

    it('rejects entry with missing id', () => {
      const bad = { date: '2026-03-05', plan: 'Pro', amountUsd: 20 };
      const result = validateConfigUpdatePayload('subscriptions', { entries: [bad] });
      expect(result.valid).toBe(false);
    });

    it('rejects entry with invalid date format', () => {
      const bad = { ...validEntry, date: '03-05-2026' };
      const result = validateConfigUpdatePayload('subscriptions', { entries: [bad] });
      expect(result.valid).toBe(false);
    });

    it('rejects entry with zero amount', () => {
      const bad = { ...validEntry, amountUsd: 0 };
      const result = validateConfigUpdatePayload('subscriptions', { entries: [bad] });
      expect(result.valid).toBe(false);
    });

    it('rejects entry with negative amount', () => {
      const bad = { ...validEntry, amountUsd: -5 };
      const result = validateConfigUpdatePayload('subscriptions', { entries: [bad] });
      expect(result.valid).toBe(false);
    });

    it('rejects entry with non-string note', () => {
      const bad = { ...validEntry, note: 123 };
      const result = validateConfigUpdatePayload('subscriptions', { entries: [bad] });
      expect(result.valid).toBe(false);
    });
  });
});
