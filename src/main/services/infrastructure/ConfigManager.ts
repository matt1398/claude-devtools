/**
 * ConfigManager service - Manages app configuration stored at ~/.claude/claude-devtools-config.json.
 *
 * Responsibilities:
 * - Load configuration from disk on initialization
 * - Provide default values for all configuration fields
 * - Save configuration changes to disk
 * - Manage notification settings (ignore patterns, projects, snooze)
 * - Handle JSON parse errors gracefully
 */

import { setClaudeBasePathOverride } from '@main/utils/pathDecoder';
import { validateRegexPattern } from '@main/utils/regexValidation';
import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DEFAULT_TRIGGERS, TriggerManager } from './TriggerManager';

import type { TriggerColor } from '@shared/constants/triggerColors';
import type { SshConnectionProfile } from '@shared/types/api';

const logger = createLogger('Service:ConfigManager');

const CONFIG_DIR = path.join(os.homedir(), '.claude');
const CONFIG_FILENAME = 'claude-devtools-config.json';
const DEFAULT_CONFIG_PATH = path.join(CONFIG_DIR, CONFIG_FILENAME);

// ===========================================================================
// Types
// ===========================================================================

export interface NotificationConfig {
  enabled: boolean;
  soundEnabled: boolean;
  ignoredRegex: string[];
  ignoredRepositories: string[]; // Repository group IDs to ignore
  snoozedUntil: number | null; // Unix timestamp (ms) when snooze ends
  snoozeMinutes: number; // Default snooze duration
  /** Whether to include errors from subagent sessions */
  includeSubagentErrors: boolean;
  /** Notification triggers - define when to generate notifications */
  triggers: NotificationTrigger[];
}

/**
 * Content types that can trigger notifications.
 */
export type TriggerContentType = 'tool_result' | 'tool_use' | 'thinking' | 'text';

/**
 * Known tool names that can be filtered for tool_use triggers.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used for type derivation only
const KNOWN_TOOL_NAMES = [
  'Bash',
  'Task',
  'TodoWrite',
  'Read',
  'Write',
  'Edit',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'LSP',
  'Skill',
  'NotebookEdit',
  'AskUserQuestion',
  'KillShell',
  'TaskOutput',
] as const;

/**
 * Tool names that can be filtered for tool_use triggers.
 * Accepts known tool names or any custom tool name.
 */
export type TriggerToolName = (typeof KNOWN_TOOL_NAMES)[number] | (string & Record<never, never>);

/**
 * Match fields available for different content types and tools.
 */
export type MatchFieldForToolResult = 'content';
export type MatchFieldForBash = 'command' | 'description';
export type MatchFieldForTask = 'description' | 'prompt' | 'subagent_type';
export type MatchFieldForRead = 'file_path';
export type MatchFieldForWrite = 'file_path' | 'content';
export type MatchFieldForEdit = 'file_path' | 'old_string' | 'new_string';
export type MatchFieldForGlob = 'pattern' | 'path';
export type MatchFieldForGrep = 'pattern' | 'path' | 'glob';
export type MatchFieldForWebFetch = 'url' | 'prompt';
export type MatchFieldForWebSearch = 'query';
export type MatchFieldForSkill = 'skill' | 'args';
export type MatchFieldForThinking = 'thinking';
export type MatchFieldForText = 'text';

/**
 * Combined type for all possible match fields.
 */
export type TriggerMatchField =
  | MatchFieldForToolResult
  | MatchFieldForBash
  | MatchFieldForTask
  | MatchFieldForRead
  | MatchFieldForWrite
  | MatchFieldForEdit
  | MatchFieldForGlob
  | MatchFieldForGrep
  | MatchFieldForWebFetch
  | MatchFieldForWebSearch
  | MatchFieldForSkill
  | MatchFieldForThinking
  | MatchFieldForText;

/**
 * Trigger mode determines how the trigger evaluates conditions.
 * - 'error_status': Triggers when is_error is true (simple boolean check)
 * - 'content_match': Triggers when content matches a regex pattern
 * - 'token_threshold': Triggers when token count exceeds threshold
 */
export type TriggerMode = 'error_status' | 'content_match' | 'token_threshold';

/**
 * Token type for threshold triggers.
 */
export type TriggerTokenType = 'input' | 'output' | 'total';

/**
 * Notification trigger configuration.
 * Defines when notifications should be generated.
 */
