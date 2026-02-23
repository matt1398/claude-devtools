import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { COLOR_TEXT_MUTED, COLOR_TEXT_SECONDARY } from '@renderer/constants/cssVariables';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { useStore } from '@renderer/store';
import { enhanceAIGroup, type PrecedingSlashInfo } from '@renderer/utils/aiGroupEnhancer';
import { extractSlashInfo, isCommandContent } from '@shared/utils/contentSanitizer';
import { getModelColorClass } from '@shared/utils/modelParser';
import { estimateTokens } from '@shared/utils/tokenFormatting';
import { format } from 'date-fns';
import { Bot, ChevronDown, Clock } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { TokenUsageDisplay } from '../common/TokenUsageDisplay';

import { ContextBadge } from './ContextBadge';
import { DisplayItemList } from './DisplayItemList';
import { LastOutputDisplay } from './LastOutputDisplay';

import type { ContextStats } from '@renderer/types/contextInjection';
import type {
  AIGroup,
  AIGroupDisplayItem,
  EnhancedAIGroup,
  UserGroup,
} from '@renderer/types/groups';
import type { TriggerColor } from '@shared/constants/triggerColors';

/**
 * Extract slash info from a UserGroup's message content.
 * Returns PrecedingSlashInfo if the user message was a slash invocation,
 * null otherwise.
 */
function extractPrecedingSlashInfo(
  userGroup: UserGroup | undefined
): PrecedingSlashInfo | undefined {
  if (!userGroup) return undefined;

  const msg = userGroup.message;
  const content = msg.content;

  // Check if this is a slash message (has <command-name> tags)
  if (typeof content === 'string' && isCommandContent(content)) {
    const slashInfo = extractSlashInfo(content);
    if (slashInfo) {
      return {
        name: slashInfo.name,
        message: slashInfo.message,
        args: slashInfo.args,
        commandMessageUuid: msg.uuid,
        timestamp: new Date(msg.timestamp),
      };
    }
  }

  return undefined;
}

/**
 * Format duration in milliseconds to human-readable string.
 * Examples: "1.2s", "45s", "1m 30s", "5m"
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    const decimal = ms % 1000 >= 100 ? `.${Math.floor((ms % 1000) / 100)}` : '';
    return `${seconds}${decimal}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

interface AIChatGroupProps {
  aiGroup: AIGroup;
  /** Tool use ID to highlight for error deep linking */
  highlightToolUseId?: string;
  /** Custom highlight color from trigger */
  highlightColor?: TriggerColor;
  /** Register ref for individual tool items (for precise scroll targeting) */
  registerToolRef?: (toolId: string, el: HTMLElement | null) => void;
}

/**
 * Checks if a tool ID exists within the display items (including nested subagents).
 */
