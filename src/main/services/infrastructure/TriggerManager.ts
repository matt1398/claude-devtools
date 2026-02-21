/**
 * TriggerManager - Manages notification triggers.
 *
 * Handles CRUD operations for notification triggers including:
 * - Adding, updating, and removing triggers
 * - Validating trigger configurations (with ReDoS protection)
 * - Managing builtin vs custom triggers
 */

import { validateRegexPattern } from '@main/utils/regexValidation';

import type { NotificationTrigger } from './ConfigManager';

// ===========================================================================
// Types
// ===========================================================================

export interface TriggerValidationResult {
  valid: boolean;
  errors: string[];
}

// ===========================================================================
// Default Triggers
// ===========================================================================

/**
 * Default built-in notification triggers.
 */
export const DEFAULT_TRIGGERS: NotificationTrigger[] = [
  {
    id: 'builtin-bash-command',
    name: '.env File Access Alert',
    enabled: false,
    contentType: 'tool_use',
    mode: 'content_match',
    matchPattern: '/.env',
    isBuiltin: true,
    color: 'red',
  },
  {
    id: 'builtin-tool-result-error',
    name: 'Tool Result Error',
    enabled: false,
    contentType: 'tool_result',
    mode: 'error_status',
    requireError: true,
    ignorePatterns: [
      "The user doesn't want to proceed with this tool use\\.",
      '\\[Request interrupted by user for tool use\\]',
    ],
    isBuiltin: true,
    color: 'orange',
  },
  {
    id: 'builtin-high-token-usage',
    name: 'High Token Usage',
    enabled: false,
    contentType: 'tool_result',
    mode: 'token_threshold',
    tokenThreshold: 8000,
    tokenType: 'total',
    color: 'yellow',
    isBuiltin: true,
  },
];

// ===========================================================================
// TriggerManager Class
// ===========================================================================

export class TriggerManager {
  private triggers: NotificationTrigger[];
  private readonly onSave: () => void;

  constructor(triggers: NotificationTrigger[], onSave: () => void) {
    this.triggers = triggers;
    this.onSave = onSave;
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  /**
   * Gets all notification triggers.
   */
  getAll(): NotificationTrigger[] {
    return this.deepClone(this.triggers);
  }

  /**
   * Gets enabled notification triggers only.
   */
  getEnabled(): NotificationTrigger[] {
    return this.deepClone(this.triggers.filter((t) => t.enabled));
  }

  /**
   * Gets a trigger by ID.
   */
  getById(triggerId: string): NotificationTrigger | undefined {
    const trigger = this.triggers.find((t) => t.id === triggerId);
    return trigger ? this.deepClone(trigger) : undefined;
  }

  /**
   * Adds a new notification trigger.
   * @throws Error if trigger with same ID already exists
   */
  add(trigger: NotificationTrigger): NotificationTrigger[] {
    // Check if trigger with same ID already exists
    if (this.triggers.some((t) => t.id === trigger.id)) {
      throw new Error(`Trigger with ID "${trigger.id}" already exists`);
    }

    // Validate trigger
    const validation = this.validate(trigger);
    if (!validation.valid) {
      throw new Error(`Invalid trigger: ${validation.errors.join(', ')}`);
    }

    this.triggers = [...this.triggers, trigger];
    this.onSave();
    return this.getAll();
  }

  /**
   * Updates an existing notification trigger.
   * @throws Error if trigger not found
   */
  update(triggerId: string, updates: Partial<NotificationTrigger>): NotificationTrigger[] {
    const index = this.triggers.findIndex((t) => t.id === triggerId);

    if (index === -1) {
      throw new Error(`Trigger with ID "${triggerId}" not found`);
    }

    // Extract allowedUpdates without isBuiltin (which cannot be changed)
    const allowedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([key]) => key !== 'isBuiltin')
    ) as Partial<NotificationTrigger>;

    const updated = { ...this.triggers[index], ...allowedUpdates };

    // Ensure mode is set (for backward compatibility with old triggers)
    if (!updated.mode) {
      updated.mode = this.inferMode(updated);
    }

    // Validate updated trigger
    const validation = this.validate(updated);
    if (!validation.valid) {
      throw new Error(`Invalid trigger update: ${validation.errors.join(', ')}`);
    }

