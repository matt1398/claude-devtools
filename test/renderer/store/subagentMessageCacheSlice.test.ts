/**
 * Tests for subagentMessageCacheSlice.
 *
 * Covers:
 *   - First load fetches via IPC and caches the result
 *   - Second call hits the cache (no extra IPC)
 *   - Concurrent loads of the same id share one in-flight Promise
 *   - LRU eviction at 10 entries
 *   - Errors are surfaced via subagentMessageErrors
 *   - clearSubagentMessageCache wipes everything
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI, type MockElectronAPI } from '../../mocks/electronAPI';

import { createTestStore, type TestStore } from './storeTestUtils';

import type { ParsedMessage } from '../../../src/renderer/types/data';

function fakeMessages(label: string): ParsedMessage[] {
  return [
    {
      uuid: `uuid-${label}`,
      parentUuid: null,
      type: 'assistant',
      timestamp: new Date(),
      content: '',
      isSidechain: true,
      isMeta: false,
      toolCalls: [],
      toolResults: [],
    },
  ];
}

describe('subagentMessageCacheSlice', () => {
  let store: TestStore;
  let mockAPI: MockElectronAPI;

  beforeEach(() => {
    mockAPI = installMockElectronAPI();
    store = createTestStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with empty cache state', () => {
    const state = store.getState();
    expect(state.subagentMessageCache.size).toBe(0);
    expect(state.loadingSubagentIds.size).toBe(0);
    expect(state.subagentMessageErrors.size).toBe(0);
  });

  it('fetches on first call and caches the result', async () => {
    mockAPI.getSubagentMessages.mockResolvedValue(fakeMessages('a1'));
    const messages = await store.getState().loadSubagentMessages('p1', 's1', 'a1');

    expect(messages).toHaveLength(1);
    expect(mockAPI.getSubagentMessages).toHaveBeenCalledTimes(1);
    expect(mockAPI.getSubagentMessages).toHaveBeenCalledWith('p1', 's1', 'a1');

    const cached = store.getState().getCachedSubagentMessages('a1');
    expect(cached).not.toBeNull();
    expect(cached).toHaveLength(1);
  });

  it('returns the cached value on second call without re-invoking IPC', async () => {
    mockAPI.getSubagentMessages.mockResolvedValue(fakeMessages('a1'));
    await store.getState().loadSubagentMessages('p1', 's1', 'a1');
    await store.getState().loadSubagentMessages('p1', 's1', 'a1');

    expect(mockAPI.getSubagentMessages).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent loads of the same id into one IPC', async () => {
    let resolveFn: ((value: ParsedMessage[]) => void) | null = null;
    mockAPI.getSubagentMessages.mockImplementation(
      () =>
        new Promise<ParsedMessage[]>((resolve) => {
          resolveFn = resolve;
        })
    );

    const p1 = store.getState().loadSubagentMessages('p1', 's1', 'a1');
    const p2 = store.getState().loadSubagentMessages('p1', 's1', 'a1');
    const p3 = store.getState().loadSubagentMessages('p1', 's1', 'a1');

    expect(mockAPI.getSubagentMessages).toHaveBeenCalledTimes(1);
    expect(store.getState().loadingSubagentIds.has('a1')).toBe(true);

    resolveFn!(fakeMessages('a1'));
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
    expect(store.getState().loadingSubagentIds.has('a1')).toBe(false);
  });

  it('records the error when the IPC rejects, and surfaces it via subagentMessageErrors', async () => {
    mockAPI.getSubagentMessages.mockRejectedValue(new Error('boom'));
    const result = await store.getState().loadSubagentMessages('p1', 's1', 'broken');

    expect(result).toEqual([]);
    expect(store.getState().subagentMessageErrors.get('broken')).toBe('boom');
    expect(store.getState().loadingSubagentIds.has('broken')).toBe(false);
    expect(store.getState().subagentMessageCache.has('broken')).toBe(false);
  });

  it('evicts the oldest entry when the cache exceeds 10 entries', async () => {
    // Load 11 distinct subagents in order. The first one should fall out.
    for (let i = 0; i < 11; i++) {
      mockAPI.getSubagentMessages.mockResolvedValueOnce(fakeMessages(`a${i}`));
      await store.getState().loadSubagentMessages('p1', 's1', `a${i}`);
    }

    expect(store.getState().subagentMessageCache.size).toBe(10);
    expect(store.getState().subagentMessageCache.has('a0')).toBe(false);
    expect(store.getState().subagentMessageCache.has('a10')).toBe(true);
  });

  it('clearSubagentMessageCache wipes everything', async () => {
    mockAPI.getSubagentMessages.mockResolvedValue(fakeMessages('a1'));
    await store.getState().loadSubagentMessages('p1', 's1', 'a1');
    store.getState().clearSubagentMessageCache();
    expect(store.getState().subagentMessageCache.size).toBe(0);
    expect(store.getState().loadingSubagentIds.size).toBe(0);
    expect(store.getState().subagentMessageErrors.size).toBe(0);
  });
});