export interface NotificationTrigger {
  /** Unique identifier for this trigger */
  id: string;
  /** Human-readable name for this trigger */
  name: string;
  /** Whether this trigger is enabled */
  enabled: boolean;
  /** Content type to match */
  contentType: TriggerContentType;
  /** For tool_use/tool_result: specific tool name to match */
  toolName?: TriggerToolName;
  /** Whether this is a built-in trigger (cannot be deleted) */
  isBuiltin?: boolean;
  /** Regex patterns to IGNORE (skip notification if content matches any of these) */
  ignorePatterns?: string[];

  // === Discriminated Union Mode ===
  /** Trigger evaluation mode */
  mode: TriggerMode;

  // === Mode: error_status ===
  /** For error_status mode: always triggers on is_error=true */
  requireError?: boolean;

  // === Mode: content_match ===
  /** For content_match mode: field to match against */
  matchField?: TriggerMatchField;
  /** For content_match mode: regex pattern to match */
  matchPattern?: string;

  // === Mode: token_threshold ===
  /** For token_threshold mode: minimum token count to trigger */
  tokenThreshold?: number;
  /** For token_threshold mode: which token type to check */
  tokenType?: TriggerTokenType;

  // === Repository Scope ===
  /** If set, this trigger only applies to these repository group IDs */
  repositoryIds?: string[];

  // === Display ===
  /** Color for notification dot and navigation highlight (preset key or hex string) */
  color?: TriggerColor;
}

export interface GeneralConfig {
  launchAtLogin: boolean;
  showDockIcon: boolean;
  theme: 'dark' | 'light' | 'system';
  defaultTab: 'dashboard' | 'last-session';
  claudeRootPath: string | null;
}

export interface DisplayConfig {
  showTimestamps: boolean;
  compactMode: boolean;
  syntaxHighlighting: boolean;
}

export interface SessionsConfig {
  pinnedSessions: Record<string, { sessionId: string; pinnedAt: number }[]>;
  hiddenSessions: Record<string, { sessionId: string; hiddenAt: number }[]>;
}

export interface SshPersistConfig {
  lastConnection: {
    host: string;
    port: number;
    username: string;
    authMethod: 'password' | 'privateKey' | 'agent' | 'auto';
    privateKeyPath?: string;
  } | null;
  autoReconnect: boolean;
  profiles: SshConnectionProfile[];
  lastActiveContextId: string;
}

export interface HttpServerConfig {
  enabled: boolean;
  port: number;
}

export interface AppConfig {
  notifications: NotificationConfig;
  general: GeneralConfig;
  display: DisplayConfig;
  sessions: SessionsConfig;
  ssh: SshPersistConfig;
  httpServer: HttpServerConfig;
}

// Config section keys for type-safe updates
export type ConfigSection = keyof AppConfig;

// ===========================================================================
// Default Configuration
// ===========================================================================

// Default regex patterns for common non-actionable notifications
const DEFAULT_IGNORED_REGEX = ["The user doesn't want to proceed with this tool use\\."];

const DEFAULT_CONFIG: AppConfig = {
  notifications: {
    enabled: true,
    soundEnabled: true,
    ignoredRegex: [...DEFAULT_IGNORED_REGEX],
    ignoredRepositories: [],
    snoozedUntil: null,
    snoozeMinutes: 30,
    includeSubagentErrors: true,
    triggers: DEFAULT_TRIGGERS,
  },
  general: {
    launchAtLogin: false,
    showDockIcon: true,
    theme: 'dark',
    defaultTab: 'dashboard',
    claudeRootPath: null,
  },
  display: {
    showTimestamps: true,
    compactMode: false,
    syntaxHighlighting: true,
  },
  sessions: {
    pinnedSessions: {},
    hiddenSessions: {},
  },
  ssh: {
    lastConnection: null,
    autoReconnect: false,
    profiles: [],
    lastActiveContextId: 'local',
  },
  httpServer: {
    enabled: false,
    port: 3456,
  },
};

function normalizeConfiguredClaudeRootPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = path.normalize(trimmed);
  if (!path.isAbsolute(normalized)) {
    return null;
  }

  const resolved = path.resolve(normalized);
  const root = path.parse(resolved).root;
  if (resolved === root) {
    return resolved;
  }
  let end = resolved.length;
  while (end > root.length) {
    const char = resolved[end - 1];
    if (char !== '/' && char !== '\\') {
      break;
    }
    end--;
  }

  return resolved.slice(0, end);
}

// ===========================================================================
// ConfigManager Class
// ===========================================================================

export class ConfigManager {
  private config: AppConfig;
  private readonly configPath: string;
  private static instance: ConfigManager | null = null;
  private triggerManager: TriggerManager;

