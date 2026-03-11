/**
 * CLAUDE.md Injection Tracker
 *
 * Tracks system context injections from various CLAUDE.md sources throughout a session.
 * Detects injections based on:
 * - Global sources (enterprise, user-memory, project-memory, project-rules, project-local)
 * - Directory-specific CLAUDE.md files (detected from Read tool calls and @ mentions)
 */

import { extractFileReferences } from './groupTransformer';

import type { ClaudeMdInjection, ClaudeMdSource, ClaudeMdStats } from '../types/claudeMd';
import type { ClaudeMdFileInfo, ParsedMessage, SemanticStep } from '../types/data';
import type { AIGroup, ChatItem, FileReference, UserGroup } from '../types/groups';

// =============================================================================
// Constants
// =============================================================================

/** Default estimated tokens for global CLAUDE.md sources */
const DEFAULT_ESTIMATED_TOKENS = 500;

/** CLAUDE.md filename to search for */
const CLAUDE_MD_FILENAME = 'CLAUDE.md';

/** Source identifier for project memory CLAUDE.md files */
const SOURCE_PROJECT_MEMORY: ClaudeMdSource = 'project-memory';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a unique ID for an injection based on its path.
 * Uses a simple hash-like approach for readability.
 */
export function generateInjectionId(path: string): string {
  // Create a simple hash from the path
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to positive hex string
  const positiveHash = Math.abs(hash).toString(16);
  return `cmd-${positiveHash}`;
}

/**
 * Create a display name for a CLAUDE.md injection.
 * Returns the raw path for transparency.
 */
export function getDisplayName(path: string, _source: ClaudeMdSource): string {
  return path;
}

/**
 * Check if a path is absolute (starts with /).
 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(path);
}

/**
 * Join paths, handling various path formats properly.
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

  // Remove trailing slash from base if present
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
 * Get the directory containing a file.
 */
export function getDirectory(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSep === -1) return '';
  return filePath.slice(0, lastSep);
}

/**
 * Get the parent directory of a path.
 */
export function getParentDirectory(dirPath: string): string | null {
  const lastSep = Math.max(dirPath.lastIndexOf('/'), dirPath.lastIndexOf('\\'));
  if (lastSep <= 0) return null; // At root or invalid
  return dirPath.slice(0, lastSep);
}

/**
 * Check if dirPath is at or above stopPath in the directory tree.
 */
function isAtOrAbove(dirPath: string, stopPath: string): boolean {
  const normDir = normalizeForComparison(dirPath).replace(/\/$/, '');
  const normStop = normalizeForComparison(stopPath).replace(/\/$/, '');

  // dirPath is at or above stopPath if stopPath starts with dirPath
  return normStop === normDir || normStop.startsWith(normDir + '/');
}

// =============================================================================
// Path Extraction Functions
// =============================================================================

/**
 * Extract file paths from Read tool calls in semantic steps.
 */
export function extractReadToolPaths(steps: SemanticStep[]): string[] {
  const paths: string[] = [];

  for (const step of steps) {
    // Check if this is a Read tool call
    if (step.type === 'tool_call' && step.content.toolName === 'Read') {
      const toolInput = step.content.toolInput as Record<string, unknown> | undefined;
      if (toolInput && typeof toolInput.file_path === 'string') {
        paths.push(toolInput.file_path);
      }
    }
  }

  return paths;
}

/**
 * Extract file paths from user @ mentions.
 * Converts relative paths to absolute using projectRoot.
 */
export function extractUserMentionPaths(
  userGroup: UserGroup | null,
  projectRoot: string
): string[] {
  if (!userGroup) return [];

  const fileReferences = userGroup.content.fileReferences || [];
  const paths: string[] = [];

  for (const ref of fileReferences) {
    if (ref.path) {
      // Convert to absolute if relative
      const absolutePath = isAbsolutePath(ref.path) ? ref.path : joinPaths(projectRoot, ref.path);
      paths.push(absolutePath);
    }
  }

  return paths;
}

