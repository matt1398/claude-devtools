/**
 * Session analyzer — TypeScript port of scripts/analyze-session.py.
 *
 * Takes a SessionDetail (already parsed by the main process) and produces
 * a SessionReport with structured metrics, cost analysis, friction signals,
 * conversation tree analysis, idle gap detection, and more.
 *
 * Runs entirely in the renderer process — no IPC needed.
 */

import {
  computeCacheEfficiencyAssessment,
  computeCacheRatioAssessment,
  computeCostPerCommitAssessment,
  computeCostPerLineAssessment,
  computeIdleAssessment,
  computeOverheadAssessment,
  computeRedundancyAssessment,
  computeSubagentCostShareAssessment,
  computeThrashingAssessment,
  computeToolHealthAssessment,
  detectModelMismatch,
  detectSwitchPattern,
} from '@renderer/utils/reportAssessments';
import { calculateMessageCost } from '@shared/utils/pricing';

import type {
  AgentTreeNode,
  FrictionCorrection,
  GitCommit,
  IdleGap,
  KeyEvent,
  ModelSwitch,
  ModelTokenStats,
  OutOfScopeFindings,
  SessionReport,
  SkillInvocation,
  SubagentBasicEntry,
  SubagentEntry,
  TestSnapshot,
  ThinkingBlockAnalysis,
  ToolError,
  ToolSuccessRate,
  UserQuestion,
} from '@renderer/types/sessionReport';
import type {
  ContentBlock,
  ParsedMessage,
  Process,
  SessionDetail,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@shared/types';

// Re-export getDisplayPricing as getPricing for backward compat with CostSection
export { getDisplayPricing as getPricing } from '@shared/utils/pricing';

// =============================================================================
// Helpers
// =============================================================================

function isTextBlock(block: ContentBlock): block is TextContent {
  return block.type === 'text';
}

function isThinkingBlock(block: ContentBlock): block is ThinkingContent {
  return block.type === 'thinking';
}

function extractTextContent(msg: ParsedMessage): string {
  const { content } = msg;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(isTextBlock)
      .map((block) => block.text)
      .join(' ');
  }
  return '';
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Friction keyword patterns
const FRICTION_PATTERNS: [RegExp, string][] = [
  [/\bno,/i, 'no,'],
  [/\bwrong\b/i, 'wrong'],
  [/\bactually\b/i, 'actually'],
  [/\bundo\b/i, 'undo'],
  [/\brevert\b/i, 'revert'],
  [/that's not\b/i, "that's not"],
  [/\binstead,/i, 'instead,'],
  [/\bwait,/i, 'wait,'],
  [/\bnevermind\b/i, 'nevermind'],
  [/I don't want\b/i, "I don't want"],
];

// Permission denial keywords (case-insensitive substring match)
const PERMISSION_KEYWORDS = [
  'permission denied',
  'not allowed',
  'requires approval',
  'cannot execute',
  'access denied',
  'operation not permitted',
  'eacces',
  'eperm',
  'user rejected',
  'user denied',
  'needs_user_approval',
];

function isPermissionDenial(text: string): boolean {
  const lower = text.toLowerCase();
  return PERMISSION_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Extract a number immediately before a keyword in text.
 * E.g., extractNumberBefore("42 passed", "passed") => 42
 */
function extractNumberBefore(text: string, keyword: string): number | null {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx <= 0) return null;
  const before = text.slice(Math.max(0, idx - 15), idx).trim();
  const parts = before.split(/\s+/);
  const numStr = parts[parts.length - 1];
  if (numStr && /^\d+$/.test(numStr)) return parseInt(numStr, 10);
  return null;
}

/**
 * Parse test summary from command output.
 * Returns [passed, failed] or null if no match.
 */
function parseTestSummary(text: string): [number, number] | null {
  // Try "passed"/"failed" keywords — treat missing count as 0
  // (runners often omit "0 failed" when all tests pass)
  const passed = extractNumberBefore(text, ' passed');
  const failed = extractNumberBefore(text, ' failed');
  if (passed != null || failed != null) return [passed ?? 0, failed ?? 0];

  // Try "passing"/"failing" keywords (mocha-style)
  const passing = extractNumberBefore(text, ' passing');
  const failing = extractNumberBefore(text, ' failing');
  if (passing != null || failing != null) return [passing ?? 0, failing ?? 0];

  return null;
}

// Thinking block analysis signals
const THINKING_SIGNALS: Record<string, RegExp> = {
  alternatives: /\balternative(?:ly|s)?\b|\binstead\b|\bother approach\b|\bcould also\b/i,
  uncertainty: /\bnot sure\b|\buncertain\b|\bmight be\b|\bpossibly\b|\bI think\b.*\bbut\b/i,
  errors_noticed: /\bbug\b|\berror\b|\bwrong\b|\bincorrect\b|\bfail\b|\bbroken\b/i,
  planning: /\bfirst.*then\b|\bstep \d\b|\bplan\b|\bapproach\b|\bstrategy\b/i,
  direction_change: /\bwait\b|\bactually\b|\bon second thought\b|\blet me reconsider\b|\bhmm\b/i,
};

// "Work" tools (non-Skill) for startup overhead detection
const NON_SKILL_TOOLS = new Set([
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Grep',
  'Glob',
  'Task',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
]);

// =============================================================================
// Main Analyzer
// =============================================================================

export function analyzeSession(detail: SessionDetail): SessionReport {
  const { session, messages } = detail;

  // --- Session Overview ---
  const timestamps = messages.filter((m) => m.timestamp).map((m) => m.timestamp);
  const firstTs = timestamps.length > 0 ? timestamps[0] : null;
  const lastTs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
  const durationMs = firstTs && lastTs ? lastTs.getTime() - firstTs.getTime() : 0;
  const durationSeconds = durationMs / 1000;

  // Context consumption interpretation
  const ctxConsumption = session.contextConsumption ?? 0;
  let ctxConsumptionPct: number | null = null;
  let ctxAssessment: 'critical' | 'high' | 'moderate' | 'healthy' | null = null;
  if (ctxConsumption <= 1) {
    ctxConsumptionPct = ctxConsumption ? Math.round(ctxConsumption * 1000) / 10 : 0;
    if (ctxConsumption > 0.8) ctxAssessment = 'critical';
    else if (ctxConsumption > 0.6) ctxAssessment = 'high';
    else if (ctxConsumption > 0.4) ctxAssessment = 'moderate';
    else ctxAssessment = 'healthy';
  }

  // ===================================================================
  // SINGLE-PASS ACCUMULATORS
  // ===================================================================

  // Token usage by model
  const modelStats = new Map<string, ModelTokenStats>();

  const getModelStats = (model: string): ModelTokenStats => {
    let stats = modelStats.get(model);
    if (!stats) {
      stats = {
        apiCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheCreation: 0,
        cacheRead: 0,
        costUsd: 0,
      };
      modelStats.set(model, stats);
    }
    return stats;
  };

  // Cache economics
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let coldStartDetected = false;
  let firstAssistantWithUsageSeen = false;

  // Message type counts
  const typeCounts = new Map<string, number>();

  // Tool usage counts
  const toolCounts = new Map<string, number>();

  // Tool call index: toolUseId -> [messageIndex, toolCall]
  const toolCallIndex = new Map<string, [number, ToolCall]>();

  // Tool errors
  const errors: ToolError[] = [];
  const errorsByTool = new Map<string, number>();

  // Permission denials
  const permissionDenials: ToolError[] = [];

  // Key events
  const keyEvents: KeyEvent[] = [];

  // Thinking blocks
  let thinkingCount = 0;
  const thinkingAnalysis: ThinkingBlockAnalysis[] = [];

  // Git branches
  const branches = new Set<string>();

  // Friction signals
  const corrections: FrictionCorrection[] = [];
  let userMessageCount = 0;

  // Thrashing detection
  const bashPrefixGroups = new Map<string, number>();
  const fileEditIndices = new Map<string, number[]>();

  // Startup overhead
  let firstWorkToolSeen = false;
  let startupMessages = 0;
  let startupTokens = 0;

  // Token density timeline
  const assistantMsgData: [Date, number][] = [];

  // Conversation tree
  const uuidToIdx = new Map<string, number>();
  const parentMap = new Map<string, string | null>();
  let sidechainCount = 0;
  const childrenMap = new Map<string, string[]>();

  // Idle gap detection
  let lastAssistantTs: Date | null = null;
  const idleGaps: IdleGap[] = [];
  const IDLE_THRESHOLD_SEC = 60;

  // Model switch detection
  let lastModel: string | null = null;
  const modelSwitches: ModelSwitch[] = [];

  // Working directory tracking
  const cwdSet = new Set<string>();
  const cwdChanges: { from: string; to: string; messageIndex: number }[] = [];
  let lastCwd: string | null = null;

  // Test progression
  const testSnapshots: TestSnapshot[] = [];

  // Cost tracking
  let parentCost = 0;

  // Pre-compute which requestIds are duplicates (keep last occurrence only).
  // Streaming writes multiple JSONL entries per API response with the same
  // requestId but incrementally accumulating output_tokens.
  const lastRequestIdIndex = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].requestId) {
      lastRequestIdIndex.set(messages[i].requestId!, i);
    }
  }

  // Git activity
  const gitCommits: GitCommit[] = [];
  let gitPushCount = 0;
  const gitBranchCreations: string[] = [];
  let linesAddedTotal = 0;
  let linesRemovedTotal = 0;

  // File read redundancy
  const fileReadCounts = new Map<string, number>();

  // First user message length
  let firstUserMessageLength = 0;
  let firstUserSeen = false;

  // Skills invoked
  const skillsInvoked: SkillInvocation[] = [];

  // Bash commands
  const bashCmds: string[] = [];

  // Subagents list (backward compat)
  const subagentsList: SubagentBasicEntry[] = [];

  // Lifecycle tasks
  const lifecycleTasks: string[] = [];

  // User questions
  const userQuestions: UserQuestion[] = [];

  // Out-of-scope findings
  const OUT_OF_SCOPE_KEYWORDS = [
    'pre-existing',
    'out of scope',
    'tech debt',
    'anti-pattern',
    'existed before',
  ];
  const outOfScopeFindings: OutOfScopeFindings[] = [];

  // Agent tree metadata
  const agentTreeNodes: AgentTreeNode[] = [];

  // Compact summary count

  let compactSummaryCount = 0;

  // ===================================================================
  // SINGLE PASS
  // ===================================================================

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const msgType = m.type ?? 'unknown';
    typeCounts.set(msgType, (typeCounts.get(msgType) ?? 0) + 1);
    const msgUuid = m.uuid ?? '';
    const msgParent = m.parentUuid ?? '';
    const msgTs = m.timestamp;

    // --- Conversation tree ---
    if (msgUuid) {
      uuidToIdx.set(msgUuid, i);
      parentMap.set(msgUuid, msgParent || null);
      if (msgParent) {
        const children = childrenMap.get(msgParent);
        if (children) children.push(msgUuid);
        else childrenMap.set(msgParent, [msgUuid]);
      }
    }

    if (m.isSidechain) sidechainCount++;

    // --- Working directory tracking ---
    const msgCwd = m.cwd ?? '';
    if (msgCwd) {
      cwdSet.add(msgCwd);
      if (lastCwd && msgCwd !== lastCwd) {
        cwdChanges.push({ from: lastCwd, to: msgCwd, messageIndex: i });
      }
      lastCwd = msgCwd;
    }

    // --- Token usage, cache economics, and cost ---
    // Skip sidechain messages to avoid double-counting (subagent costs are
    // accounted for separately via processSubagentCost).
    if (m.usage && m.model && !m.isSidechain && m.model !== '<synthetic>') {
      // Only count cost for the last entry per requestId (streaming dedup).
      // Streaming writes multiple JSONL entries per API response with the same
      // requestId but incrementally accumulating output_tokens.
      const isLastForRequest = !m.requestId || lastRequestIdIndex.get(m.requestId) === i;

      if (isLastForRequest) {
        const model = m.model;
        const u = m.usage;
        const inpTok = u.input_tokens ?? 0;
        const outTok = u.output_tokens ?? 0;
        const cc = u.cache_creation_input_tokens ?? 0;
        const cr = u.cache_read_input_tokens ?? 0;

        const stats = getModelStats(model);
        stats.apiCalls += 1;
        stats.inputTokens += inpTok;
        stats.outputTokens += outTok;
        stats.cacheCreation += cc;
        stats.cacheRead += cr;

        const callCost = calculateMessageCost(model, inpTok, outTok, cr, cc);
        stats.costUsd += callCost;
        parentCost += callCost;

        totalCacheCreation += cc;
        totalCacheRead += cr;

        // Cold start detection
        if (msgType === 'assistant' && !firstAssistantWithUsageSeen) {
          firstAssistantWithUsageSeen = true;
          if (cc > 0 && cr === 0) coldStartDetected = true;
        }
      }
    }

    // --- Git branches ---
    if (m.gitBranch) branches.add(m.gitBranch);

    // --- Compact summaries ---
    if (m.isCompactSummary) compactSummaryCount++;

    // --- Agent tree metadata ---
    if (m.agentId) {
      // agentType/teamName/parentToolUseId may exist on raw data but not typed in ParsedMessage
      const raw = m as unknown as Record<string, unknown>;
      agentTreeNodes.push({
        agentId: m.agentId,
        agentType: (raw.agentType as string) ?? 'unknown',
        teamName: (raw.teamName as string) ?? '',
        parentToolUseId: (raw.parentToolUseId as string) ?? '',
        messageIndex: i,
      });
    }

    // --- Thinking blocks (with content analysis) ---
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (isThinkingBlock(block)) {
          thinkingCount++;
          const thinkText = block.thinking ?? '';
          const signalsFound: Record<string, boolean> = {};
          for (const [signalName, pattern] of Object.entries(THINKING_SIGNALS)) {
            if (pattern.test(thinkText)) signalsFound[signalName] = true;
          }
          if (Object.keys(signalsFound).length > 0 || thinkingCount <= 5) {
            thinkingAnalysis.push({
              messageIndex: i,
              preview: thinkText.slice(0, 200).replace(/\n/g, ' ').trim(),
              charLength: thinkText.length,
              signals: signalsFound,
            });
          }
        }
      }
    }

    // --- Model switch detection ---
    if (msgType === 'assistant' && m.model) {
      const currentModel = m.model;
      if (lastModel && currentModel !== lastModel) {
        modelSwitches.push({
          from: lastModel,
          to: currentModel,
          messageIndex: i,
          timestamp: msgTs ?? null,
        });
      }
      lastModel = currentModel;
    }

    // --- Idle gap detection ---
    if (msgType === 'assistant' && msgTs) {
      lastAssistantTs = msgTs;
    }
    if (msgType === 'user' && msgTs && lastAssistantTs) {
      const gap = (msgTs.getTime() - lastAssistantTs.getTime()) / 1000;
      if (gap > IDLE_THRESHOLD_SEC) {
        idleGaps.push({
          gapSeconds: Math.round(gap * 10) / 10,
          gapHuman: formatDuration(Math.floor(gap)),
          afterMessageIndex: i,
        });
      }
    }

    // --- First user message length (prompt quality) ---
    if (msgType === 'user' && !firstUserSeen && !m.isMeta) {
      const contentText = extractTextContent(m);
      if (contentText.trim()) {
        firstUserMessageLength = contentText.length;
        firstUserSeen = true;
      }
    }

    // --- Tool calls (assistant messages) ---
    for (const tc of m.toolCalls) {
      const toolName = tc.name;
      toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1);
      if (tc.id) toolCallIndex.set(tc.id, [i, tc]);
      const inp = tc.input ?? {};

      // Bash commands
      if (toolName === 'Bash') {
        const cmd = typeof inp.command === 'string' ? inp.command : '';
        const cmdTrunc = cmd.slice(0, 200);
        bashCmds.push(cmdTrunc);
        // Thrashing: bash prefix groups
        const prefix = cmd.slice(0, 40);
        bashPrefixGroups.set(prefix, (bashPrefixGroups.get(prefix) ?? 0) + 1);

        // Git activity
        if (cmd.includes('git commit')) {
          const heredocMatch = /cat\s+<<['"]?EOF['"]?\n(.+?)(?:\n|$)/.exec(cmd);
          let preview: string;
          if (heredocMatch) {
            preview = heredocMatch[1].trim().slice(0, 80);
          } else {
            const msgMatch = /-m\s+["'](.+?)["']/.exec(cmd);
            preview = msgMatch ? msgMatch[1].slice(0, 80) : cmd.slice(0, 80);
          }
          gitCommits.push({ messagePreview: preview, messageIndex: i });
        }
        if (cmd.includes('git push')) gitPushCount++;
        if (cmd.includes('git checkout -b') || cmd.includes('git switch -c')) {
          const branchMatch = /git (?:checkout -b|switch -c)\s+(\S+)/.exec(cmd);
          if (branchMatch) gitBranchCreations.push(branchMatch[1]);
        }
      }

      // Skills
      if (toolName === 'Skill') {
        skillsInvoked.push({
          skill: (inp.skill as string) ?? 'unknown',
          argsPreview: (typeof inp.args === 'string'
            ? inp.args
            : JSON.stringify(inp.args ?? '')
          ).slice(0, 120),
        });
      }

      // Task (subagent list)
      if (toolName === 'Task') {
        subagentsList.push({
          description: (inp.description as string) ?? 'unknown',
          subagentType: (inp.subagent_type as string) ?? 'unknown',
          model: (inp.model as string) ?? 'default (inherits parent)',
          runInBackground: (inp.run_in_background as boolean) ?? false,
        });
      }

      // TaskCreate
      if (toolName === 'TaskCreate') {
        lifecycleTasks.push((inp.subject as string) ?? 'unknown');
      }

      // AskUserQuestion
      if (toolName === 'AskUserQuestion') {
        const questions = inp.questions as { question?: string; options?: { label?: string }[] }[];
        if (Array.isArray(questions)) {
          for (const q of questions) {
            userQuestions.push({
              question: q.question ?? '',
              options: Array.isArray(q.options) ? q.options.map((o) => o.label ?? '') : [],
            });
          }
        }
      }

      // File reads
      if (toolName === 'Read') {
        const filePath = (inp.file_path as string) ?? '';
        if (filePath) {
          fileReadCounts.set(filePath, (fileReadCounts.get(filePath) ?? 0) + 1);
        }
      }

      // Write/Edit for thrashing
      if (toolName === 'Write' || toolName === 'Edit') {
        const fp = (inp.file_path as string) ?? '';
        if (fp) {
          const indices = fileEditIndices.get(fp);
          if (indices) indices.push(i);
          else fileEditIndices.set(fp, [i]);
        }
      }

      // Startup overhead: track first non-Skill tool call
      if (!firstWorkToolSeen && NON_SKILL_TOOLS.has(toolName)) {
        firstWorkToolSeen = true;
      }
    }

    // --- Startup overhead: count assistant messages before first work tool ---
    if (msgType === 'assistant' && !firstWorkToolSeen) {
      startupMessages++;
      if (m.usage) {
        startupTokens += m.usage.output_tokens ?? 0;
        startupTokens += m.usage.input_tokens ?? 0;
        startupTokens += m.usage.cache_creation_input_tokens ?? 0;
        startupTokens += m.usage.cache_read_input_tokens ?? 0;
      }
    }

    // --- Token density timeline ---
    if (msgType === 'assistant' && msgTs && m.usage) {
      const totalMsgTokens =
        (m.usage.input_tokens ?? 0) +
        (m.usage.output_tokens ?? 0) +
        (m.usage.cache_creation_input_tokens ?? 0) +
        (m.usage.cache_read_input_tokens ?? 0);
      assistantMsgData.push([msgTs, totalMsgTokens]);
    }

    // --- Timing / key events ---
    if (msgTs) {
      let label: string | null = null;
      if (msgType === 'user' && typeof m.content === 'string') {
        const content = m.content;
        if (content.includes('start feature')) {
          label = `User: ${content.slice(0, 60)}`;
        } else if (content.includes('being continued')) {
          label = 'Context compaction/continuation';
        }
      }

      for (const tc of m.toolCalls) {
        if (tc.name === 'Skill') {
          label = `Skill: ${(tc.input.skill as string) ?? ''}`;
        } else if (tc.name === 'Task') {
          const inpTc = tc.input ?? {};
          label = `Task: ${(inpTc.description as string) ?? ''} (${(inpTc.subagent_type as string) ?? ''})`;
        }
      }

      if (label) {
        keyEvents.push({ timestamp: msgTs, label });
      }
    }

    // --- Friction signals (user messages) ---
    if (msgType === 'user' && !m.isMeta) {
      const contentText = extractTextContent(m);
      if (contentText.trim()) {
        userMessageCount++;
        for (const [regex, keyword] of FRICTION_PATTERNS) {
          if (regex.test(contentText)) {
            corrections.push({
              messageIndex: i,
              keyword,
              preview: contentText.slice(0, 120).replace(/\n/g, ' '),
            });
            break;
          }
        }
      }
    }

    // --- Out-of-scope findings (assistant messages) ---
    if (msgType === 'assistant') {
      const contentText = extractTextContent(m);
      const contentLower = contentText.toLowerCase();
      for (const kw of OUT_OF_SCOPE_KEYWORDS) {
        const kwIdx = contentLower.indexOf(kw.toLowerCase());
        if (kwIdx >= 0) {
          const start = Math.max(0, kwIdx - 80);
          const end = Math.min(contentText.length, kwIdx + 300);
          outOfScopeFindings.push({
            keyword: kw,
            messageIndex: i,
            snippet: contentText.slice(start, end).replace(/\n/g, ' ').trim(),
          });
          break;
        }
      }
    }

    // --- Tool results ---
    for (const tr of m.toolResults) {
      const toolUseId = tr.toolUseId;
      if (!toolUseId) continue;
      const contentStr = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);

      // Tool errors
      if (tr.isError) {
        let toolName = 'unknown';
        let toolInput = '';
        const indexed = toolCallIndex.get(toolUseId);
        if (indexed) {
          const [, tc] = indexed;
          toolName = tc.name ?? 'unknown';
          toolInput = JSON.stringify(tc.input ?? {}).slice(0, 300);
        }

        const errorEntry: ToolError = {
          tool: toolName,
          inputPreview: toolInput,
          error: contentStr.slice(0, 500),
          messageIndex: i,
          isPermissionDenial: false,
        };

        if (isPermissionDenial(contentStr)) {
          errorEntry.isPermissionDenial = true;
          permissionDenials.push(errorEntry);
        }

        errors.push(errorEntry);
        errorsByTool.set(toolName, (errorsByTool.get(toolName) ?? 0) + 1);
      }

      // Bash exit code errors
      if (
        !tr.isError &&
        (contentStr.includes('Exit code 1') || contentStr.includes('Exit code 127'))
      ) {
        const indexed = toolCallIndex.get(toolUseId);
        if (indexed) {
          const [, tc] = indexed;
          if (tc.name === 'Bash') {
            const bashError: ToolError = {
              tool: 'Bash (non-zero exit)',
              inputPreview: JSON.stringify(tc.input ?? {}).slice(0, 300),
              error: contentStr.slice(0, 500),
              messageIndex: i,
              isPermissionDenial: false,
            };
            if (isPermissionDenial(contentStr)) {
              bashError.isPermissionDenial = true;
              permissionDenials.push(bashError);
            }
            errors.push(bashError);
            errorsByTool.set(
              'Bash (non-zero exit)',
              (errorsByTool.get('Bash (non-zero exit)') ?? 0) + 1
            );
          }
        }
      }

      // --- Test progression: parse test output from bash results ---
      const indexedForTest = toolCallIndex.get(toolUseId);
      if (indexedForTest) {
        const [, tcOrig] = indexedForTest;
        if (tcOrig.name === 'Bash') {
          const testResult = parseTestSummary(contentStr);
          if (testResult) {
            const [passed, failed] = testResult;
            testSnapshots.push({
              messageIndex: i,
              passed,
              failed,
              total: passed + failed,
              raw: contentStr.slice(0, 200).replace(/\n/g, ' '),
            });
          }
        }
      }

      // --- Lines changed: parse git diff --stat output ---
      const indexedForDiff = toolCallIndex.get(toolUseId);
      if (indexedForDiff) {
        const [, tcOrig] = indexedForDiff;
        if (tcOrig.name === 'Bash') {
          const rawCmd = tcOrig.input?.command;
          const cmdText = typeof rawCmd === 'string' ? rawCmd : '';
          if (cmdText.includes('git diff') || cmdText.includes('git show')) {
            const insertionIdx = contentStr.indexOf(' insertion');
            const deletionIdx = contentStr.indexOf(' deletion');
            if (insertionIdx > 0) {
              const numStr = contentStr
                .slice(Math.max(0, insertionIdx - 10), insertionIdx)
                .trim()
                .split(/\s+/)
                .pop();
              if (numStr && /^\d+$/.test(numStr)) linesAddedTotal += parseInt(numStr, 10);
            }
            if (deletionIdx > 0) {
              const numStr = contentStr
                .slice(Math.max(0, deletionIdx - 10), deletionIdx)
                .trim()
                .split(/\s+/)
                .pop();
              if (numStr && /^\d+$/.test(numStr)) linesRemovedTotal += parseInt(numStr, 10);
            }
          }
        }
      }
    }
  }

  // ===================================================================
  // POST-PASS AGGREGATION
  // ===================================================================

  // --- Token usage ---
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;

  const byModel: Record<string, ModelTokenStats> = {};
  for (const [model, stats] of modelStats) {
    stats.costUsd = Math.round(stats.costUsd * 10000) / 10000;
    byModel[model] = stats;
    totalInputTokens += stats.inputTokens;
    totalOutputTokens += stats.outputTokens;
    totalCacheCreationTokens += stats.cacheCreation;
    totalCacheReadTokens += stats.cacheRead;
  }

  let grandTotal =
    totalInputTokens + totalOutputTokens + totalCacheCreationTokens + totalCacheReadTokens;

  // --- Cost analysis ---
  const commitCount = gitCommits.length;
  const linesChanged = linesAddedTotal + linesRemovedTotal;

  // --- Subagent metrics from detail.processes ---
  const subagentEntries: SubagentEntry[] = detail.processes.map((proc: Process) => {
    const desc = proc.description ?? 'unknown';
    // Extract actual model from subagent messages (first assistant message with a model field)
    const subagentModel =
      proc.messages.find((m: ParsedMessage) => m.type === 'assistant' && m.model)?.model ??
      'default (inherits parent)';
    // Compute cost from subagent token breakdown (proc.metrics.costUsd is not populated upstream)
    const computedCost = calculateMessageCost(
      subagentModel,
      proc.metrics.inputTokens,
      proc.metrics.outputTokens,
      proc.metrics.cacheReadTokens,
      proc.metrics.cacheCreationTokens
    );
    return {
      description: desc,
      subagentType: proc.subagentType ?? 'unknown',
      model: subagentModel,
      totalTokens: proc.metrics.totalTokens,
      totalDurationMs: proc.durationMs,
      totalToolUseCount: proc.messages.reduce(
        (sum: number, pm: ParsedMessage) => sum + pm.toolCalls.length,
        0
      ),
      costUsd: computedCost,
      modelMismatch: detectModelMismatch(desc, subagentModel),
    };
  });

  const saFromProcesses = {
    count: subagentEntries.length,
    totalTokens: subagentEntries.reduce((sum, a) => sum + a.totalTokens, 0),
    totalDurationMs: subagentEntries.reduce((sum, a) => sum + a.totalDurationMs, 0),
    totalToolUseCount: subagentEntries.reduce((sum, a) => sum + a.totalToolUseCount, 0),
    totalCostUsd:
      Math.round(subagentEntries.reduce((sum, a) => sum + a.costUsd, 0) * 10000) / 10000,
    byAgent: subagentEntries,
  };

  // --- Tool usage with success rates ---
  const toolSuccessRates: Record<string, ToolSuccessRate> = {};
  const sortedToolCounts = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
  const countsRecord: Record<string, number> = {};
  for (const [tool, count] of sortedToolCounts) {
    countsRecord[tool] = count;
    const errCount = errorsByTool.get(tool) ?? 0;
    const successPct = count ? Math.round(((count - errCount) / count) * 1000) / 10 : 0;
    toolSuccessRates[tool] = {
      totalCalls: count,
      errors: errCount,
      successRatePct: successPct,
      assessment: computeToolHealthAssessment(successPct),
    };
  }

  // Overall tool health: worst assessment among tools with >5 calls
  const significantTools = Object.values(toolSuccessRates).filter((t) => t.totalCalls > 5);
  type THAssessment = 'healthy' | 'degraded' | 'unreliable';
  const overallToolHealth: THAssessment =
    significantTools.length > 0
      ? significantTools.reduce<THAssessment>((worst, t) => {
          const order = { healthy: 0, degraded: 1, unreliable: 2 } as const;
          return order[t.assessment] > order[worst] ? t.assessment : worst;
        }, 'healthy')
      : computeToolHealthAssessment(100);

  // --- Key events timing ---
  for (let j = 1; j < keyEvents.length; j++) {
    const prevDt = keyEvents[j - 1].timestamp;
    const currDt = keyEvents[j].timestamp;
    const delta = (currDt.getTime() - prevDt.getTime()) / 1000;
    keyEvents[j].deltaSeconds = Math.round(delta * 10) / 10;
    keyEvents[j].deltaHuman = formatDuration(Math.floor(delta));
  }

  // --- Thinking blocks signal aggregation ---
  const signalTotals: Record<string, number> = {};
  for (const ta of thinkingAnalysis) {
    for (const sig of Object.keys(ta.signals)) {
      signalTotals[sig] = (signalTotals[sig] ?? 0) + 1;
    }
  }

  // --- Cache economics ---
  const cacheTotalCreationAndRead = totalCacheCreation + totalCacheRead;
  const cacheEfficiency = cacheTotalCreationAndRead
    ? Math.round((totalCacheRead / cacheTotalCreationAndRead) * 10000) / 100
    : 0;
  const cacheRwRatio = totalCacheCreation
    ? Math.round((totalCacheRead / totalCacheCreation) * 10) / 10
    : 0;

  // --- File read redundancy ---
  let totalReads = 0;
  const redundantFiles: Record<string, number> = {};
  for (const [path, count] of fileReadCounts) {
    totalReads += count;
    if (count > 2) redundantFiles[path] = count;
  }
  const uniqueFiles = fileReadCounts.size;

  // --- Token density timeline ---
  const quartiles: { q: number; avgTokens: number; messageCount: number }[] = [];
  if (assistantMsgData.length > 0) {
    const n = assistantMsgData.length;
    const qSize = Math.max(1, Math.floor(n / 4));
    for (let q = 0; q < 4; q++) {
      const startIdx = q * qSize;
      const endIdx = q === 3 ? n : (q + 1) * qSize;
      const chunk = assistantMsgData.slice(startIdx, endIdx);
      if (chunk.length > 0) {
        const avgTokens = Math.round(chunk.reduce((sum, [, t]) => sum + t, 0) / chunk.length);
        quartiles.push({ q: q + 1, avgTokens, messageCount: chunk.length });
      } else {
        quartiles.push({ q: q + 1, avgTokens: 0, messageCount: 0 });
      }
    }
  } else {
    for (let q = 0; q < 4; q++) {
      quartiles.push({ q: q + 1, avgTokens: 0, messageCount: 0 });
    }
  }

  // --- Conversation tree analysis ---
  const depthMemo = new Map<string, number>();
  function getDepth(uuid: string, visited = new Set<string>()): number {
    if (depthMemo.has(uuid)) return depthMemo.get(uuid)!;
    if (visited.has(uuid)) {
      depthMemo.set(uuid, 0);
      return 0;
    }
    visited.add(uuid);
    const parent = parentMap.get(uuid);
    if (!parent) {
      depthMemo.set(uuid, 0);
      return 0;
    }
    const depth = 1 + getDepth(parent, visited);
    depthMemo.set(uuid, depth);
    return depth;
  }

  let maxDepth = 0;
  for (const uuid of parentMap.keys()) {
    const d = getDepth(uuid);
    if (d > maxDepth) maxDepth = d;
  }

  // Branch points: parents with multiple children
  const branchPoints = new Map<string, string[]>();
  for (const [parent, children] of childrenMap) {
    if (children.length > 1) branchPoints.set(parent, children);
  }

  const branchDetails = [...branchPoints.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([p, c]) => ({
      parentUuid: p.slice(0, 12) + '...',
      childCount: c.length,
      parentMessageIndex: uuidToIdx.get(p),
    }));

  // --- Idle gap analysis ---
  const totalIdle = idleGaps.reduce((sum, g) => sum + g.gapSeconds, 0);
  const wallClock = durationSeconds;
  const activeTime = wallClock > 0 ? wallClock - totalIdle : 0;

  // --- Thrashing signals ---
  const bashNearDuplicates = [...bashPrefixGroups.entries()]
    .filter(([, count]) => count > 2)
    .sort((a, b) => b[1] - a[1])
    .map(([prefix, count]) => ({ prefix, count }));

  const editReworkFiles = [...fileEditIndices.entries()]
    .filter(([, indices]) => indices.length >= 3)
    .map(([filePath, editIndices]) => ({ filePath, editIndices }));

  // --- Model switches ---
  const modelsUsed =
    modelSwitches.length > 0
      ? [...new Set([...modelSwitches.map((s) => s.from), ...modelSwitches.map((s) => s.to)])]
      : [...modelStats.keys()];

  // --- Test progression trajectory ---
  let trajectory: 'improving' | 'regressing' | 'stable' | 'insufficient_data' = 'insufficient_data';
  if (testSnapshots.length >= 2) {
    const first = testSnapshots[0];
    const last = testSnapshots[testSnapshots.length - 1];
    if (last.passed > first.passed) trajectory = 'improving';
    else if (last.passed < first.passed) trajectory = 'regressing';
    else trajectory = 'stable';
  }

  // --- Prompt quality assessment ---
  const correctionCount = corrections.length;
  const frictionRate = userMessageCount
    ? Math.round((correctionCount / userMessageCount) * 10000) / 10000
    : 0;

  type PromptAssessment =
    | 'underspecified'
    | 'verbose_but_unclear'
    | 'well_specified'
    | 'moderate_friction';

  let assessment: PromptAssessment;
  let promptNote: string;

  if (firstUserMessageLength < 100 && correctionCount >= 2) {
    assessment = 'underspecified';
    promptNote =
      'Short initial prompt with multiple corrections suggests the task needed more upfront specification.';
  } else if (firstUserMessageLength > 500 && correctionCount >= 3) {
    assessment = 'verbose_but_unclear';
    promptNote =
      'Initial prompt was detailed but still required corrections — consider restructuring for clarity.';
  } else if (correctionCount <= 1) {
    assessment = 'well_specified';
    promptNote = 'Low friction — initial prompt effectively communicated intent.';
  } else {
    assessment = 'moderate_friction';
    promptNote =
      'Moderate friction detected — review correction patterns for improvement opportunities.';
  }

  // --- Message types ---
  const messageTypes: Record<string, number> = {};
  for (const [type, count] of typeCounts) {
    messageTypes[type] = count;
  }

  // --- Subagent cost from processes ---
  const processSubagentCost = subagentEntries.reduce((sum, a) => sum + a.costUsd, 0);
  const totalCost = parentCost + processSubagentCost;

  // Add aggregated subagent row to costByModel and byModel for the cost table
  if (subagentEntries.length > 0 && processSubagentCost > 0) {
    const subagentTokenStats: ModelTokenStats = {
      apiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreation: 0,
      cacheRead: 0,
      costUsd: 0,
    };
    for (const proc of detail.processes) {
      subagentTokenStats.inputTokens += proc.metrics.inputTokens;
      subagentTokenStats.outputTokens += proc.metrics.outputTokens;
      subagentTokenStats.cacheCreation += proc.metrics.cacheCreationTokens;
      subagentTokenStats.cacheRead += proc.metrics.cacheReadTokens;
      // Count assistant messages with usage as API calls
      subagentTokenStats.apiCalls += proc.messages.filter(
        (m: ParsedMessage) => m.type === 'assistant' && m.usage
      ).length;
    }
    subagentTokenStats.costUsd = Math.round(processSubagentCost * 10000) / 10000;
    const subagentLabel = 'Subagents (combined)';
    byModel[subagentLabel] = subagentTokenStats;
    modelStats.set(subagentLabel, subagentTokenStats);

    // Update totals to include subagent tokens so the footer row stays consistent
    totalInputTokens += subagentTokenStats.inputTokens;
    totalOutputTokens += subagentTokenStats.outputTokens;
    totalCacheCreationTokens += subagentTokenStats.cacheCreation;
    totalCacheReadTokens += subagentTokenStats.cacheRead;
    grandTotal =
      totalInputTokens + totalOutputTokens + totalCacheCreationTokens + totalCacheReadTokens;
  }

  // --- Assessment computations ---
  const costPerCommitVal =
    commitCount > 0 ? Math.round((totalCost / commitCount) * 10000) / 10000 : null;
  const costPerLineVal =
    linesChanged > 0 ? Math.round((totalCost / linesChanged) * 1000000) / 1000000 : null;
  const subagentCostSharePct =
    totalCost > 0 ? Math.round((processSubagentCost / totalCost) * 10000) / 100 : null;

  const readsPerUniqueFile = uniqueFiles ? Math.round((totalReads / uniqueFiles) * 100) / 100 : 0;
  const startupPctOfTotal = grandTotal ? Math.round((startupTokens / grandTotal) * 10000) / 100 : 0;
  const idlePct = wallClock > 0 ? Math.round((totalIdle / wallClock) * 1000) / 10 : 0;
  const thrashingSignalCount = bashNearDuplicates.length + editReworkFiles.length;

  // ===================================================================
  // BUILD REPORT
  // ===================================================================

  const report: SessionReport = {
    overview: {
      sessionId: session.id,
      projectId: session.projectId ?? 'unknown',
      projectPath: session.projectPath ?? 'unknown',
      firstMessage: session.firstMessage ?? 'unknown',
      messageCount: session.messageCount ?? 0,
      hasSubagents: session.hasSubagents ?? false,
      contextConsumption: ctxConsumption,
      contextConsumptionPct: ctxConsumptionPct,
      contextAssessment: ctxAssessment,
      compactionCount: session.compactionCount ?? 0,
      gitBranch: session.gitBranch ?? 'unknown',
      startTime: firstTs,
      endTime: lastTs,
      durationSeconds,
      durationHuman: durationSeconds > 0 ? formatDuration(Math.floor(durationSeconds)) : 'unknown',
      totalMessages: messages.length,
    },

    tokenUsage: {
      byModel,
      totals: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheCreation: totalCacheCreationTokens,
        cacheRead: totalCacheReadTokens,
        grandTotal,
        cacheReadPct: grandTotal
          ? Math.round((totalCacheReadTokens / grandTotal) * 10000) / 100
          : 0,
      },
    },

    costAnalysis: {
      parentCostUsd: Math.round(parentCost * 10000) / 10000,
      subagentCostUsd: Math.round(processSubagentCost * 10000) / 10000,
      totalSessionCostUsd: Math.round(totalCost * 10000) / 10000,
      costByModel: Object.fromEntries(
        [...modelStats.entries()].map(([model, stats]) => [
          model,
          Math.round(stats.costUsd * 10000) / 10000,
        ])
      ),
      costPerCommit: costPerCommitVal,
      costPerLineChanged: costPerLineVal,
      costPerCommitAssessment:
        costPerCommitVal != null ? computeCostPerCommitAssessment(costPerCommitVal) : null,
      costPerLineAssessment:
        costPerLineVal != null ? computeCostPerLineAssessment(costPerLineVal) : null,
      subagentCostSharePct,
      subagentCostShareAssessment:
        subagentCostSharePct != null
          ? computeSubagentCostShareAssessment(subagentCostSharePct)
          : null,
    },

    cacheEconomics: {
      cacheRead: totalCacheRead,
      cacheEfficiencyPct: cacheEfficiency,
      coldStartDetected,
      cacheReadToWriteRatio: cacheRwRatio,
      cacheEfficiencyAssessment:
        cacheTotalCreationAndRead > 0 ? computeCacheEfficiencyAssessment(cacheEfficiency) : null,
      cacheRatioAssessment:
        totalCacheCreation > 0 ? computeCacheRatioAssessment(cacheRwRatio) : null,
    },

    toolUsage: {
      counts: countsRecord,
      totalCalls: [...toolCounts.values()].reduce((sum, c) => sum + c, 0),
      successRates: toolSuccessRates,
      overallToolHealth,
    },

    subagentMetrics: saFromProcesses,

    subagentsList,

    errors: {
      errors,
      permissionDenials: {
        count: permissionDenials.length,
        denials: permissionDenials,
        affectedTools: [...new Set(permissionDenials.map((d) => d.tool))],
      },
    },

    gitActivity: {
      commitCount: gitCommits.length,
      commits: gitCommits,
      pushCount: gitPushCount,
      branchCreations: gitBranchCreations,
      linesAdded: linesAddedTotal,
      linesRemoved: linesRemovedTotal,
      linesChanged,
    },

    frictionSignals: {
      correctionCount,
      corrections,
      frictionRate,
    },

    thrashingSignals: {
      bashNearDuplicates,
      editReworkFiles,
      thrashingAssessment: computeThrashingAssessment(thrashingSignalCount),
    },

    conversationTree: {
      totalNodes: uuidToIdx.size,
      maxDepth,
      sidechainCount,
      branchPoints: branchPoints.size,
      branchDetails,
    },

    idleAnalysis: {
      idleThresholdSeconds: IDLE_THRESHOLD_SEC,
      idleGapCount: idleGaps.length,
      totalIdleSeconds: Math.round(totalIdle * 10) / 10,
      totalIdleHuman: formatDuration(Math.floor(totalIdle)),
      wallClockSeconds: Math.round(wallClock * 10) / 10,
      activeWorkingSeconds: Math.round(Math.max(activeTime, 0) * 10) / 10,
      activeWorkingHuman: formatDuration(Math.floor(Math.max(activeTime, 0))),
      idlePct,
      longestGaps: [...idleGaps].sort((a, b) => b.gapSeconds - a.gapSeconds).slice(0, 5),
      idleAssessment: computeIdleAssessment(idlePct),
    },

    modelSwitches: {
      count: modelSwitches.length,
      switches: modelSwitches,
      modelsUsed,
      switchPattern: detectSwitchPattern(modelSwitches),
    },

    workingDirectories: {
      uniqueDirectories: [...cwdSet],
      directoryCount: cwdSet.size,
      changes: cwdChanges,
      changeCount: cwdChanges.length,
      isMultiDirectory: cwdSet.size > 1,
    },

    testProgression: {
      snapshotCount: testSnapshots.length,
      snapshots: testSnapshots,
      trajectory,
      firstSnapshot: testSnapshots.length > 0 ? testSnapshots[0] : null,
      lastSnapshot: testSnapshots.length > 0 ? testSnapshots[testSnapshots.length - 1] : null,
    },

    startupOverhead: {
      messagesBeforeFirstWork: startupMessages,
      tokensBeforeFirstWork: startupTokens,
      pctOfTotal: startupPctOfTotal,
      overheadAssessment: computeOverheadAssessment(startupPctOfTotal),
    },

    tokenDensityTimeline: { quartiles },

    promptQuality: {
      firstMessageLengthChars: firstUserMessageLength,
      userMessageCount,
      correctionCount,
      frictionRate,
      assessment,
      note: promptNote,
    },

    thinkingBlocks: {
      count: thinkingCount,
      analyzedCount: thinkingAnalysis.length,
      signalSummary: signalTotals,
      notableBlocks: thinkingAnalysis.slice(0, 20),
    },

    keyEvents,

    messageTypes,

    fileReadRedundancy: {
      totalReads,
      uniqueFiles,
      readsPerUniqueFile,
      redundantFiles,
      redundancyAssessment: computeRedundancyAssessment(readsPerUniqueFile),
    },

    compaction: {
      count: session.compactionCount ?? 0,
      compactSummaryCount,
      note:
        (session.compactionCount ?? 0) > 0
          ? 'Session underwent compaction, which may have caused loss of earlier context. Check for repeated work after compaction events.'
          : 'No compaction occurred — session stayed within context limits.',
    },

    gitBranches: [...branches],

    skillsInvoked,

    bashCommands: {
      total: bashCmds.length,
      unique: new Set(bashCmds).size,
      repeated: Object.fromEntries(
        [
          ...bashCmds
            .reduce((acc, cmd) => acc.set(cmd, (acc.get(cmd) ?? 0) + 1), new Map<string, number>())
            .entries(),
        ]
          .filter(([, count]) => count > 1)
          .sort((a, b) => b[1] - a[1])
      ),
    },

    lifecycleTasks,

    userQuestions,

    outOfScopeFindings,

    agentTree: (() => {
      const uniqueAgents = new Map<string, AgentTreeNode>();
      for (const node of agentTreeNodes) {
        if (!uniqueAgents.has(node.agentId)) uniqueAgents.set(node.agentId, node);
      }
      return {
        agentCount: uniqueAgents.size,
        agents: [...uniqueAgents.values()],
        hasTeamMode: agentTreeNodes.some((n) => n.teamName),
        teamNames: [...new Set(agentTreeNodes.filter((n) => n.teamName).map((n) => n.teamName))],
      };
    })(),
  };

  return report;
}
