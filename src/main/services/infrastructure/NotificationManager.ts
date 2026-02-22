/**
 * NotificationManager service - Manages native macOS notifications and error history.
 *
 * Responsibilities:
 * - Store error history at ~/.claude/claude-devtools-notifications.json (max 100 entries)
 * - Show native macOS notifications using Electron's Notification API
 * - Implement throttling (5 seconds per unique error hash)
 * - Respect config.notifications.enabled and snoozedUntil
 * - Filter errors matching ignoredRegex patterns
 * - Filter errors from ignoredProjects
 * - Auto-prune notifications over 100 on startup
 * - Emit IPC events to renderer: notification:new, notification:updated
 */

import { createLogger } from '@shared/utils/logger';
import { type BrowserWindow, Notification } from 'electron';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { type DetectedError } from '../error/ErrorMessageBuilder';

const logger = createLogger('Service:NotificationManager');
import { projectPathResolver } from '../discovery/ProjectPathResolver';
import { gitIdentityResolver } from '../parsing/GitIdentityResolver';

import { ConfigManager } from './ConfigManager';

// Re-export DetectedError for backward compatibility
export type { DetectedError };

/**
 * Stored notification with read status.
 */
export interface StoredNotification extends DetectedError {
  /** Whether the notification has been read */
  isRead: boolean;
  /** When the notification was created (may differ from error timestamp) */
  createdAt: number;
}

/**
 * Pagination options for getNotifications.
 */
export interface GetNotificationsOptions {
  /** Number of notifications to return */
  limit?: number;
  /** Number of notifications to skip */
  offset?: number;
}

/**
 * Result of getNotifications call.
 */
export interface GetNotificationsResult {
  /** Notifications for this page */
  notifications: StoredNotification[];
  /** Total number of notifications */
  total: number;
  /** Total count (alias for IPC compatibility) */
  totalCount: number;
  /** Number of unread notifications */
  unreadCount: number;
  /** Whether there are more notifications to load */
  hasMore: boolean;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of notifications to store */
const MAX_NOTIFICATIONS = 100;

/** Throttle window in milliseconds (5 seconds) */
const THROTTLE_MS = 5000;

/** Path to notifications storage file */
const NOTIFICATIONS_PATH = path.join(os.homedir(), '.claude', 'claude-devtools-notifications.json');

// =============================================================================
// NotificationManager Class
// =============================================================================

export class NotificationManager extends EventEmitter {
  private static instance: NotificationManager | null = null;
  private notifications: StoredNotification[] = [];
  private configManager: ConfigManager;
  private mainWindow: BrowserWindow | null = null;
  private throttleMap = new Map<string, number>();
  private isInitialized: boolean = false;

  constructor(configManager?: ConfigManager) {
    super();
    this.configManager = configManager ?? ConfigManager.getInstance();
  }

  // ===========================================================================
  // Singleton Pattern
  // ===========================================================================