/**
 * Extracts file references from isMeta:true user messages within AI group responses.
 * These are user-type messages generated by slash commands and other internal mechanisms
 * that contain @-mentioned file paths.
 */
export function extractFileRefsFromResponses(responses: ParsedMessage[]): FileReference[] {
  const refs: FileReference[] = [];
  for (const msg of responses) {
    if (msg.type !== 'user') continue;
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) text += block.text;
      }
    }
    if (text) refs.push(...extractFileReferences(text));
  }
  return refs;
}

// =============================================================================
// CLAUDE.md Detection Functions
// =============================================================================

/**
 * Detect potential CLAUDE.md files by walking up from a file's directory to project root.
 * Returns paths to CLAUDE.md files that would be injected based on the file path.
 */
export function detectClaudeMdFromFilePath(filePath: string, projectRoot: string): string[] {
  const claudeMdPaths: string[] = [];
  const sep = filePath.includes('\\') ? '\\' : '/';

  // Get the directory containing the file
  let currentDir = getDirectory(filePath);

  // Walk up to project root (inclusive)
  while (currentDir && isAtOrAbove(projectRoot, currentDir)) {
    // Add potential CLAUDE.md path for this directory
    const claudeMdPath = `${currentDir}${sep}${CLAUDE_MD_FILENAME}`;
    claudeMdPaths.push(claudeMdPath);

    // Move to parent directory
    const parentDir = getParentDirectory(currentDir);
    if (!parentDir || parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return claudeMdPaths;
}

// =============================================================================
// Injection Creation Functions
// =============================================================================

/**
 * Create injection entries for global CLAUDE.md sources.
 * These are injected at the start of every session.
 * Only includes files that actually exist (tokens > 0).
 */
export function createGlobalInjections(
  projectRoot: string,
  aiGroupId: string,
  tokenData?: Record<string, ClaudeMdFileInfo>
): ClaudeMdInjection[] {
  const injections: ClaudeMdInjection[] = [];

  // Helper to get token count from tokenData or fallback to default
  const getTokens = (key: string): number => {
    return tokenData?.[key]?.estimatedTokens ?? DEFAULT_ESTIMATED_TOKENS;
  };

  // 1. Enterprise config
  const enterprisePath =
    tokenData?.enterprise?.path ?? '/Library/Application Support/ClaudeCode/CLAUDE.md';
  const enterpriseTokens = getTokens('enterprise');
  if (enterpriseTokens > 0) {
    injections.push({
      id: generateInjectionId(enterprisePath),
      path: enterprisePath,
      source: 'enterprise',
      displayName: getDisplayName(enterprisePath, 'enterprise'),
      isGlobal: true,
      estimatedTokens: enterpriseTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 2. User memory (~/.claude/CLAUDE.md)
  // Use ~ for display purposes (renderer cannot access Node.js process.env)
  const userMemoryPath = '~/.claude/CLAUDE.md';
  const userTokens = getTokens('user');
  if (userTokens > 0) {
    injections.push({
      id: generateInjectionId(userMemoryPath),
      path: userMemoryPath,
      source: 'user-memory',
      displayName: getDisplayName(userMemoryPath, 'user-memory'),
      isGlobal: true,
      estimatedTokens: userTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 3. Project memory - could be at root or in .claude folder
  const projectMemoryPath = joinPaths(projectRoot, 'CLAUDE.md');
  const projectMemoryAltPath = joinPaths(projectRoot, '.claude/CLAUDE.md');
  // Add the main project CLAUDE.md
  const projectTokens = getTokens('project');
  if (projectTokens > 0) {
    injections.push({
      id: generateInjectionId(projectMemoryPath),
      path: projectMemoryPath,
      source: SOURCE_PROJECT_MEMORY,
      displayName: getDisplayName(projectMemoryPath, SOURCE_PROJECT_MEMORY),
      isGlobal: true,
      estimatedTokens: projectTokens,
      firstSeenInGroup: aiGroupId,
    });
  }
  // Also add the .claude folder variant
  const projectAltTokens = getTokens('project-alt');
  if (projectAltTokens > 0) {
    injections.push({
      id: generateInjectionId(projectMemoryAltPath),
      path: projectMemoryAltPath,
      source: SOURCE_PROJECT_MEMORY,
      displayName: getDisplayName(projectMemoryAltPath, SOURCE_PROJECT_MEMORY),
      isGlobal: true,
      estimatedTokens: projectAltTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 4. Project rules (*.md files in .claude/rules/)
  const projectRulesPath = joinPaths(projectRoot, '.claude/rules/*.md');
  const projectRulesTokens = getTokens('project-rules');
  if (projectRulesTokens > 0) {
    injections.push({
      id: generateInjectionId(projectRulesPath),
      path: projectRulesPath,
      source: 'project-rules',
      displayName: getDisplayName(projectRulesPath, 'project-rules'),
      isGlobal: true,
      estimatedTokens: projectRulesTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 5. Project local
  const projectLocalPath = joinPaths(projectRoot, 'CLAUDE.local.md');
  const projectLocalTokens = getTokens('project-local');
  if (projectLocalTokens > 0) {
    injections.push({
      id: generateInjectionId(projectLocalPath),
      path: projectLocalPath,
      source: 'project-local',
      displayName: getDisplayName(projectLocalPath, 'project-local'),
      isGlobal: true,
      estimatedTokens: projectLocalTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 6. User rules (~/.claude/rules/**/*.md)
  const userRulesPath = '~/.claude/rules/**/*.md';
  const userRulesTokens = getTokens('user-rules');
  if (userRulesTokens > 0) {
    injections.push({
      id: generateInjectionId(userRulesPath),
      path: userRulesPath,
      source: 'user-rules',
      displayName: getDisplayName(userRulesPath, 'user-rules'),
      isGlobal: true,
      estimatedTokens: userRulesTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  // 7. Auto memory (~/.claude/projects/<encoded>/memory/MEMORY.md)
  const autoMemoryPath =
    tokenData?.['auto-memory']?.path ?? '~/.claude/projects/.../memory/MEMORY.md';
  const autoMemoryTokens = getTokens('auto-memory');
  if (autoMemoryTokens > 0) {
    injections.push({
      id: generateInjectionId(autoMemoryPath),
      path: autoMemoryPath,
      source: 'auto-memory',
      displayName: getDisplayName(autoMemoryPath, 'auto-memory'),
      isGlobal: true,
      estimatedTokens: autoMemoryTokens,
      firstSeenInGroup: aiGroupId,
    });
  }

  return injections;
}

/**
 * Create an injection entry for a directory-specific CLAUDE.md.
 */
function createDirectoryInjection(path: string, aiGroupId: string): ClaudeMdInjection {
  return {
    id: generateInjectionId(path),
    path,
    source: 'directory',
    displayName: getDisplayName(path, 'directory'),
    isGlobal: false,
    estimatedTokens: DEFAULT_ESTIMATED_TOKENS,
    firstSeenInGroup: aiGroupId,
  };
}

// =============================================================================
// Stats Computation
// =============================================================================

/**
 * Parameters for computing CLAUDE.md stats for an AI group.
 */
interface ComputeClaudeMdStatsParams {
  aiGroup: AIGroup;
  userGroup: UserGroup | null;
  isFirstGroup: boolean;
  previousInjections: ClaudeMdInjection[];
  /** Paths already seen in previous groups (threaded to avoid O(N) rebuild per group) */
  previousPaths: Set<string>;
  projectRoot: string;
  contextTokens: number;
  tokenData?: Record<string, ClaudeMdFileInfo>;
}

interface ComputeClaudeMdStatsResult {
  stats: ClaudeMdStats;
  /** Updated previousPaths set — caller should thread this to the next group */
  previousPaths: Set<string>;
}

/**
 * Compute CLAUDE.md injection statistics for an AI group.
 */
function computeClaudeMdStats(params: ComputeClaudeMdStatsParams): ComputeClaudeMdStatsResult {
  const {
    aiGroup,
    userGroup,
    isFirstGroup,
    previousInjections,
    previousPaths,
    projectRoot,
    contextTokens,
    tokenData,
  } = params;

  const newInjections: ClaudeMdInjection[] = [];

  // For the first group, add global injections
  // Use "ai-N" format for firstSeenInGroup to enable turn navigation in SessionClaudeMdPanel
  const turnGroupId = `ai-${aiGroup.turnIndex}`;
  if (isFirstGroup) {
    const globalInjections = createGlobalInjections(projectRoot, turnGroupId, tokenData);
    for (const injection of globalInjections) {
      if (!previousPaths.has(injection.path)) {
        newInjections.push(injection);
        previousPaths.add(injection.path);
      }
    }
  }

  // Collect all file paths from Read tools and user @ mentions
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

      // Create directory injection
      const injection = createDirectoryInjection(claudeMdPath, turnGroupId);
      newInjections.push(injection);
      previousPaths.add(claudeMdPath);
    }
  }

  // Build accumulated injections (mutable push to avoid O(N²) spread)
  for (const inj of newInjections) {
    previousInjections.push(inj);
  }
  const accumulatedInjections = previousInjections;

  // Calculate totals
  const totalEstimatedTokens = accumulatedInjections.reduce(
    (sum, inj) => sum + inj.estimatedTokens,
    0
  );

  // Calculate percentage of context
  const percentageOfContext = contextTokens > 0 ? (totalEstimatedTokens / contextTokens) * 100 : 0;

  return {
    stats: {
      newInjections,
      accumulatedInjections,
      totalEstimatedTokens,
      percentageOfContext,
      newCount: newInjections.length,
      accumulatedCount: accumulatedInjections.length,
    },
    previousPaths,
  };
}

// =============================================================================
// Session Processing
// =============================================================================

/**
 * Process all chat items in a session and compute CLAUDE.md stats for each AI group.
 * Returns a map of aiGroupId -> ClaudeMdStats.
 */
export function processSessionClaudeMd(
  items: ChatItem[],
  projectRoot: string,
  tokenData?: Record<string, ClaudeMdFileInfo>
): Map<string, ClaudeMdStats> {
  const statsMap = new Map<string, ClaudeMdStats>();
  let accumulatedInjections: ClaudeMdInjection[] = [];
  let previousPaths = new Set<string>();
  let isFirstAiGroup = true;
  let previousUserGroup: UserGroup | null = null;

  for (const item of items) {
    // Track user groups for pairing with subsequent AI groups
    if (item.type === 'user') {
      previousUserGroup = item.group;
      continue;
    }

    // Handle compact items: reset accumulated state across compaction boundaries
    if (item.type === 'compact') {
      accumulatedInjections = [];
      previousPaths = new Set<string>();
      isFirstAiGroup = true;
      previousUserGroup = null;
      continue;
    }

    // Process AI groups
    if (item.type === 'ai') {
      const aiGroup = item.group;

      // Get context tokens from the AI group's metrics
      // Use input tokens as a proxy for context window usage
      const contextTokens = aiGroup.tokens.input || 0;

      // Compute stats for this group
      const result = computeClaudeMdStats({
        aiGroup,
        userGroup: previousUserGroup,
        isFirstGroup: isFirstAiGroup,
        previousInjections: accumulatedInjections,
        previousPaths,
        projectRoot,
        contextTokens,
        tokenData,
      });
      const stats = result.stats;

      // Store stats (snapshot accumulatedInjections so later mutations don't corrupt stored entries)
      statsMap.set(aiGroup.id, {
        ...stats,
        accumulatedInjections: [...stats.accumulatedInjections],
      });

      // Update accumulated state for next iteration
      accumulatedInjections = stats.accumulatedInjections;
      previousPaths = result.previousPaths;
      isFirstAiGroup = false;

      // Clear the user group pairing after processing
      previousUserGroup = null;
    }
  }

  return statsMap;
}

// =============================================================================
// Utility Exports
// =============================================================================
