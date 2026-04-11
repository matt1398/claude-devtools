/**
 * Runtime validation for config:update IPC payloads.
 * Prevents invalid/unknown data from mutating persisted config.
 */

import * as path from 'path';

import type {
  AppConfig,
  DisplayConfig,
  GeneralConfig,
  HttpServerConfig,
  NotificationConfig,
  NotificationTrigger,
  SessionsConfig,
  SshPersistConfig,
} from '../services';
import type { LogicalProject } from '@shared/types/notifications';

type ConfigSection = keyof AppConfig;

interface ValidationSuccess<K extends ConfigSection> {
  valid: true;
  section: K;
  data: Partial<AppConfig[K]>;
}

interface ValidationFailure {
  valid: false;
  error: string;
}

export type ConfigUpdateValidationResult =
  | ValidationSuccess<'notifications'>
  | ValidationSuccess<'general'>
  | ValidationSuccess<'display'>
  | ValidationSuccess<'httpServer'>
  | ValidationSuccess<'ssh'>
  | ValidationSuccess<'sessions'>
  | ValidationFailure;

const VALID_SECTIONS = new Set<ConfigSection>([
  'notifications',
  'general',
  'display',
  'httpServer',
  'ssh',
  'sessions',
]);
const MAX_SNOOZE_MINUTES = 24 * 60;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidTrigger(trigger: unknown): trigger is NotificationTrigger {
  if (!isPlainObject(trigger)) {
    return false;
  }

  if (typeof trigger.id !== 'string' || trigger.id.trim().length === 0) {
    return false;
  }

  if (typeof trigger.name !== 'string' || trigger.name.trim().length === 0) {
    return false;
  }

  if (typeof trigger.enabled !== 'boolean') {
    return false;
  }

  if (
    trigger.contentType !== 'tool_result' &&
    trigger.contentType !== 'tool_use' &&
    trigger.contentType !== 'thinking' &&
    trigger.contentType !== 'text'
  ) {
    return false;
  }

  if (
    trigger.mode !== 'error_status' &&
    trigger.mode !== 'content_match' &&
    trigger.mode !== 'token_threshold'
  ) {
    return false;
  }

  return true;
}

function validateNotificationsSection(
  data: unknown
): ValidationSuccess<'notifications'> | ValidationFailure {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'notifications update must be an object' };
  }

  const allowedKeys: (keyof NotificationConfig)[] = [
    'enabled',
    'soundEnabled',
    'includeSubagentErrors',
    'ignoredRegex',
    'ignoredRepositories',
    'snoozedUntil',
    'snoozeMinutes',
    'triggers',
  ];

  const result: Partial<NotificationConfig> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowedKeys.includes(key as keyof NotificationConfig)) {
      return {
        valid: false,
        error: `notifications.${key} is not supported via config:update`,
      };
    }

    switch (key as keyof NotificationConfig) {
      case 'enabled':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `notifications.${key} must be a boolean` };
        }
        result.enabled = value;
        break;
      case 'soundEnabled':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `notifications.${key} must be a boolean` };
        }
        result.soundEnabled = value;
        break;
      case 'includeSubagentErrors':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `notifications.${key} must be a boolean` };
        }
        result.includeSubagentErrors = value;
        break;
      case 'ignoredRegex':
        if (!isStringArray(value)) {
          return { valid: false, error: `notifications.${key} must be a string[]` };
        }
        result.ignoredRegex = value;
        break;
      case 'ignoredRepositories':
        if (!isStringArray(value)) {
          return { valid: false, error: `notifications.${key} must be a string[]` };
        }
        result.ignoredRepositories = value;
        break;
      case 'snoozedUntil':
        if (value !== null && !isFiniteNumber(value)) {
          return { valid: false, error: 'notifications.snoozedUntil must be a number or null' };
        }
        if (typeof value === 'number' && value < 0) {
          return { valid: false, error: 'notifications.snoozedUntil must be >= 0' };
        }
        result.snoozedUntil = value;
        break;
      case 'snoozeMinutes':
        if (!isFiniteNumber(value) || !Number.isInteger(value)) {
          return { valid: false, error: 'notifications.snoozeMinutes must be an integer' };
        }
        if (value <= 0 || value > MAX_SNOOZE_MINUTES) {
          return {
            valid: false,
            error: `notifications.snoozeMinutes must be between 1 and ${MAX_SNOOZE_MINUTES}`,
          };
        }
        result.snoozeMinutes = value;
        break;
      case 'triggers':
        if (!Array.isArray(value) || !value.every((trigger) => isValidTrigger(trigger))) {
          return { valid: false, error: 'notifications.triggers must be a valid trigger[]' };
        }
        result.triggers = value;
        break;
      default:
        return { valid: false, error: `Unsupported notifications key: ${key}` };
    }
  }

  return {
    valid: true,
    section: 'notifications',
    data: result,
  };
}

