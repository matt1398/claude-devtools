/**
 * Notification and configuration types for claude-devtools.
 *
 * These types define:
 * - Detected errors from session files
 * - Notification triggers (rules for when to notify)
 * - Application configuration settings
 *
 * Shared between preload and renderer processes.
 */

import type { DataRoot } from './roots';
import type { TriggerColor } from '@shared/constants/triggerColors';

// =============================================================================
// Detected Error Types
// =============================================================================

/**
 * Detected error from session JSONL files.
 * Used for notification display and deep linking to error locations.
 */
export interface DetectedError {
  /** UUID for unique identification */
  id: string;
  /** Unix timestamp when error occurred */
  timestamp: number;
  /** Session ID where error occurred */
  sessionId: string;
  /** Project ID (encoded project path) */
  projectId: string;
  /** Path to the JSONL file */
  filePath: string;
  /** Tool name or 'assistant' */
  source: string;
  /** Error message text */
  message: string;
  /** Line number in JSONL for deep linking */
  lineNumber?: number;
  /** Tool use ID for precise deep linking to the specific tool item */
  toolUseId?: string;
  /** Subagent ID when error originates from a subagent session */
  subagentId?: string;
  /** Whether the notification has been read */
  isRead: boolean;
  /** When the notification was created */
  createdAt: number;
  /** Trigger color key for notification dot and highlight */
  triggerColor?: TriggerColor;
  /** ID of the trigger that produced this notification */
  triggerId?: string;
  /** Human-readable name of the trigger that produced this notification */
  triggerName?: string;
  /** Additional context */
  context: {
    /** Display name of the project */
    projectName: string;
    /** Current working directory when error occurred */
    cwd?: string;
  };
}

// =============================================================================
// Notification Trigger Types
// =============================================================================

/**
 * Content types that can trigger notifications.
 */
export type TriggerContentType = 'tool_result' | 'tool_use' | 'thinking' | 'text';

/**
 * Known tool names that can be filtered for tool_use triggers.
 */
export const KNOWN_TOOL_NAMES = [
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

/**
 * Result of testing a trigger against historical data.
 */
export interface TriggerTestResult {
  totalCount: number;
  errors: {
    id: string;
    sessionId: string;
    projectId: string;
    message: string;
    timestamp: number;
    source: string;
    /** Tool use ID for precise deep linking to the specific tool item */
    toolUseId?: string;
    /** Subagent ID when error originates from or targets a subagent */
    subagentId?: string;
    /** Line number in JSONL for deep linking */
    lineNumber?: number;
    context: { projectName: string };
  }[];
  /**
   * True if results were truncated due to safety limits:
   * - totalCount capped at 10,000
   * - Max 100 sessions scanned
   * - 30 second timeout
   */
  truncated?: boolean;
}

// =============================================================================
// Application Configuration Types
// =============================================================================

/**
 * Application configuration settings.
 * Persisted to disk and loaded on app startup.
 */
export interface AppConfig {
  /** Notification-related settings */
  notifications: {
    /** Whether notifications are enabled globally */
    enabled: boolean;
    /** Whether to play sound with notifications */
    soundEnabled: boolean;
    /** Regex patterns for errors to ignore */
    ignoredRegex: string[];
    /** Repository group IDs to ignore for notifications */
    ignoredRepositories: string[];
    /** Unix timestamp until which notifications are snoozed (null if not snoozed) */
    snoozedUntil: number | null;
    /** Default snooze duration in minutes */
    snoozeMinutes: number;
    /** Whether to include errors from subagent sessions */
    includeSubagentErrors: boolean;
    /** Notification triggers - define when to generate notifications */
    triggers: NotificationTrigger[];
  };
  /** General application settings */
  general: {
    /** Whether to launch app at system login */
    launchAtLogin: boolean;
    /** Whether to show icon in dock (macOS) */
    showDockIcon: boolean;
    /** Application theme */
    theme: 'dark' | 'light' | 'system';
    /** Default tab to show on app launch */
    defaultTab: 'dashboard' | 'last-session';
    /** Optional custom Claude root folder (auto-detected when null) */
    claudeRootPath: string | null;
  };
  /** Display and UI settings */
  display: {
    /** Whether to show timestamps in message views */
    showTimestamps: boolean;
    /** Whether to use compact display mode */
    compactMode: boolean;
    /** Whether to enable syntax highlighting in code blocks */
    syntaxHighlighting: boolean;
  };
  /** Session-related settings */
  sessions: {
    /** Pinned sessions per project. Key is projectId, value is array of pinned sessions */
    pinnedSessions: Record<string, { sessionId: string; pinnedAt: number }[]>;
    /** Hidden sessions per project. Key is projectId, value is array of hidden sessions */
    hiddenSessions: Record<string, { sessionId: string; hiddenAt: number }[]>;
  };
  /** Data roots (local and SSH) */
  roots: {
    /** Ordered root definitions */
    items: DataRoot[];
    /** Active root ID */
    activeRootId: string;
  };
  /** SSH connection settings */
  ssh?: {
    /** Last used connection details */
    lastConnection: {
      host: string;
      port: number;
      username: string;
      authMethod: 'password' | 'privateKey' | 'agent' | 'auto';
      privateKeyPath?: string;
    } | null;
    /** Whether to auto-reconnect on launch */
    autoReconnect: boolean;
    /** Saved SSH connection profiles */
    profiles: {
      id: string;
      name: string;
      host: string;
      port: number;
      username: string;
      authMethod: 'password' | 'privateKey' | 'agent' | 'auto';
      privateKeyPath?: string;
    }[];
    /** Last active context ID */
    lastActiveContextId: string;
  };
  /** HTTP sidecar server settings for iframe embedding */
  httpServer?: {
    /** Whether the HTTP server is enabled */
    enabled: boolean;
    /** Port for the HTTP server (default 3456) */
    port: number;
  };
}
