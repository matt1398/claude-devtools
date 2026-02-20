/**
 * Unified Context Tracker
 *
 * Provides comprehensive context tracking for all sources of context injection:
 * - CLAUDE.md files (enterprise, user, project, directory)
 * - Mentioned files (@mentions)
 * - Tool outputs
 *
 * This builds on claudeMdTracker.ts and extends it to track all context sources.
 */

import { estimateTokens } from '@shared/utils/tokenFormatting';

import { MAX_MENTIONED_FILE_TOKENS } from '../types/contextInjection';

import { buildDisplayItems, findLastOutput, linkToolCallsToResults } from './aiGroupEnhancer';
import {
  createGlobalInjections,
  detectClaudeMdFromFilePath,
  extractFileRefsFromResponses,
  extractReadToolPaths,
  extractUserMentionPaths,
  generateInjectionId,
  getDisplayName,
} from './claudeMdTracker';

import type { ClaudeMdInjection, ClaudeMdSource } from '../types/claudeMd';
import type {
  ClaudeMdContextInjection,
  CompactionTokenDelta,
  ContextInjection,
  ContextPhase,
  ContextPhaseInfo,
  ContextStats,
  MentionedFileInfo,
  MentionedFileInjection,
  NewCountsByCategory,
  TaskCoordinationBreakdown,
  TaskCoordinationInjection,
  ThinkingTextBreakdown,
  ThinkingTextInjection,
  TokensByCategory,
  ToolOutputInjection,
  ToolTokenBreakdown,
  UserMessageInjection,
} from '../types/contextInjection';
import type { ClaudeMdFileInfo } from '../types/data';
import type {
  AIGroup,
  AIGroupDisplayItem,
  ChatItem,
  LinkedToolItem,
  UserGroup,
} from '../types/groups';

// =============================================================================
// Constants
// =============================================================================

/** Category identifier for mentioned file injections */
const CATEGORY_MENTIONED_FILE = 'mentioned-file' as const;

/** Tool names that constitute task coordination overhead */
const TASK_COORDINATION_TOOL_NAMES = new Set([
  'SendMessage',
  'TeamCreate',
  'TeamDelete',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
]);

// =============================================================================
// ID Generation Functions
// =============================================================================

/**
 * Generate a unique ID for a mentioned file injection.
 * Uses a similar approach to generateInjectionId but with 'mf-' prefix.
 */
function generateMentionedFileId(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const positiveHash = Math.abs(hash).toString(16);
  return `mf-${positiveHash}`;
}

/**
 * Generate a unique ID for a tool output injection.
 */
function generateToolOutputId(turnIndex: number): string {
  return `tool-output-ai-${turnIndex}`;
}

/**
 * Generate unique ID for thinking-text injection.
 */
function generateThinkingTextId(turnIndex: number): string {
  return `thinking-text-ai-${turnIndex}`;
}

/**
 * Generate unique ID for task coordination injection.
 */
function generateTaskCoordinationId(turnIndex: number): string {
  return `task-coord-ai-${turnIndex}`;
}

/**
 * Generate unique ID for user message injection.
 */
function generateUserMessageId(turnIndex: number): string {
  return `user-msg-ai-${turnIndex}`;
}

// =============================================================================
// Injection Wrapping Functions
// =============================================================================

/**
 * Wrap a ClaudeMdInjection with the 'claude-md' category for union compatibility.
 */
function wrapClaudeMdInjection(injection: ClaudeMdInjection): ClaudeMdContextInjection {
  return {
    ...injection,
    category: 'claude-md' as const,
  };
}

// =============================================================================
// Mentioned File Injection Creation
// =============================================================================

/**
 * Parameters for creating a mentioned file injection.
 */
interface CreateMentionedFileInjectionParams {
  /** Absolute file path */
  path: string;
  /** Display name (relative path or filename) */
  displayName: string;
  /** Estimated token count for this file */
  estimatedTokens: number;
  /** Turn index where this file was first mentioned */
  turnIndex: number;
  /** AI group ID for navigation */
  aiGroupId: string;
  /** Whether the file exists on disk */
  exists?: boolean;
}

/**
 * Create a MentionedFileInjection object.
 */
