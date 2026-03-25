import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateUUID } from '../../../src/renderer/utils/stringUtils';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateUUID', () => {
  it('delegates to crypto.randomUUID when available', () => {
    const KNOWN_UUID = '12345678-1234-4234-8234-123456789abc';
    const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue(KNOWN_UUID);
    const result = generateUUID();
    expect(spy).toHaveBeenCalled();
    expect(result).toBe(KNOWN_UUID);
    expect(result).toMatch(UUID_V4_PATTERN);
    spy.mockRestore();
  });

  describe('getRandomValues fallback (non-secure context)', () => {
    const originalRandomUUID = crypto.randomUUID;

    // Deterministic 16-byte input: all 0xff so we can predict the masked output
    const FIXED_BYTES = new Uint8Array(16).fill(0xff);

    beforeEach(() => {
      // Simulate non-secure context: randomUUID is unavailable
      // @ts-expect-error — intentionally removing a required property for test
      crypto.randomUUID = undefined;

      vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
        (array as Uint8Array).set(FIXED_BYTES);
        return array as Uint8Array;
      });
    });

    afterEach(() => {
      crypto.randomUUID = originalRandomUUID;
      vi.restoreAllMocks();
    });

    it('returns a valid UUID v4 string', () => {
      expect(generateUUID()).toMatch(UUID_V4_PATTERN);
    });

    it('sets version nibble (13th hex char) to "4"', () => {
      const uuid = generateUUID();
      // xxxxxxxx-xxxx-[4]xxx-xxxx-xxxxxxxxxxxx
      expect(uuid[14]).toBe('4');
    });

    it('sets variant bits (17th hex char) to 8, 9, a, or b', () => {
      const uuid = generateUUID();
      // xxxxxxxx-xxxx-xxxx-[v]xxx-xxxxxxxxxxxx
      expect(['8', '9', 'a', 'b']).toContain(uuid[19]);
    });

    it('applies version and variant masks correctly to 0xff input', () => {
      const uuid = generateUUID();
      // byte[6] = 0xff & 0x0f | 0x40 = 0x4f → '4f'
      // byte[8] = 0xff & 0x3f | 0x80 = 0xbf → 'bf'
      expect(uuid).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    });
  });
});
