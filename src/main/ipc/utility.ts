/**
 * IPC Handlers for Utility Operations.
 *
 * Handlers:
 * - shell:openPath: Opens a folder or file in the system's default application
 * - read-claude-md-files: Reads all global CLAUDE.md files for a project
 * - read-directory-claude-md: Reads a specific directory's CLAUDE.md file
 * - read-mentioned-file: Validates mentioned files for context injection
 */

import { createLogger } from '@shared/utils/logger';
import { app, type IpcMain, type IpcMainInvokeEvent, shell } from 'electron';
import * as fs from 'fs';

import { type ClaudeMdFileInfo, readAgentConfigs, readAllClaudeMdFiles, readDirectoryClaudeMd } from '../services';

import type { AgentConfig } from '@shared/types/api';

const logger = createLogger('IPC:utility');
import { validateFilePath, validateOpenPath } from '../utils/pathValidation';
import { countTokens } from '../utils/tokenizer';

/**
 * Registers all utility-related IPC handlers.
 */
export function registerUtilityHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get-app-version', handleGetAppVersion);
  ipcMain.handle('shell:openPath', handleShellOpenPath);
  ipcMain.handle('shell:openExternal', handleShellOpenExternal);
  ipcMain.handle('read-claude-md-files', handleReadClaudeMdFiles);
  ipcMain.handle('read-directory-claude-md', handleReadDirectoryClaudeMd);
  ipcMain.handle('read-mentioned-file', handleReadMentionedFile);
  ipcMain.handle('read-agent-configs', handleReadAgentConfigs);

  logger.info('Utility handlers registered');
}

/**
 * Removes all utility IPC handlers.
 */
export function removeUtilityHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('get-app-version');
  ipcMain.removeHandler('shell:openPath');
  ipcMain.removeHandler('shell:openExternal');
  ipcMain.removeHandler('read-claude-md-files');
  ipcMain.removeHandler('read-directory-claude-md');
  ipcMain.removeHandler('read-mentioned-file');
  ipcMain.removeHandler('read-agent-configs');

  logger.info('Utility handlers removed');
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handler for 'get-app-version' IPC call.
 * Returns the app version from package.json.
 */
function handleGetAppVersion(): string {
  return app.getVersion();
}

/**
 * Handler for 'shell:openExternal' IPC call.
 * Opens a URL in the system's default browser.
 */
async function handleShellOpenExternal(
  _event: IpcMainInvokeEvent,
  url: string
): Promise<{ success: boolean; error?: string }> {
  try {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return { success: false, error: 'Invalid URL' };
    }

    const protocol = parsedUrl.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:' && protocol !== 'mailto:') {
      logger.error(`shell:openExternal - invalid URL scheme: ${url}`);
      return { success: false, error: 'Only http, https, and mailto URLs are allowed' };
    }

    await shell.openExternal(parsedUrl.toString());
    return { success: true };
  } catch (error) {
    logger.error('Error in shell:openExternal:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Handler for 'shell:openPath' IPC call.
 * Opens a folder or file in the system's default application (Finder on macOS).
 * Validates path security before opening.
 */
async function handleShellOpenPath(
  _event: IpcMainInvokeEvent,
  targetPath: string,
  projectRoot?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Validate path security
    const validation = validateOpenPath(targetPath, projectRoot ?? null);
    if (!validation.valid) {
      logger.error(`shell:openPath - validation failed: ${validation.error ?? 'Unknown error'}`);
      return { success: false, error: validation.error };
    }

    const safePath = validation.normalizedPath!;

    // Check if path exists
    if (!fs.existsSync(safePath)) {
      logger.error(`shell:openPath - path does not exist: ${safePath}`);
      return { success: false, error: 'Path does not exist' };
    }

    // Open in default application (Finder on macOS)
    const errorMessage = await shell.openPath(safePath);
    if (errorMessage) {
      logger.error(`shell:openPath - failed: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }

    return { success: true };
  } catch (error) {
    logger.error('Error in shell:openPath:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Handler for 'read-claude-md-files' IPC call.
 * Reads all global CLAUDE.md files for a project.
 */
async function handleReadClaudeMdFiles(
  _event: IpcMainInvokeEvent,
  projectRoot: string
): Promise<Record<string, ClaudeMdFileInfo>> {
  try {
    const result = await readAllClaudeMdFiles(projectRoot);
    // Convert Map to object for IPC serialization
    const files: Record<string, ClaudeMdFileInfo> = {};
    result.files.forEach((info, key) => {
      files[key] = info;
    });

    return files;
  } catch (error) {
    logger.error(`Error in read-claude-md-files:`, error);
    return {};
  }
}

/**
 * Handler for 'read-directory-claude-md' IPC call.
 * Reads a specific directory's CLAUDE.md file.
 */
async function handleReadDirectoryClaudeMd(
  _event: IpcMainInvokeEvent,
  dirPath: string
): Promise<ClaudeMdFileInfo> {
  try {
    const info = await readDirectoryClaudeMd(dirPath);
    return info;
  } catch (error) {
    logger.error(`Error in read-directory-claude-md:`, error);
    return {
      path: dirPath,
      exists: false,
      charCount: 0,
      estimatedTokens: 0,
    };
  }
}

/**
 * Handler for 'read-mentioned-file' IPC call.
 * Validates mentioned files for context injection.
 * Returns file info if file exists, is a regular file, within allowed directories, and within token limits.
 *
 * Security: Validates path against allowed directories and sensitive file patterns.
 */
async function handleReadMentionedFile(
  _event: IpcMainInvokeEvent,
  absolutePath: string,
  projectRoot: string,
  maxTokens: number = 25000
): Promise<{ path: string; exists: boolean; charCount: number; estimatedTokens: number } | null> {
  try {
    // Validate path security
    const validation = validateFilePath(absolutePath, projectRoot || null);
    if (!validation.valid) {
      return null;
    }

    const safePath = validation.normalizedPath!;

    // Check if file exists
    if (!fs.existsSync(safePath)) {
      return null;
    }

    // Check if it's a file (not directory)
    const stats = fs.statSync(safePath);
    if (!stats.isFile()) {
      return null;
    }

    // Read file content
    const content = fs.readFileSync(safePath, 'utf8');

    // Calculate tokens
    const estimatedTokens = countTokens(content);

    // Check token limit
    if (estimatedTokens > maxTokens) {
      return null;
    }

    return {
      path: safePath,
      exists: true,
      charCount: content.length,
      estimatedTokens,
    };
  } catch (error) {
    logger.error(`Error in read-mentioned-file for ${absolutePath}:`, error);
    return null;
  }
}

/**
 * Handler for 'read-agent-configs' IPC call.
 * Reads agent definitions from project's .claude/agents/ directory.
 */
async function handleReadAgentConfigs(
  _event: IpcMainInvokeEvent,
  projectRoot: string
): Promise<Record<string, AgentConfig>> {
  try {
    return await readAgentConfigs(projectRoot);
  } catch (error) {
    logger.error('Error in read-agent-configs:', error);
    return {};
  }
}
