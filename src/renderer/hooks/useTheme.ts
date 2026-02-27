import { useCallback, useEffect, useState } from 'react';

import { ALL_THEME_CLASSES, getThemeDefinition } from '@renderer/constants/themes';
import { useShallow } from 'zustand/react/shallow';

import { useStore } from '../store';

import type { ThemeName } from '@shared/types/notifications';

type ResolvedTheme = 'dark' | 'light';

const THEME_CACHE_KEY = 'claude-devtools-theme-cache';

/**
 * Hook to manage theme state and application.
 * - Fetches theme preference from config on mount
 * - Listens to system theme changes when set to 'system'
 * - Applies theme class to document root
 * - Caches theme in localStorage for flash prevention
 */
export function useTheme(): {
  theme: ThemeName;
  resolvedTheme: ResolvedTheme;
  isDark: boolean;
  isLight: boolean;
} {
  const { appConfig, fetchConfig } = useStore(
    useShallow((s) => ({
      appConfig: s.appConfig,
      fetchConfig: s.fetchConfig,
    }))
  );
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    // Initialize from cache to prevent flash
    try {
      const cached = localStorage.getItem(THEME_CACHE_KEY);
      if (cached === 'light') return 'light';
    } catch {
      // localStorage may not be available
    }
    return 'dark';
  });

  // Fetch config on mount if not loaded
  useEffect(() => {
    if (!appConfig) {
      void fetchConfig();
    }
  }, [appConfig, fetchConfig]);

  // Get configured theme
  const configuredTheme: ThemeName = appConfig?.general?.theme ?? 'dark';

  // Get system theme preference
  const getSystemTheme = useCallback((): ResolvedTheme => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }, []);

  // Resolve 'system' theme and listen for changes
  useEffect(() => {
    const updateTheme = (): void => {
      const themeDef = getThemeDefinition(configuredTheme);
      let resolved: ResolvedTheme;

      if (configuredTheme === 'system') {
        resolved = getSystemTheme();
      } else {
        resolved = themeDef.isLight ? 'light' : 'dark';
      }

      setResolvedTheme(resolved);

      // Cache for flash prevention
      try {
        localStorage.setItem(THEME_CACHE_KEY, resolved);
      } catch {
        // localStorage may not be available
      }
    };

    updateTheme();

    // Listen to system theme changes when in 'system' mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (): void => {
      if (configuredTheme === 'system') {
        updateTheme();
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [configuredTheme, getSystemTheme]);

  // Apply theme class to document root
  useEffect(() => {
    const root = document.documentElement;

    // Remove all existing theme classes
    root.classList.remove(...ALL_THEME_CLASSES);

    // Determine which class to apply
    if (configuredTheme === 'system') {
      // System mode: resolve to 'dark' or 'light'
      root.classList.add(resolvedTheme);
    } else {
      // Named theme: use its CSS class directly
      const themeDef = getThemeDefinition(configuredTheme);
      if (themeDef.cssClass) {
        root.classList.add(themeDef.cssClass);
      }
    }
  }, [configuredTheme, resolvedTheme]);

  return {
    theme: configuredTheme,
    resolvedTheme,
    isDark: resolvedTheme === 'dark',
    isLight: resolvedTheme === 'light',
  };
}