function createMentionedFileInjection(
  params: CreateMentionedFileInjectionParams
): MentionedFileInjection {
  return {
    id: generateMentionedFileId(params.path),
    category: CATEGORY_MENTIONED_FILE,
    path: params.path,
    displayName: params.displayName,
    estimatedTokens: params.estimatedTokens,
    firstSeenTurnIndex: params.turnIndex,
    firstSeenInGroup: params.aiGroupId,
    exists: params.exists ?? true,
  };
}

// =============================================================================
// Tool Output Aggregation
// =============================================================================

/**
 * Aggregate tool outputs from all linked tools in a turn.
 * Also includes tokens from user-invoked skills (via /skill-name commands).
 * Returns a ToolOutputInjection if there are any tool outputs with tokens.
 */
function aggregateToolOutputs(
  linkedTools: Map<string, LinkedToolItem>,
  turnIndex: number,
  aiGroupId: string,
  displayItems?: AIGroupDisplayItem[]
): ToolOutputInjection | null {
  const toolBreakdown: ToolTokenBreakdown[] = [];
  let totalTokens = 0;

  for (const linkedTool of linkedTools.values()) {
    // Skip task coordination tools - they are tracked separately
    if (TASK_COORDINATION_TOOL_NAMES.has(linkedTool.name)) {
      continue;
    }

    // Calculate total context tokens for the tool operation
    // This matches getToolContextTokens in LinkedToolItem.tsx and ErrorDetector
    //
    // callTokens: What Claude generated (Write file content, Edit old/new strings)
    // resultTokens: What Claude reads back (success message, Read file content)
    // skillTokens: Additional context for Skill tools
    const callTokens = linkedTool.callTokens ?? 0;
    const resultTokens = linkedTool.result?.tokenCount ?? 0;
    const skillTokens = linkedTool.skillInstructionsTokenCount ?? 0;
    const toolTokenCount = callTokens + resultTokens + skillTokens;

    if (toolTokenCount > 0) {
      // Rename "Task" to "Task (Subagent)" for clarity in the UI
      const displayName = linkedTool.name === 'Task' ? 'Task (Subagent)' : linkedTool.name;
      toolBreakdown.push({
        toolName: displayName,
        tokenCount: toolTokenCount,
        isError: linkedTool.result?.isError ?? false,
        toolUseId: linkedTool.id,
      });
      totalTokens += toolTokenCount;
    }
  }

  // Include user-invoked slash tokens from display items
  // These are slashes invoked via /xxx commands
  if (displayItems) {
    for (const item of displayItems) {
      if (item.type === 'slash' && item.slash.instructionsTokenCount) {
        toolBreakdown.push({
          toolName: `/${item.slash.name}`,
          tokenCount: item.slash.instructionsTokenCount,
          isError: false,
        });
        totalTokens += item.slash.instructionsTokenCount;
      }
    }
  }

  // Return null if no tokens from tools
  if (totalTokens === 0) {
    return null;
  }

  return {
    id: generateToolOutputId(turnIndex),
    category: 'tool-output',
    turnIndex,
    aiGroupId,
    estimatedTokens: totalTokens,
    toolCount: toolBreakdown.length,
    toolBreakdown,
  };
}

// =============================================================================
// Task Coordination Aggregation
// =============================================================================

/**
 * Aggregate task coordination tokens from linked tools and display items.
 * Tracks SendMessage, TeamCreate, TaskCreate, and other task tools,
 * plus teammate_message items injected into the session.
 */
