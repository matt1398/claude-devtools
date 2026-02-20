/**
 * useSettingsConfig - Hook for managing settings configuration state.
 * Handles loading, saving, and providing safe defaults for config.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import type { AppConfig } from '@renderer/types/data';

// Get the setState function from the store to update appConfig globally
const setStoreState = useStore.setState;

/** Repository item for ignored repositories list */
export interface RepositoryDropdownItem {
  id: string;
  name: string;
  path: string;
  worktreeCount: number;
  totalSessions: number;
}

export interface SafeConfig {
  general: {
    launchAtLogin: boolean;
    showDockIcon: boolean;
    theme: 'dark' | 'light' | 'system';
    defaultTab: 'dashboard' | 'last-session';
    claudeRootPath: string | null;
    combinedSessionsEnabled: boolean;
  };
  notifications: {
    enabled: boolean;
    soundEnabled: boolean;
    ignoredRegex: string[];
    ignoredRepositories: string[];
    snoozedUntil: number | null;
    snoozeMinutes: number;
    includeSubagentErrors: boolean;
    triggers: AppConfig['notifications']['triggers'];
  };
  display: {
    showTimestamps: boolean;
    compactMode: boolean;
    syntaxHighlighting: boolean;
  };
}

interface UseSettingsConfigReturn {
  config: AppConfig | null;
  safeConfig: SafeConfig;
  loading: boolean;
  saving: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  setSaving: (saving: boolean) => void;
  setConfig: (config: AppConfig | null) => void;
  setOptimisticConfig: React.Dispatch<React.SetStateAction<AppConfig | null>>;
  updateConfig: (
    section: keyof AppConfig,
    data: Partial<AppConfig[keyof AppConfig]>
  ) => Promise<void>;
  ignoredRepositoryItems: RepositoryDropdownItem[];
  excludedRepositoryIds: string[];
  isSnoozed: boolean;
}

export function useSettingsConfig(): UseSettingsConfigReturn {
  const { repositoryGroups, fetchRepositoryGroups } = useStore(
    useShallow((s) => ({
      repositoryGroups: s.repositoryGroups,
      fetchRepositoryGroups: s.fetchRepositoryGroups,
    }))
  );

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local optimistic state for immediate visual feedback on toggles
  const [optimisticConfig, setOptimisticConfig] = useState<AppConfig | null>(null);

  // Fetch config on mount
  useEffect(() => {
    const loadConfig = async (): Promise<void> => {
      try {
        setLoading(true);
        setError(null);
        const loadedConfig = await api.config.get();
        setConfig(loadedConfig);
        setOptimisticConfig(loadedConfig);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    };

    void loadConfig();
  }, []);

  // Fetch repository groups for ignored repositories dropdown
  useEffect(() => {
    if (repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    }
  }, [repositoryGroups.length, fetchRepositoryGroups]);

  // Update a config section with optimistic update for immediate UI feedback
  const updateConfig = useCallback(
    async (section: keyof AppConfig, data: Partial<AppConfig[keyof AppConfig]>) => {
      // Optimistic update - immediately reflect the change in UI
      setOptimisticConfig((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [section]: {
            ...prev[section],
            ...data,
          },
        };
      });

      try {
        setSaving(true);
        const updatedConfig = await api.config.update(section, data as object);
        setConfig(updatedConfig);
        setOptimisticConfig(updatedConfig);
        // Update global store so other components (like useTheme) see the change
        setStoreState({ appConfig: updatedConfig });
      } catch (err) {
        // Revert optimistic update on error
        setOptimisticConfig(config);
        setError(err instanceof Error ? err.message : 'Failed to save settings');
      } finally {
        setSaving(false);
      }
    },
    [config]
  );

  // Use optimistic config for UI display (falls back to config if not set)
  const displayConfig = optimisticConfig ?? config;

  // Create safe config with defaults to prevent null reference errors
  const safeConfig = useMemo(
    (): SafeConfig => ({
      general: {
        launchAtLogin: displayConfig?.general?.launchAtLogin ?? false,
        showDockIcon: displayConfig?.general?.showDockIcon ?? true,
        theme: displayConfig?.general?.theme ?? 'dark',
        defaultTab: displayConfig?.general?.defaultTab ?? 'dashboard',
        claudeRootPath: displayConfig?.general?.claudeRootPath ?? null,
        combinedSessionsEnabled: displayConfig?.general?.combinedSessionsEnabled ?? false,
      },
      notifications: {
        enabled: displayConfig?.notifications?.enabled ?? true,
        soundEnabled: displayConfig?.notifications?.soundEnabled ?? true,
        ignoredRegex: displayConfig?.notifications?.ignoredRegex ?? [],
        ignoredRepositories: displayConfig?.notifications?.ignoredRepositories ?? [],
        snoozedUntil: displayConfig?.notifications?.snoozedUntil ?? null,
        snoozeMinutes: displayConfig?.notifications?.snoozeMinutes ?? 30,
        includeSubagentErrors: displayConfig?.notifications?.includeSubagentErrors ?? true,
        triggers: displayConfig?.notifications?.triggers ?? [],
      },
      display: {
        showTimestamps: displayConfig?.display?.showTimestamps ?? true,
        compactMode: displayConfig?.display?.compactMode ?? false,
        syntaxHighlighting: displayConfig?.display?.syntaxHighlighting ?? true,
      },
    }),
    [displayConfig]
  );

  // Convert ignored repository IDs to RepositoryDropdownItem[] for display
  const ignoredRepositoryItems = useMemo((): RepositoryDropdownItem[] => {
    const items: RepositoryDropdownItem[] = [];
    const ignoredRepositories = safeConfig.notifications.ignoredRepositories;

    for (const repositoryId of ignoredRepositories) {
      // Find repository group by ID
      const group = repositoryGroups.find((g) => g.id === repositoryId);
      if (group) {
        items.push({
          id: group.id,
          name: group.name,
          path: group.worktrees[0]?.path ?? '',
          worktreeCount: group.worktrees.length,
          totalSessions: group.totalSessions,
        });
      } else {
        // If not found, create a placeholder item
        items.push({
          id: repositoryId,
          name: repositoryId,
          path: '',
          worktreeCount: 0,
          totalSessions: 0,
        });
      }
    }

    return items;
  }, [safeConfig.notifications.ignoredRepositories, repositoryGroups]);

  // Get excluded repository IDs for dropdown
  const excludedRepositoryIds = safeConfig.notifications.ignoredRepositories;

  // Check if snoozed
  const isSnoozed =
    safeConfig.notifications.snoozedUntil !== null &&
    safeConfig.notifications.snoozedUntil > Date.now();

  return {
    config,
    safeConfig,
    loading,
    saving,
    error,
    setError,
    setSaving,
    setConfig,
    setOptimisticConfig,
    updateConfig,
    ignoredRepositoryItems,
    excludedRepositoryIds,
    isSnoozed,
  };
}
