/**
 * Worker Thread entry point for session parsing.
 *
 * Runs the JS parsing pipeline (parseJsonlFile -> processMessages -> buildChunks -> resolveSubagents)
 * off the main Electron thread so IPC, file watchers, and the renderer stay responsive.
 *
 * All imports must be pure Node.js / pure logic -- no Electron APIs.
 */

import { ChunkBuilder } from '@main/services/analysis/ChunkBuilder';
import { computeSubagentDisplayMeta } from '@main/services/analysis/SubagentDisplayMetaBuilder';
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
import { calculateMetrics, checkMessagesOngoing, getTaskCalls, parseJsonlFile } from '@main/utils/jsonl';
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
// Subagent file parsing
// ---------------------------------------------------------------------------
//
// Each subagent JSONL is parsed in full because the renderer's SubagentItem
// reads `subagent.messages` directly to display:
//   - inline execution trace (via buildDisplayItemsFromMessages)
//   - model/last-usage/turn count
//   - shutdown-only detection
//   - per-phase context breakdown
// Stripping `messages` to bound memory broke the inline UI; the drill-down
// modal re-parses separately, but the inline path consumes the worker output.
//
// Memory amplification is bounded by:
//   1. Single-flight in SessionParserPool — concurrent requests for the same
//      session coalesce into one parse, preventing refresh-storm cascades.
//   2. Serial worker — only one session parses at a time inside the worker.
//   3. SUBAGENT_PARSE_CONCURRENCY caps simultaneous file loads within a parse.

const PARALLEL_WINDOW_MS = 100;
/**
 * Concurrency for subagent file parsing within a single session parse.
 * Lower than the old bulk-load value (24) to cap simultaneous fd + transcript
 * buffers when a session has many subagents. Single-flight at the pool layer
 * already prevents the cross-request stacking Codex flagged.
 */
const SUBAGENT_PARSE_CONCURRENCY = 8;

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

  const subagents: Process[] = [];

  // Bounded-concurrency batches keep peak fd + transcript count capped.
  for (let i = 0; i < subagentFiles.length; i += SUBAGENT_PARSE_CONCURRENCY) {
    const batch = subagentFiles.slice(i, i + SUBAGENT_PARSE_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((filePath) => parseSubagentFile(filePath, fsProvider))
    );
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value !== null) {
        subagents.push(result.value);
      }
    }
  }

  linkToTaskCalls(subagents, taskCalls, messages);
  propagateTeamMetadata(subagents);
  detectParallelExecution(subagents);
  enrichTeamColors(subagents, messages);

  subagents.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  // Drop full message bodies from every subagent now that all post-processing
  // (linking, ancestry walks, color enrichment) is done. The renderer reads
  // displayMeta for the collapsed view and lazy-loads bodies via IPC when a
  // user expands a subagent. This is the core memory bound: cached
  // SessionDetails no longer hold N×transcript_size of subagent payloads.
  for (const s of subagents) {
    s.messages = [];
  }

  return subagents;
}

/**
 * Parse a single subagent JSONL file into a fully-populated Process.
 * Mirrors SubagentResolver.parseSubagentFile but additionally attaches
 * `displayMeta` so the worker can drop `messages` from the response.
 */
async function parseSubagentFile(
  filePath: string,
  fsProvider: LocalFileSystemProvider
): Promise<Process | null> {
  try {
    const filename = path.basename(filePath);
    const agentId = filename.replace(/^agent-/, '').replace(/\.jsonl$/, '');

    if (agentId.startsWith('acompact')) return null;

    const messages = await parseJsonlFile(filePath, fsProvider);
    if (messages.length === 0) return null;

    // Warmup filter: first user message content === 'Warmup'
    const firstUser = messages.find((m) => m.type === 'user');
    if (firstUser?.content === 'Warmup') return null;

    const timestamps = messages.map((m) => m.timestamp.getTime()).filter((t) => !Number.isNaN(t));
    const hasTimes = timestamps.length > 0;
    const minTime = hasTimes ? Math.min(...timestamps) : Date.now();
    const maxTime = hasTimes ? Math.max(...timestamps) : minTime;

    const metrics = calculateMetrics(messages);
    const isOngoing = checkMessagesOngoing(messages);

    // Pre-compute display metadata while messages are still in scope.
    // After resolveSubagentsFromPaths finishes its post-processing it will
    // strip `messages = []` from every Process before returning, so the
    // renderer must use displayMeta for everything except expanded views.
    const displayMeta = computeSubagentDisplayMeta(messages);

    return {
      id: agentId,
      filePath,
      messages,
      displayMeta,
      startTime: new Date(minTime),
      endTime: new Date(maxTime),
      durationMs: maxTime - minTime,
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

/** Extract the summary attribute from the first <teammate-message> tag. */
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

  // Build agentId -> taskCallId map from parent session tool result messages.
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

  // Phase 2: Description-based matching for team members.
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
  // Index subagents by the uuid of their last message for ancestry walks.
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

    // 3. Resolve subagents. Each subagent is parsed in full transiently so
    //    we can compute displayMeta and run the linking helpers, then the
    //    `messages` array is stripped before this returns. The renderer
    //    reads displayMeta for the collapsed SubagentItem header and
    //    lazy-loads message bodies via the get-subagent-messages IPC when
    //    a subagent is expanded. Memory is bounded by:
    //      - SUBAGENT_PARSE_CONCURRENCY (8) for in-parse fd/buffer count
    //      - the pool's single-flight + serial-worker guarantees
    //      - the post-processing strip below removing N×transcript_size
    //        from every cached SessionDetail
    const subagents = await resolveSubagentsFromPaths(
      request.projectsDir,
      request.projectId,
      request.sessionId,
      parsedSession.taskCalls,
      parsedSession.messages,
      fsProvider
    );

    // 4. Build chunks and overall metrics.
    const chunkBuilder = new ChunkBuilder();
    const session = request.session;
    session.hasSubagents = subagents.length > 0;

    const chunks = chunkBuilder.buildChunks(parsedSession.messages, subagents);
    const metrics = calculateMetrics(parsedSession.messages);

    // 5. Assemble the response. parsedSession.messages is dropped — the
    //    renderer never reads it and the main IPC handler strips it anyway.
    const sessionDetail: SessionDetail = {
      session,
      messages: [],
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