function aggregateTaskCoordination(
  linkedTools: Map<string, LinkedToolItem>,
  turnIndex: number,
  aiGroupId: string,
  displayItems?: AIGroupDisplayItem[]
): TaskCoordinationInjection | null {
  const breakdown: TaskCoordinationBreakdown[] = [];
  let totalTokens = 0;

  // Scan linked tools for task coordination tools
  for (const linkedTool of linkedTools.values()) {
    if (!TASK_COORDINATION_TOOL_NAMES.has(linkedTool.name)) {
      continue;
    }

    const callTokens = linkedTool.callTokens ?? 0;
    const resultTokens = linkedTool.result?.tokenCount ?? 0;
    const skillTokens = linkedTool.skillInstructionsTokenCount ?? 0;
    const toolTokenCount = callTokens + resultTokens + skillTokens;

    if (toolTokenCount > 0) {
      // Extract a label from tool input for SendMessage (recipient name)
      let label = linkedTool.name;
      if (linkedTool.name === 'SendMessage' && linkedTool.input) {
        const recipient = linkedTool.input.recipient as string | undefined;
        if (recipient) {
          label = `SendMessage → ${recipient}`;
        }
      }

      breakdown.push({
        type: linkedTool.name === 'SendMessage' ? 'send-message' : 'task-tool',
        toolName: linkedTool.name,
        tokenCount: toolTokenCount,
        label,
      });
      totalTokens += toolTokenCount;
    }
  }

  // Scan display items for teammate messages
  if (displayItems) {
    for (const item of displayItems) {
      if (item.type === 'teammate_message' && item.teammateMessage.tokenCount) {
        breakdown.push({
          type: 'teammate-message',
          tokenCount: item.teammateMessage.tokenCount,
          label: item.teammateMessage.teammateId,
        });
        totalTokens += item.teammateMessage.tokenCount;
      }
    }
  }

  if (totalTokens === 0) {
    return null;
  }

  return {
    id: generateTaskCoordinationId(turnIndex),
    category: 'task-coordination',
    turnIndex,
    aiGroupId,
    estimatedTokens: totalTokens,
    breakdown,
  };
}

// =============================================================================
// User Message Injection Creation
// =============================================================================

/**
 * Create a UserMessageInjection from a user group.
 * Uses rawText (includes commands and @mentions) for token estimation
 * since that's what's actually sent to the API.
 *
 * @returns UserMessageInjection or null if empty text or 0 tokens
 */
function createUserMessageInjection(
  userGroup: UserGroup,
  turnIndex: number,
  aiGroupId: string
): UserMessageInjection | null {
  const text = userGroup.content.rawText ?? userGroup.content.text ?? '';
  if (!text) return null;

  const tokens = estimateTokens(text);
  if (tokens === 0) return null;

  const textPreview = text.length > 80 ? text.slice(0, 80) + '…' : text;

  return {
    id: generateUserMessageId(turnIndex),
    category: 'user-message',
    turnIndex,
    aiGroupId,
    estimatedTokens: tokens,
    textPreview,
  };
}

// =============================================================================
// Thinking/Text Output Aggregation
// =============================================================================

/**
 * Aggregates thinking and text output tokens for a single turn.
 * Creates a ThinkingTextInjection that tracks all thinking blocks and text outputs.
 *
 * @param displayItems - Display items from the AI group
 * @param turnIndex - The turn index (0-based)
 * @param aiGroupId - The AI group ID for navigation
 * @returns ThinkingTextInjection or null if no tokens
 */
function aggregateThinkingText(
  displayItems: AIGroupDisplayItem[],
  turnIndex: number,
  aiGroupId: string
): ThinkingTextInjection | null {
  const breakdown: ThinkingTextBreakdown[] = [];
  let totalTokens = 0;
  let thinkingTokens = 0;
  let textTokens = 0;

  for (const item of displayItems) {
    if (item.type === 'thinking' && item.tokenCount && item.tokenCount > 0) {
      thinkingTokens += item.tokenCount;
      totalTokens += item.tokenCount;
    } else if (item.type === 'output' && item.tokenCount && item.tokenCount > 0) {
      textTokens += item.tokenCount;
      totalTokens += item.tokenCount;
    }
  }

  if (thinkingTokens > 0) {
    breakdown.push({ type: 'thinking', tokenCount: thinkingTokens });
  }
  if (textTokens > 0) {
    breakdown.push({ type: 'text', tokenCount: textTokens });
  }

  if (totalTokens === 0) {
    return null;
  }

  return {
    id: generateThinkingTextId(turnIndex),
    category: 'thinking-text',
    turnIndex,
    aiGroupId,
    estimatedTokens: totalTokens,
    breakdown,
  };
}

// =============================================================================
// Stats Computation
// =============================================================================

/**
 * Parameters for computing context stats for an AI group.
 */
interface ComputeContextStatsParams {
  /** The AI group being processed */
  aiGroup: AIGroup;
  /** The preceding user group (if any) */
  userGroup: UserGroup | null;
  /** Linked tools map from the enhanced AI group */
  linkedTools: Map<string, LinkedToolItem>;
  /** Display items from enhanced AI group (includes user skills) */
  displayItems?: AIGroupDisplayItem[];
  /** Whether this is the first AI group in the session */
  isFirstGroup: boolean;
  /** Accumulated injections from previous groups */
  previousInjections: ContextInjection[];
  /** Project root path for resolving relative paths */
  projectRoot: string;
  /** Token data for CLAUDE.md files (global sources) */
  claudeMdTokenData?: Record<string, ClaudeMdFileInfo>;
  /** Token data for mentioned files */
  mentionedFileTokenData?: Map<string, MentionedFileInfo>;
  /** Token data for validated directory CLAUDE.md files (keyed by full path) */
  directoryTokenData?: Record<string, ClaudeMdFileInfo>;
}