function containsToolUseId(items: AIGroupDisplayItem[], toolUseId: string): boolean {
  for (const item of items) {
    if (item.type === 'tool' && item.tool.id === toolUseId) {
      return true;
    }
    // Check nested subagent messages for the tool ID
    if (item.type === 'subagent' && item.subagent.messages) {
      for (const msg of item.subagent.messages) {
        if (msg.toolCalls?.some((tc) => tc.id === toolUseId)) {
          return true;
        }
        if (msg.toolResults?.some((tr) => tr.toolUseId === toolUseId)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * AIChatGroup displays an AI response using a clean, minimal card-based design.
 *
 * Features:
 * - Card container with subtle zinc styling
 * - Clickable header with Bot icon, "Claude" label, and items summary
 * - LastOutputDisplay: Always visible last output (text or tool result)
 * - DisplayItemList: Shows items when expanded with inline expansion support
 * - Manages local expansion state and inline item expansion
 */
const AIChatGroupInner = ({
  aiGroup,
  highlightToolUseId,
  highlightColor,
  registerToolRef,
}: Readonly<AIChatGroupProps>): React.JSX.Element => {
  // Per-tab UI state for expansion (completely isolated per tab)
  const {
    tabId,
    isAIGroupExpanded: isAIGroupExpandedForTab,
    toggleAIGroupExpansion,
    getExpandedDisplayItemIds,
    toggleDisplayItemExpansion,
    expandDisplayItem,
  } = useTabUI();

  // Per-tab session data, falling back to global state
  const projectRoot = useStore((s) => {
    const td = tabId ? s.tabSessionData[tabId] : null;
    return (td?.sessionDetail ?? s.sessionDetail)?.session?.projectPath;
  });
  const isSessionOngoing = useStore((s) => {
    const id = s.selectedSessionId;
    if (!id) return false;
    return s.sessions.find((sess) => sess.id === id)?.isOngoing ?? false;
  });

  // Per-tab session data subscriptions, falling back to global state
  const {
    sessionClaudeMdStats,
    sessionContextStats,
    sessionPhaseInfo,
    conversation,
    searchExpandedAIGroupIds,
    searchExpandedSubagentIds,
    searchCurrentDisplayItemId,
  } = useStore(
    useShallow((s) => {
      const td = tabId ? s.tabSessionData[tabId] : null;
      return {
        sessionClaudeMdStats: td?.sessionClaudeMdStats ?? s.sessionClaudeMdStats,
        sessionContextStats: td?.sessionContextStats ?? s.sessionContextStats,
        sessionPhaseInfo: td?.sessionPhaseInfo ?? s.sessionPhaseInfo,
        conversation: td?.conversation ?? s.conversation,
        searchExpandedAIGroupIds: s.searchExpandedAIGroupIds,
        searchExpandedSubagentIds: s.searchExpandedSubagentIds,
        searchCurrentDisplayItemId: s.searchCurrentDisplayItemId,
      };
    })
  );

  // Notification color map for tool item dots
  const notifications = useStore((s) => s.notifications);
  const notificationColorMap = useMemo(() => {
    const map = new Map<string, TriggerColor>();
    for (const n of notifications) {
      if (n.toolUseId && n.triggerColor) {
        map.set(n.toolUseId, n.triggerColor);
      }
    }
    return map;
  }, [notifications]);

  // Derived state from store values
  const claudeMdStats = sessionClaudeMdStats?.get(aiGroup.id);
  const contextStats: ContextStats | undefined = sessionContextStats?.get(aiGroup.id);

  // Phase data for this AI group
  const phaseNumber = sessionPhaseInfo?.aiGroupPhaseMap.get(aiGroup.id);
  const totalPhases = sessionPhaseInfo?.phases.length ?? 0;

  // Find the preceding UserGroup for this AIGroup to extract slash info
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- React Compiler can't preserve this; manual memo needed for O(n) traversal
  const precedingSlash = useMemo(() => {
    if (!conversation?.items) return undefined;

    // Find the index of this AIGroup in the conversation
    const aiGroupIndex = conversation.items.findIndex(
      (item) => item.type === 'ai' && item.group.id === aiGroup.id
    );

    if (aiGroupIndex <= 0) return undefined;

    // Look backwards for the nearest UserGroup
    for (let i = aiGroupIndex - 1; i >= 0; i--) {
      const item = conversation.items[i];
      if (item.type === 'user') {
        return extractPrecedingSlashInfo(item.group);
      }
      // Stop if we hit another AI group (shouldn't happen in normal flow)
      if (item.type === 'ai') break;
    }

    return undefined;
  }, [conversation?.items, aiGroup.id]);

  // Enhance the AI group to get display-ready data
  const enhanced: EnhancedAIGroup = useMemo(
    () => enhanceAIGroup(aiGroup, claudeMdStats, precedingSlash),
    [aiGroup, claudeMdStats, precedingSlash]
  );

  // Check if this group should be expanded for search results
  const shouldExpandForSearch = searchExpandedAIGroupIds.has(aiGroup.id);

  // Check if this group contains the highlighted error tool
  const containsHighlightedError = useMemo(() => {
    if (!highlightToolUseId) return false;
    return containsToolUseId(enhanced.displayItems, highlightToolUseId);
  }, [enhanced.displayItems, highlightToolUseId]);

  // Get the LAST assistant message's usage (represents current context window snapshot)
  // This is the correct metric to display - not the summed values across all messages
  const lastUsage = useMemo(() => {
    const responses = aiGroup.responses || [];
    // Find the last assistant message with usage data
    for (let i = responses.length - 1; i >= 0; i--) {
      const msg = responses[i];
      if (msg.type === 'assistant' && msg.usage) {
        return msg.usage;
      }
    }
    return null;
  }, [aiGroup.responses]);

  // Get the total cost
  const costUSD = aiGroup.metrics.costUsd;

  // Calculate thinking and text output tokens from assistant message content blocks
  // These are estimated from the actual content, providing breakdown of output token usage
  const { thinkingTokens, textOutputTokens } = useMemo(() => {
    let thinking = 0;
    let textOutput = 0;

    const responses = aiGroup.responses || [];
    for (const msg of responses) {
      if (msg.type === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'thinking' && block.thinking) {
            thinking += estimateTokens(block.thinking);
          } else if (block.type === 'text' && block.text) {
            textOutput += estimateTokens(block.text);
          }
        }
      }
    }

    return { thinkingTokens: thinking, textOutputTokens: textOutput };
  }, [aiGroup.responses]);

  // Auto-expand if contains error or search result, or if manually expanded
  const isExpanded =
    isAIGroupExpandedForTab(aiGroup.id) || containsHighlightedError || shouldExpandForSearch;

  // Helper function to find the item ID containing the highlighted tool
  const findHighlightedItemId = useCallback(
    (toolUseId: string): string | null => {
      for (let i = 0; i < enhanced.displayItems.length; i++) {
        const item = enhanced.displayItems[i];
        if (item.type === 'tool' && item.tool.id === toolUseId) {
          return `tool-${item.tool.id}-${i}`;
        }
        // For subagents, expand the subagent item
        if (item.type === 'subagent' && item.subagent.messages) {
          for (const msg of item.subagent.messages) {
            if (
              msg.toolCalls?.some((tc) => tc.id === toolUseId) ||
              msg.toolResults?.some((tr) => tr.toolUseId === toolUseId)
            ) {
              return `subagent-${item.subagent.id}-${i}`;
            }
          }
        }
      }
      return null;
    },
    [enhanced.displayItems]
  );

  // Get expanded item IDs for this AI group (per-tab)
  const expandedItemIds = useMemo(
    () => getExpandedDisplayItemIds(aiGroup.id),
    [getExpandedDisplayItemIds, aiGroup.id]
  );

  // Track which highlightToolUseId we've already processed to prevent infinite loops
  const processedHighlightRef = useRef<string | null>(null);

  // Effect to auto-expand display item when highlightToolUseId is set
  // AI group expansion is now handled by the navigation coordinator
  // This only handles display item expansion which requires enhanced data
  useEffect(() => {
    if (!highlightToolUseId || !containsHighlightedError) {
      // Reset ref when highlight is cleared
      if (!highlightToolUseId) {
        processedHighlightRef.current = null;
      }
      return;
    }

    // Skip if we've already processed this exact highlight
    if (processedHighlightRef.current === highlightToolUseId) {
      return;
    }

    // Mark as processed BEFORE making any state changes
    processedHighlightRef.current = highlightToolUseId;

    // Find and expand the display item containing the highlighted tool
    // No delay needed - navigation coordinator ensures DOM is stable before highlight
    const itemId = findHighlightedItemId(highlightToolUseId);
    if (itemId) {
      expandDisplayItem(aiGroup.id, itemId);
    }
  }, [
    highlightToolUseId,
    containsHighlightedError,
    aiGroup.id,
    expandDisplayItem,
    findHighlightedItemId,
  ]);

  // Track which search we've already processed to prevent infinite loops
  const processedSearchRef = useRef<string | null>(null);

  // Effect to auto-expand display items when search navigates to this group
  // Note: AI group expansion is handled by derived isExpanded (shouldExpandForSearch)
  useEffect(() => {
    if (!shouldExpandForSearch) {
      processedSearchRef.current = null;
      return;
    }

    // Create a unique key for this search state
    const searchKey = `${searchCurrentDisplayItemId ?? ''}-${Array.from(searchExpandedSubagentIds).join(',')}`;
    if (processedSearchRef.current === searchKey) {
      return;
    }
    processedSearchRef.current = searchKey;

    // Expand the specific display item containing the search result (uses per-tab state)
    if (searchCurrentDisplayItemId) {
      expandDisplayItem(aiGroup.id, searchCurrentDisplayItemId);
    }

    // If any subagents in this group need their trace expanded for search, expand them
    for (let i = 0; i < enhanced.displayItems.length; i++) {
      const item = enhanced.displayItems[i];
      if (item.type === 'subagent' && searchExpandedSubagentIds.has(item.subagent.id)) {
        const subagentItemId = `subagent-${item.subagent.id}-${i}`;
        expandDisplayItem(aiGroup.id, subagentItemId);
      }
    }
  }, [
    shouldExpandForSearch,
    searchCurrentDisplayItemId,
    searchExpandedSubagentIds,
    enhanced.displayItems,
    aiGroup.id,
    expandDisplayItem,
  ]);

  // Determine if there's content to toggle
  const hasToggleContent = enhanced.displayItems.length > 0;

  // Handle item click - toggle inline expansion using store action
  const handleItemClick = (itemId: string): void => {
    toggleDisplayItemExpansion(aiGroup.id, itemId);
  };

  return (
    <div className="space-y-3 border-l-2 pl-3" style={{ borderColor: 'var(--chat-ai-border)' }}>
      {/* Header Row */}
      {hasToggleContent && (
        <div className="flex items-center gap-2">
          {/* Clickable toggle area */}
          <div
            role="button"
            tabIndex={0}
            className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden"
            onClick={() => toggleAIGroupExpansion(aiGroup.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleAIGroupExpansion(aiGroup.id);
              }
            }}
          >
            <Bot className="size-4 shrink-0" style={{ color: COLOR_TEXT_SECONDARY }} />
            <span
              className="shrink-0 text-xs font-semibold"
              style={{ color: COLOR_TEXT_SECONDARY }}
            >
              Claude
            </span>

            {/* Main agent model */}
            {enhanced.mainModel && (
              <span className={`shrink-0 text-xs ${getModelColorClass(enhanced.mainModel.family)}`}>
                {enhanced.mainModel.name}
              </span>
            )}

            {/* Subagent models if different */}
            {enhanced.subagentModels.length > 0 && (
              <>
                <span className="shrink-0" style={{ color: COLOR_TEXT_MUTED }}>
                  →
                </span>
                <span className="shrink-0 text-xs" style={{ color: COLOR_TEXT_MUTED }}>
                  {enhanced.subagentModels.map((m, i) => (
                    <span key={m.name}>
                      {i > 0 && ', '}
                      <span className={getModelColorClass(m.family)}>{m.name}</span>
                    </span>
                  ))}
                </span>
              </>
            )}

            <span className="shrink-0 text-xs" style={{ color: COLOR_TEXT_MUTED }}>
              ·
            </span>
            <span className="truncate text-xs" style={{ color: COLOR_TEXT_MUTED }}>
              {enhanced.itemsSummary}
            </span>
            <ChevronDown
              className={`size-3.5 shrink-0 transition-transform group-hover:opacity-80 ${isExpanded ? 'rotate-180' : ''}`}
              style={{ color: COLOR_TEXT_MUTED }}
            />
          </div>

          {/* Right side: Context badge, Token usage, Timestamp (non-clickable) */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Context injection badge (CLAUDE.md, mentioned files, tool outputs) */}
            {contextStats && <ContextBadge stats={contextStats} projectRoot={projectRoot} />}

            {/* Token usage - show last assistant message's usage (context window snapshot) */}
            {lastUsage && (
              <TokenUsageDisplay
                inputTokens={lastUsage.input_tokens}
                outputTokens={lastUsage.output_tokens}
                cacheReadTokens={lastUsage.cache_read_input_tokens ?? 0}
                cacheCreationTokens={lastUsage.cache_creation_input_tokens ?? 0}
                thinkingTokens={thinkingTokens}
                textOutputTokens={textOutputTokens}
                modelName={enhanced.mainModel?.name}
                modelFamily={enhanced.mainModel?.family}
                size="sm"
                claudeMdStats={enhanced.claudeMdStats ?? undefined}
                contextStats={contextStats}
                phaseNumber={phaseNumber}
                totalPhases={totalPhases}
                costUsd={costUSD}
              />
            )}

            {/* Duration */}
            {aiGroup.durationMs > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs"
                style={{ color: COLOR_TEXT_MUTED }}
              >
                <Clock className="size-3" />
                {formatDuration(aiGroup.durationMs)}
              </span>
            )}

            {/* Timestamp - receded for visual hierarchy */}
            {enhanced.lastOutput?.timestamp && (
              <span
                className="shrink-0 whitespace-nowrap text-[10px]"
                style={{ color: COLOR_TEXT_MUTED }}
              >
                {format(enhanced.lastOutput.timestamp, 'h:mm:ss a')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Expandable Content */}
      {hasToggleContent && isExpanded && (
        <div className="py-2 pl-2">
          <DisplayItemList
            items={enhanced.displayItems}
            onItemClick={handleItemClick}
            expandedItemIds={expandedItemIds}
            aiGroupId={aiGroup.id}
            highlightToolUseId={highlightToolUseId}
            highlightColor={highlightColor}
            notificationColorMap={notificationColorMap}
            registerToolRef={registerToolRef}
          />
        </div>
      )}

      {/* Always-visible Output */}
      <div>
        <LastOutputDisplay
          lastOutput={enhanced.lastOutput}
          aiGroupId={aiGroup.id}
          isLastGroup={aiGroup.isOngoing ?? false}
          isSessionOngoing={isSessionOngoing}
        />
      </div>
    </div>
  );
};

export const AIChatGroup = React.memo(AIChatGroupInner);