function validateGeneralSection(data: unknown): ValidationSuccess<'general'> | ValidationFailure {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'general update must be an object' };
  }

  const allowedKeys: (keyof GeneralConfig)[] = [
    'launchAtLogin',
    'showDockIcon',
    'theme',
    'defaultTab',
    'claudeRootPath',
    'autoExpandAIGroups',
    'useNativeTitleBar',
  ];

  const result: Partial<GeneralConfig> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowedKeys.includes(key as keyof GeneralConfig)) {
      return { valid: false, error: `general.${key} is not a valid setting` };
    }

    switch (key as keyof GeneralConfig) {
      case 'launchAtLogin':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `general.${key} must be a boolean` };
        }
        result.launchAtLogin = value;
        break;
      case 'showDockIcon':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `general.${key} must be a boolean` };
        }
        result.showDockIcon = value;
        break;
      case 'theme':
        if (value !== 'dark' && value !== 'light' && value !== 'system') {
          return { valid: false, error: 'general.theme must be one of: dark, light, system' };
        }
        result.theme = value;
        break;
      case 'defaultTab':
        if (value !== 'dashboard' && value !== 'last-session') {
          return {
            valid: false,
            error: 'general.defaultTab must be one of: dashboard, last-session',
          };
        }
        result.defaultTab = value;
        break;
      case 'claudeRootPath':
        if (value === null) {
          result.claudeRootPath = null;
          break;
        }
        if (typeof value !== 'string') {
          return {
            valid: false,
            error: 'general.claudeRootPath must be an absolute path string or null',
          };
        }
        {
          const trimmed = value.trim();
          if (!trimmed) {
            result.claudeRootPath = null;
            break;
          }
          const normalized = path.normalize(trimmed);
          if (!path.isAbsolute(normalized)) {
            return {
              valid: false,
              error: 'general.claudeRootPath must be an absolute path',
            };
          }
          result.claudeRootPath = path.resolve(normalized);
        }
        break;
      case 'autoExpandAIGroups':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `general.${key} must be a boolean` };
        }
        result.autoExpandAIGroups = value;
        break;
      case 'useNativeTitleBar':
        if (typeof value !== 'boolean') {
          return { valid: false, error: `general.${key} must be a boolean` };
        }
        result.useNativeTitleBar = value;
        break;
      default:
        return { valid: false, error: `Unsupported general key: ${key}` };
    }
  }

  return {
    valid: true,
    section: 'general',
    data: result,
  };
}

function validateDisplaySection(data: unknown): ValidationSuccess<'display'> | ValidationFailure {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'display update must be an object' };
  }

  const allowedKeys: (keyof DisplayConfig)[] = [
    'showTimestamps',
    'compactMode',
    'syntaxHighlighting',
  ];

  const result: Partial<DisplayConfig> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowedKeys.includes(key as keyof DisplayConfig)) {
      return { valid: false, error: `display.${key} is not a valid setting` };
    }

    if (typeof value !== 'boolean') {
      return { valid: false, error: `display.${key} must be a boolean` };
    }

    result[key as keyof DisplayConfig] = value;
  }

  return {
    valid: true,
    section: 'display',
    data: result,
  };
}

