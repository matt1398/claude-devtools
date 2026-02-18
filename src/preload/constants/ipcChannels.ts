/**
 * IPC Channel Constants
 *
 * Centralized IPC channel names to avoid string duplication in preload bridge.
 */

// =============================================================================
// Config API Channels
// =============================================================================

/** Get application config */
export const CONFIG_GET = 'config:get';

/** Update config section */
export const CONFIG_UPDATE = 'config:update';

/** Add regex pattern to ignore list */
export const CONFIG_ADD_IGNORE_REGEX = 'config:addIgnoreRegex';

/** Remove regex pattern from ignore list */
export const CONFIG_REMOVE_IGNORE_REGEX = 'config:removeIgnoreRegex';

/** Add repository to ignore list */
export const CONFIG_ADD_IGNORE_REPOSITORY = 'config:addIgnoreRepository';

/** Remove repository from ignore list */
export const CONFIG_REMOVE_IGNORE_REPOSITORY = 'config:removeIgnoreRepository';

/** Snooze notifications */
export const CONFIG_SNOOZE = 'config:snooze';

/** Clear notification snooze */
export const CONFIG_CLEAR_SNOOZE = 'config:clearSnooze';

/** Add notification trigger */
export const CONFIG_ADD_TRIGGER = 'config:addTrigger';

/** Update notification trigger */
export const CONFIG_UPDATE_TRIGGER = 'config:updateTrigger';

/** Remove notification trigger */
export const CONFIG_REMOVE_TRIGGER = 'config:removeTrigger';

/** Get all triggers */
export const CONFIG_GET_TRIGGERS = 'config:getTriggers';

/** Test a trigger */
export const CONFIG_TEST_TRIGGER = 'config:testTrigger';

/** Select folders dialog */
export const CONFIG_SELECT_FOLDERS = 'config:selectFolders';

/** Select local Claude root folder */
export const CONFIG_SELECT_CLAUDE_ROOT_FOLDER = 'config:selectClaudeRootFolder';

/** Get effective/default Claude root folder info */
export const CONFIG_GET_CLAUDE_ROOT_INFO = 'config:getClaudeRootInfo';

/** Find WSL Claude root candidates (Windows only) */
export const CONFIG_FIND_WSL_CLAUDE_ROOTS = 'config:findWslClaudeRoots';

/** Open config file in external editor */
export const CONFIG_OPEN_IN_EDITOR = 'config:openInEditor';

/** Pin a session */
export const CONFIG_PIN_SESSION = 'config:pinSession';

/** Unpin a session */
export const CONFIG_UNPIN_SESSION = 'config:unpinSession';

/** Hide a session */
export const CONFIG_HIDE_SESSION = 'config:hideSession';

/** Unhide a session */
export const CONFIG_UNHIDE_SESSION = 'config:unhideSession';

/** Bulk hide sessions */
export const CONFIG_HIDE_SESSIONS = 'config:hideSessions';

/** Bulk unhide sessions */
export const CONFIG_UNHIDE_SESSIONS = 'config:unhideSessions';

// =============================================================================
// SSH API Channels
// =============================================================================

/** Connect to SSH host */
export const SSH_CONNECT = 'ssh:connect';

/** Disconnect SSH and switch to local */
export const SSH_DISCONNECT = 'ssh:disconnect';

/** Get current SSH connection state */
export const SSH_GET_STATE = 'ssh:getState';

/** Test SSH connection without switching */
export const SSH_TEST = 'ssh:test';

/** Get SSH config hosts from ~/.ssh/config */
export const SSH_GET_CONFIG_HOSTS = 'ssh:getConfigHosts';

/** Resolve a single SSH config host alias */
export const SSH_RESOLVE_HOST = 'ssh:resolveHost';

/** Save last SSH connection config */
export const SSH_SAVE_LAST_CONNECTION = 'ssh:saveLastConnection';

/** Get last saved SSH connection config */
export const SSH_GET_LAST_CONNECTION = 'ssh:getLastConnection';

/** SSH status event channel (main -> renderer) */
export const SSH_STATUS = 'ssh:status';

// =============================================================================
// Updater API Channels
// =============================================================================

/** Check for updates */
export const UPDATER_CHECK = 'updater:check';

/** Download available update */
export const UPDATER_DOWNLOAD = 'updater:download';

/** Quit and install downloaded update */
export const UPDATER_INSTALL = 'updater:install';

/** Status event channel (main -> renderer) */
export const UPDATER_STATUS = 'updater:status';

// =============================================================================
// Context API Channels
// =============================================================================

/** List all available contexts (local + SSH) */
export const CONTEXT_LIST = 'context:list';

/** Get active context ID */
export const CONTEXT_GET_ACTIVE = 'context:getActive';

/** Switch to a different context */
export const CONTEXT_SWITCH = 'context:switch';

/** Context changed event channel (main -> renderer) */
export const CONTEXT_CHANGED = 'context:changed';

// =============================================================================
// HTTP Server API Channels
// =============================================================================

/** Start HTTP sidecar server */
export const HTTP_SERVER_START = 'httpServer:start';

/** Stop HTTP sidecar server */
export const HTTP_SERVER_STOP = 'httpServer:stop';

/** Get HTTP server status */
export const HTTP_SERVER_GET_STATUS = 'httpServer:getStatus';

// =============================================================================
// Window Controls API (Windows / Linux — native title bar is hidden)
// =============================================================================

/** Minimize window */
export const WINDOW_MINIMIZE = 'window:minimize';

/** Maximize or restore window */
export const WINDOW_MAXIMIZE = 'window:maximize';

/** Close window */
export const WINDOW_CLOSE = 'window:close';

/** Whether the window is currently maximized */
export const WINDOW_IS_MAXIMIZED = 'window:isMaximized';

// =============================================================================
// Deep Link API Channels
// =============================================================================

/** Deep link navigation event channel (main -> renderer) */
export const DEEPLINK_NAVIGATE = 'deeplink:navigate';
