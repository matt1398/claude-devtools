/**
 * Theme definitions and helpers for multi-theme support.
 */

import type { ThemeName } from '@shared/types/notifications';

export interface ThemeDefinition {
  /** Config value stored in AppConfig */
  value: ThemeName;
  /** Display label in settings UI */
  label: string;
  /** CSS class added to :root */
  cssClass: string;
  /** Whether this is a light theme (for system resolution) */
  isLight: boolean;
  /** Short description */
  description: string;
}

const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    value: 'dark',
    label: 'Dark',
    cssClass: 'dark',
    isLight: false,
    description: 'Default dark theme',
  },
  {
    value: 'light',
    label: 'Light',
    cssClass: 'light',
    isLight: true,
    description: 'Default light theme',
  },
  {
    value: 'system',
    label: 'System',
    cssClass: '', // resolved at runtime
    isLight: false,
    description: 'Follow system preference',
  },
  {
    value: 'monokai',
    label: 'Monokai',
    cssClass: 'monokai',
    isLight: false,
    description: 'Warm dark with vibrant syntax colors',
  },
  {
    value: 'dracula',
    label: 'Dracula',
    cssClass: 'dracula',
    isLight: false,
    description: 'Purple-accented dark theme',
  },
  {
    value: 'solarized-dark',
    label: 'Solarized Dark',
    cssClass: 'solarized-dark',
    isLight: false,
    description: 'Warm dark with teal accents',
  },
  {
    value: 'solarized-light',
    label: 'Solarized Light',
    cssClass: 'solarized-light',
    isLight: true,
    description: 'Warm light with teal accents',
  },
  {
    value: 'nord',
    label: 'Nord',
    cssClass: 'nord',
    isLight: false,
    description: 'Cool blue-gray arctic palette',
  },
  {
    value: 'github-light',
    label: 'GitHub Light',
    cssClass: 'github-light',
    isLight: true,
    description: 'Clean light theme inspired by GitHub',
  },
  {
    value: 'github-dark',
    label: 'GitHub Dark',
    cssClass: 'github-dark',
    isLight: false,
    description: 'Dimmed dark theme inspired by GitHub',
  },
];

/** Options for the settings dropdown */
export const THEME_OPTIONS = THEME_DEFINITIONS.map((t) => ({
  value: t.value,
  label: t.label,
}));

/** All CSS classes that need to be removed before applying a new theme */
export const ALL_THEME_CLASSES = THEME_DEFINITIONS.filter((t) => t.cssClass).map(
  (t) => t.cssClass
);

/** Get the full theme definition for a theme name */
export function getThemeDefinition(name: ThemeName): ThemeDefinition {
  return THEME_DEFINITIONS.find((t) => t.value === name) ?? THEME_DEFINITIONS[0];
}

/** All valid theme name values (for validation) */
export const VALID_THEME_NAMES: readonly ThemeName[] = THEME_DEFINITIONS.map((t) => t.value);