function validateHttpServerSection(
  data: unknown
): ValidationSuccess<'httpServer'> | ValidationFailure {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'httpServer update must be an object' };
  }

  const allowedKeys: (keyof HttpServerConfig)[] = ['enabled', 'port'];
  const result: Partial<HttpServerConfig> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowedKeys.includes(key as keyof HttpServerConfig)) {
      return { valid: false, error: `httpServer.${key} is not a valid setting` };
    }

    switch (key as keyof HttpServerConfig) {
      case 'enabled':
        if (typeof value !== 'boolean') {
          return { valid: false, error: 'httpServer.enabled must be a boolean' };
        }
        result.enabled = value;
        break;
      case 'port':
        if (!isFiniteNumber(value) || !Number.isInteger(value) || value < 1024 || value > 65535) {
          return {
            valid: false,
            error: 'httpServer.port must be an integer between 1024 and 65535',
          };
        }
        result.port = value;
        break;
      default:
        return { valid: false, error: `Unsupported httpServer key: ${key}` };
    }
  }

  return {
    valid: true,
    section: 'httpServer',
    data: result,
  };
}

function isValidSshProfile(profile: unknown): boolean {
  if (!isPlainObject(profile)) return false;
  if (typeof profile.id !== 'string' || profile.id.trim().length === 0) return false;
  if (typeof profile.name !== 'string') return false;
  if (typeof profile.host !== 'string') return false;
  if (typeof profile.port !== 'number') return false;
  if (typeof profile.username !== 'string') return false;
  const validMethods = ['password', 'privateKey', 'agent', 'auto'];
  if (!validMethods.includes(profile.authMethod as string)) return false;
  return true;
}

function validateSshSection(data: unknown): ValidationSuccess<'ssh'> | ValidationFailure {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'ssh update must be an object' };
  }

  const allowedKeys: (keyof SshPersistConfig)[] = [
    'lastConnection',
    'autoReconnect',
    'profiles',
    'lastActiveContextId',
  ];

  const result: Partial<SshPersistConfig> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowedKeys.includes(key as keyof SshPersistConfig)) {
      return { valid: false, error: `ssh.${key} is not a valid setting` };
    }

    switch (key as keyof SshPersistConfig) {
      case 'autoReconnect':
        if (typeof value !== 'boolean') {
          return { valid: false, error: 'ssh.autoReconnect must be a boolean' };
        }
        result.autoReconnect = value;
        break;
      case 'lastActiveContextId':
        if (typeof value !== 'string') {
          return { valid: false, error: 'ssh.lastActiveContextId must be a string' };
        }
        result.lastActiveContextId = value;
        break;
      case 'lastConnection':
        if (value !== null && !isPlainObject(value)) {
          return { valid: false, error: 'ssh.lastConnection must be an object or null' };
        }
        result.lastConnection = value as SshPersistConfig['lastConnection'];
        break;
      case 'profiles':
        if (!Array.isArray(value) || !value.every(isValidSshProfile)) {
          return { valid: false, error: 'ssh.profiles must be a valid profile array' };
        }
        result.profiles = value as SshPersistConfig['profiles'];
        break;
      default:
        return { valid: false, error: `Unsupported ssh key: ${key}` };
    }
  }

  return { valid: true, section: 'ssh', data: result };
}

function isValidLogicalProject(value: unknown): value is LogicalProject {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== 'string' || !value.id) return false;
  if (typeof value.name !== 'string' || !value.name) return false;
  if (typeof value.color !== 'string' || !value.color) return false;
  if (!isFiniteNumber(value.order)) return false;
  if (!isFiniteNumber(value.createdAt)) return false;
  if (value.icon !== undefined && typeof value.icon !== 'string') return false;
  return true;
}

function isStringToStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((v) => typeof v === 'string');
}