/**
 * Helper to check if a path is absolute.
 */
function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.startsWith('~/') ||
    path.startsWith('~\\') ||
    path === '~' ||
    path.startsWith('\\\\') ||
    /^[a-zA-Z]:[\\/]/.test(path)
  );
}

/**
 * Helper to join paths, handling various path formats properly.
 * Handles:
 * - Absolute paths: /full/path/file.tsx (returned as-is)
 * - Relative paths with ./: ./apps/foo/bar.tsx (strips ./)
 * - Parent paths with ../: ../other/file.tsx (walks up directories)
 * - Plain paths: apps/foo/bar.tsx (joins with base)
 * - Paths with @ prefix: @apps/foo/bar.tsx (strips @ then joins)
 */
function joinPaths(base: string, relative: string): string {
  if (isAbsolutePath(relative)) {
    return relative;
  }

  const cleanBase = trimTrailingSeparator(base);

  // Handle @ prefix (file mention marker) - strip it if present
  let cleanRelative = relative;
  if (cleanRelative.startsWith('@')) {
    cleanRelative = cleanRelative.slice(1);
  }

  // Handle ./ prefix (current directory)
  if (cleanRelative.startsWith('./')) {
    cleanRelative = cleanRelative.slice(2);
  }

  // Handle ../ prefixes (parent directory)
  const separator = cleanBase.includes('\\') ? '\\' : '/';
  const hasUnixRoot = cleanBase.startsWith('/');
  const hasUncRoot = cleanBase.startsWith('\\\\');
  const normalizedRelative = normalizeSeparators(cleanRelative, separator);
  const baseParts = splitPath(cleanBase);
  let remainingRelative = normalizedRelative;
  while (remainingRelative.startsWith(`..${separator}`)) {
    remainingRelative = remainingRelative.slice(3);
    if (baseParts.length > 1) {
      baseParts.pop();
    }
  }

  // Join the normalized paths
  let normalizedBase = baseParts.join(separator);
  if (hasUnixRoot && !normalizedBase.startsWith('/')) {
    normalizedBase = `/${normalizedBase}`;
  }
  if (hasUncRoot && !normalizedBase.startsWith('\\\\')) {
    normalizedBase = `\\\\${normalizedBase}`;
  }
  return remainingRelative ? `${normalizedBase}${separator}${remainingRelative}` : normalizedBase;
}

function trimTrailingSeparator(input: string): string {
  let end = input.length;
  while (end > 0) {
    const char = input[end - 1];
    if (char !== '/' && char !== '\\') {
      break;
    }
    end--;
  }
  return input.slice(0, end);
}

function normalizeSeparators(input: string, separator: '/' | '\\'): string {
  let output = '';
  let prevWasSeparator = false;

  for (const char of input) {
    const isSeparator = char === '/' || char === '\\';
    if (isSeparator) {
      if (!prevWasSeparator) {
        output += separator;
      }
      prevWasSeparator = true;
    } else {
      output += char;
      prevWasSeparator = false;
    }
  }

  return output;
}

