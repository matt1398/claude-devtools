/**
 * Infrastructure services - Core application infrastructure.
 *
 * Exports:
 * - DataCache: LRU cache with TTL for parsed session data
 * - FileWatcher: Watches for file changes with debouncing
 * - ConfigManager: App configuration management
 * - TriggerManager: Notification trigger management (used internally by ConfigManager)
 * - NotificationManager: Notification handling and persistence
 * - FileSystemProvider: Abstract filesystem interface
 * - LocalFileSystemProvider: Local fs implementation
 * - SshFileSystemProvider: SSH/SFTP implementation
 * - SshConnectionManager: SSH connection lifecycle
 * - ServiceContext: Service bundle for a single workspace context
 * - ServiceContextRegistry: Registry coordinator for all contexts
 * - HttpServer: Fastify-based HTTP server for API and static file serving
 */

export * from './ConfigManager';
export * from './DataCache';
export type * from './FileSystemProvider';
export * from './FileWatcher';
export * from './HttpServer';
export * from './LocalFileSystemProvider';
export * from './NotificationManager';
export * from './ServiceContext';
export * from './ServiceContextRegistry';
export * from './SshConfigParser';
export * from './SshConnectionManager';
export * from './SshFileSystemProvider';
export * from './SubagentMessageCache';
export * from './TriggerManager';
export * from './UpdaterService';