  constructor(configPath?: string) {
    this.configPath = configPath ?? DEFAULT_CONFIG_PATH;
    this.config = this.loadConfig();
    setClaudeBasePathOverride(this.config.general.claudeRootPath);
    this.triggerManager = new TriggerManager(this.config.notifications.triggers, () =>
      this.saveConfig()
    );
  }

  // ===========================================================================
  // Singleton Pattern
  // ===========================================================================

  /**
   * Gets the singleton instance of ConfigManager.
   */
  static getInstance(): ConfigManager {
    ConfigManager.instance ??= new ConfigManager();
    return ConfigManager.instance;
  }

  /**
   * Resets the singleton instance (useful for testing).
   */
  static resetInstance(): void {
    ConfigManager.instance = null;
  }

  // ===========================================================================
  // Config Loading & Saving
  // ===========================================================================

  /**
   * Loads configuration from disk.
   * Returns default config if file doesn't exist or is invalid.
   */
  private loadConfig(): AppConfig {
    try {
      if (!fs.existsSync(this.configPath)) {
        logger.info('No config file found, using defaults');
        return this.deepClone(DEFAULT_CONFIG);
      }

      const content = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(content) as Partial<AppConfig>;

      // Merge with defaults to ensure all fields exist
      return this.mergeWithDefaults(parsed);
    } catch (error) {
      logger.error('Error loading config, using defaults:', error);
      return this.deepClone(DEFAULT_CONFIG);
    }
  }

  /**
   * Saves the current configuration to disk.
   */
  private saveConfig(): void {
    try {
      this.persistConfig(this.config);
      logger.info('Config saved');
    } catch (error) {
      logger.error('Error saving config:', error);
    }
  }

  /**
   * Persists configuration to the canonical path.
   */
  private persistConfig(config: AppConfig): void {
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const content = JSON.stringify(config, null, 2);
    fs.writeFileSync(this.configPath, content, 'utf8');
  }

