/**
 * IPC Handlers for the per-session Scratchpad viewer.
 *
 * Surface:
 * - scratchpad:list      → ScratchpadListResult (one directory level)
 * - scratchpad:readFile  → ScratchpadReadFileResult (text, image or binary stub)
 * - scratchpad:openPath  → reveal a file in the OS file manager, or open a directory
 *
 * Read-only. Scratchpads live in the local temp directory, so SSH contexts are
 * rejected rather than resolved against the wrong machine.
 */

import { scratchpadReader } from '@main/services/discovery/ScratchpadReader';
import { createLogger } from '@shared/utils/logger';
import { type IpcMain, type IpcMainInvokeEvent, shell } from 'electron';
import * as fs from 'fs';

import { validateScratchpadArgs } from './guards';

import type { ServiceContextRegistry } from '../services';
import type {
  ScratchpadListResult,
  ScratchpadOpenResult,
  ScratchpadReadFileResult,
} from '@shared/types';

const SCRATCHPAD_LIST = 'scratchpad:list';
const SCRATCHPAD_READ_FILE = 'scratchpad:readFile';
const SCRATCHPAD_OPEN_PATH = 'scratchpad:openPath';

const logger = createLogger('IPC:scratchpad');

let registry: ServiceContextRegistry;

export function initializeScratchpadHandlers(contextRegistry: ServiceContextRegistry): void {
  registry = contextRegistry;
}

export function registerScratchpadHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(SCRATCHPAD_LIST, handleList);
  ipcMain.handle(SCRATCHPAD_READ_FILE, handleReadFile);
  ipcMain.handle(SCRATCHPAD_OPEN_PATH, handleOpenPath);
  logger.info('Scratchpad handlers registered');
}

export function removeScratchpadHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler(SCRATCHPAD_LIST);
  ipcMain.removeHandler(SCRATCHPAD_READ_FILE);
  ipcMain.removeHandler(SCRATCHPAD_OPEN_PATH);
}

function sshUnsupported(): { success: false; error: string } | null {
  return registry?.getActive().type === 'ssh'
    ? { success: false, error: 'Scratchpads are only available for local sessions' }
    : null;
}

async function handleList(
  _event: IpcMainInvokeEvent,
  projectId: unknown,
  sessionId: unknown,
  relativeDir: unknown
): Promise<ScratchpadListResult> {
  const args = validateScratchpadArgs(projectId, sessionId, relativeDir);
  if (!args.valid) return { success: false, error: args.error };
  const unsupported = sshUnsupported();
  if (unsupported) return unsupported;
  try {
    const listing = await scratchpadReader.list(args.projectId, args.sessionId, args.relativePath);
    return { success: true, ...listing };
  } catch (error) {
    logger.error('Error in scratchpad:list:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleReadFile(
  _event: IpcMainInvokeEvent,
  projectId: unknown,
  sessionId: unknown,
  relativePath: unknown
): Promise<ScratchpadReadFileResult> {
  const args = validateScratchpadArgs(projectId, sessionId, relativePath);
  if (!args.valid) return { success: false, error: args.error };
  const unsupported = sshUnsupported();
  if (unsupported) return unsupported;
  try {
    const result = await scratchpadReader.readFile(
      args.projectId,
      args.sessionId,
      args.relativePath
    );
    return { success: true, ...result };
  } catch (error) {
    logger.error('Error in scratchpad:readFile:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleOpenPath(
  _event: IpcMainInvokeEvent,
  projectId: unknown,
  sessionId: unknown,
  relativePath: unknown
): Promise<ScratchpadOpenResult> {
  const args = validateScratchpadArgs(projectId, sessionId, relativePath);
  if (!args.valid) return { success: false, error: args.error };
  const unsupported = sshUnsupported();
  if (unsupported) return unsupported;
  try {
    const rootPath = scratchpadReader.getRootPath(args.projectId, args.sessionId);
    const target = await scratchpadReader.resolveInside(rootPath, args.relativePath);
    if ((await fs.promises.stat(target)).isDirectory()) {
      const error = await shell.openPath(target);
      return error ? { success: false, error } : { success: true };
    }
    shell.showItemInFolder(target);
    return { success: true };
  } catch (error) {
    logger.error('Error in scratchpad:openPath:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
