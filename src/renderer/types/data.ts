/**
 * Type definitions for the renderer process.
 *
 * This module re-exports types from the main process types and adds
 * renderer-specific types and utilities. For most uses, import from
 * the index.ts barrel file instead.
 *
 * Import hierarchy:
 * - Main types: Domain models, JSONL format, parsed messages, chunks
 * - Renderer types: API interfaces, notifications, visualization
 */

// =============================================================================
// Re-exports from Main Process Types
// =============================================================================

// Domain types
export type {
  PhaseTokenBreakdown,
  Project,
  RepositoryGroup,
  SearchResult,
  Session,
  SessionMetrics,
  Worktree,
  WorktreeSource,
} from '@shared/types';

// Message types
export type { ParsedMessage } from '@shared/types';

// Chunk types
export type {
  Chunk,
  EnhancedAIChunk,
  EnhancedChunk,
  EnhancedCompactChunk,
  EnhancedSystemChunk,
  EnhancedUserChunk,
  Process,
  SemanticStep,
  SessionDetail,
  SubagentDetail,
} from '@shared/types';

// Chunk type guards
export { isEnhancedAIChunk } from '@shared/types';

// JSONL types (for components that need content block types)
export type { ToolUseResultData } from '@shared/types';

// =============================================================================
// Re-exports from Renderer-Specific Types
// =============================================================================

// API types
export type { ClaudeMdFileInfo } from './api';

// Notification types
export type {
  AppConfig,
  DetectedError,
  NotificationTrigger,
  TriggerContentType,
  TriggerMatchField,
  TriggerMode,
  TriggerTestResult,
  TriggerTokenType,
  TriggerToolName,
} from './notifications';

// =============================================================================
// Session Sort Mode
// =============================================================================

/** Sort mode for session list in sidebar */
export type SessionSortMode = 'recent' | 'most-context';

// =============================================================================
// Renderer-Specific Type Guards
// =============================================================================

import type {
  Chunk,
  EnhancedChunk,
  EnhancedCompactChunk,
  EnhancedSystemChunk,
  EnhancedUserChunk,
  ParsedMessage,
} from '@shared/types';

/**
 * Type guard: Check if message is an assistant message.
 */
export function isAssistantMessage(msg: ParsedMessage): boolean {
  return msg.type === 'assistant';
}

/**
 * Type guard to check if a chunk is an EnhancedUserChunk.
 */
export function isEnhancedUserChunk(chunk: Chunk | EnhancedChunk): chunk is EnhancedUserChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'user' && 'rawMessages' in chunk;
}

/**
 * Type guard to check if a chunk is an EnhancedSystemChunk.
 */
export function isEnhancedSystemChunk(chunk: Chunk | EnhancedChunk): chunk is EnhancedSystemChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'system' && 'rawMessages' in chunk;
}

/**
 * Type guard to check if a chunk is an EnhancedCompactChunk.
 */
export function isEnhancedCompactChunk(
  chunk: Chunk | EnhancedChunk
): chunk is EnhancedCompactChunk {
  return 'chunkType' in chunk && chunk.chunkType === 'compact' && 'rawMessages' in chunk;
}

/**
 * Type guard to check if a single chunk is an EnhancedChunk.
 * Enhanced chunks have 'chunkType' and 'rawMessages' properties.
 */
function isEnhancedChunk(chunk: Chunk | EnhancedChunk): chunk is EnhancedChunk {
  return 'chunkType' in chunk && 'rawMessages' in chunk;
}

/**
 * Type guard to check if an array of chunks are all EnhancedChunks.
 * Returns the array typed as EnhancedChunk[] if valid.
 */
export function asEnhancedChunkArray(chunks: Chunk[]): EnhancedChunk[] | null {
  if (chunks.length === 0) {
    return [];
  }
  // Check first chunk - if it has enhanced properties, assume all do
  // (they come from the same builder)
  if (isEnhancedChunk(chunks[0])) {
    return chunks as EnhancedChunk[];
  }
  return null;
}