function isLogicalProjectRecord(value: unknown): value is Record<string, LogicalProject> {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(isValidLogicalProject);
}

function isPinnedEntryArrayRecord(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (arr) =>
      Array.isArray(arr) &&
      arr.every(
        (entry) =>
          isPlainObject(entry) &&
          typeof entry.sessionId === 'string' &&
          isFiniteNumber(entry.pinnedAt)
      )
  );
}

function isHiddenEntryArrayRecord(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every(
    (arr) =>
      Array.isArray(arr) &&
      arr.every(
        (entry) =>
          isPlainObject(entry) &&
          typeof entry.sessionId === 'string' &&
          isFiniteNumber(entry.hiddenAt)
      )
  );
}

function validateSessionsSection(
  data: unknown
): ValidationSuccess<'sessions'> | ValidationFailure {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'sessions update must be an object' };
  }

  const allowedKeys: (keyof SessionsConfig)[] = [
    'pinnedSessions',
    'hiddenSessions',
    'filterActiveOnly',
    'logicalProjects',
    'sessionProjectMap',
    'cwdProjectMap',
    'sidebarGroupBy',
  ];

  const result: Partial<SessionsConfig> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowedKeys.includes(key as keyof SessionsConfig)) {
      return { valid: false, error: `sessions.${key} is not a valid setting` };
    }

    switch (key as keyof SessionsConfig) {
      case 'pinnedSessions':
        if (!isPinnedEntryArrayRecord(value)) {
          return { valid: false, error: 'sessions.pinnedSessions has invalid shape' };
        }
        result.pinnedSessions = value as SessionsConfig['pinnedSessions'];
        break;
      case 'hiddenSessions':
        if (!isHiddenEntryArrayRecord(value)) {
          return { valid: false, error: 'sessions.hiddenSessions has invalid shape' };
        }
        result.hiddenSessions = value as SessionsConfig['hiddenSessions'];
        break;
      case 'filterActiveOnly':
        if (typeof value !== 'boolean') {
          return { valid: false, error: 'sessions.filterActiveOnly must be a boolean' };
        }
        result.filterActiveOnly = value;
        break;
      case 'logicalProjects':
        if (!isLogicalProjectRecord(value)) {
          return { valid: false, error: 'sessions.logicalProjects has invalid shape' };
        }
        result.logicalProjects = value;
        break;
      case 'sessionProjectMap':
        if (!isStringToStringRecord(value)) {
          return { valid: false, error: 'sessions.sessionProjectMap must be Record<string,string>' };
        }
        result.sessionProjectMap = value;
        break;
      case 'cwdProjectMap':
        if (!isStringToStringRecord(value)) {
          return { valid: false, error: 'sessions.cwdProjectMap must be Record<string,string>' };
        }
        result.cwdProjectMap = value;
        break;
      case 'sidebarGroupBy':
        if (value !== 'date' && value !== 'logical-project') {
          return {
            valid: false,
            error: "sessions.sidebarGroupBy must be 'date' or 'logical-project'",
          };
        }
        result.sidebarGroupBy = value;
        break;
      default:
        return { valid: false, error: `Unsupported sessions key: ${key}` };
    }
  }

  return { valid: true, section: 'sessions', data: result };
}

export function validateConfigUpdatePayload(
  section: unknown,
  data: unknown
): ConfigUpdateValidationResult {
  if (typeof section !== 'string' || !VALID_SECTIONS.has(section as ConfigSection)) {
    return {
      valid: false,
      error: 'Section must be one of: notifications, general, display, httpServer, ssh, sessions',
    };
  }

  switch (section as ConfigSection) {
    case 'notifications':
      return validateNotificationsSection(data);
    case 'general':
      return validateGeneralSection(data);
    case 'display':
      return validateDisplaySection(data);
    case 'httpServer':
      return validateHttpServerSection(data);
    case 'ssh':
      return validateSshSection(data);
    case 'sessions':
      return validateSessionsSection(data);
    default:
      return { valid: false, error: 'Invalid section' };
  }
}