  /**
   * Merges loaded config with defaults to ensure all fields exist.
   * Special handling for triggers array to preserve existing triggers
   * and add any missing builtin triggers.
   */
  private mergeWithDefaults(loaded: Partial<AppConfig>): AppConfig {
    const loadedNotifications = loaded.notifications ?? ({} as Partial<NotificationConfig>);
    const loadedTriggers = loadedNotifications.triggers ?? [];
    const mergedGeneral: GeneralConfig = {
      ...DEFAULT_CONFIG.general,
      ...(loaded.general ?? {}),
    };
    mergedGeneral.claudeRootPath = normalizeConfiguredClaudeRootPath(mergedGeneral.claudeRootPath);

    // Merge triggers: preserve existing triggers, add missing builtin ones
    const mergedTriggers = TriggerManager.mergeTriggers(loadedTriggers, DEFAULT_TRIGGERS);

    return {
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        ...loadedNotifications,
        triggers: mergedTriggers,
      },
      general: mergedGeneral,
      display: {
        ...DEFAULT_CONFIG.display,
        ...(loaded.display ?? {}),
      },
      sessions: {
        ...DEFAULT_CONFIG.sessions,
        ...(loaded.sessions ?? {}),
      },
      ssh: {
        ...DEFAULT_CONFIG.ssh,
        ...(loaded.ssh ?? {}),
      },
      httpServer: {
        ...DEFAULT_CONFIG.httpServer,
        ...(loaded.httpServer ?? {}),
      },
    };
  }

  /**
   * Deep clones an object.
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
  }

  // ===========================================================================
  // Config Access
  // ===========================================================================

  /**
   * Gets the full configuration object.
   */
  getConfig(): AppConfig {
    return this.deepClone(this.config);
  }

  /**
   * Gets the configuration file path.
   */
  getConfigPath(): string {
    return this.configPath;
  }

  // ===========================================================================
  // Config Updates
  // ===========================================================================

  /**
   * Updates a section of the configuration.
   * @param section - The config section to update ('notifications', 'general', 'display')
   * @param data - Partial data to merge into the section
   */
  updateConfig<K extends ConfigSection>(section: K, data: Partial<AppConfig[K]>): AppConfig {
    const normalizedData = this.normalizeSectionUpdate(section, data);
    this.config[section] = {
      ...this.config[section],
      ...normalizedData,
    };

    if (section === 'general') {
      setClaudeBasePathOverride(this.config.general.claudeRootPath);
    }

    this.saveConfig();
    return this.getConfig();
  }

  private normalizeSectionUpdate<K extends ConfigSection>(
    section: K,
    data: Partial<AppConfig[K]>
  ): Partial<AppConfig[K]> {
    if (section !== 'general') {
      return data;
    }

    if (!Object.prototype.hasOwnProperty.call(data, 'claudeRootPath')) {
      return data;
    }

    const generalUpdate = data as Partial<GeneralConfig>;
    return {
      ...generalUpdate,
      claudeRootPath: normalizeConfiguredClaudeRootPath(generalUpdate.claudeRootPath),
    } as unknown as Partial<AppConfig[K]>;
  }

  // ===========================================================================
  // Notification Ignore Regex Management
  // ===========================================================================

  /**
   * Adds a regex pattern to the ignore list.
   * Validates pattern for safety to prevent ReDoS attacks.
   * @param pattern - Regex pattern string to add
   * @returns Updated config
   */
  addIgnoreRegex(pattern: string): AppConfig {
    if (!pattern || pattern.trim().length === 0) {
      return this.getConfig();
    }

    const trimmedPattern = pattern.trim();

    // Validate regex pattern (includes ReDoS protection)
    const validation = validateRegexPattern(trimmedPattern);
    if (!validation.valid) {
      logger.error(`ConfigManager: Invalid regex pattern: ${validation.error ?? 'Unknown error'}`);
      return this.getConfig();
    }

    // Check for duplicates
    if (this.config.notifications.ignoredRegex.includes(trimmedPattern)) {
      return this.getConfig();
    }

    this.config.notifications.ignoredRegex.push(trimmedPattern);
    this.saveConfig();
    return this.getConfig();
  }

  /**
   * Removes a regex pattern from the ignore list.
   * @param pattern - Regex pattern string to remove
   * @returns Updated config
   */
  removeIgnoreRegex(pattern: string): AppConfig {
    const index = this.config.notifications.ignoredRegex.indexOf(pattern);
    if (index !== -1) {
      this.config.notifications.ignoredRegex.splice(index, 1);
      this.saveConfig();
    }
    return this.getConfig();
  }

  // ===========================================================================
  // Notification Ignore Repository Management
  // ===========================================================================

  /**
   * Adds a repository to the ignore list.
   * @param repositoryId - Repository group ID to add
   * @returns Updated config
   */
  addIgnoreRepository(repositoryId: string): AppConfig {
    if (!repositoryId || repositoryId.trim().length === 0) {
      return this.getConfig();
    }

    const trimmedRepositoryId = repositoryId.trim();

    // Check for duplicates
    if (this.config.notifications.ignoredRepositories.includes(trimmedRepositoryId)) {
      return this.getConfig();
    }

    this.config.notifications.ignoredRepositories.push(trimmedRepositoryId);
    this.saveConfig();
    return this.getConfig();
  }

  /**
   * Removes a repository from the ignore list.
   * @param repositoryId - Repository group ID to remove
   * @returns Updated config
   */
  removeIgnoreRepository(repositoryId: string): AppConfig {
    const index = this.config.notifications.ignoredRepositories.indexOf(repositoryId);
    if (index !== -1) {
      this.config.notifications.ignoredRepositories.splice(index, 1);
      this.saveConfig();
    }
    return this.getConfig();
  }

  // ===========================================================================
  // Trigger Management (delegated to TriggerManager)
  // ===========================================================================

  /**
   * Adds a new notification trigger.
   * @param trigger - The trigger configuration to add
   * @returns Updated config
   */
  addTrigger(trigger: NotificationTrigger): AppConfig {
    this.config.notifications.triggers = this.triggerManager.add(trigger);
    return this.deepClone(this.config);
  }

  /**
   * Updates an existing notification trigger.
   * @param triggerId - ID of the trigger to update
   * @param updates - Partial trigger configuration to apply
   * @returns Updated config
   */
  updateTrigger(triggerId: string, updates: Partial<NotificationTrigger>): AppConfig {
    this.config.notifications.triggers = this.triggerManager.update(triggerId, updates);
    return this.deepClone(this.config);
  }

  /**
   * Removes a notification trigger.
   * Built-in triggers cannot be removed.
   * @param triggerId - ID of the trigger to remove
   * @returns Updated config
   */
  removeTrigger(triggerId: string): AppConfig {
    this.config.notifications.triggers = this.triggerManager.remove(triggerId);
    return this.deepClone(this.config);
  }

  /**
   * Gets all notification triggers.
   * @returns Array of notification triggers
   */
  getTriggers(): NotificationTrigger[] {
    return this.triggerManager.getAll();
  }

  /**
   * Gets enabled notification triggers only.
   * @returns Array of enabled notification triggers
   */
  getEnabledTriggers(): NotificationTrigger[] {
    return this.triggerManager.getEnabled();
  }

  // ===========================================================================
  // Snooze Management
  // ===========================================================================

  /**
   * Sets the snooze period for notifications.
   * Alias: snooze()
   * @param minutes - Number of minutes to snooze (uses config default if not provided)
   * @returns Updated config
   */
  setSnooze(minutes?: number): AppConfig {
    const snoozeMinutes = minutes ?? this.config.notifications.snoozeMinutes;
    const snoozedUntil = Date.now() + snoozeMinutes * 60 * 1000;

    this.config.notifications.snoozedUntil = snoozedUntil;
    this.saveConfig();

    logger.info(
      `ConfigManager: Notifications snoozed until ${new Date(snoozedUntil).toISOString()}`
    );
    return this.getConfig();
  }

  /**
   * Alias for setSnooze() for convenience.
   */
  snooze(minutes?: number): AppConfig {
    return this.setSnooze(minutes);
  }

  /**
   * Clears the snooze period, re-enabling notifications.
   * @returns Updated config
   */
  clearSnooze(): AppConfig {
    this.config.notifications.snoozedUntil = null;
    this.saveConfig();

    logger.info('Snooze cleared');
    return this.getConfig();
  }

  /**
   * Checks if notifications are currently snoozed.
   * Automatically clears expired snooze.
   * @returns true if currently snoozed, false otherwise
   */
  isSnoozed(): boolean {
    const snoozedUntil = this.config.notifications.snoozedUntil;

    if (snoozedUntil === null) {
      return false;
    }

    // Check if snooze has expired
    if (Date.now() >= snoozedUntil) {
      // Auto-clear expired snooze
      this.config.notifications.snoozedUntil = null;
      this.saveConfig();
      return false;
    }

    return true;
  }

  // ===========================================================================
  // Session Pin Management
  // ===========================================================================

  /**
   * Pins a session for a project.
   * @param projectId - The project ID
   * @param sessionId - The session ID to pin
   */
  pinSession(projectId: string, sessionId: string): void {
    const pins = this.config.sessions.pinnedSessions[projectId] ?? [];

    // Check for duplicates
    if (pins.some((p) => p.sessionId === sessionId)) {
      return;
    }

    // Prepend (most recently pinned first)
    this.config.sessions.pinnedSessions[projectId] = [{ sessionId, pinnedAt: Date.now() }, ...pins];
    this.saveConfig();
  }

  /**
   * Unpins a session for a project.
   * @param projectId - The project ID
   * @param sessionId - The session ID to unpin
   */
  unpinSession(projectId: string, sessionId: string): void {
    const pins = this.config.sessions.pinnedSessions[projectId];
    if (!pins) return;

    this.config.sessions.pinnedSessions[projectId] = pins.filter((p) => p.sessionId !== sessionId);

    // Clean up empty arrays
    if (this.config.sessions.pinnedSessions[projectId].length === 0) {
      delete this.config.sessions.pinnedSessions[projectId];
    }

    this.saveConfig();
  }

  // ===========================================================================
  // Session Hide Management
  // ===========================================================================

  /**
   * Hides a session for a project.
   * @param projectId - The project ID
   * @param sessionId - The session ID to hide
   */
  hideSession(projectId: string, sessionId: string): void {
    const hidden = this.config.sessions.hiddenSessions[projectId] ?? [];

    if (hidden.some((h) => h.sessionId === sessionId)) {
      return;
    }

    this.config.sessions.hiddenSessions[projectId] = [
      { sessionId, hiddenAt: Date.now() },
      ...hidden,
    ];
    this.saveConfig();
  }

  /**
   * Unhides a session for a project.
   * @param projectId - The project ID
   * @param sessionId - The session ID to unhide
   */
  unhideSession(projectId: string, sessionId: string): void {
    const hidden = this.config.sessions.hiddenSessions[projectId];
    if (!hidden) return;

    this.config.sessions.hiddenSessions[projectId] = hidden.filter(
      (h) => h.sessionId !== sessionId
    );

    if (this.config.sessions.hiddenSessions[projectId].length === 0) {
      delete this.config.sessions.hiddenSessions[projectId];
    }

    this.saveConfig();
  }

  /**
   * Hides multiple sessions for a project in a single write.
   * @param projectId - The project ID
   * @param sessionIds - The session IDs to hide
   */
  hideSessions(projectId: string, sessionIds: string[]): void {
    const hidden = this.config.sessions.hiddenSessions[projectId] ?? [];
    const existingIds = new Set(hidden.map((h) => h.sessionId));
    const now = Date.now();
    const newEntries = sessionIds
      .filter((id) => !existingIds.has(id))
      .map((sessionId) => ({ sessionId, hiddenAt: now }));

    if (newEntries.length === 0) return;

    this.config.sessions.hiddenSessions[projectId] = [...newEntries, ...hidden];
    this.saveConfig();
  }

  /**
   * Unhides multiple sessions for a project in a single write.
   * @param projectId - The project ID
   * @param sessionIds - The session IDs to unhide
   */
  unhideSessions(projectId: string, sessionIds: string[]): void {
    const hidden = this.config.sessions.hiddenSessions[projectId];
    if (!hidden) return;

    const toRemove = new Set(sessionIds);
    this.config.sessions.hiddenSessions[projectId] = hidden.filter(
      (h) => !toRemove.has(h.sessionId)
    );

    if (this.config.sessions.hiddenSessions[projectId].length === 0) {
      delete this.config.sessions.hiddenSessions[projectId];
    }

    this.saveConfig();
  }

  // ===========================================================================
  // SSH Profile Management
  // ===========================================================================

  /**
   * Adds an SSH connection profile.
   * @param profile - The SSH connection profile to add
   */
  addSshProfile(profile: SshConnectionProfile): void {
    // Check for duplicates by ID
    if (this.config.ssh.profiles.some((p) => p.id === profile.id)) {
      logger.warn(`SSH profile with ID ${profile.id} already exists`);
      return;
    }

    this.config.ssh.profiles.push(profile);
    this.saveConfig();
    logger.info(`SSH profile added: ${profile.name} (${profile.id})`);
  }

  /**
   * Removes an SSH connection profile by ID.
   * @param profileId - The profile ID to remove
   */
  removeSshProfile(profileId: string): void {
    const index = this.config.ssh.profiles.findIndex((p) => p.id === profileId);
    if (index === -1) {
      logger.warn(`SSH profile not found: ${profileId}`);
      return;
    }

    const removed = this.config.ssh.profiles.splice(index, 1)[0];
    this.saveConfig();
    logger.info(`SSH profile removed: ${removed.name} (${profileId})`);
  }

  /**
   * Updates an existing SSH connection profile.
   * @param profileId - The profile ID to update
   * @param updates - Partial profile data to merge
   */
  updateSshProfile(profileId: string, updates: Partial<SshConnectionProfile>): void {
    const profile = this.config.ssh.profiles.find((p) => p.id === profileId);
    if (!profile) {
      logger.warn(`SSH profile not found: ${profileId}`);
      return;
    }

    Object.assign(profile, updates);
    this.saveConfig();
    logger.info(`SSH profile updated: ${profile.name} (${profileId})`);
  }

  /**
   * Gets all SSH connection profiles.
   * @returns Array of SSH connection profiles
   */
  getSshProfiles(): SshConnectionProfile[] {
    return this.deepClone(this.config.ssh.profiles);
  }

  /**
   * Sets the last active context ID (for restoration on app restart).
   * @param contextId - The context ID that was active
   */
  setLastActiveContextId(contextId: string): void {
    this.config.ssh.lastActiveContextId = contextId;
    this.saveConfig();
    logger.info(`Last active context ID saved: ${contextId}`);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Resets configuration to defaults.
   * @returns Updated config
   */
  resetToDefaults(): AppConfig {
    this.config = this.deepClone(DEFAULT_CONFIG);
    setClaudeBasePathOverride(this.config.general.claudeRootPath);
    this.triggerManager.setTriggers(this.config.notifications.triggers);
    this.saveConfig();
    logger.info('Config reset to defaults');
    return this.getConfig();
  }

  /**
   * Reloads configuration from disk.
   * Useful if config was modified externally.
   * @returns Updated config
   */
  reload(): AppConfig {
    this.config = this.loadConfig();
    setClaudeBasePathOverride(this.config.general.claudeRootPath);
    this.triggerManager.setTriggers(this.config.notifications.triggers);
    logger.info('Config reloaded from disk');
    return this.getConfig();
  }
}

// ===========================================================================
// Singleton Export
// ===========================================================================

/** Singleton instance for convenience */
export const configManager = ConfigManager.getInstance();
