import { describe, expect, it } from 'vitest';

import { getModelColorClass, parseModelString } from '../../../src/shared/utils/modelParser';

describe('modelParser', () => {
  describe('parseModelString', () => {
    it('should return null for empty string', () => {
      expect(parseModelString('')).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(parseModelString(undefined)).toBeNull();
    });

    it('should return null for synthetic model', () => {
      expect(parseModelString('<synthetic>')).toBeNull();
    });

    it('should return null for an unsupported model', () => {
      expect(parseModelString('unsupported-model')).toBeNull();
    });

    it('should parse MiniMax-M3', () => {
      expect(parseModelString('MiniMax-M3')).toEqual({
        name: 'MiniMax-M3',
        family: 'minimax',
        majorVersion: 3,
        minorVersion: null,
      });
    });

    it('should parse MiniMax-M2.7', () => {
      expect(parseModelString('MiniMax-M2.7')).toEqual({
        name: 'MiniMax-M2.7',
        family: 'minimax',
        majorVersion: 2,
        minorVersion: 7,
      });
    });

    // New format tests: claude-{family}-{major}-{minor}-{date}
    it('should parse new format: claude-sonnet-4-5-20250929', () => {
      const result = parseModelString('claude-sonnet-4-5-20250929');
      expect(result).toEqual({
        name: 'sonnet4.5',
        family: 'sonnet',
        majorVersion: 4,
        minorVersion: 5,
      });
    });

    it('should parse new format without minor version', () => {
      const result = parseModelString('claude-opus-5-20260101');
      expect(result).toEqual({
        name: 'opus5',
        family: 'opus',
        majorVersion: 5,
        minorVersion: null,
      });
    });

    it('should parse new format without date: claude-opus-4-6', () => {
      const result = parseModelString('claude-opus-4-6');
      expect(result).toEqual({
        name: 'opus4.6',
        family: 'opus',
        majorVersion: 4,
        minorVersion: 6,
      });
    });

    it('should parse new format: claude-haiku-3-20240307', () => {
      const result = parseModelString('claude-haiku-3-20240307');
      expect(result).toEqual({
        name: 'haiku3',
        family: 'haiku',
        majorVersion: 3,
        minorVersion: null,
      });
    });

    // Old format tests: claude-{major}[-{minor}]-{family}-{date}
    it('should parse old format: claude-3-opus-20240229', () => {
      const result = parseModelString('claude-3-opus-20240229');
      expect(result).toEqual({
        name: 'opus3',
        family: 'opus',
        majorVersion: 3,
        minorVersion: null,
      });
    });

    it('should parse old format with minor: claude-3-5-sonnet-20241022', () => {
      const result = parseModelString('claude-3-5-sonnet-20241022');
      expect(result).toEqual({
        name: 'sonnet3.5',
        family: 'sonnet',
        majorVersion: 3,
        minorVersion: 5,
      });
    });

    it('should handle case insensitivity', () => {
      const result = parseModelString('CLAUDE-SONNET-4-5-20250929');
      expect(result).toEqual({
        name: 'sonnet4.5',
        family: 'sonnet',
        majorVersion: 4,
        minorVersion: 5,
      });
    });

    it('should handle whitespace', () => {
      const result = parseModelString('  claude-sonnet-4-5-20250929  ');
      expect(result).toEqual({
        name: 'sonnet4.5',
        family: 'sonnet',
        majorVersion: 4,
        minorVersion: 5,
      });
    });

    it('should return null for invalid format with only two parts', () => {
      expect(parseModelString('claude-sonnet')).toBeNull();
    });

    it('should handle unknown model families', () => {
      const result = parseModelString('claude-newmodel-4-5-20250929');
      expect(result).toEqual({
        name: 'newmodel4.5',
        family: 'newmodel',
        majorVersion: 4,
        minorVersion: 5,
      });
    });
  });

  describe('getModelColorClass', () => {
    it('should return color for opus', () => {
      expect(getModelColorClass('opus')).toBe('text-zinc-400');
    });

    it('should return color for sonnet', () => {
      expect(getModelColorClass('sonnet')).toBe('text-zinc-400');
    });

    it('should return color for haiku', () => {
      expect(getModelColorClass('haiku')).toBe('text-zinc-400');
    });

    it('should return default color for unknown family', () => {
      expect(getModelColorClass('unknown')).toBe('text-zinc-500');
    });

    it('should return default color for arbitrary string', () => {
      expect(getModelColorClass('newmodel')).toBe('text-zinc-500');
    });
  });
});