function splitPath(input: string): string[] {
  const parts: string[] = [];
  let current = '';

  for (const char of input) {
    if (char === '/' || char === '\\') {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

function normalizeForComparison(input: string): string {
  return input.replace(/\\/g, '/');
}

/**
 * Create a directory injection for a CLAUDE.md file discovered via file paths.
 */
function createDirectoryInjection(path: string, aiGroupId: string): ClaudeMdInjection {
  return {
    id: generateInjectionId(path),
    path,
    source: 'directory' as ClaudeMdSource,
    displayName: getDisplayName(path, 'directory'),
    isGlobal: false,
    estimatedTokens: 500, // Default estimated tokens
    firstSeenInGroup: aiGroupId,
  };
}

/**
 * Compute context stats for an AI group.
 * Tracks CLAUDE.md injections, mentioned files, and tool outputs.
 */
function computeContextStats(params: ComputeContextStatsParams): ContextStats {
  const {
    aiGroup,
    userGroup,
    linkedTools,
    displayItems,
    isFirstGroup,
    previousInjections,
    projectRoot,
    claudeMdTokenData,
    mentionedFileTokenData,
    directoryTokenData,
  } = params;

  const newInjections: ContextInjection[] = [];
  const previousPaths = new Set(
    previousInjections
      .filter(
        (inj): inj is ClaudeMdContextInjection | MentionedFileInjection =>
          inj.category === 'claude-md' || inj.category === CATEGORY_MENTIONED_FILE
      )
      .map((inj) => inj.path)
  );

  // Use "ai-N" format for firstSeenInGroup to enable turn navigation
  const turnGroupId = `ai-${aiGroup.turnIndex}`;

  // a) For FIRST group only: Add CLAUDE.md global injections
  if (isFirstGroup) {
    const globalInjections = createGlobalInjections(projectRoot, turnGroupId, claudeMdTokenData);
    for (const injection of globalInjections) {
      if (!previousPaths.has(injection.path)) {
        newInjections.push(wrapClaudeMdInjection(injection));
        previousPaths.add(injection.path);
      }
    }
  }

  // b) Detect directory CLAUDE.md from file paths
  // Only include directory CLAUDE.md files that have been validated to exist
  const allFilePaths: string[] = [];

  // Extract from Read tool calls in semantic steps
  const readPaths = extractReadToolPaths(aiGroup.steps);
  allFilePaths.push(...readPaths);

  // Extract from user @ mentions
  const mentionPaths = extractUserMentionPaths(userGroup, projectRoot);
  allFilePaths.push(...mentionPaths);

  // Extract from isMeta:true user messages in AI responses (slash command follow-ups)
  const responseRefs = extractFileRefsFromResponses(aiGroup.responses);
  for (const ref of responseRefs) {
    if (ref.path) {
      const absPath = isAbsolutePath(ref.path) ? ref.path : joinPaths(projectRoot, ref.path);
      allFilePaths.push(absPath);
    }
  }

  // For each file path, detect potential CLAUDE.md files
  for (const filePath of allFilePaths) {
    const claudeMdPaths = detectClaudeMdFromFilePath(filePath, projectRoot);

    for (const claudeMdPath of claudeMdPaths) {
      // Skip if already seen
      if (previousPaths.has(claudeMdPath)) {
        continue;
      }

      // Skip if this is a global path (already handled)
      const isGlobalPath =
        normalizeForComparison(claudeMdPath) ===
          `${normalizeForComparison(projectRoot)}/CLAUDE.md` ||
        normalizeForComparison(claudeMdPath) ===
          `${normalizeForComparison(projectRoot)}/.claude/CLAUDE.md` ||
        normalizeForComparison(claudeMdPath) ===
          `${normalizeForComparison(projectRoot)}/CLAUDE.local.md`;

      if (isGlobalPath) {
        continue;
      }

      // Only include directory CLAUDE.md files that exist (validated via directoryTokenData)
      // If directoryTokenData is provided and doesn't contain this path, the file doesn't exist
      if (directoryTokenData) {
        const fileInfo = directoryTokenData[claudeMdPath];
        if (!fileInfo || !fileInfo.exists || fileInfo.estimatedTokens <= 0) {
          // File doesn't exist or has no content - skip it
          continue;
        }
        // Use validated token count from directoryTokenData
        const injection = createDirectoryInjection(claudeMdPath, turnGroupId);
        injection.estimatedTokens = fileInfo.estimatedTokens;
        newInjections.push(wrapClaudeMdInjection(injection));
        previousPaths.add(claudeMdPath);
      } else {
        // Fallback: if no directoryTokenData provided, create with default tokens (legacy behavior)
        const injection = createDirectoryInjection(claudeMdPath, turnGroupId);
        newInjections.push(wrapClaudeMdInjection(injection));
        previousPaths.add(claudeMdPath);
      }
    }
  }

  // c) Process mentioned files (NEW LOGIC)
  if (userGroup?.content.fileReferences) {
    for (const fileRef of userGroup.content.fileReferences) {
      if (!fileRef.path) continue;

      // Convert to absolute path if needed
      const absolutePath = isAbsolutePath(fileRef.path)
        ? fileRef.path
        : joinPaths(projectRoot, fileRef.path);

      // Skip if already seen
      if (previousPaths.has(absolutePath)) {
        continue;
      }

      // Check if we have token data for this file
      const fileInfo = mentionedFileTokenData?.get(absolutePath);

      // Only include files that exist and are under the token limit
      if (fileInfo && fileInfo.exists && fileInfo.estimatedTokens <= MAX_MENTIONED_FILE_TOKENS) {
        const mentionedFileInjection = createMentionedFileInjection({
          path: absolutePath,
          displayName: fileRef.path, // Use original path for display
          estimatedTokens: fileInfo.estimatedTokens,
          turnIndex: aiGroup.turnIndex,
          aiGroupId: turnGroupId,
          exists: fileInfo.exists,
        });

        newInjections.push(mentionedFileInjection);
        previousPaths.add(absolutePath);
      }
    }
  }

  // c2) Process @-mentions from isMeta:true user messages in AI responses
  for (const fileRef of responseRefs) {
    if (!fileRef.path) continue;

    const absolutePath = isAbsolutePath(fileRef.path)
      ? fileRef.path
      : joinPaths(projectRoot, fileRef.path);

    if (previousPaths.has(absolutePath)) {
      continue;
    }

    const fileInfo = mentionedFileTokenData?.get(absolutePath);

    if (fileInfo && fileInfo.exists && fileInfo.estimatedTokens <= MAX_MENTIONED_FILE_TOKENS) {
      const mentionedFileInjection = createMentionedFileInjection({
        path: absolutePath,
        displayName: fileRef.path,
        estimatedTokens: fileInfo.estimatedTokens,
        turnIndex: aiGroup.turnIndex,
        aiGroupId: turnGroupId,
        exists: fileInfo.exists,
      });

      newInjections.push(mentionedFileInjection);
      previousPaths.add(absolutePath);
    }
  }

  // d) Aggregate tool outputs (includes user-invoked skill tokens from displayItems)
  //    Task coordination tools are excluded here (tracked separately in step d2)
  const toolOutputInjection = aggregateToolOutputs(
    linkedTools,
    aiGroup.turnIndex,
    turnGroupId,
    displayItems
  );
  if (toolOutputInjection) {
    newInjections.push(toolOutputInjection);
  }

  // d2) Aggregate task coordination tokens (SendMessage, TeamCreate, TaskCreate, etc.)
  const taskCoordinationInjection = aggregateTaskCoordination(
    linkedTools,
    aiGroup.turnIndex,
    turnGroupId,
    displayItems
  );
  if (taskCoordinationInjection) {
    newInjections.push(taskCoordinationInjection);
  }

  // d3) Create user message injection
  if (userGroup) {
    const userMessageInjection = createUserMessageInjection(
      userGroup,
      aiGroup.turnIndex,
      turnGroupId
    );
    if (userMessageInjection) {
      newInjections.push(userMessageInjection);
    }
  }

  // e) Aggregate thinking and text output tokens
  if (displayItems) {
    const thinkingTextInjection = aggregateThinkingText(
      displayItems,
      aiGroup.turnIndex,
      turnGroupId
    );
    if (thinkingTextInjection) {
      newInjections.push(thinkingTextInjection);
    }
  }

  // f) Build accumulated injections
  const accumulatedInjections = [...previousInjections, ...newInjections];

  // g) Calculate totals and category breakdowns
  const tokensByCategory: TokensByCategory = {
    claudeMd: 0,
    mentionedFiles: 0,
    toolOutputs: 0,
    thinkingText: 0,
    taskCoordination: 0,
    userMessages: 0,
  };

  const newCounts: NewCountsByCategory = {
    claudeMd: 0,
    mentionedFiles: 0,
    toolOutputs: 0,
    thinkingText: 0,
    taskCoordination: 0,
    userMessages: 0,
  };

  // Count new injections by category
  for (const injection of newInjections) {
    switch (injection.category) {
      case 'claude-md':
        newCounts.claudeMd++;
        break;
      case CATEGORY_MENTIONED_FILE:
        newCounts.mentionedFiles++;
        break;
      case 'tool-output':
        newCounts.toolOutputs += injection.toolCount;
        break;
      case 'thinking-text':
        newCounts.thinkingText++;
        break;
      case 'task-coordination':
        newCounts.taskCoordination += injection.breakdown.length;
        break;
      case 'user-message':
        newCounts.userMessages++;
        break;
    }
  }

  // Sum tokens by category from accumulated injections
  for (const injection of accumulatedInjections) {
    switch (injection.category) {
      case 'claude-md':
        tokensByCategory.claudeMd += injection.estimatedTokens;
        break;
      case CATEGORY_MENTIONED_FILE:
        tokensByCategory.mentionedFiles += injection.estimatedTokens;
        break;
      case 'tool-output':
        tokensByCategory.toolOutputs += injection.estimatedTokens;
        break;
      case 'thinking-text':
        tokensByCategory.thinkingText += injection.estimatedTokens;
        break;
      case 'task-coordination':
        tokensByCategory.taskCoordination += injection.estimatedTokens;
        break;
      case 'user-message':
        tokensByCategory.userMessages += injection.estimatedTokens;
        break;
    }
  }

  const totalEstimatedTokens =
    tokensByCategory.claudeMd +
    tokensByCategory.mentionedFiles +
    tokensByCategory.toolOutputs +
    tokensByCategory.thinkingText +
    tokensByCategory.taskCoordination +
    tokensByCategory.userMessages;

  return {
    newInjections,
    accumulatedInjections,
    totalEstimatedTokens,
    tokensByCategory,
    newCounts,
  };
}

// =============================================================================
// Session Processing
// =============================================================================

/**
 * Get total tokens from the last assistant message in an AI group.
 * Sums input_tokens, output_tokens, cache_read_input_tokens, and cache_creation_input_tokens.
 */
function getLastAssistantTotalTokens(aiGroup: AIGroup): number | undefined {
  const responses = aiGroup.responses || [];
  for (let i = responses.length - 1; i >= 0; i--) {
    const msg = responses[i];
    if (msg.type === 'assistant' && msg.usage) {
      return (
        (msg.usage.input_tokens ?? 0) +
        (msg.usage.output_tokens ?? 0) +
        (msg.usage.cache_read_input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0)
      );
    }
  }
  return undefined;
}

/**
 * Get total tokens from the FIRST assistant message in an AI group.
 * Used for post-compaction token measurement: the first response after compaction
 * reflects the actual compacted context size before the AI generates more content.
 */
function getFirstAssistantTotalTokens(aiGroup: AIGroup): number | undefined {
  const responses = aiGroup.responses || [];
  for (const msg of responses) {
    if (msg.type === 'assistant' && msg.usage) {
      return (
        (msg.usage.input_tokens ?? 0) +
        (msg.usage.output_tokens ?? 0) +
        (msg.usage.cache_read_input_tokens ?? 0) +
        (msg.usage.cache_creation_input_tokens ?? 0)
      );
    }
  }
  return undefined;
}

/**
 * Process all chat items in a session and compute context stats with phase information.
 * Returns both the stats map and session-wide phase info.
 */
export function processSessionContextWithPhases(
  items: ChatItem[],
  projectRoot: string,
  claudeMdTokenData?: Record<string, ClaudeMdFileInfo>,
  mentionedFileTokenData?: Map<string, MentionedFileInfo>,
  directoryTokenData?: Record<string, ClaudeMdFileInfo>
): { statsMap: Map<string, ContextStats>; phaseInfo: ContextPhaseInfo } {
  const statsMap = new Map<string, ContextStats>();
  let accumulatedInjections: ContextInjection[] = [];
  let isFirstAiGroup = true;
  let previousUserGroup: UserGroup | null = null;

  // Phase tracking state
  let currentPhaseNumber = 1;
  const phases: ContextPhase[] = [];
  const aiGroupPhaseMap = new Map<string, number>();
  const compactionTokenDeltas = new Map<string, CompactionTokenDelta>();

  // Track phase boundaries
  let currentPhaseFirstAIGroupId: string | null = null;
  let currentPhaseLastAIGroupId: string | null = null;
  let currentPhaseCompactGroupId: string | null = null;
  let lastAIGroupBeforeCompact: AIGroup | null = null;

  for (const item of items) {
    // Track user groups for pairing with subsequent AI groups
    if (item.type === 'user') {
      previousUserGroup = item.group;
      continue;
    }

    // Handle compact items: reset accumulated state and start new phase
    if (item.type === 'compact') {
      // Finalize the current phase before starting a new one
      if (currentPhaseFirstAIGroupId && currentPhaseLastAIGroupId) {
        phases.push({
          phaseNumber: currentPhaseNumber,
          firstAIGroupId: currentPhaseFirstAIGroupId,
          lastAIGroupId: currentPhaseLastAIGroupId,
          compactGroupId: currentPhaseCompactGroupId,
        });
      }

      // Reset context tracking state
      accumulatedInjections = [];
      isFirstAiGroup = true;
      previousUserGroup = null;

      // Start new phase
      currentPhaseNumber++;
      currentPhaseCompactGroupId = item.group.id;
      currentPhaseFirstAIGroupId = null;
      currentPhaseLastAIGroupId = null;
      // Note: lastAIGroupBeforeCompact is intentionally NOT reset here.
      // It retains the last AI group from the previous phase so we can
      // compute compaction token deltas when the first AI group of the
      // new phase is encountered.

      continue;
    }

    // Process AI groups
    if (item.type === 'ai') {
      const aiGroup = item.group;

      // Compute linked tools for this AI group
      interface EnhancedAIGroupProps {
        linkedTools?: Map<string, LinkedToolItem>;
        displayItems?: AIGroupDisplayItem[];
      }
      let linkedTools = (aiGroup as AIGroup & EnhancedAIGroupProps).linkedTools;
      if (!linkedTools || linkedTools.size === 0) {
        linkedTools = linkToolCallsToResults(aiGroup.steps, aiGroup.responses);
      }

      let displayItems = (aiGroup as AIGroup & EnhancedAIGroupProps).displayItems;
      if (!displayItems && aiGroup.steps && aiGroup.steps.length > 0) {
        const lastOutput = findLastOutput(aiGroup.steps, aiGroup.isOngoing ?? false);
        displayItems = buildDisplayItems(
          aiGroup.steps,
          lastOutput,
          aiGroup.processes || [],
          aiGroup.responses
        );
      }

      // Compute stats for this group
      const stats = computeContextStats({
        aiGroup,
        userGroup: previousUserGroup,
        linkedTools,
        displayItems,
        isFirstGroup: isFirstAiGroup,
        previousInjections: accumulatedInjections,
        projectRoot,
        claudeMdTokenData,
        mentionedFileTokenData,
        directoryTokenData,
      });

      // Tag with phase number
      stats.phaseNumber = currentPhaseNumber;

      // Build compaction token delta for this phase's first AI group
      if (isFirstAiGroup && currentPhaseCompactGroupId && lastAIGroupBeforeCompact) {
        const preTokens = getLastAssistantTotalTokens(lastAIGroupBeforeCompact);
        // Use FIRST assistant message after compaction — it reflects the actual
        // compacted context size before the AI generates more content.
        const postTokens = getFirstAssistantTotalTokens(aiGroup);
        if (preTokens !== undefined && postTokens !== undefined) {
          compactionTokenDeltas.set(currentPhaseCompactGroupId, {
            preCompactionTokens: preTokens,
            postCompactionTokens: postTokens,
            delta: postTokens - preTokens,
          });
        }
      }

      // Store stats
      statsMap.set(aiGroup.id, stats);

      // Track phase boundaries
      aiGroupPhaseMap.set(aiGroup.id, currentPhaseNumber);
      if (!currentPhaseFirstAIGroupId) {
        currentPhaseFirstAIGroupId = aiGroup.id;
      }
      currentPhaseLastAIGroupId = aiGroup.id;
      lastAIGroupBeforeCompact = aiGroup;

      // Update accumulated state for next iteration
      accumulatedInjections = stats.accumulatedInjections;
      isFirstAiGroup = false;
      previousUserGroup = null;
    }
  }

  // Finalize the last phase
  if (currentPhaseFirstAIGroupId && currentPhaseLastAIGroupId) {
    phases.push({
      phaseNumber: currentPhaseNumber,
      firstAIGroupId: currentPhaseFirstAIGroupId,
      lastAIGroupId: currentPhaseLastAIGroupId,
      compactGroupId: currentPhaseCompactGroupId,
    });
  }

  const phaseInfo: ContextPhaseInfo = {
    phases,
    compactionCount: currentPhaseNumber - 1,
    aiGroupPhaseMap,
    compactionTokenDeltas,
  };

  return { statsMap, phaseInfo };
}

// =============================================================================
// Utility Functions
// =============================================================================
