/**
 * IPC Handlers for Subagent Operations.
 *
 * Handlers:
 * - get-subagent-detail: Get detailed information for a specific subagent
 *   (used by the drill-down modal — returns parsed chunks).
 * - subagent:get-messages: Lazy-load a subagent's full message body for
 *   inline expansion in SubagentItem. Backed by SubagentMessageCache so
 *   repeat expansions are instant.
 */

import { SubagentMessageCache } from '@main/services/infrastructure/SubagentMessageCache';
import { buildSubagentsPath } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import { type IpcMain, type IpcMainInvokeEvent } from 'electron';
import * as path from 'path';

import { type ParsedMessage, type SubagentDetail } from '../types';

import { validateProjectId, validateSessionId, validateSubagentId } from './guards';

import type { ServiceContextRegistry } from '../services';

const logger = createLogger('IPC:subagents');

/**
 * IPC channel for lazy-loading subagent message bodies.
 * Mirrors `SUBAGENT_GET_MESSAGES` in `preload/constants/ipcChannels.ts` —
 * kept as a literal here because main can't import from preload (boundary
 * rule). Update both sides if this string changes.
 */
const CHANNEL_GET_SUBAGENT_MESSAGES = 'subagent:get-messages';

// Service registry - set via initialize
let registry: ServiceContextRegistry;

/**
 * Initializes subagent handlers with service registry.
 */
export function initializeSubagentHandlers(contextRegistry: ServiceContextRegistry): void {
  registry = contextRegistry;
}

/**
 * Registers all subagent-related IPC handlers.
 */
export function registerSubagentHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('get-subagent-detail', handleGetSubagentDetail);
  ipcMain.handle(CHANNEL_GET_SUBAGENT_MESSAGES, handleGetSubagentMessages);

  logger.info('Subagent handlers registered');
}

/**
 * Removes all subagent IPC handlers.
 */
export function removeSubagentHandlers(ipcMain: IpcMain): void {
  ipcMain.removeHandler('get-subagent-detail');
  ipcMain.removeHandler(CHANNEL_GET_SUBAGENT_MESSAGES);

  logger.info('Subagent handlers removed');
}

// =============================================================================
// Handler Implementations
// =============================================================================

/**
 * Handler for 'get-subagent-detail' IPC call.
 * Gets detailed information for a specific subagent for drill-down modal.
 */
async function handleGetSubagentDetail(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string,
  subagentId: string
): Promise<SubagentDetail | null> {
  try {
    const validatedProject = validateProjectId(projectId);
    const validatedSession = validateSessionId(sessionId);
    const validatedSubagent = validateSubagentId(subagentId);
    if (!validatedProject.valid || !validatedSession.valid || !validatedSubagent.valid) {
      logger.error(
        `get-subagent-detail rejected: ${
          validatedProject.error ??
          validatedSession.error ??
          validatedSubagent.error ??
          'Invalid parameters'
        }`
      );
      return null;
    }
    const safeProjectId = validatedProject.value!;
    const safeSessionId = validatedSession.value!;
    const safeSubagentId = validatedSubagent.value!;

    const { chunkBuilder, sessionParser, subagentResolver, projectScanner, dataCache } =
      registry.getActive();

    const cacheKey = `subagent-${safeProjectId}-${safeSessionId}-${safeSubagentId}`;

    // Check cache first
    let subagentDetail = dataCache.getSubagent(cacheKey);

    if (subagentDetail) {
      return subagentDetail;
    }

    // Get provider and projectsDir from projectScanner
    const fsProvider = projectScanner.getFileSystemProvider();
    const projectsDir = projectScanner.getProjectsDir();

    // Build subagent detail
    const builtDetail = await chunkBuilder.buildSubagentDetail(
      safeProjectId,
      safeSessionId,
      safeSubagentId,
      sessionParser,
      subagentResolver,
      fsProvider,
      projectsDir
    );

    if (!builtDetail) {
      logger.error(`Subagent not found: ${safeSubagentId}`);
      return null;
    }

    subagentDetail = builtDetail;

    // Cache the result
    dataCache.setSubagent(cacheKey, subagentDetail);

    return subagentDetail;
  } catch (error) {
    logger.error(`Error in get-subagent-detail for ${subagentId}:`, error);
    return null;
  }
}

/**
 * Handler for 'subagent:get-messages' IPC call.
 * Lazy-loads a single subagent's parsed messages on demand. Used by the
 * inline SubagentItem when a user expands an entry — the worker output now
 * carries `messages: []` to keep cached SessionDetails small, so the body
 * has to be fetched here.
 *
 * Cached in SubagentMessageCache (small LRU, distinct from DataCache so
 * subagent bodies don't compete with full SessionDetails for slots).
 */
async function handleGetSubagentMessages(
  _event: IpcMainInvokeEvent,
  projectId: string,
  sessionId: string,
  subagentId: string
): Promise<ParsedMessage[]> {
  try {
    const validatedProject = validateProjectId(projectId);
    const validatedSession = validateSessionId(sessionId);
    const validatedSubagent = validateSubagentId(subagentId);
    if (!validatedProject.valid || !validatedSession.valid || !validatedSubagent.valid) {
      logger.error(
        `subagent:get-messages rejected: ${
          validatedProject.error ??
          validatedSession.error ??
          validatedSubagent.error ??
          'Invalid parameters'
        }`
      );
      return [];
    }
    const safeProjectId = validatedProject.value!;
    const safeSessionId = validatedSession.value!;
    const safeSubagentId = validatedSubagent.value!;

    const { sessionParser, projectScanner, subagentMessageCache } = registry.getActive();

    const cacheKey = SubagentMessageCache.buildKey(safeProjectId, safeSessionId, safeSubagentId);
    const cached = subagentMessageCache.get(cacheKey);
    if (cached) {
      logger.debug(
        `subagent:get-messages cache hit ${safeSubagentId} (${cached.length} msgs)`
      );
      return cached;
    }

    // Construct the subagent file path. The actual on-disk layout is:
    //   {projectsDir}/{baseProjectId}/{sessionId}/subagents/agent-{subagentId}.jsonl
    // `buildSubagentsPath` handles the composite-id split and gives us the
    // {.../subagents} directory; we append the agent file ourselves.
    const projectsDir = projectScanner.getProjectsDir();
    const subagentsDir = buildSubagentsPath(projectsDir, safeProjectId, safeSessionId);
    const subagentPath = path.join(subagentsDir, `agent-${safeSubagentId}.jsonl`);

    const parsed = await sessionParser.parseSessionFile(subagentPath);
    logger.info(
      `subagent:get-messages loaded ${safeSubagentId} from ${subagentPath} (${parsed.messages.length} messages)`
    );
    subagentMessageCache.set(cacheKey, parsed.messages);
    return parsed.messages;
  } catch (error) {
    logger.error(`Error in subagent:get-messages for ${subagentId}:`, error);
    return [];
  }
}