    this.triggers = this.triggers.map((t, i) => (i === index ? updated : t));
    this.onSave();
    return this.getAll();
  }

  /**
   * Infers trigger mode from trigger properties for backward compatibility.
   */
  private inferMode(
    trigger: Partial<NotificationTrigger>
  ): 'error_status' | 'content_match' | 'token_threshold' {
    if (trigger.requireError) return 'error_status';
    if (trigger.matchPattern || trigger.matchField) return 'content_match';
    if (trigger.tokenThreshold !== undefined) return 'token_threshold';
    return 'error_status'; // default fallback
  }

  /**
   * Removes a notification trigger.
   * Built-in triggers cannot be removed.
   * @throws Error if trigger not found or is builtin
   */
  remove(triggerId: string): NotificationTrigger[] {
    const trigger = this.triggers.find((t) => t.id === triggerId);

    if (!trigger) {
      throw new Error(`Trigger with ID "${triggerId}" not found`);
    }

    if (trigger.isBuiltin) {
      throw new Error('Cannot remove built-in triggers. Disable them instead.');
    }

    this.triggers = this.triggers.filter((t) => t.id !== triggerId);
    this.onSave();
    return this.getAll();
  }

  // ===========================================================================
  // Validation
  // ===========================================================================

  /**
   * Validates a trigger configuration.
   */
  validate(trigger: NotificationTrigger): TriggerValidationResult {
    const errors: string[] = [];

    // Required fields
    if (!trigger.id || trigger.id.trim() === '') {
      errors.push('Trigger ID is required');
    }

    if (!trigger.name || trigger.name.trim() === '') {
      errors.push('Trigger name is required');
    }

    if (!trigger.contentType) {
      errors.push('Content type is required');
    }

    if (!trigger.mode) {
      errors.push('Trigger mode is required');
    }

    // Mode-specific validation
    if (trigger.mode === 'content_match') {
      // matchField is required unless it's tool_use with "Any Tool" (no toolName)
      // In that case, we match against the entire JSON input
      if (!trigger.matchField && !(trigger.contentType === 'tool_use' && !trigger.toolName)) {
        errors.push('Match field is required for content_match mode');
      }
      // Validate regex pattern if provided (with ReDoS protection)
      if (trigger.matchPattern) {
        const validation = validateRegexPattern(trigger.matchPattern);
        if (!validation.valid) {
          errors.push(validation.error ?? 'Invalid regex pattern');
        }
      }
    }

    if (trigger.mode === 'token_threshold') {
      if (trigger.tokenThreshold === undefined || trigger.tokenThreshold < 0) {
        errors.push('Token threshold must be a non-negative number');
      }
      if (!trigger.tokenType) {
        errors.push('Token type is required for token_threshold mode');
      }
    }

    // Validate ignore patterns (with ReDoS protection)
    if (trigger.ignorePatterns) {
      for (const pattern of trigger.ignorePatterns) {
        const validation = validateRegexPattern(pattern);
        if (!validation.valid) {
          errors.push(
            `Invalid ignore pattern "${pattern}": ${validation.error ?? 'Unknown error'}`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  // ===========================================================================
  // Trigger Merging
  // ===========================================================================

  /**
   * Merges loaded triggers with default triggers.
   * - Preserves all existing triggers (including user-modified builtin triggers)
   * - Adds any missing builtin triggers from defaults
   * - Removes deprecated builtin triggers that are no longer in defaults
   */
  static mergeTriggers(
    loaded: NotificationTrigger[],
    defaults: NotificationTrigger[] = DEFAULT_TRIGGERS
  ): NotificationTrigger[] {
    // Get IDs of current builtin triggers
    const builtinIds = new Set(defaults.filter((t) => t.isBuiltin).map((t) => t.id));

    // Filter out deprecated builtin triggers (builtin triggers not in current defaults)
    const filtered = loaded.filter((t) => !t.isBuiltin || builtinIds.has(t.id));

    // Add any missing builtin triggers from defaults
    for (const defaultTrigger of defaults) {
      if (defaultTrigger.isBuiltin) {
        const existsInFiltered = filtered.some((t) => t.id === defaultTrigger.id);
        if (!existsInFiltered) {
          filtered.push(defaultTrigger);
        }
      }
    }

    return filtered;
  }

  // ===========================================================================
  // Internal Methods
  // ===========================================================================

  /**
   * Updates the internal triggers array.
   * Used by ConfigManager when loading config.
   */
  setTriggers(triggers: NotificationTrigger[]): void {
    this.triggers = triggers;
  }

  /**
   * Deep clones an object.
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj)) as T;
  }
}