  /**
   * Gets the singleton instance of NotificationManager.
   */
  static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager();
      NotificationManager.instance.initialize();
    }
    return NotificationManager.instance;
  }

  /**
   * Resets the singleton instance (useful for testing).
   */
  static resetInstance(): void {
    NotificationManager.instance = null;
  }

  /**
   * Sets the singleton instance (useful for dependency injection).
   */
  static setInstance(instance: NotificationManager): void {
    NotificationManager.instance = instance;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initializes the notification manager.
   * Loads existing notifications and prunes if needed.
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    this.loadNotifications();
    this.pruneNotifications();
    this.isInitialized = true;

    logger.info(`NotificationManager: Initialized with ${this.notifications.length} notifications`);
  }

  /**
   * Sets the main window reference for sending IPC events.
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  /**
   * Loads notifications from disk.
   */
  private loadNotifications(): void {
    try {
      if (fs.existsSync(NOTIFICATIONS_PATH)) {
        const data = fs.readFileSync(NOTIFICATIONS_PATH, 'utf8');
        const parsed = JSON.parse(data) as unknown;

        if (Array.isArray(parsed)) {
          this.notifications = parsed as StoredNotification[];
        } else {
          logger.warn('Invalid notifications file format, starting fresh');
          this.notifications = [];
        }
      }
    } catch (error) {
      logger.error('Error loading notifications:', error);
      this.notifications = [];
    }
  }

  /**
   * Saves notifications to disk.
   */
  private saveNotifications(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(NOTIFICATIONS_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(NOTIFICATIONS_PATH, JSON.stringify(this.notifications, null, 2), 'utf8');
    } catch (error) {
      logger.error('Error saving notifications:', error);
    }
  }

  /**
   * Prunes notifications to MAX_NOTIFICATIONS entries.
   * Removes oldest notifications first.
   */
  private pruneNotifications(): void {
    if (this.notifications.length > MAX_NOTIFICATIONS) {
      // Sort by createdAt descending (newest first)
      this.notifications.sort((a, b) => b.createdAt - a.createdAt);

      // Keep only the newest MAX_NOTIFICATIONS
      const removed = this.notifications.length - MAX_NOTIFICATIONS;
      this.notifications = this.notifications.slice(0, MAX_NOTIFICATIONS);
      this.saveNotifications();

      logger.info(`NotificationManager: Pruned ${removed} old notifications`);
    }
  }

  // ===========================================================================
  // Error Filtering
  // ===========================================================================

  /**
   * Generates a unique hash for throttling based on projectId + message.
   */
  private generateErrorHash(error: DetectedError): string {
    return `${error.projectId}:${error.message}`;
  }

  /**
   * Checks if an error should be throttled.
   */
  private isThrottled(error: DetectedError): boolean {
    const hash = this.generateErrorHash(error);
    const lastSeen = this.throttleMap.get(hash);

    if (lastSeen && Date.now() - lastSeen < THROTTLE_MS) {
      return true;
    }

    // Update throttle map
    this.throttleMap.set(hash, Date.now());

    // Clean up old entries periodically
    this.cleanupThrottleMap();

    return false;
  }

  /**
   * Cleans up old entries from the throttle map.
   */
  private cleanupThrottleMap(): void {
    const now = Date.now();
    const expiredThreshold = now - THROTTLE_MS * 2;

    const keysToDelete: string[] = [];
    this.throttleMap.forEach((timestamp, hash) => {
      if (timestamp < expiredThreshold) {
        keysToDelete.push(hash);
      }
    });

    for (const key of keysToDelete) {
      this.throttleMap.delete(key);
    }
  }

  /**
   * Checks if notifications are currently enabled based on config.
   */
  private areNotificationsEnabled(): boolean {
    const config = this.configManager.getConfig();

    // Check if notifications are globally disabled
    if (!config.notifications.enabled) {
      return false;
    }

    // Check if notifications are snoozed
    if (config.notifications.snoozedUntil) {
      if (Date.now() < config.notifications.snoozedUntil) {
        return false;
      } else {
        // Snooze has expired, clear it
        this.configManager.clearSnooze();
      }
    }

    return true;
  }

  /**
   * Checks if an error matches any ignored regex patterns.
   */
  private matchesIgnoredRegex(error: DetectedError): boolean {
    const config = this.configManager.getConfig();
    const patterns = config.notifications.ignoredRegex;

    if (!patterns || patterns.length === 0) {
      return false;
    }

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(error.message)) {
          return true;
        }
      } catch {
        // Invalid regex pattern, skip
        logger.warn(`NotificationManager: Invalid regex pattern: ${pattern}`);
      }
    }

    return false;
  }

  /**
   * Checks if the error is from an ignored repository.
   * Resolves the project path to a repository ID and checks against ignored list.
   */
  private async isFromIgnoredRepository(error: DetectedError): Promise<boolean> {
    const config = this.configManager.getConfig();
    const ignoredRepositories = config.notifications.ignoredRepositories;

    if (!ignoredRepositories || ignoredRepositories.length === 0) {
      return false;
    }

    // Resolve project ID to repository ID using canonical path resolution.
    const projectPath = await projectPathResolver.resolveProjectPath(error.projectId, {
      cwdHint: error.context.cwd,
    });
    const identity = await gitIdentityResolver.resolveIdentity(projectPath);

    if (!identity) {
      return false;
    }

    return ignoredRepositories.includes(identity.id);
  }

  /**
   * Determines if an error should generate a notification.
   */
  private async shouldNotify(error: DetectedError): Promise<boolean> {
    // Check if notifications are enabled
    if (!this.areNotificationsEnabled()) {
      return false;
    }

    // Check if error is from an ignored repository
    if (await this.isFromIgnoredRepository(error)) {
      return false;
    }

    // Check if error matches an ignored regex
    if (this.matchesIgnoredRegex(error)) {
      return false;
    }

    // Check throttling (for native toast dedup only — storage is unconditional)
    if (this.isThrottled(error)) {
      return false;
    }

    return true;
  }

  // ===========================================================================
  // Native Notifications
  // ===========================================================================

  /**
   * Shows a native macOS notification for an error.
   */
  private showNativeNotification(error: DetectedError): void {
    // Guard against standalone/Docker mode where Electron's Notification API is unavailable
    if (
      typeof Notification === 'undefined' ||
      typeof Notification.isSupported !== 'function' ||
      !Notification.isSupported()
    ) {
      logger.warn('Native notifications not supported');
      return;
    }

    const config = this.configManager.getConfig();

    const notification = new Notification({
      title: 'Claude Code Error',
      subtitle: error.context.projectName,
      body: error.message.slice(0, 200),
      sound: config.notifications.soundEnabled ? 'default' : undefined,
    });

    notification.on('click', () => {
      // Focus app window
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.show();
        this.mainWindow.focus();

        // Send deep link to renderer
        this.mainWindow.webContents.send('notification:clicked', error);
      }

      // Emit event for other listeners
      this.emit('notification-clicked', error);
    });

    notification.show();
  }

  // ===========================================================================
  // IPC Event Emission
  // ===========================================================================

  /**
   * Emits a notification:new event to the renderer.
   */
  private emitNewNotification(notification: StoredNotification): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('notification:new', notification);
    }

    this.emit('notification-new', notification);
  }

  /**
   * Emits a notification:updated event to the renderer.
   */
  private emitNotificationUpdated(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('notification:updated', {
        total: this.notifications.length,
        unreadCount: this.getUnreadCountSync(),
      });
    }

    this.emit('notification-updated', {
      total: this.notifications.length,
      unreadCount: this.getUnreadCountSync(),
    });
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Adds an error and shows a notification if enabled.
   * @param error - The detected error to add
   * @returns The stored notification, or null if filtered/throttled
   */
  async addError(error: DetectedError): Promise<StoredNotification | null> {
    // Deduplicate by toolUseId: the same tool call can appear in both the
    // subagent JSONL file and the parent session JSONL (as a progress event).
    // Keep the subagent-annotated version (with subagentId) when possible.
    if (error.toolUseId) {
      const existingIndex = this.notifications.findIndex((n) => n.toolUseId === error.toolUseId);
      if (existingIndex !== -1) {
        const existing = this.notifications[existingIndex];
        if (!existing.subagentId && error.subagentId) {
          // Replace: prefer the subagent-annotated version
          this.notifications.splice(existingIndex, 1);
        } else {
          // Already have a (better or equal) version — skip
          return null;
        }
      }
    }

    const storedNotification: StoredNotification = {
      ...error,
      isRead: false,
      createdAt: Date.now(),
    };

    // Add to the beginning of the list (newest first)
    this.notifications.unshift(storedNotification);

    // Prune if needed
    this.pruneNotifications();

    // Save to disk
    this.saveNotifications();

    // Emit new notification event
    this.emitNewNotification(storedNotification);
    // Emit authoritative counters (total/unread) so renderer badge stays in sync.
    this.emitNotificationUpdated();

    // Show native notification if enabled and not filtered
    if (await this.shouldNotify(error)) {
      this.showNativeNotification(error);
    }

    return storedNotification;
  }

  /**
   * Gets a paginated list of notifications.
   * @param options - Pagination options
   * @returns Paginated notifications result
   */
  async getNotifications(options?: GetNotificationsOptions): Promise<GetNotificationsResult> {
    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;

    // Notifications are already sorted newest first
    const notifications = this.notifications.slice(offset, offset + limit);
    const total = this.notifications.length;
    const hasMore = offset + notifications.length < total;

    return {
      notifications,
      total,
      totalCount: total,
      unreadCount: this.getUnreadCountSync(),
      hasMore,
    };
  }

  /**
   * Marks a notification as read.
   * @param id - The notification ID to mark as read
   * @returns true if found and marked, false otherwise
   */
  async markRead(id: string): Promise<boolean> {
    const notification = this.notifications.find((n) => n.id === id);

    if (!notification) {
      return false;
    }

    if (!notification.isRead) {
      notification.isRead = true;
      this.saveNotifications();
      this.emitNotificationUpdated();
    }

    return true;
  }

  /**
   * Marks all notifications as read.
   * @returns true on success
   */
  async markAllRead(): Promise<boolean> {
    let changed = false;

    for (const notification of this.notifications) {
      if (!notification.isRead) {
        notification.isRead = true;
        changed = true;
      }
    }

    if (changed) {
      this.saveNotifications();
      this.emitNotificationUpdated();
    }

    return true;
  }

  /**
   * Clears all notifications.
   */
  clear(): void {
    this.notifications = [];
    this.saveNotifications();
    this.emitNotificationUpdated();
  }

  /**
   * Clears all notifications (async version for IPC).
   * @returns true on success
   */
  async clearAll(): Promise<boolean> {
    this.clear();
    return true;
  }

  /**
   * Gets the count of unread notifications.
   * @returns Number of unread notifications (Promise for IPC compatibility)
   */
  async getUnreadCount(): Promise<number> {
    return this.notifications.filter((n) => !n.isRead).length;
  }

  /**
   * Gets the count of unread notifications (sync version).
   * @returns Number of unread notifications
   */
  getUnreadCountSync(): number {
    return this.notifications.filter((n) => !n.isRead).length;
  }

  /**
   * Gets a specific notification by ID.
   * @param id - The notification ID
   * @returns The notification or undefined if not found
   */
  getNotification(id: string): StoredNotification | undefined {
    return this.notifications.find((n) => n.id === id);
  }

  /**
   * Deletes a specific notification.
   * @param id - The notification ID to delete
   * @returns true if found and deleted, false otherwise
   */
  deleteNotification(id: string): boolean {
    const index = this.notifications.findIndex((n) => n.id === id);

    if (index === -1) {
      return false;
    }

    this.notifications.splice(index, 1);
    this.saveNotifications();
    this.emitNotificationUpdated();

    return true;
  }

  // ===========================================================================
  // Stats
  // ===========================================================================

  /**
   * Gets statistics about notifications.
   */
  getStats(): {
    total: number;
    unread: number;
    byProject: Record<string, number>;
    bySource: Record<string, number>;
  } {
    const byProject: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    for (const notification of this.notifications) {
      const projectName = notification.context.projectName;
      byProject[projectName] = (byProject[projectName] || 0) + 1;

      bySource[notification.source] = (bySource[notification.source] || 0) + 1;
    }

    return {
      total: this.notifications.length,
      unread: this.getUnreadCountSync(),
      byProject,
      bySource,
    };
  }
}
