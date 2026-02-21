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
  RootsConfig,
  SshPersistConfig,
} from '../services';

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
  | ValidationSuccess<'roots'>
  | ValidationFailure;

const VALID_SECTIONS = new Set<ConfigSection>([
  'notifications',
  'general',
  'display',
  'httpServer',
  'ssh',
  'roots',
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
    'combinedSessionsEnabled',
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
      case 'combinedSessionsEnabled':
        if (typeof value !== 'boolean') {
          return { valid: false, error: 'general.combinedSessionsEnabled must be a boolean' };
        }
        result.combinedSessionsEnabled = value;
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
        // Deprecated: roots.activeRootId is the source of truth.
        // Accept for backward compatibility but ignore during update.
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

function isValidRootId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateRootsSection(
  data: unknown,
  fullConfig?: AppConfig
): ValidationSuccess<'roots'> | ValidationFailure {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'roots update must be an object' };
  }

  const allowedKeys: (keyof RootsConfig)[] = ['items', 'activeRootId'];
  const result: Partial<RootsConfig> = {};

  for (const [key, value] of Object.entries(data)) {
    if (!allowedKeys.includes(key as keyof RootsConfig)) {
      return { valid: false, error: `roots.${key} is not a valid setting` };
    }

    switch (key as keyof RootsConfig) {
      case 'activeRootId':
        if (!isValidRootId(value)) {
          return { valid: false, error: 'roots.activeRootId must be a non-empty string' };
        }
        result.activeRootId = value;
        break;
      case 'items': {
        if (!Array.isArray(value)) {
          return { valid: false, error: 'roots.items must be an array' };
        }
        if (value.length === 0) {
          return { valid: false, error: 'roots.items must contain at least one root' };
        }

        result.items = [];
        const profileIds = new Set(fullConfig?.ssh.profiles.map((profile) => profile.id) ?? []);
        const seenRootIds = new Set<string>();

        for (const [index, item] of value.entries()) {
          if (!isPlainObject(item)) {
            return { valid: false, error: `roots.items[${index}] must be an object` };
          }
          if (!isValidRootId(item.id)) {
            return { valid: false, error: `roots.items[${index}].id must be a non-empty string` };
          }
          if (seenRootIds.has(item.id)) {
            return { valid: false, error: `roots.items[${index}].id must be unique` };
          }
          seenRootIds.add(item.id);
          if (!isValidRootId(item.name)) {
            return { valid: false, error: `roots.items[${index}].name must be a non-empty string` };
          }
          if (!isFiniteNumber(item.order) || !Number.isInteger(item.order)) {
            return { valid: false, error: `roots.items[${index}].order must be an integer` };
          }

          if (item.type === 'local') {
            let normalizedPath: string | null = null;
            if (item.claudeRootPath != null) {
              if (typeof item.claudeRootPath !== 'string') {
                return {
                  valid: false,
                  error: `roots.items[${index}].claudeRootPath must be an absolute path or null`,
                };
              }
              const trimmed = item.claudeRootPath.trim();
              if (trimmed.length > 0) {
                const normalized = path.normalize(trimmed);
                if (!path.isAbsolute(normalized)) {
                  return {
                    valid: false,
                    error: `roots.items[${index}].claudeRootPath must be an absolute path`,
                  };
                }
                normalizedPath = path.resolve(normalized);
              }
            }

            result.items.push({
              id: item.id,
              name: item.name.trim(),
              type: 'local',
              claudeRootPath: normalizedPath,
              order: item.order,
            });
            continue;
          }

          if (item.type === 'ssh') {
            if (!isValidRootId(item.sshProfileId)) {
              return {
                valid: false,
                error: `roots.items[${index}].sshProfileId must be a non-empty string`,
              };
            }
            if (fullConfig && !profileIds.has(item.sshProfileId)) {
              return {
                valid: false,
                error: `roots.items[${index}].sshProfileId references a missing SSH profile`,
              };
            }
            if (item.remoteClaudeRootPath != null && typeof item.remoteClaudeRootPath !== 'string') {
              return {
                valid: false,
                error: `roots.items[${index}].remoteClaudeRootPath must be a string or null`,
              };
            }
            result.items.push({
              id: item.id,
              name: item.name.trim(),
              type: 'ssh',
              sshProfileId: item.sshProfileId,
              remoteClaudeRootPath: item.remoteClaudeRootPath?.trim() || null,
              order: item.order,
            });
            continue;
          }

          return {
            valid: false,
            error: `roots.items[${index}].type must be "local" or "ssh"`,
          };
        }
        break;
      }
      default:
        return { valid: false, error: `Unsupported roots key: ${key}` };
    }
  }

  if (
    result.activeRootId &&
    result.items &&
    !result.items.some((root) => root.id === result.activeRootId)
  ) {
    return { valid: false, error: 'roots.activeRootId must reference one of roots.items[].id' };
  }
  if (result.items && !result.items.some((root) => root.type === 'local')) {
    return { valid: false, error: 'roots.items must contain at least one local root' };
  }

  return { valid: true, section: 'roots', data: result };
}

export function validateConfigUpdatePayload(
  section: unknown,
  data: unknown,
  fullConfig?: AppConfig
): ConfigUpdateValidationResult {
  if (typeof section !== 'string' || !VALID_SECTIONS.has(section as ConfigSection)) {
    return {
      valid: false,
      error: 'Section must be one of: notifications, general, display, httpServer, ssh, roots',
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
    case 'roots':
      return validateRootsSection(data, fullConfig);
    default:
      return { valid: false, error: 'Invalid section' };
  }
}
