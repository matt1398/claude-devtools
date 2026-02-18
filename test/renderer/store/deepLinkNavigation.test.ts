import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installMockElectronAPI } from '../../mocks/electronAPI';
import { createTestStore, type TestStore } from './storeTestUtils';

describe('Deep Link Navigation', () => {
  let store: TestStore;

  beforeEach(() => {
    installMockElectronAPI();
    store = createTestStore();

    let uuidCounter = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `test-uuid-${++uuidCounter}`,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens dashboard tab', () => {
    store.getState().openDashboard();
    expect(store.getState().openTabs).toHaveLength(1);
    expect(store.getState().openTabs[0].type).toBe('dashboard');
  });

  it('opens session tab via navigateToSession', () => {
    store.getState().navigateToSession('-Users-test-project', 'session-123');
    expect(store.getState().openTabs).toHaveLength(1);
    expect(store.getState().openTabs[0].type).toBe('session');
    expect(store.getState().openTabs[0].sessionId).toBe('session-123');
    expect(store.getState().openTabs[0].projectId).toBe('-Users-test-project');
  });

  it('opens settings tab with section', () => {
    store.getState().openSettingsTab('advanced');
    expect(store.getState().openTabs).toHaveLength(1);
    expect(store.getState().openTabs[0].type).toBe('settings');
    expect(store.getState().pendingSettingsSection).toBe('advanced');
  });

  it('opens notifications tab', () => {
    store.getState().openNotificationsTab();
    expect(store.getState().openTabs).toHaveLength(1);
    expect(store.getState().openTabs[0].type).toBe('notifications');
  });

  it('opens command palette with search query', () => {
    store.getState().openCommandPalette('hello world');
    expect(store.getState().commandPaletteOpen).toBe(true);
    expect(store.getState().pendingSearchQuery).toBe('hello world');
  });

  it('opens command palette without query', () => {
    store.getState().openCommandPalette();
    expect(store.getState().commandPaletteOpen).toBe(true);
    expect(store.getState().pendingSearchQuery).toBeNull();
  });

  it('clears pending search query', () => {
    store.getState().openCommandPalette('test');
    expect(store.getState().pendingSearchQuery).toBe('test');
    store.getState().clearPendingSearchQuery();
    expect(store.getState().pendingSearchQuery).toBeNull();
  });
});
