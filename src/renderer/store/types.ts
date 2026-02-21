/**
 * Store type definitions.
 * Contains the combined AppState interface and shared types used across slices.
 */

import type { CombinedSessionsSlice } from './slices/combinedSessionsSlice';
import type { ConfigSlice } from './slices/configSlice';
import type { ConnectionSlice } from './slices/connectionSlice';
import type { ContextSlice } from './slices/contextSlice';
import type { ConversationSlice } from './slices/conversationSlice';
import type { NotificationSlice } from './slices/notificationSlice';
import type { PaneSlice } from './slices/paneSlice';
import type { ProjectSlice } from './slices/projectSlice';
import type { RepositorySlice } from './slices/repositorySlice';
import type { SessionDetailSlice } from './slices/sessionDetailSlice';
import type { SessionSlice } from './slices/sessionSlice';
import type { SubagentSlice } from './slices/subagentSlice';
import type { TabSlice } from './slices/tabSlice';
import type { TabUISlice } from './slices/tabUISlice';
import type { UISlice } from './slices/uiSlice';
import type { UpdateSlice } from './slices/updateSlice';

// =============================================================================
// Shared Types
// =============================================================================

/**
 * Breadcrumb item for subagent drill-down navigation.
 */
export interface BreadcrumbItem {
  id: string;
  description: string;
}

/**
 * Represents a single search match in the conversation.
 * Only searches: user message text and AI lastOutput text (not tool results, thinking, or subagents)
 */
export interface SearchMatch {
  /** ID of the chat item containing this match */
  itemId: string;
  /** Type of item ('user' | 'ai') - system items are not searched */
  itemType: 'user' | 'ai';
  /** Which match within this item (0-based) */
  matchIndexInItem: number;
  /** Global index across all matches */
  globalIndex: number;
  /** Display item ID within the AI group (e.g., "lastOutput") */
  displayItemId?: string;
}

/**
 * Search context for navigating from Command Palette results.
 */
export interface SearchNavigationContext {
  /** The search query */
  query: string;
  /** Timestamp of the message containing the search match */
  messageTimestamp: number;
  /** The matched text */
  matchedText: string;
  /** Optional exact target group ID (e.g., "user-..." or "ai-...") */
  targetGroupId?: string;
  /** Optional exact match index within the target group's searchable text */
  targetMatchIndexInItem?: number;
  /** Optional character offset of the match in the searchable text */
  targetMatchStartOffset?: number;
  /** Optional source message UUID for diagnostics/fallback mapping */
  targetMessageUuid?: string;
}

// =============================================================================
// Combined AppState Type
// =============================================================================

/**
 * Combined application state type.
 * Combines all slice interfaces into a single unified state type.
 */
export type AppState = ProjectSlice &
  RepositorySlice &
  CombinedSessionsSlice &
  SessionSlice &
  SessionDetailSlice &
  SubagentSlice &
  ConversationSlice &
  TabSlice &
  TabUISlice &
  PaneSlice &
  UISlice &
  NotificationSlice &
  ConfigSlice &
  ConnectionSlice &
  ContextSlice &
  UpdateSlice;
