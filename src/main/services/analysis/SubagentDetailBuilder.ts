/**
 * SubagentDetailBuilder - Builds detailed information for subagent drill-down.
 *
 * Loads subagent JSONL files, resolves nested subagents, and builds
 * complete SubagentDetail objects for the drill-down modal.
 */

import {
  type EnhancedAIChunk,
  type EnhancedChunk,
  isEnhancedAIChunk,
  type ParsedMessage,
  type Process,
  type SemanticStepGroup,
  type SubagentDetail,
} from '@main/types';
import { buildSubagentsPath } from '@main/utils/pathDecoder';
import { countTokens } from '@main/utils/tokenizer';
import { createLogger } from '@shared/utils/logger';
import * as path from 'path';

const logger = createLogger('Service:SubagentDetailBuilder');

import { buildSemanticStepGroups } from './SemanticStepGrouper';

import type { SubagentResolver } from '../discovery/SubagentResolver';
import type { FileSystemProvider } from '../infrastructure/FileSystemProvider';
import type { SessionParser } from '../parsing/SessionParser';

/**
 * Build detailed information for a specific subagent.
 * Used for drill-down modal to show subagent's internal execution.
 *
 * @param projectId - Project ID
 * @param _sessionId - Parent session ID (currently unused, kept for API consistency)
 * @param subagentId - Subagent ID to load
 * @param sessionParser - SessionParser instance for parsing subagent file
 * @param subagentResolver - SubagentResolver instance for nested subagents
 * @param buildChunksFn - Function to build chunks from messages and subagents
 * @param fsProvider - FileSystemProvider for file existence checks
 * @param projectsDir - Projects directory path
 * @returns SubagentDetail or null if not found
 */
export async function buildSubagentDetail(
  projectId: string,
  sessionId: string,
  subagentId: string,
  sessionParser: SessionParser,
  subagentResolver: SubagentResolver,
  buildChunksFn: (messages: ParsedMessage[], subagents: Process[]) => EnhancedChunk[],
  fsProvider: FileSystemProvider,
  projectsDir: string
): Promise<SubagentDetail | null> {
  try {
    // Layout: {projectsDir}/{baseProjectId}/{sessionId}/subagents/agent-X.jsonl
    const subagentsDir = buildSubagentsPath(projectsDir, projectId, sessionId);
    const subagentPath = path.join(subagentsDir, `agent-${subagentId}.jsonl`);

    // Check if file exists
    if (!(await fsProvider.exists(subagentPath))) {
      logger.warn(`Subagent file not found: ${subagentPath}`);
      return null;
    }

    // Parse subagent JSONL file
    const parsedSession = await sessionParser.parseSessionFile(subagentPath);

    // Resolve nested subagents within this subagent
    const nestedSubagents = await subagentResolver.resolveSubagents(
      projectId,
      subagentId, // Use subagentId as sessionId for nested resolution
      parsedSession.taskCalls
    );

    // Build chunks with semantic steps
    const chunks = buildChunksFn(parsedSession.messages, nestedSubagents);

    // Extract description (try to get from first user message)
    let description = 'Subagent';
    if (parsedSession.messages.length > 0) {
      const firstUserMsg = parsedSession.messages.find(
        (m) => m.type === 'user' && typeof m.content === 'string'
      );
      if (firstUserMsg && typeof firstUserMsg.content === 'string') {
        description = firstUserMsg.content.substring(0, 100);
        if (firstUserMsg.content.length > 100) {
          description += '...';
        }
      }
    }

    // Calculate timing
    const times = parsedSession.messages.map((m) => m.timestamp.getTime());
    const startTime = new Date(Math.min(...times));
    const endTime = new Date(Math.max(...times));
    const duration = endTime.getTime() - startTime.getTime();

    // Calculate thinking tokens
    let thinkingTokens = 0;
    for (const msg of parsedSession.messages) {
      if (msg.type === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'thinking' && block.thinking) {
            thinkingTokens += countTokens(block.thinking);
          }
        }
      }
    }

    // Build semantic step groups from AI chunks only (UserChunks don't have semanticSteps)
    const allSemanticSteps = chunks
      .filter((c): c is EnhancedAIChunk => isEnhancedAIChunk(c))
      .flatMap((c) => c.semanticSteps);
    const semanticStepGroups: SemanticStepGroup[] | undefined =
      allSemanticSteps.length > 0 ? buildSemanticStepGroups(allSemanticSteps) : undefined;

    return {
      id: subagentId,
      description,
      chunks,
      semanticStepGroups,
      startTime,
      endTime,
      duration,
      metrics: {
        inputTokens: parsedSession.metrics.inputTokens,
        outputTokens: parsedSession.metrics.outputTokens,
        thinkingTokens,
        messageCount: parsedSession.metrics.messageCount,
      },
    };
  } catch (error) {
    logger.error(`Error building subagent detail for ${subagentId}:`, error);
    return null;
  }
}
