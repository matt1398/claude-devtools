/**
 * IPC Handlers for Search Operations.
 *
 * Handlers:
 * - search-sessions: Search sessions in a project
 */

import { createLogger } from '@shared/utils/logger';
import { isSessionIdFragment } from '@shared/utils/sessionIdValidator';
import { type IpcMain, type IpcMainInvokeEvent } from 'electron';

import {
  type FindSessionByIdResult,
  type FindSessionsByPartialIdResult,
  type SearchSessionsResult,
} from '../types';

import {
  coerceSearchMaxResults,
  validateProjectId,
  validateSearchQuery,
  validateSessionId,
} from './guards';

import type { ServiceContextRegistry } from '../services';

const logger = createLogger('IPC:search');

// Service registry - set via initialize
let registry: ServiceContextRegistry;

/**
 * Initializes search handlers with service registry.
 */
export function initializeSearchHandlers(contextRegistry: ServiceContextRegistry): void {
  registry = contextRegistry;
}

/**
 * Registers all search-related IPC handlers.
 */
export function registerSearchHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('search-sessions', handleSearchSessions);
  ipcMain.handle('search-all-projects', handleSearchAllProjects);
  ipcMain.handle('find-session-by-id', handleFindSessionById);
  ipcMain.handle('find-sessions-by-partial-id', handleFindSessionsByPartialId);

  logger.info('Search handlers registered');
}

/**
 * Removes all search IPC handlers.
 */
export function removeSearchHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('search-sessions');
  ipcMain.removeHandler('search-all-projects');
  ipcMain.removeHandler('find-session-by-id');
  ipcMain.removeHandler('find-sessions-by-partial-id');

  logger.info('Search handlers removed');
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handler for 'search-sessions' IPC call.
 * Searches sessions in a project for a query string.
 */
async function handleSearchSessions(
  _event: IpcMainInvokeEvent,
  projectId: string,
  query: string,
  maxResults?: number,
  fuzzy?: boolean
): Promise<SearchSessionsResult> {
  try {
    const validatedProject = validateProjectId(projectId);
    const validatedQuery = validateSearchQuery(query);
    if (!validatedProject.valid || !validatedQuery.valid) {
      logger.error(
        `search-sessions rejected: ${validatedProject.error ?? validatedQuery.error ?? 'Invalid inputs'}`
      );
      return { results: [], totalMatches: 0, sessionsSearched: 0, query };
    }

    const { projectScanner } = registry.getActive();
    const safeMaxResults = coerceSearchMaxResults(maxResults, 50);
    const result = await projectScanner.searchSessions(
      validatedProject.value!,
      validatedQuery.value!,
      safeMaxResults,
      fuzzy === true
    );
    return result;
  } catch (error) {
    logger.error(`Error in search-sessions for project ${projectId}:`, error);
    return { results: [], totalMatches: 0, sessionsSearched: 0, query };
  }
}

/**
 * Handler for 'search-all-projects' IPC call.
 * Searches sessions across all projects for a query string.
 */
async function handleSearchAllProjects(
  _event: IpcMainInvokeEvent,
  query: string,
  maxResults?: number,
  fuzzy?: boolean
): Promise<SearchSessionsResult> {
  try {
    const validatedQuery = validateSearchQuery(query);
    if (!validatedQuery.valid) {
      logger.error(`search-all-projects rejected: ${validatedQuery.error ?? 'Invalid query'}`);
      return { results: [], totalMatches: 0, sessionsSearched: 0, query };
    }

    const { projectScanner } = registry.getActive();
    const safeMaxResults = coerceSearchMaxResults(maxResults, 50);
    const result = await projectScanner.searchAllProjects(
      validatedQuery.value!,
      safeMaxResults,
      fuzzy === true
    );
    return result;
  } catch (error) {
    logger.error('Error in search-all-projects:', error);
    return { results: [], totalMatches: 0, sessionsSearched: 0, query };
  }
}

/**
 * Handler for 'find-session-by-id' IPC call.
 * Finds a session by its UUID across all projects.
 */
async function handleFindSessionById(
  _event: IpcMainInvokeEvent,
  sessionId: string
): Promise<FindSessionByIdResult> {
  try {
    const validatedSession = validateSessionId(sessionId);
    if (!validatedSession.valid) {
      logger.error(`find-session-by-id rejected: ${validatedSession.error ?? 'Invalid sessionId'}`);
      return { found: false };
    }

    const { projectScanner } = registry.getActive();
    return await projectScanner.findSessionById(validatedSession.value!);
  } catch (error) {
    logger.error(`Error in find-session-by-id for ${sessionId}:`, error);
    return { found: false };
  }
}

/**
 * Handler for 'find-sessions-by-partial-id' IPC call.
 * Finds sessions whose IDs contain the given fragment.
 */
async function handleFindSessionsByPartialId(
  _event: IpcMainInvokeEvent,
  fragment: string
): Promise<FindSessionsByPartialIdResult> {
  try {
    const trimmed = typeof fragment === 'string' ? fragment.trim() : '';
    if (!isSessionIdFragment(trimmed)) {
      logger.error(`find-sessions-by-partial-id rejected: invalid fragment`);
      return { found: false, results: [] };
    }

    const { projectScanner } = registry.getActive();
    return await projectScanner.findSessionsByPartialId(trimmed);
  } catch (error) {
    logger.error(`Error in find-sessions-by-partial-id for ${fragment}:`, error);
    return { found: false, results: [] };
  }
}
