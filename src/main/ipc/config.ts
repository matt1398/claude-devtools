/**
 * IPC Handlers for App Configuration.
 *
 * Handlers:
 * - config:get: Get full app configuration
 * - config:update: Update a specific config section
 * - config:addIgnoreRegex: Add an ignore pattern for notifications
 * - config:removeIgnoreRegex: Remove an ignore pattern
 * - config:addIgnoreRepository: Add a repository to ignore list
 * - config:removeIgnoreRepository: Remove a repository from ignore list
 * - config:snooze: Set snooze duration for notifications
 * - config:clearSnooze: Clear the snooze timer
 * - config:addTrigger: Add a new notification trigger
 * - config:updateTrigger: Update an existing notification trigger
 * - config:removeTrigger: Remove a notification trigger
 * - config:getTriggers: Get all notification triggers
 * - config:testTrigger: Test a trigger against historical session data
 */

import {
  getAutoDetectedClaudeBasePath,
  getClaudeBasePath,
} from '@main/utils/pathDecoder';
import { getErrorMessage } from '@shared/utils/errorHandling';
import { createLogger } from '@shared/utils/logger';
import { execFile } from 'child_process';
import { BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import {
  type AppConfig,
  ConfigManager,
  type NotificationTrigger,
  type TriggerContentType,
  type TriggerMatchField,
  type TriggerMode,
  type TriggerTokenType,
} from '../services';

import { validateConfigUpdatePayload } from './configValidation';
import { validateTriggerId } from './guards';

import type { TriggerColor } from '@shared/constants/triggerColors';
import type {
  ClaudeRootFolderSelection,
  ClaudeRootInfo,
  WslClaudeRootCandidate,
} from '@shared/types';

const logger = createLogger('IPC:config');
const execFileAsync = promisify(execFile);

// Get singleton instance
const configManager = ConfigManager.getInstance();
let onClaudeRootPathUpdated:
  | ((claudeRootPath: string | null) => Promise<void> | void)
  | null = null;

/**
 * Response type for config operations
 */
interface ConfigResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Initializes config handlers with callbacks that require app-level services.
 */
export function initializeConfigHandlers(
  options: {
    onClaudeRootPathUpdated?: (claudeRootPath: string | null) => Promise<void> | void;
  } = {}
): void {
  onClaudeRootPathUpdated = options.onClaudeRootPathUpdated ?? null;
}

/**
 * Registers all config-related IPC handlers.
 */
export function registerConfigHandlers(ipcMain: IpcMain): void {
  // Get full configuration
  ipcMain.handle('config:get', handleGetConfig);

  // Update configuration section
  ipcMain.handle('config:update', handleUpdateConfig);

  // Ignore regex pattern handlers
  ipcMain.handle('config:addIgnoreRegex', handleAddIgnoreRegex);
  ipcMain.handle('config:removeIgnoreRegex', handleRemoveIgnoreRegex);

  // Ignore repository handlers
  ipcMain.handle('config:addIgnoreRepository', handleAddIgnoreRepository);
  ipcMain.handle('config:removeIgnoreRepository', handleRemoveIgnoreRepository);

  // Snooze handlers
  ipcMain.handle('config:snooze', handleSnooze);
  ipcMain.handle('config:clearSnooze', handleClearSnooze);

  // Trigger management handlers
  ipcMain.handle('config:addTrigger', handleAddTrigger);
  ipcMain.handle('config:updateTrigger', handleUpdateTrigger);
  ipcMain.handle('config:removeTrigger', handleRemoveTrigger);
  ipcMain.handle('config:getTriggers', handleGetTriggers);
  ipcMain.handle('config:testTrigger', handleTestTrigger);

  // Session pin handlers
  ipcMain.handle('config:pinSession', handlePinSession);
  ipcMain.handle('config:unpinSession', handleUnpinSession);

  // Dialog handlers
  ipcMain.handle('config:selectFolders', handleSelectFolders);
  ipcMain.handle('config:selectClaudeRootFolder', handleSelectClaudeRootFolder);
  ipcMain.handle('config:getClaudeRootInfo', handleGetClaudeRootInfo);
  ipcMain.handle('config:findWslClaudeRoots', handleFindWslClaudeRoots);

  // Editor handlers
  ipcMain.handle('config:openInEditor', handleOpenInEditor);

  logger.info('Config handlers registered (including trigger management)');
}

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Handler for 'config:get' IPC call.
 * Returns the full app configuration.
 */
async function handleGetConfig(_event: IpcMainInvokeEvent): Promise<ConfigResult<AppConfig>> {
  try {
    const config = configManager.getConfig();
    return { success: true, data: config };
  } catch (error) {
    logger.error('Error in config:get:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:update' IPC call.
 * Updates a specific section of the configuration.
 * Returns the full updated config.
 */
async function handleUpdateConfig(
  _event: IpcMainInvokeEvent,
  section: unknown,
  data: unknown
): Promise<ConfigResult<AppConfig>> {
  try {
    const validation = validateConfigUpdatePayload(section, data);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const isClaudeRootUpdate =
      validation.section === 'general' &&
      Object.prototype.hasOwnProperty.call(validation.data, 'claudeRootPath');

    configManager.updateConfig(validation.section, validation.data);

    if (isClaudeRootUpdate && onClaudeRootPathUpdated) {
      const nextClaudeRootPath = (validation.data as { claudeRootPath?: string | null })
        .claudeRootPath;
      try {
        await onClaudeRootPathUpdated(nextClaudeRootPath ?? null);
      } catch (callbackError) {
        logger.error('Failed to apply updated Claude root path at runtime:', callbackError);
      }
    }

    const updatedConfig = configManager.getConfig();
    return { success: true, data: updatedConfig };
  } catch (error) {
    logger.error('Error in config:update:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:addIgnoreRegex' IPC call.
 * Adds a regex pattern to the notification ignore list.
 */
async function handleAddIgnoreRegex(
  _event: IpcMainInvokeEvent,
  pattern: string
): Promise<ConfigResult> {
  try {
    if (!pattern || typeof pattern !== 'string') {
      return { success: false, error: 'Pattern is required and must be a string' };
    }

    // Validate that the pattern is a valid regex
    try {
      new RegExp(pattern);
    } catch {
      return { success: false, error: 'Invalid regex pattern' };
    }

    configManager.addIgnoreRegex(pattern);
    return { success: true };
  } catch (error) {
    logger.error('Error in config:addIgnoreRegex:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:removeIgnoreRegex' IPC call.
 * Removes a regex pattern from the notification ignore list.
 */
async function handleRemoveIgnoreRegex(
  _event: IpcMainInvokeEvent,
  pattern: string
): Promise<ConfigResult> {
  try {
    if (!pattern || typeof pattern !== 'string') {
      return { success: false, error: 'Pattern is required and must be a string' };
    }

    configManager.removeIgnoreRegex(pattern);
    return { success: true };
  } catch (error) {
    logger.error('Error in config:removeIgnoreRegex:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:addIgnoreRepository' IPC call.
 * Adds a repository to the notification ignore list.
 */
async function handleAddIgnoreRepository(
  _event: IpcMainInvokeEvent,
  repositoryId: string
): Promise<ConfigResult> {
  try {
    if (!repositoryId || typeof repositoryId !== 'string') {
      return { success: false, error: 'Repository ID is required and must be a string' };
    }

    configManager.addIgnoreRepository(repositoryId);
    return { success: true };
  } catch (error) {
    logger.error('Error in config:addIgnoreRepository:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:removeIgnoreRepository' IPC call.
 * Removes a repository from the notification ignore list.
 */
async function handleRemoveIgnoreRepository(
  _event: IpcMainInvokeEvent,
  repositoryId: string
): Promise<ConfigResult> {
  try {
    if (!repositoryId || typeof repositoryId !== 'string') {
      return { success: false, error: 'Repository ID is required and must be a string' };
    }

    configManager.removeIgnoreRepository(repositoryId);
    return { success: true };
  } catch (error) {
    logger.error('Error in config:removeIgnoreRepository:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:snooze' IPC call.
 * Sets the snooze timer for notifications.
 */
async function handleSnooze(_event: IpcMainInvokeEvent, minutes: number): Promise<ConfigResult> {
  try {
    if (typeof minutes !== 'number' || minutes <= 0 || minutes > 24 * 60) {
      return { success: false, error: 'Minutes must be a positive number' };
    }

    configManager.setSnooze(minutes);
    return { success: true };
  } catch (error) {
    logger.error('Error in config:snooze:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:clearSnooze' IPC call.
 * Clears the snooze timer.
 */
async function handleClearSnooze(_event: IpcMainInvokeEvent): Promise<ConfigResult> {
  try {
    configManager.clearSnooze();
    return { success: true };
  } catch (error) {
    logger.error('Error in config:clearSnooze:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:addTrigger' - Adds a new notification trigger.
 */
async function handleAddTrigger(
  _event: IpcMainInvokeEvent,
  trigger: {
    id: string;
    name: string;
    enabled: boolean;
    contentType: string;
    mode?: TriggerMode;
    requireError?: boolean;
    toolName?: string;
    matchField?: string;
    matchPattern?: string;
    ignorePatterns?: string[];
    tokenThreshold?: number;
    tokenType?: TriggerTokenType;
    repositoryIds?: string[];
    color?: string;
  }
): Promise<ConfigResult> {
  try {
    if (!trigger.id || !trigger.name || !trigger.contentType) {
      return {
        success: false,
        error: 'Trigger must have id, name, and contentType',
      };
    }

    configManager.addTrigger({
      id: trigger.id,
      name: trigger.name,
      enabled: trigger.enabled,
      contentType: trigger.contentType as TriggerContentType,
      mode: trigger.mode ?? (trigger.requireError ? 'error_status' : 'content_match'),
      requireError: trigger.requireError,
      toolName: trigger.toolName,
      matchField: trigger.matchField as TriggerMatchField | undefined,
      matchPattern: trigger.matchPattern,
      ignorePatterns: trigger.ignorePatterns,
      tokenThreshold: trigger.tokenThreshold,
      tokenType: trigger.tokenType,
      repositoryIds: trigger.repositoryIds,
      color: trigger.color as TriggerColor | undefined,
      isBuiltin: false,
    });

    return { success: true };
  } catch (error) {
    logger.error('Error in config:addTrigger:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to add trigger',
    };
  }
}

/**
 * Handler for 'config:updateTrigger' - Updates an existing notification trigger.
 */
async function handleUpdateTrigger(
  _event: IpcMainInvokeEvent,
  triggerId: string,
  updates: Partial<{
    name: string;
    enabled: boolean;
    contentType: string;
    requireError: boolean;
    toolName: string;
    matchField: string;
    matchPattern: string;
    ignorePatterns: string[];
    mode: TriggerMode;
    tokenThreshold: number;
    tokenType: TriggerTokenType;
    repositoryIds: string[];
    color: string;
  }>
): Promise<ConfigResult> {
  try {
    const validatedTriggerId = validateTriggerId(triggerId);
    if (!validatedTriggerId.valid) {
      return {
        success: false,
        error: validatedTriggerId.error ?? 'Trigger ID is required',
      };
    }

    configManager.updateTrigger(validatedTriggerId.value!, updates as Partial<NotificationTrigger>);

    return { success: true };
  } catch (error) {
    logger.error('Error in config:updateTrigger:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update trigger',
    };
  }
}

/**
 * Handler for 'config:removeTrigger' - Removes a notification trigger.
 */
async function handleRemoveTrigger(
  _event: IpcMainInvokeEvent,
  triggerId: string
): Promise<ConfigResult> {
  try {
    const validatedTriggerId = validateTriggerId(triggerId);
    if (!validatedTriggerId.valid) {
      return {
        success: false,
        error: validatedTriggerId.error ?? 'Trigger ID is required',
      };
    }

    configManager.removeTrigger(validatedTriggerId.value!);

    return { success: true };
  } catch (error) {
    logger.error('Error in config:removeTrigger:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to remove trigger',
    };
  }
}

/**
 * Handler for 'config:getTriggers' - Gets all notification triggers.
 */
async function handleGetTriggers(
  _event: IpcMainInvokeEvent
): Promise<ConfigResult<NotificationTrigger[]>> {
  try {
    const triggers = configManager.getTriggers();

    return { success: true, data: triggers };
  } catch (error) {
    logger.error('Error in config:getTriggers:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get triggers',
    };
  }
}

/**
 * Handler for 'config:testTrigger' - Tests a trigger against historical session data.
 * Returns errors that would have been detected by the trigger.
 *
 * Safety: Results are truncated if:
 * - More than 10,000 total matches found
 * - More than 100 sessions scanned
 * - Test runs longer than 30 seconds
 */
async function handleTestTrigger(
  _event: IpcMainInvokeEvent,
  trigger: NotificationTrigger
): Promise<
  ConfigResult<{
    totalCount: number;
    errors: {
      id: string;
      sessionId: string;
      projectId: string;
      message: string;
      timestamp: number;
      source: string;
      toolUseId?: string;
      subagentId?: string;
      lineNumber?: number;
      context: { projectName: string };
    }[];
    /** True if results were truncated due to safety limits */
    truncated?: boolean;
  }>
> {
  try {
    const { errorDetector } = await import('../services');
    const result = await errorDetector.testTrigger(trigger, 50);

    // Map the DetectedError objects to the format expected by the renderer
    // Include toolUseId, subagentId, and lineNumber for deep linking to exact error location
    const errors = result.errors.map((error) => ({
      id: error.id,
      sessionId: error.sessionId,
      projectId: error.projectId,
      message: error.message,
      timestamp: error.timestamp,
      source: error.source,
      toolUseId: error.toolUseId,
      subagentId: error.subagentId,
      lineNumber: error.lineNumber,
      context: { projectName: error.context.projectName },
    }));

    return {
      success: true,
      data: { totalCount: result.totalCount, errors, truncated: result.truncated },
    };
  } catch (error) {
    logger.error('Error in config:testTrigger:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to test trigger',
    };
  }
}

/**
 * Handler for 'config:pinSession' - Pins a session for a project.
 */
async function handlePinSession(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<ConfigResult> {
  try {
    if (!projectId || typeof projectId !== 'string') {
      return { success: false, error: 'Project ID is required and must be a string' };
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'Session ID is required and must be a string' };
    }

    configManager.pinSession(projectId, sessionId);
    return { success: true };
  } catch (error) {
    logger.error('Error in config:pinSession:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:unpinSession' - Unpins a session for a project.
 */
async function handleUnpinSession(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string
): Promise<ConfigResult> {
  try {
    if (!projectId || typeof projectId !== 'string') {
      return { success: false, error: 'Project ID is required and must be a string' };
    }
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'Session ID is required and must be a string' };
    }

    configManager.unpinSession(projectId, sessionId);
    return { success: true };
  } catch (error) {
    logger.error('Error in config:unpinSession:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:openInEditor' - Opens the config JSON file in an external editor.
 * Tries editors in order: $VISUAL, $EDITOR, cursor, code, then falls back to system open.
 */
async function handleOpenInEditor(_event: IpcMainInvokeEvent): Promise<ConfigResult> {
  try {
    const configPath = configManager.getConfigPath();

    // Try editors in priority order
    const editors: string[] = [];
    if (process.env.VISUAL) editors.push(process.env.VISUAL);
    if (process.env.EDITOR) editors.push(process.env.EDITOR);
    editors.push('cursor', 'code', 'subl', 'zed');

    for (const editor of editors) {
      try {
        await new Promise<void>((resolve, reject) => {
          const child = execFile(editor, [configPath], { timeout: 5000 });
          // If the process spawns successfully, resolve after a short delay
          // (editors typically fork and the parent exits quickly)
          const timer = setTimeout(() => resolve(), 500);
          child.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        });
        return { success: true };
      } catch {
        // Editor not found, try next
        continue;
      }
    }

    // Fallback: open with system default
    const { shell } = await import('electron');
    const errorMessage = await shell.openPath(configPath);
    if (errorMessage) {
      return { success: false, error: errorMessage };
    }
    return { success: true };
  } catch (error) {
    logger.error('Error in config:openInEditor:', error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * Handler for 'config:selectFolders' - Opens native folder selection dialog.
 * Allows users to select one or more folders for trigger project scope.
 */
async function handleSelectFolders(_event: IpcMainInvokeEvent): Promise<ConfigResult<string[]>> {
  try {
    // Get the focused window for proper dialog parenting
    const focusedWindow = BrowserWindow.getFocusedWindow();

    // dialog.showOpenDialog accepts either (options) or (window, options)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'multiSelections'],
      title: 'Select Project Folders',
      buttonLabel: 'Select',
    };

    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled) {
      return { success: true, data: [] };
    }

    return { success: true, data: result.filePaths };
  } catch (error) {
    logger.error('Error in config:selectFolders:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to open folder dialog',
    };
  }
}

/**
 * Handler for 'config:selectClaudeRootFolder' - Opens native folder picker for Claude root.
 */
async function handleSelectClaudeRootFolder(
  _event: IpcMainInvokeEvent
): Promise<ConfigResult<ClaudeRootFolderSelection | null>> {
  try {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const currentRootPath = getClaudeBasePath();
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Select Claude Root Folder',
      buttonLabel: 'Select Folder',
      defaultPath: currentRootPath,
    };

    const result = focusedWindow
      ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, data: null };
    }

    const selectedPath = path.resolve(path.normalize(result.filePaths[0]));
    const folderName = path.basename(selectedPath);
    const projectsDir = path.join(selectedPath, 'projects');
    const hasProjectsDir = (() => {
      try {
        return fs.existsSync(projectsDir) && fs.statSync(projectsDir).isDirectory();
      } catch {
        return false;
      }
    })();

    return {
      success: true,
      data: {
        path: selectedPath,
        isClaudeDirName: folderName === '.claude',
        hasProjectsDir,
      },
    };
  } catch (error) {
    logger.error('Error in config:selectClaudeRootFolder:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to open Claude root folder dialog',
    };
  }
}

/**
 * Handler for 'config:getClaudeRootInfo' - Returns default/custom/effective local Claude root paths.
 */
async function handleGetClaudeRootInfo(
  _event: IpcMainInvokeEvent
): Promise<ConfigResult<ClaudeRootInfo>> {
  try {
    const customPath = configManager.getConfig().general.claudeRootPath;
    const defaultPath = getAutoDetectedClaudeBasePath();
    const resolvedPath = getClaudeBasePath();

    return {
      success: true,
      data: {
        defaultPath,
        resolvedPath,
        customPath,
      },
    };
  } catch (error) {
    logger.error('Error in config:getClaudeRootInfo:', error);

    // Last-resort fallback to a best-effort auto-detected value.
    const fallbackDefault = getAutoDetectedClaudeBasePath();

    return {
      success: true,
      data: {
        defaultPath: fallbackDefault,
        resolvedPath: fallbackDefault,
        customPath: null,
      },
    };
  }
}

function normalizeWslHomePath(home: string): string | null {
  const trimmed = home.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  let normalized = path.posix.normalize(trimmed);
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function toWslUncPath(prefix: '\\\\wsl.localhost' | '\\\\wsl$', distro: string, posixPath: string): string {
  const uncSuffix = posixPath.replace(/\//g, '\\');
  return `${prefix}\\${distro}${uncSuffix}`;
}

function getWslExecutableCandidates(): string[] {
  const candidates = new Set<string>();

  const windir = process.env.WINDIR;
  if (windir) {
    candidates.add(path.join(windir, 'System32', 'wsl.exe'));
    candidates.add(path.join(windir, 'Sysnative', 'wsl.exe'));
  }

  candidates.add('wsl.exe');
  return Array.from(candidates);
}

async function runWsl(args: string[], timeout = 5000): Promise<{ stdout: string; stderr: string }> {
  const candidates = getWslExecutableCandidates();
  let lastError: unknown = null;

  for (const executable of candidates) {
    try {
      const result = await execFileAsync(executable, args, { timeout });
      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to execute wsl.exe');
}

async function listWslDistros(): Promise<string[]> {
  try {
    const { stdout } = await runWsl(['-l', '-q'], 4000);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    // Fallback for environments where -q behavior is inconsistent.
    const { stdout } = await runWsl(['-l'], 4000);
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.toLowerCase().startsWith('windows subsystem for linux'))
      .filter((line) => !line.toLowerCase().includes('default version'))
      .map(stripDefaultSuffix);
  }
}

function stripDefaultSuffix(input: string): string {
  const suffix = '(default)';
  if (!input.toLowerCase().endsWith(suffix)) {
    return input;
  }

  return input.slice(0, input.length - suffix.length).trimEnd();
}

async function resolveWslHome(distro: string): Promise<string | null> {
  try {
    const { stdout } = await runWsl(
      ['-d', distro, '--', 'sh', '-lc', 'printf %s "$HOME"'],
      5000
    );
    return normalizeWslHomePath(stdout);
  } catch {
    return null;
  }
}

/**
 * Handler for 'config:findWslClaudeRoots' - Find Windows UNC candidates for WSL Claude roots.
 */
async function handleFindWslClaudeRoots(
  _event: IpcMainInvokeEvent
): Promise<ConfigResult<WslClaudeRootCandidate[]>> {
  try {
    if (process.platform !== 'win32') {
      return { success: true, data: [] };
    }

    const distros = await listWslDistros();
    if (distros.length === 0) {
      return { success: true, data: [] };
    }

    const candidates: WslClaudeRootCandidate[] = [];
    const seen = new Set<string>();
    for (const distro of distros) {
      const homePath = await resolveWslHome(distro);
      const homeCandidates = new Set<string>();
      if (homePath) {
        homeCandidates.add(homePath);
      }
      if (process.env.USERNAME) {
        homeCandidates.add(`/home/${process.env.USERNAME}`);
      }
      homeCandidates.add('/root');

      for (const homeCandidate of homeCandidates) {
        const normalizedHome = normalizeWslHomePath(homeCandidate);
        if (!normalizedHome) {
          continue;
        }
        const claudePosixPath = path.posix.join(normalizedHome, '.claude');

        const uncPaths = [
          toWslUncPath('\\\\wsl.localhost', distro, claudePosixPath),
          toWslUncPath('\\\\wsl$', distro, claudePosixPath),
        ];

        for (const claudeUncPath of uncPaths) {
          if (seen.has(claudeUncPath.toLowerCase())) {
            continue;
          }
          seen.add(claudeUncPath.toLowerCase());

          const projectsPath = path.join(claudeUncPath, 'projects');
          const hasProjectsDir = (() => {
            try {
              return fs.existsSync(projectsPath) && fs.statSync(projectsPath).isDirectory();
            } catch {
              return false;
            }
          })();

          candidates.push({
            distro,
            path: claudeUncPath,
            hasProjectsDir,
          });
        }
      }
    }

    return { success: true, data: candidates };
  } catch (error) {
    logger.error('Error in config:findWslClaudeRoots:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to detect WSL Claude paths',
    };
  }
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Removes all config-related IPC handlers.
 * Should be called when shutting down.
 */
export function removeConfigHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('config:get');
  ipcMain.removeHandler('config:update');
  ipcMain.removeHandler('config:addIgnoreRegex');
  ipcMain.removeHandler('config:removeIgnoreRegex');
  ipcMain.removeHandler('config:addIgnoreRepository');
  ipcMain.removeHandler('config:removeIgnoreRepository');
  ipcMain.removeHandler('config:snooze');
  ipcMain.removeHandler('config:clearSnooze');
  ipcMain.removeHandler('config:addTrigger');
  ipcMain.removeHandler('config:updateTrigger');
  ipcMain.removeHandler('config:removeTrigger');
  ipcMain.removeHandler('config:getTriggers');
  ipcMain.removeHandler('config:testTrigger');
  ipcMain.removeHandler('config:pinSession');
  ipcMain.removeHandler('config:unpinSession');
  ipcMain.removeHandler('config:selectFolders');
  ipcMain.removeHandler('config:selectClaudeRootFolder');
  ipcMain.removeHandler('config:getClaudeRootInfo');
  ipcMain.removeHandler('config:findWslClaudeRoots');
  ipcMain.removeHandler('config:openInEditor');
  logger.info('Config handlers removed');
}
