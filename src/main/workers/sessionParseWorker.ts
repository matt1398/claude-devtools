/**
 * Worker Thread entry point for session parsing.
 *
 * Runs the JS parsing pipeline (parseJsonlFile -> processMessages -> buildChunks -> resolveSubagents)
 * off the main Electron thread so IPC, file watchers, and the renderer stay responsive.
 *
 * All imports must be pure Node.js / pure logic -- no Electron APIs.
 */

import { ChunkBuilder } from '@main/services/analysis/ChunkBuilder';
import { SubagentLocator } from '@main/services/discovery/SubagentLocator';
import { LocalFileSystemProvider } from '@main/services/infrastructure/LocalFileSystemProvider';
import {
  isParsedInternalUserMessage,
  isParsedRealUserMessage,
  type ParsedMessage,
  type Process,
  type Session,
  type SessionDetail,
  type ToolCall,
} from '@main/types';
import { calculateMetrics, getTaskCalls, parseJsonlFile } from '@main/utils/jsonl';
import { checkMessagesOngoing } from '@main/utils/sessionStateDetection';
import * as path from 'path';
import { parentPort } from 'worker_threads';

import type { ParsedSession } from '@main/services/parsing/SessionParser';

// ---------------------------------------------------------------------------
// Worker request / response types
// ---------------------------------------------------------------------------

export interface WorkerRequest {
  /** Unique request ID for matching responses */
  id: string;
  /** Base ~/.claude/projects/ path */
  projectsDir: string;
  /** Full path to session.jsonl */
  sessionPath: string;
  projectId: string;
  sessionId: string;
  fsType: 'local' | 'ssh';
  /** Session metadata object (serializable POJO, transferred via structured clone) */
  session: Session;
}

interface WorkerResponse {
  id: string;
  result?: SessionDetail;
  error?: string;
}

// ---------------------------------------------------------------------------
// Pure-function equivalents of SessionParser.processMessages
// ---------------------------------------------------------------------------

function processMessages(messages: ParsedMessage[]): ParsedSession {
  const byType = {
    user: [] as ParsedMessage[],
    realUser: [] as ParsedMessage[],
    internalUser: [] as ParsedMessage[],
    assistant: [] as ParsedMessage[],
    system: [] as ParsedMessage[],
    other: [] as ParsedMessage[],
  };
  const sidechainMessages: ParsedMessage[] = [];
  const mainMessages: ParsedMessage[] = [];

  for (const m of messages) {
    switch (m.type) {
      case 'user':
        byType.user.push(m);
        if (isParsedRealUserMessage(m)) {
          byType.realUser.push(m);
        } else if (isParsedInternalUserMessage(m)) {
          byType.internalUser.push(m);
        }
        break;
      case 'assistant':
        byType.assistant.push(m);
        break;
      case 'system':
        byType.system.push(m);
        break;
      default:
        byType.other.push(m);
        break;
    }

    if (m.isSidechain) {
      sidechainMessages.push(m);
    } else {
      mainMessages.push(m);
    }
  }

  const metrics = calculateMetrics(messages);
  const taskCalls = getTaskCalls(messages);

  return { messages, metrics, taskCalls, byType, sidechainMessages, mainMessages };
}

// ---------------------------------------------------------------------------
// Lightweight subagent resolution (mirrors SubagentResolver but uses paths directly)
// ---------------------------------------------------------------------------

const PARALLEL_WINDOW_MS = 100;

async function resolveSubagentsFromPaths(
  projectsDir: string,
  projectId: string,
  sessionId: string,
  taskCalls: ToolCall[],
  messages: ParsedMessage[],
  fsProvider: LocalFileSystemProvider
): Promise<Process[]> {
  const locator = new SubagentLocator(projectsDir, fsProvider);
  const subagentFiles = await locator.listSubagentFiles(projectId, sessionId);

  if (subagentFiles.length === 0) {
    return [];
  }

  // Parse subagent files with bounded concurrency
  const concurrency = 24;
  const subagents: Process[] = [];

  for (let i = 0; i < subagentFiles.length; i += concurrency) {
    const batch = subagentFiles.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((filePath) => parseSubagentFile(filePath, fsProvider))
    );
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value !== null) {
        subagents.push(result.value);
      }
    }
  }

  // Link to Task calls
  linkToTaskCalls(subagents, taskCalls, messages);

  // Propagate team metadata
  propagateTeamMetadata(subagents);

  // Detect parallel execution
  detectParallelExecution(subagents);

  // Enrich team colors
  enrichTeamColors(subagents, messages);

  // Sort by start time
  subagents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  return subagents;
}

