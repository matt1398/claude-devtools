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
import { type DataRoot, DEFAULT_LOCAL_ROOT_ID, type LocalDataRoot, type SshDataRoot } from '@shared/types/roots';
import { createLogger } from '@shared/utils/logger';
import { randomUUID } from 'crypto';
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

export interface RootsConfig {
  items: DataRoot[];
  activeRootId: string;
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
  roots: RootsConfig;
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

function createDefaultLocalRoot(): LocalDataRoot {
  return {
    id: DEFAULT_LOCAL_ROOT_ID,
    name: 'Local',
    type: 'local',
    claudeRootPath: null,
    order: 0,
  };
}

function normalizeRootOrder(roots: DataRoot[]): DataRoot[] {
  return roots.map((root, index) => ({ ...root, order: index }));
}

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
  roots: {
    items: [createDefaultLocalRoot()],
    activeRootId: DEFAULT_LOCAL_ROOT_ID,
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

function normalizeRemoteClaudeRootPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function migrateLegacyRoots(legacyClaudeRootPath: unknown, _legacyLastActiveContextId: unknown): {
  items: DataRoot[];
  activeRootId: string;
} {
  const defaultLocalRoot = createDefaultLocalRoot();
  defaultLocalRoot.claudeRootPath = normalizeConfiguredClaudeRootPath(legacyClaudeRootPath);

  return {
    items: [defaultLocalRoot],
    activeRootId: defaultLocalRoot.id,
  };
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
    setClaudeBasePathOverride(this.getActiveLocalClaudeRootPath());
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
    mergedGeneral.claudeRootPath = normalizeConfiguredClaudeRootPath(
      mergedGeneral.claudeRootPath
    );

    const mergedSsh: SshPersistConfig = {
      ...DEFAULT_CONFIG.ssh,
      ...(loaded.ssh ?? {}),
    };

    const rootsFromConfig = (() => {
      if (!loaded.roots || !Array.isArray(loaded.roots.items) || loaded.roots.items.length === 0) {
        return migrateLegacyRoots(mergedGeneral.claudeRootPath, mergedSsh.lastActiveContextId);
      }

      const sanitizedRoots: DataRoot[] = [];
      for (const [index, candidate] of loaded.roots.items.entries()) {
        if (!candidate || typeof candidate !== 'object') {
          continue;
        }
        const id = typeof candidate.id === 'string' && candidate.id.trim().length > 0
          ? candidate.id
          : `${candidate.type === 'ssh' ? 'ssh' : 'local'}-root-${index + 1}`;
        const name =
          typeof candidate.name === 'string' && candidate.name.trim().length > 0
            ? candidate.name.trim()
            : candidate.type === 'ssh'
              ? `SSH Root ${index + 1}`
              : `Local Root ${index + 1}`;
        const order =
          typeof candidate.order === 'number' && Number.isFinite(candidate.order)
            ? candidate.order
            : index;

        if (candidate.type === 'ssh') {
          if (
            typeof candidate.sshProfileId !== 'string' ||
            candidate.sshProfileId.trim().length === 0
          ) {
            continue;
          }
          sanitizedRoots.push({
            id,
            name,
            type: 'ssh',
            sshProfileId: candidate.sshProfileId,
            remoteClaudeRootPath: normalizeRemoteClaudeRootPath(candidate.remoteClaudeRootPath),
            order,
          });
          continue;
        }

        sanitizedRoots.push({
          id,
          name,
          type: 'local',
          claudeRootPath: normalizeConfiguredClaudeRootPath(candidate.claudeRootPath),
          order,
        });
      }

      const existingProfileIds = new Set(mergedSsh.profiles.map((profile) => profile.id));
      const rootsWithValidProfiles = sanitizedRoots.filter(
        (root) => root.type !== 'ssh' || existingProfileIds.has(root.sshProfileId)
      );

      const ordered = normalizeRootOrder(rootsWithValidProfiles);
      if (ordered.length === 0) {
        return migrateLegacyRoots(mergedGeneral.claudeRootPath, mergedSsh.lastActiveContextId);
      }

      const hasLocalRoot = ordered.some((root) => root.type === 'local');
      const items = hasLocalRoot ? ordered : [createDefaultLocalRoot(), ...ordered];
      const requestedActiveRootId =
        typeof loaded.roots.activeRootId === 'string' ? loaded.roots.activeRootId : null;
      const activeRootId =
        requestedActiveRootId && items.some((root) => root.id === requestedActiveRootId)
          ? requestedActiveRootId
          : items[0].id;

      return { items: normalizeRootOrder(items), activeRootId };
    })();

    const defaultLocalRoot =
      rootsFromConfig.items.find(
        (root): root is LocalDataRoot =>
          root.type === 'local' && root.id === DEFAULT_LOCAL_ROOT_ID
      ) ??
      rootsFromConfig.items.find((root): root is LocalDataRoot => root.type === 'local') ??
      createDefaultLocalRoot();
    mergedGeneral.claudeRootPath = defaultLocalRoot.claudeRootPath;

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
      roots: rootsFromConfig,
      ssh: mergedSsh,
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

  /**
   * Gets ordered root list.
   */
  getRoots(): DataRoot[] {
    return this.deepClone(this.config.roots.items).sort((a, b) => a.order - b.order);
  }

  /**
   * Gets a root by ID.
   */
  getRoot(rootId: string): DataRoot | null {
    const root = this.config.roots.items.find((item) => item.id === rootId);
    return root ? this.deepClone(root) : null;
  }

  /**
   * Gets the active root configuration.
   */
  getActiveRoot(): DataRoot {
    const root =
      this.config.roots.items.find((item) => item.id === this.config.roots.activeRootId) ??
      this.config.roots.items[0];
    return this.deepClone(root);
  }

  /**
   * Set active root ID.
   */
  setActiveRoot(rootId: string): AppConfig {
    if (!this.config.roots.items.some((root) => root.id === rootId)) {
      throw new Error(`Root not found: ${rootId}`);
    }
    this.config.roots.activeRootId = rootId;
    this.syncLegacyGeneralClaudeRootPath();
    setClaudeBasePathOverride(this.getActiveLocalClaudeRootPath());
    this.saveConfig();
    return this.getConfig();
  }

  private getActiveLocalClaudeRootPath(): string | null {
    const activeRoot =
      this.config.roots.items.find((item) => item.id === this.config.roots.activeRootId) ??
      this.config.roots.items[0];
    if (activeRoot?.type === 'local') {
      return activeRoot.claudeRootPath;
    }

    const fallbackLocalRoot = this.config.roots.items.find(
      (item): item is LocalDataRoot => item.type === 'local'
    );
    return fallbackLocalRoot?.claudeRootPath ?? null;
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

    if (section === 'ssh') {
      const sshUpdate = normalizedData as Partial<SshPersistConfig>;
      if (sshUpdate.profiles) {
        this.assertRemovedSshProfilesAreUnreferenced(sshUpdate.profiles);
      }
    }

    if (section === 'roots') {
      this.assertRootsConfigValid(normalizedData as Partial<RootsConfig>);
    }

    if (section === 'roots') {
      this.config.roots = this.mergeRootsUpdate(normalizedData as Partial<RootsConfig>);
      this.syncLegacyGeneralClaudeRootPath();
    } else {
      this.config[section] = {
        ...this.config[section],
        ...normalizedData,
      };
    }

    if (section === 'general') {
      const generalUpdate = normalizedData as Partial<GeneralConfig>;
      if (Object.prototype.hasOwnProperty.call(generalUpdate, 'claudeRootPath')) {
        const defaultLocalRoot = this.getDefaultLocalRootMutable();
        defaultLocalRoot.claudeRootPath = generalUpdate.claudeRootPath ?? null;
      }
    }

    if (section === 'roots' || section === 'general') {
      setClaudeBasePathOverride(this.getActiveLocalClaudeRootPath());
    }

    this.saveConfig();
    return this.getConfig();
  }

  private normalizeSectionUpdate<K extends ConfigSection>(
    section: K,
    data: Partial<AppConfig[K]>
  ): Partial<AppConfig[K]> {
    if (section !== 'general') {
      if (section === 'roots') {
        const rootsUpdate = data as Partial<RootsConfig>;
        const result: Partial<RootsConfig> = { ...rootsUpdate };
        if (Array.isArray(rootsUpdate.items)) {
          result.items = normalizeRootOrder(
            rootsUpdate.items.map((root, index) => {
              if (root.type === 'local') {
                return {
                  ...root,
                  order: typeof root.order === 'number' ? root.order : index,
                  claudeRootPath: normalizeConfiguredClaudeRootPath(root.claudeRootPath),
                };
              }
              return {
                ...root,
                order: typeof root.order === 'number' ? root.order : index,
                remoteClaudeRootPath: normalizeRemoteClaudeRootPath(root.remoteClaudeRootPath),
              };
            })
          );
        }
        return result as unknown as Partial<AppConfig[K]>;
      }
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

  private getDefaultLocalRootMutable(): LocalDataRoot {
    const existingDefaultRoot = this.config.roots.items.find(
      (root): root is LocalDataRoot => root.type === 'local' && root.id === DEFAULT_LOCAL_ROOT_ID
    );
    if (existingDefaultRoot) {
      return existingDefaultRoot;
    }

    const firstLocalRoot = this.config.roots.items.find(
      (root): root is LocalDataRoot => root.type === 'local'
    );
    if (firstLocalRoot) {
      return firstLocalRoot;
    }

    const created = createDefaultLocalRoot();
    this.config.roots.items.unshift(created);
    this.config.roots.items = normalizeRootOrder(this.config.roots.items);
    return created;
  }

  private assertRootsConfigValid(update: Partial<RootsConfig>): void {
    if (!update.items && !update.activeRootId) {
      return;
    }

    const nextItems = update.items ?? this.config.roots.items;
    if (nextItems.length === 0) {
      throw new Error('At least one root is required');
    }

    const seenRootIds = new Set<string>();
    for (const root of nextItems) {
      if (seenRootIds.has(root.id)) {
        throw new Error(`Duplicate root id: ${root.id}`);
      }
      seenRootIds.add(root.id);
      if (!root.name.trim()) {
        throw new Error('Root name is required');
      }
    }

    if (!update.items) {
      if (!nextItems.some((root) => root.id === update.activeRootId)) {
        throw new Error('activeRootId must reference an existing root');
      }
      return;
    }

    const profileIds = new Set(this.config.ssh.profiles.map((profile) => profile.id));
    for (const root of nextItems) {
      if (root.type !== 'ssh') {
        continue;
      }
      if (!profileIds.has(root.sshProfileId)) {
        throw new Error(`SSH profile not found for root "${root.name}"`);
      }
    }

    if (!nextItems.some((root) => root.type === 'local')) {
      throw new Error('At least one local root is required');
    }

    if (update.activeRootId && !nextItems.some((root) => root.id === update.activeRootId)) {
      throw new Error('activeRootId must reference one of roots.items[].id');
    }
  }

  private mergeRootsUpdate(update: Partial<RootsConfig>): RootsConfig {
    const nextItems = update.items ? normalizeRootOrder(update.items) : this.config.roots.items;
    const requestedActiveRootId = update.activeRootId ?? this.config.roots.activeRootId;
    const activeRootId = nextItems.some((root) => root.id === requestedActiveRootId)
      ? requestedActiveRootId
      : nextItems[0].id;

    return {
      items: nextItems,
      activeRootId,
    };
  }

  private assertRemovedSshProfilesAreUnreferenced(nextProfiles: SshConnectionProfile[]): void {
    const nextProfileIds = new Set(nextProfiles.map((profile) => profile.id));
    for (const removedProfile of this.config.ssh.profiles) {
      if (nextProfileIds.has(removedProfile.id)) {
        continue;
      }

      const referencingRoot = this.config.roots.items.find(
        (root): root is SshDataRoot =>
          root.type === 'ssh' && root.sshProfileId === removedProfile.id
      );
      if (referencingRoot) {
        throw new Error(
          `Profile is used by root "${referencingRoot.name}". Remove the root first.`
        );
      }
    }
  }

  private syncLegacyGeneralClaudeRootPath(): void {
    const defaultLocalRoot = this.getDefaultLocalRootMutable();
    this.config.general.claudeRootPath = defaultLocalRoot.claudeRootPath;
  }

  // ===========================================================================
  // Roots Management
  // ===========================================================================

  addRoot(root: Omit<LocalDataRoot, 'id' | 'order'> | Omit<SshDataRoot, 'id' | 'order'>): AppConfig {
    const nextOrder = this.config.roots.items.length;
    const trimmedName = root.name.trim();
    if (!trimmedName) {
      throw new Error('Root name is required');
    }

    if (root.type === 'ssh') {
      const sshRoot = root;
      const profileExists = this.config.ssh.profiles.some(
        (profile) => profile.id === sshRoot.sshProfileId
      );
      if (!profileExists) {
        throw new Error(`SSH profile not found: ${sshRoot.sshProfileId}`);
      }

      this.config.roots.items.push({
        id: randomUUID(),
        name: trimmedName,
        type: 'ssh',
        sshProfileId: sshRoot.sshProfileId,
        remoteClaudeRootPath: normalizeRemoteClaudeRootPath(sshRoot.remoteClaudeRootPath),
        order: nextOrder,
      });
    } else {
      const localRoot = root;
      this.config.roots.items.push({
        id: randomUUID(),
        name: trimmedName,
        type: 'local',
        claudeRootPath: normalizeConfiguredClaudeRootPath(localRoot.claudeRootPath),
        order: nextOrder,
      });
    }

    this.config.roots.items = normalizeRootOrder(this.config.roots.items);
    this.syncLegacyGeneralClaudeRootPath();
    this.saveConfig();
    return this.getConfig();
  }

  updateRoot(
    rootId: string,
    updates: Partial<Omit<LocalDataRoot, 'id'>> | Partial<Omit<SshDataRoot, 'id'>>
  ): AppConfig {
    const index = this.config.roots.items.findIndex((root) => root.id === rootId);
    if (index === -1) {
      throw new Error(`Root not found: ${rootId}`);
    }

    const currentRoot = this.config.roots.items[index];
    if (updates.type && updates.type !== currentRoot.type) {
      throw new Error('Root type cannot be changed');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      if (typeof updates.name !== 'string' || updates.name.trim().length === 0) {
        throw new Error('Root name is required');
      }
    }

    if (currentRoot.type === 'local') {
      this.config.roots.items[index] = {
        ...currentRoot,
        name: typeof updates.name === 'string' ? updates.name.trim() : currentRoot.name,
        claudeRootPath:
          Object.prototype.hasOwnProperty.call(updates, 'claudeRootPath')
            ? normalizeConfiguredClaudeRootPath((updates as Partial<LocalDataRoot>).claudeRootPath)
            : currentRoot.claudeRootPath,
        order:
          typeof updates.order === 'number' && Number.isFinite(updates.order)
            ? updates.order
            : currentRoot.order,
      };
    } else {
      const nextProfileId = (updates as Partial<SshDataRoot>).sshProfileId ?? currentRoot.sshProfileId;
      const profileExists = this.config.ssh.profiles.some((profile) => profile.id === nextProfileId);
      if (!profileExists) {
        throw new Error(`SSH profile not found: ${nextProfileId}`);
      }

      this.config.roots.items[index] = {
        ...currentRoot,
        name: typeof updates.name === 'string' ? updates.name.trim() : currentRoot.name,
        sshProfileId: nextProfileId,
        remoteClaudeRootPath: Object.prototype.hasOwnProperty.call(updates, 'remoteClaudeRootPath')
          ? normalizeRemoteClaudeRootPath((updates as Partial<SshDataRoot>).remoteClaudeRootPath)
          : currentRoot.remoteClaudeRootPath,
        order:
          typeof updates.order === 'number' && Number.isFinite(updates.order)
            ? updates.order
            : currentRoot.order,
      };
    }

    this.config.roots.items = normalizeRootOrder(this.config.roots.items);
    this.syncLegacyGeneralClaudeRootPath();
    setClaudeBasePathOverride(this.getActiveLocalClaudeRootPath());
    this.saveConfig();
    return this.getConfig();
  }

  removeRoot(rootId: string): AppConfig {
    if (this.config.roots.items.length <= 1) {
      throw new Error('Cannot remove the last root');
    }
    if (rootId === DEFAULT_LOCAL_ROOT_ID) {
      throw new Error('Default local root cannot be removed');
    }

    const index = this.config.roots.items.findIndex((root) => root.id === rootId);
    if (index === -1) {
      throw new Error(`Root not found: ${rootId}`);
    }

    this.config.roots.items.splice(index, 1);
    this.config.roots.items = normalizeRootOrder(this.config.roots.items);

    if (this.config.roots.activeRootId === rootId) {
      const fallbackRoot =
        this.config.roots.items.find((root) => root.type === 'local') ?? this.config.roots.items[0];
      this.config.roots.activeRootId = fallbackRoot.id;
    }

    this.syncLegacyGeneralClaudeRootPath();
    setClaudeBasePathOverride(this.getActiveLocalClaudeRootPath());
    this.saveConfig();
    return this.getConfig();
  }

  reorderRoots(rootIdsInOrder: string[]): AppConfig {
    if (rootIdsInOrder.length !== this.config.roots.items.length) {
      throw new Error('Reorder payload does not match roots length');
    }

    const uniqueRootIds = new Set(rootIdsInOrder);
    if (uniqueRootIds.size !== rootIdsInOrder.length) {
      throw new Error('Reorder payload contains duplicate root IDs');
    }

    const knownIds = new Set(this.config.roots.items.map((root) => root.id));
    for (const rootId of rootIdsInOrder) {
      if (!knownIds.has(rootId)) {
        throw new Error(`Unknown root in reorder payload: ${rootId}`);
      }
    }

    this.config.roots.items = rootIdsInOrder.map((rootId, index) => {
      const root = this.config.roots.items.find((item) => item.id === rootId)!;
      return { ...root, order: index };
    });

    this.syncLegacyGeneralClaudeRootPath();
    this.saveConfig();
    return this.getConfig();
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
    const referencingRoot = this.config.roots.items.find(
      (root): root is SshDataRoot => root.type === 'ssh' && root.sshProfileId === profileId
    );
    if (referencingRoot) {
      throw new Error(`Profile is used by root "${referencingRoot.name}". Remove the root first.`);
    }

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
    setClaudeBasePathOverride(this.getActiveLocalClaudeRootPath());
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
    setClaudeBasePathOverride(this.getActiveLocalClaudeRootPath());
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
