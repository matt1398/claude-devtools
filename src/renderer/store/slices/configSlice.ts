/**
 * Config slice - manages app configuration state and actions.
 */

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { AppConfig } from '@renderer/types/data';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:config');

// =============================================================================
// Slice Interface
// =============================================================================

export interface ConfigSlice {
  // State
  appConfig: AppConfig | null;
  configLoading: boolean;
  configError: string | null;
  pendingSettingsSection: string | null;

  // Actions
  fetchConfig: () => Promise<void>;
  updateConfig: (section: string, data: Record<string, unknown>) => Promise<void>;
  openSettingsTab: (section?: string) => void;
  clearPendingSettingsSection: () => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createConfigSlice: StateCreator<AppState, [], [], ConfigSlice> = (set, get) => ({
  // Initial state
  appConfig: null,
  configLoading: false,
  configError: null,
  pendingSettingsSection: null,

  // Fetch app configuration from main process
  fetchConfig: async () => {
    set({ configLoading: true, configError: null });
    try {
      const config = await api.config.get();
      set({
        appConfig: config,
        configLoading: false,
      });
    } catch (error) {
      set({
        configError: error instanceof Error ? error.message : 'Failed to fetch config',
        configLoading: false,
      });
    }
  },

  // Update a section of the app configuration
  updateConfig: async (section: string, data: Record<string, unknown>) => {
    try {
      await api.config.update(section, data);
      // Refresh config after update
      const config = await api.config.get();
      set({ appConfig: config });
    } catch (error) {
      logger.error('Failed to update config:', error);
      set({
        configError: error instanceof Error ? error.message : 'Failed to update config',
      });
    }
  },

  // Open or focus the settings tab (per-pane singleton)
  openSettingsTab: (section?: string) => {
    const state = get();

    if (section) {
      set({ pendingSettingsSection: section });
    }

    // Check if settings tab exists in focused pane
    const focusedPane = state.paneLayout.panes.find((p) => p.id === state.paneLayout.focusedPaneId);
    const settingsTab = focusedPane?.tabs.find((t) => t.type === 'settings');
    if (settingsTab) {
      state.setActiveTab(settingsTab.id);
      return;
    }

    // Create new settings tab via openTab (which adds to focused pane)
    state.openTab({
      type: 'settings',
      label: 'Settings',
    });
  },

  clearPendingSettingsSection: () => {
    set({ pendingSettingsSection: null });
  },
});