async function parseSubagentFile(
  filePath: string,
  fsProvider: LocalFileSystemProvider
): Promise<Process | null> {
  try {
    const messages = await parseJsonlFile(filePath, fsProvider);

    if (messages.length === 0) return null;

    // Filter warmup subagents
    const firstUser = messages.find((m) => m.type === 'user');
    if (firstUser?.content === 'Warmup') return null;

    const filename = path.basename(filePath);
    const agentId = filename.replace(/^agent-/, '').replace(/\.jsonl$/, '');

    // Filter compact files
    if (agentId.startsWith('acompact')) return null;

    // Calculate timing
    const timestamps = messages.map((m) => m.timestamp.getTime()).filter((t) => !isNaN(t));
    let startTime: Date;
    let endTime: Date;
    let durationMs: number;

    if (timestamps.length === 0) {
      const now = new Date();
      startTime = now;
      endTime = now;
      durationMs = 0;
    } else {
      let minTime = timestamps[0];
      let maxTime = timestamps[0];
      for (let i = 1; i < timestamps.length; i++) {
        if (timestamps[i] < minTime) minTime = timestamps[i];
        if (timestamps[i] > maxTime) maxTime = timestamps[i];
      }
      startTime = new Date(minTime);
      endTime = new Date(maxTime);
      durationMs = maxTime - minTime;
    }

    const metrics = calculateMetrics(messages);
    const isOngoing = checkMessagesOngoing(messages);

    return {
      id: agentId,
      filePath,
      messages,
      startTime,
      endTime,
      durationMs,
      metrics,
      isParallel: false,
      isOngoing,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Task call linking (mirrors SubagentResolver)
// ---------------------------------------------------------------------------

function extractTeamMessageSummary(messages: ParsedMessage[]): string | undefined {
  const firstUser = messages.find((m) => m.type === 'user');
  if (!firstUser) return undefined;
  const text = typeof firstUser.content === 'string' ? firstUser.content : '';
  const match = /<teammate-message[^>]*\bsummary="([^"]+)"/.exec(text);
  return match?.[1];
}

function enrichSubagentFromTask(subagent: Process, taskCall: ToolCall): void {
  /* eslint-disable no-param-reassign -- Mutation is intentional; mirrors SubagentResolver */
  subagent.parentTaskId = taskCall.id;
  subagent.description = taskCall.taskDescription;
  subagent.subagentType = taskCall.taskSubagentType;

  const teamName = taskCall.input?.team_name as string | undefined;
  const memberName = taskCall.input?.name as string | undefined;
  if (teamName && memberName) {
    subagent.team = { teamName, memberName, memberColor: '' };
  }
  /* eslint-enable no-param-reassign -- End of intentional mutation block */
}

function linkToTaskCalls(
  subagents: Process[],
  taskCalls: ToolCall[],
  messages: ParsedMessage[]
): void {
  const taskCallsOnly = taskCalls.filter((tc) => tc.isTask);
  if (taskCallsOnly.length === 0 || subagents.length === 0) return;

  // Build agentId -> taskCallId map from tool result messages
  const agentIdToTaskId = new Map<string, string>();
  for (const msg of messages) {
    if (!msg.toolUseResult) continue;
    const result = msg.toolUseResult;
    const agentId = (result.agentId ?? result.agent_id) as string | undefined;
    if (!agentId) continue;
    const taskCallId = msg.sourceToolUseID ?? msg.toolResults[0]?.toolUseId;
    if (taskCallId) {
      agentIdToTaskId.set(agentId, taskCallId);
    }
  }

  const taskCallById = new Map(taskCallsOnly.map((tc) => [tc.id, tc]));
  const matchedSubagentIds = new Set<string>();
  const matchedTaskIds = new Set<string>();

  // Phase 1: Result-based matching
  for (const subagent of subagents) {
    const taskCallId = agentIdToTaskId.get(subagent.id);
    if (!taskCallId) continue;
    const taskCall = taskCallById.get(taskCallId);
    if (!taskCall) continue;
    enrichSubagentFromTask(subagent, taskCall);
    matchedSubagentIds.add(subagent.id);
    matchedTaskIds.add(taskCallId);
  }

  // Phase 2: Description-based matching for team members
  const teamTaskCalls = taskCallsOnly.filter(
    (tc) => !matchedTaskIds.has(tc.id) && tc.input?.team_name && tc.input?.name
  );

  if (teamTaskCalls.length > 0) {
    const subagentSummaries = new Map<string, string>();
    for (const subagent of subagents) {
      if (matchedSubagentIds.has(subagent.id)) continue;
      const summary = extractTeamMessageSummary(subagent.messages);
      if (summary) subagentSummaries.set(subagent.id, summary);
    }

    for (const taskCall of teamTaskCalls) {
      const description = taskCall.taskDescription;
      if (!description) continue;
      let bestMatch: Process | undefined;
      for (const subagent of subagents) {
        if (matchedSubagentIds.has(subagent.id)) continue;
        if (subagentSummaries.get(subagent.id) !== description) continue;
        if (!bestMatch || subagent.startTime < bestMatch.startTime) {
          bestMatch = subagent;
        }
      }
      if (bestMatch) {
        enrichSubagentFromTask(bestMatch, taskCall);
        matchedSubagentIds.add(bestMatch.id);
        matchedTaskIds.add(taskCall.id);
      }
    }
  }

  // Phase 3: Positional fallback
  const unmatchedSubagents = [...subagents]
    .filter((s) => !matchedSubagentIds.has(s.id))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const unmatchedTasks = taskCallsOnly.filter(
    (tc) => !matchedTaskIds.has(tc.id) && !(tc.input?.team_name && tc.input?.name)
  );
  for (let i = 0; i < unmatchedSubagents.length && i < unmatchedTasks.length; i++) {
    enrichSubagentFromTask(unmatchedSubagents[i], unmatchedTasks[i]);
  }
}

function propagateTeamMetadata(subagents: Process[]): void {
  const lastUuidToSubagent = new Map<string, Process>();
  for (const subagent of subagents) {
    if (subagent.messages.length === 0) continue;
    const lastMsg = subagent.messages[subagent.messages.length - 1];
    if (lastMsg.uuid) lastUuidToSubagent.set(lastMsg.uuid, subagent);
  }

  const maxDepth = 10;
  for (const subagent of subagents) {
    if (subagent.team) continue;
    if (subagent.messages.length === 0) continue;
    const firstMsg = subagent.messages[0];
    if (!firstMsg.parentUuid) continue;

    let ancestor: Process | undefined = lastUuidToSubagent.get(firstMsg.parentUuid);
    let depth = 0;
    while (ancestor && !ancestor.team && depth < maxDepth) {
      if (ancestor.messages.length === 0) break;
      const parentUuid = ancestor.messages[0].parentUuid;
      if (!parentUuid) break;
      ancestor = lastUuidToSubagent.get(parentUuid);
      depth++;
    }

    if (ancestor?.team) {
      subagent.team = { ...ancestor.team };
      subagent.parentTaskId = subagent.parentTaskId ?? ancestor.parentTaskId;
      subagent.description = subagent.description ?? ancestor.description;
      subagent.subagentType = subagent.subagentType ?? ancestor.subagentType;
    }
  }
}

function detectParallelExecution(subagents: Process[]): void {
  if (subagents.length < 2) return;
  const sorted = [...subagents].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const groups: Process[][] = [];
  let currentGroup: Process[] = [];
  let groupStartTime = 0;

  for (const agent of sorted) {
    const startMs = agent.startTime.getTime();
    if (currentGroup.length === 0) {
      currentGroup.push(agent);
      groupStartTime = startMs;
    } else if (startMs - groupStartTime <= PARALLEL_WINDOW_MS) {
      currentGroup.push(agent);
    } else {
      if (currentGroup.length > 0) groups.push(currentGroup);
      currentGroup = [agent];
      groupStartTime = startMs;
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  for (const group of groups) {
    if (group.length > 1) {
      for (const agent of group) {
        agent.isParallel = true;
      }
    }
  }
}

function enrichTeamColors(subagents: Process[], messages: ParsedMessage[]): void {
  for (const msg of messages) {
    if (!msg.toolUseResult) continue;
    const sourceId = msg.sourceToolUseID ?? msg.toolResults[0]?.toolUseId;
    if (!sourceId) continue;
    const result = msg.toolUseResult;
    if (result.status === 'teammate_spawned' && result.color) {
      for (const subagent of subagents) {
        if (subagent.parentTaskId === sourceId && subagent.team) {
          subagent.team.memberColor = result.color as string;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

parentPort?.on('message', async (request: WorkerRequest) => {
  const response: WorkerResponse = { id: request.id };

  try {
    const fsProvider = new LocalFileSystemProvider();

    // 1. Parse JSONL
    const messages = await parseJsonlFile(request.sessionPath, fsProvider);

    // 2. Process messages (classify, extract metrics, task calls)
    const parsedSession = processMessages(messages);

    // 3. Resolve subagents
    const subagents = await resolveSubagentsFromPaths(
      request.projectsDir,
      request.projectId,
      request.sessionId,
      parsedSession.taskCalls,
      parsedSession.messages,
      fsProvider
    );

    // 4. Build chunks and assemble SessionDetail
    const chunkBuilder = new ChunkBuilder();
    const session = request.session;
    session.hasSubagents = subagents.length > 0;

    const chunks = chunkBuilder.buildChunks(parsedSession.messages, subagents);
    const metrics = calculateMetrics(parsedSession.messages);

    const sessionDetail: SessionDetail = {
      session,
      messages: parsedSession.messages,
      chunks,
      processes: subagents,
      metrics,
    };

    response.result = sessionDetail;
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }

  parentPort?.postMessage(response);
});
