import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ExportSelectionContext } from '@renderer/contexts/ExportSelectionContext';
import { isNearBottom, useAutoScrollBottom } from '@renderer/hooks/useAutoScrollBottom';
import { useTabNavigationController } from '@renderer/hooks/useTabNavigationController';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { useVisibleAIGroup } from '@renderer/hooks/useVisibleAIGroup';
import { useStore } from '@renderer/store';
import {
  assembleToolContent,
  type ExportItemType,
  extractExportItems,
  type ToolFieldKey,
} from '@renderer/utils/conversationExtractor';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronsDown, Clipboard } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { SessionContextPanel } from './SessionContextPanel/index';

/** Pixels from bottom considered "near bottom" for scroll-button visibility and auto-scroll. */
const SCROLL_THRESHOLD = 300;
/** Must match the `w-80` (320px) context panel width used in the layout below. */
const CONTEXT_PANEL_WIDTH_PX = 320;

import { ChatHistoryEmptyState } from './ChatHistoryEmptyState';
import { ChatHistoryItem } from './ChatHistoryItem';
import { ChatHistoryLoadingState } from './ChatHistoryLoadingState';

import type { ContextInjection } from '@renderer/types/contextInjection';
import type { ExportItem } from '@renderer/utils/conversationExtractor';

const ALL_TOOL_FIELDS = new Set<ToolFieldKey>(['name', 'summary', 'input', 'output']);

/**
 * Waits for two requestAnimationFrame cycles, allowing the virtualizer to render.
 */
function waitForDoubleRaf(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

interface ChatHistoryProps {
  /** Tab ID for per-tab state isolation (scroll position, deep links) */
  tabId?: string;
}

export const ChatHistory = ({ tabId }: ChatHistoryProps): JSX.Element => {
  const VIRTUALIZATION_THRESHOLD = 30;
  const ESTIMATED_CHAT_ITEM_HEIGHT = 260;

  // Per-tab UI state (context panel, scroll position, expansion) from useTabUI
  const {
    isContextPanelVisible,
    setContextPanelVisible,
    savedScrollTop,
    saveScrollPosition,
    expandAIGroup,
    expandAllAIGroups,
    triggerExpandAll,
    expandSubagentTrace,
    selectedContextPhase,
    setSelectedContextPhase,
  } = useTabUI();

  // Global store subscriptions (shared data)
  const {
    searchQuery,
    currentSearchIndex,
    searchMatches,
    openTabs,
    activeTabId,
    consumeTabNavigation,
    setSearchQuery,
    syncSearchMatchesWithRendered,
    selectSearchMatch,
    setTabVisibleAIGroup,
  } = useStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      currentSearchIndex: s.currentSearchIndex,
      searchMatches: s.searchMatches,
      openTabs: s.openTabs,
      activeTabId: s.activeTabId,
      consumeTabNavigation: s.consumeTabNavigation,
      setSearchQuery: s.setSearchQuery,
      syncSearchMatchesWithRendered: s.syncSearchMatchesWithRendered,
      selectSearchMatch: s.selectSearchMatch,
      setTabVisibleAIGroup: s.setTabVisibleAIGroup,
    }))
  );

  // Per-tab session data (each tab renders its own session independently)
  const tabData = useStore(
    useShallow((s) => {
      const td = tabId ? s.tabSessionData[tabId] : null;
      return {
        conversation: td?.conversation ?? s.conversation,
        conversationLoading: td?.conversationLoading ?? s.conversationLoading,
        sessionContextStats: td?.sessionContextStats ?? s.sessionContextStats,
        sessionPhaseInfo: td?.sessionPhaseInfo ?? s.sessionPhaseInfo,
        sessionDetail: td?.sessionDetail ?? s.sessionDetail,
      };
    })
  );
  const {
    conversation,
    conversationLoading,
    sessionContextStats,
    sessionPhaseInfo,
    sessionDetail,
  } = tabData;

  // Export selection mode
  const { exportSelectionMode, closeExportSelectionMode } = useStore(
    useShallow((s) => ({
      exportSelectionMode: s.exportSelectionMode,
      closeExportSelectionMode: s.closeExportSelectionMode,
    }))
  );

  // Pre-computed export items (recalculated when selection mode opens or conversation changes)
  const [exportItems, setExportItems] = useState<ExportItem[]>([]);
  // selectedExportIds: source of truth for non-tool items; for tool items it's kept in sync with toolItemFields
  const [selectedExportIds, setSelectedExportIds] = useState<Set<string>>(new Set());
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  // Global defaults for toolbar batch toggles
  const [toolFieldsEnabled, setToolFieldsEnabled] = useState<Set<ToolFieldKey>>(
    new Set<ToolFieldKey>(['name', 'summary', 'input', 'output'])
  );
  // Per-tool-item field sets. Invariant: selectedExportIds.has(id) <=> toolItemFields.get(id)?.size > 0
  const [toolItemFields, setToolItemFields] = useState<Map<string, Set<ToolFieldKey>>>(new Map());

  useEffect(() => {
    if (exportSelectionMode && conversation) {
      const items = extractExportItems(conversation);
      setExportItems(items);
      const selectedIds = new Set<string>();
      const fieldMap = new Map<string, Set<ToolFieldKey>>();
      for (const item of items) {
        if (item.selected) selectedIds.add(item.id);
        if (item.type === 'tool') {
          fieldMap.set(item.id, new Set<ToolFieldKey>(['name', 'summary', 'input', 'output']));
        }
      }
      setSelectedExportIds(selectedIds);
      setToolItemFields(fieldMap);
    } else if (!exportSelectionMode) {
      setExportItems([]);
      setSelectedExportIds(new Set());
      setToolItemFields(new Map());
    }
  }, [exportSelectionMode, conversation]);

  // Non-tool items: simple toggle
  const toggleExportItem = useCallback((id: string) => {
    setSelectedExportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Tool items: toggle a single field; auto-syncs selectedExportIds
  const toggleToolItemField = useCallback(
    (id: string, field: ToolFieldKey) => {
      const current = toolItemFields.get(id) ?? ALL_TOOL_FIELDS;
      const updated = new Set(current);
      if (updated.has(field)) updated.delete(field);
      else updated.add(field);
      const newItemFields = new Map(toolItemFields);
      newItemFields.set(id, updated);
      setToolItemFields(newItemFields);
      // Sync selectedExportIds
      setSelectedExportIds((prev) => {
        const next = new Set(prev);
        if (updated.size === 0) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [toolItemFields]
  );

  // Tool items: set all 4 fields on or off at once; auto-syncs selectedExportIds
  const setToolItemFieldsAll = useCallback(
    (id: string, enabled: boolean) => {
      const newFields = enabled ? new Set(ALL_TOOL_FIELDS) : new Set<ToolFieldKey>();
      const newItemFields = new Map(toolItemFields);
      newItemFields.set(id, newFields);
      setToolItemFields(newItemFields);
      setSelectedExportIds((prev) => {
        const next = new Set(prev);
        if (enabled) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [toolItemFields]
  );

  // Toolbar: batch-toggle one field across all tool items; also syncs selectedExportIds
  const toggleToolField = useCallback(
    (field: ToolFieldKey) => {
      const willEnable = !toolFieldsEnabled.has(field);
      const newGlobal = new Set(toolFieldsEnabled);
      if (willEnable) newGlobal.add(field);
      else newGlobal.delete(field);
      setToolFieldsEnabled(newGlobal);

      const newItemFields = new Map(toolItemFields);
      const newSelectedIds = new Set(selectedExportIds);
      for (const [id, fields] of toolItemFields) {
        const updated = new Set(fields);
        if (willEnable) updated.add(field);
        else updated.delete(field);
        newItemFields.set(id, updated);
        if (updated.size === 0) newSelectedIds.delete(id);
        else newSelectedIds.add(id);
      }
      setToolItemFields(newItemFields);
      setSelectedExportIds(newSelectedIds);
    },
    [toolFieldsEnabled, toolItemFields, selectedExportIds]
  );

  // Category helpers — operate on selectedExportIds (non-tool items) or all fields (tool items)
  const getCategoryItems = useCallback(
    (type: ExportItemType) => exportItems.filter((i) => i.type === type),
    [exportItems]
  );

  const isCategoryAllSelected = useCallback(
    (type: ExportItemType) => {
      const cat = exportItems.filter((i) => i.type === type);
      if (cat.length === 0) return false;
      if (type === 'tool') {
        return cat.every((i) => (toolItemFields.get(i.id)?.size ?? 0) === 4);
      }
      return cat.every((i) => selectedExportIds.has(i.id));
    },
    [exportItems, selectedExportIds, toolItemFields]
  );

  const isCategoryAnySelected = useCallback(
    (type: ExportItemType) => {
      if (type === 'tool') {
        return exportItems.some(
          (i) => i.type === 'tool' && (toolItemFields.get(i.id)?.size ?? 0) > 0
        );
      }
      return exportItems.some((i) => i.type === type && selectedExportIds.has(i.id));
    },
    [exportItems, selectedExportIds, toolItemFields]
  );

  const toggleCategory = useCallback(
    (type: ExportItemType) => {
      const cat = exportItems.filter((i) => i.type === type);
      if (cat.length === 0) return;
      if (type === 'tool') {
        const allFull = cat.every((i) => (toolItemFields.get(i.id)?.size ?? 0) === 4);
        const enable = !allFull;
        const newItemFields = new Map(toolItemFields);
        const newSelectedIds = new Set(selectedExportIds);
        for (const item of cat) {
          newItemFields.set(item.id, enable ? new Set(ALL_TOOL_FIELDS) : new Set<ToolFieldKey>());
          if (enable) newSelectedIds.add(item.id);
          else newSelectedIds.delete(item.id);
        }
        setToolItemFields(newItemFields);
        setSelectedExportIds(newSelectedIds);
      } else {
        const allSelected = cat.every((i) => selectedExportIds.has(i.id));
        setSelectedExportIds((prev) => {
          const next = new Set(prev);
          if (allSelected) cat.forEach((i) => next.delete(i.id));
          else cat.forEach((i) => next.add(i.id));
          return next;
        });
      }
    },
    [exportItems, selectedExportIds, toolItemFields]
  );

  const handleCopySelected = useCallback(async () => {
    const text = exportItems
      .filter((i) => selectedExportIds.has(i.id))
      .map((i) => {
        if (i.type === 'tool' && i.toolFields) {
          const fields = toolItemFields.get(i.id) ?? toolFieldsEnabled;
          return assembleToolContent(i.toolFields, fields);
        }
        return i.content;
      })
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyConfirmed(true);
      setTimeout(() => setCopyConfirmed(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }, [exportItems, selectedExportIds, toolItemFields, toolFieldsEnabled]);

  const exportCtxValue = useMemo(
    () => ({
      isActive: exportSelectionMode,
      isSelected: (id: string) => selectedExportIds.has(id),
      toggle: toggleExportItem,
      getToolFields: (id: string) => toolItemFields.get(id) ?? ALL_TOOL_FIELDS,
      toggleToolItemField,
      setToolItemFieldsAll,
    }),
    [
      exportSelectionMode,
      selectedExportIds,
      toggleExportItem,
      toolItemFields,
      toggleToolItemField,
      setToolItemFieldsAll,
    ]
  );

  // State for Context button hover (local state OK - doesn't need per-tab isolation)
  const [isContextButtonHovered, setIsContextButtonHovered] = useState(false);

  // Determine if this tab instance is currently active
  // Use tabId prop if provided, otherwise fall back to activeTabId (for backwards compatibility)
  const effectiveTabId = tabId ?? activeTabId;
  const isThisTabActive = effectiveTabId === activeTabId;

  // Get THIS tab's pending navigation request
  const thisTab = effectiveTabId ? openTabs.find((t) => t.id === effectiveTabId) : null;
  const pendingNavigation = thisTab?.pendingNavigation;

  // Compute all accumulated context injections (phase-aware)
  const { allContextInjections, lastAiGroupTotalTokens } = useMemo(() => {
    if (!sessionContextStats || !conversation?.items.length) {
      return { allContextInjections: [] as ContextInjection[], lastAiGroupTotalTokens: undefined };
    }

    // Determine which phase to show
    const effectivePhase = selectedContextPhase;

    // If a specific phase is selected, find the last AI group in that phase
    let targetAiGroupId: string | undefined;
    if (effectivePhase !== null && sessionPhaseInfo) {
      const phase = sessionPhaseInfo.phases.find((p) => p.phaseNumber === effectivePhase);
      if (phase) {
        targetAiGroupId = phase.lastAIGroupId;
      }
    }

    // Default: use the last AI group overall
    if (!targetAiGroupId) {
      const lastAiItem = [...conversation.items].reverse().find((item) => item.type === 'ai');
      if (lastAiItem?.type !== 'ai') {
        return {
          allContextInjections: [] as ContextInjection[],
          lastAiGroupTotalTokens: undefined,
        };
      }
      targetAiGroupId = lastAiItem.group.id;
    }

    const stats = sessionContextStats.get(targetAiGroupId);
    const injections = stats?.accumulatedInjections ?? [];

    // Get total tokens from the target AI group
    let totalTokens: number | undefined;
    const targetItem = conversation.items.find(
      (item) => item.type === 'ai' && item.group.id === targetAiGroupId
    );
    if (targetItem?.type === 'ai') {
      const responses = targetItem.group.responses || [];
      for (let i = responses.length - 1; i >= 0; i--) {
        const msg = responses[i];
        if (msg.type === 'assistant' && msg.usage) {
          const usage = msg.usage;
          totalTokens =
            (usage.input_tokens ?? 0) +
            (usage.output_tokens ?? 0) +
            (usage.cache_read_input_tokens ?? 0) +
            (usage.cache_creation_input_tokens ?? 0);
          break;
        }
      }
    }

    return { allContextInjections: injections, lastAiGroupTotalTokens: totalTokens };
  }, [sessionContextStats, conversation, selectedContextPhase, sessionPhaseInfo]);

  // State for navigation highlight (blue, used for Turn navigation from CLAUDE.md panel)
  const [isNavigationHighlight, setIsNavigationHighlight] = useState(false);
  const navigationHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs map for AI groups, chat items, and individual tool items (for scrolling)
  const aiGroupRefs = useRef<Map<string, HTMLElement>>(new Map());
  const chatItemRefs = useRef<Map<string, HTMLElement>>(new Map());
  const toolItemRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Shared scroll container ref - used by both auto-scroll and navigation coordinator
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isSearchActive = searchQuery.trim().length > 0;
  const shouldVirtualize = (conversation?.items.length ?? 0) >= VIRTUALIZATION_THRESHOLD;
  const emptyRenderedSyncCountRef = useRef(0);

  const setSearchQueryForTab = useCallback(
    (query: string): void => {
      setSearchQuery(query, conversation);
    },
    [setSearchQuery, conversation]
  );

  const groupIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!conversation?.items) {
      return map;
    }
    conversation.items.forEach((item, index) => {
      map.set(item.group.id, index);
    });
    return map;
  }, [conversation]);

  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? (conversation?.items.length ?? 0) : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ESTIMATED_CHAT_ITEM_HEIGHT,
    overscan: 8,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const ensureGroupVisible = useCallback(
    async (groupId: string) => {
      if (!shouldVirtualize) {
        return;
      }
      const index = groupIndexMap.get(groupId);
      if (index === undefined) {
        return;
      }
      rowVirtualizer.scrollToIndex(index, { align: 'center' });
      // Wait 2 RAF frames so the virtualizer has time to render the target row
      await waitForDoubleRaf();
    },
    [groupIndexMap, rowVirtualizer, shouldVirtualize]
  );

  // Sticky context button height (py-3 = 12px padding * 2 + button height ~28px + pt-3 = 12px)
  // Total: approximately 52px, round up to 60px for safety
  const STICKY_BUTTON_OFFSET = allContextInjections.length > 0 ? 60 : 0;

  // Unified navigation controller - replaces useNavigationCoordinator + useSearchContextNavigation
  // Must be created before useAutoScrollBottom so we can pass shouldDisableAutoScroll
  const {
    highlightedGroupId,
    setHighlightedGroupId,
    highlightToolUseId: controllerToolUseId,
    isSearchHighlight,
    highlightColor,
    shouldDisableAutoScroll,
  } = useTabNavigationController({
    isActiveTab: isThisTabActive,
    pendingNavigation,
    conversation,
    conversationLoading,
    consumeTabNavigation,
    tabId: effectiveTabId ?? '',
    aiGroupRefs,
    chatItemRefs,
    toolItemRefs,
    expandAIGroup,
    expandSubagentTrace,
    scrollContainerRef,
    stickyOffset: STICKY_BUTTON_OFFSET,
    ensureGroupVisible,
    setSearchQuery: setSearchQueryForTab,
    selectSearchMatch,
  });

  // Local tool highlight for context panel navigation (separate from controller)
  const [contextNavToolUseId, setContextNavToolUseId] = useState<string | null>(null);
  const effectiveHighlightToolUseId = controllerToolUseId ?? contextNavToolUseId ?? undefined;
  // Use blue for context panel tool navigation, otherwise use controller's color
  const effectiveHighlightColor = contextNavToolUseId ? ('blue' as const) : highlightColor;

  // Keep search match indices aligned with this tab's rendered conversation.
  // This avoids stale/global match lists after tab switches or in-place refreshes.
  useEffect(() => {
    if (!isThisTabActive || !searchQuery.trim()) {
      return;
    }
    setSearchQuery(searchQuery, conversation);
  }, [isThisTabActive, searchQuery, conversation, setSearchQuery]);

  // Canonicalize matches from rendered mark elements (DOM order).
  // This guarantees that nth navigation follows the exact nth visible highlight.
  // Skip when virtualizing: only a subset of items are rendered, so DOM-based sync
  // would produce an incomplete match list. The store-level matches are already correct.
  useEffect(() => {
    if (!isThisTabActive || !isSearchActive || !conversation || shouldVirtualize) {
      emptyRenderedSyncCountRef.current = 0;
      return;
    }

    let frameA = 0;
    let frameB = 0;
    let cancelled = false;

    const run = (): void => {
      const container = scrollContainerRef.current;
      if (!container || cancelled) return;

      const renderedMatches: { itemId: string; matchIndexInItem: number }[] = [];
      const marks = container.querySelectorAll<HTMLElement>(
        'mark[data-search-item-id][data-search-match-index]'
      );
      for (const mark of marks) {
        const itemId = mark.dataset.searchItemId;
        const matchIndexRaw = mark.dataset.searchMatchIndex;
        const matchIndex = matchIndexRaw !== undefined ? Number(matchIndexRaw) : Number.NaN;
        if (!itemId || !Number.isFinite(matchIndex)) continue;
        renderedMatches.push({ itemId, matchIndexInItem: matchIndex });
      }

      // Prevent transient "0 marks" snapshots during mount from wiping results.
      if (renderedMatches.length === 0 && searchMatches.length > 0) {
        emptyRenderedSyncCountRef.current += 1;
        if (emptyRenderedSyncCountRef.current < 3) {
          return;
        }
      } else {
        emptyRenderedSyncCountRef.current = 0;
      }

      syncSearchMatchesWithRendered(renderedMatches);
    };

    // Wait for highlight marks to be mounted and stabilized.
    frameA = requestAnimationFrame(() => {
      frameB = requestAnimationFrame(run);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameA);
      cancelAnimationFrame(frameB);
    };
  }, [
    isThisTabActive,
    isSearchActive,
    shouldVirtualize,
    conversation,
    currentSearchIndex,
    searchMatches,
    syncSearchMatchesWithRendered,
  ]);

  // Track shouldDisableAutoScroll transitions for scroll restore coordination
  const prevShouldDisableRef = useRef(shouldDisableAutoScroll);

  const { registerAIGroupRef } = useVisibleAIGroup({
    onVisibleChange: (aiGroupId) => {
      if (effectiveTabId) {
        setTabVisibleAIGroup(effectiveTabId, aiGroupId);
      }
    },
    threshold: 0.5,
    rootRef: scrollContainerRef,
  });

  // Scroll-to-bottom button visibility
  const [showScrollButton, setShowScrollButton] = useState(false);

  const checkScrollButton = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    setShowScrollButton(!isNearBottom(scrollTop, scrollHeight, clientHeight, SCROLL_THRESHOLD));
  }, []);

  // Auto-follow when conversation updates, but only if the user was already near bottom.
  // This preserves manual reading position when the user scrolls up.
  // Disabled during navigation to prevent conflicts with deep-link/search scrolling.
  const { scrollToBottom } = useAutoScrollBottom([conversation], {
    threshold: SCROLL_THRESHOLD,
    smoothDuration: 300,
    autoBehavior: 'auto',
    disabled: shouldDisableAutoScroll,
    externalRef: scrollContainerRef,
    resetKey: effectiveTabId,
  });

  // Re-check button visibility whenever conversation updates
  useEffect(() => {
    checkScrollButton();
  }, [conversation, checkScrollButton]);

  // Listen for session-refresh-scroll-bottom events (from Ctrl+R / refresh button)
  useEffect(() => {
    const handler = (): void => {
      scrollToBottom('smooth');
    };
    window.addEventListener('session-refresh-scroll-bottom', handler);
    return () => window.removeEventListener('session-refresh-scroll-bottom', handler);
  }, [scrollToBottom]);

  // Callback to register AI group refs (combines with visibility hook)
  const registerAIGroupRefCombined = useCallback(
    (groupId: string) => {
      const visibilityRef = registerAIGroupRef(groupId);
      return (el: HTMLElement | null) => {
        if (typeof visibilityRef === 'function') visibilityRef(el);
        if (el) aiGroupRefs.current.set(groupId, el);
        else aiGroupRefs.current.delete(groupId);
      };
    },
    [registerAIGroupRef]
  );

  // Handler to navigate to a specific turn (AI group) from CLAUDE.md panel
  const handleNavigateToTurn = useCallback(
    (turnIndex: number) => {
      if (!conversation) return;
      const targetItem = conversation.items.find(
        (item) => item.type === 'ai' && item.group.turnIndex === turnIndex
      );
      if (targetItem?.type !== 'ai') return;

      const run = async (): Promise<void> => {
        const groupId = targetItem.group.id;
        await ensureGroupVisible(groupId);
        const element = aiGroupRefs.current.get(groupId);
        if (!element) return;

        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedGroupId(groupId);
        setIsNavigationHighlight(true);
        if (navigationHighlightTimerRef.current) {
          clearTimeout(navigationHighlightTimerRef.current);
        }
        navigationHighlightTimerRef.current = setTimeout(() => {
          setHighlightedGroupId(null);
          setIsNavigationHighlight(false);
          navigationHighlightTimerRef.current = null;
        }, 2000);
      };
      void run();
    },
    [conversation, ensureGroupVisible, setHighlightedGroupId]
  );

  // Handler to navigate to a user message group (preceding the AI group at turnIndex)
  const handleNavigateToUserGroup = useCallback(
    (turnIndex: number) => {
      if (!conversation) return;
      const aiItemIndex = conversation.items.findIndex(
        (item) => item.type === 'ai' && item.group.turnIndex === turnIndex
      );
      if (aiItemIndex < 0) return;

      // Find the user item preceding this AI group
      const prevItem = aiItemIndex > 0 ? conversation.items[aiItemIndex - 1] : null;
      if (prevItem?.type !== 'user') return;

      const run = async (): Promise<void> => {
        const groupId = prevItem.group.id;
        await ensureGroupVisible(groupId);
        const element = chatItemRefs.current.get(groupId);
        if (!element) return;

        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightedGroupId(groupId);
        setIsNavigationHighlight(true);
        if (navigationHighlightTimerRef.current) {
          clearTimeout(navigationHighlightTimerRef.current);
        }
        navigationHighlightTimerRef.current = setTimeout(() => {
          setHighlightedGroupId(null);
          setIsNavigationHighlight(false);
          navigationHighlightTimerRef.current = null;
        }, 2000);
      };
      void run();
    },
    [conversation, ensureGroupVisible, setHighlightedGroupId]
  );

  // Handler to navigate to a specific tool within a turn from context panel
  const handleNavigateToTool = useCallback(
    (turnIndex: number, toolUseId: string) => {
      if (!conversation) return;
      const targetItem = conversation.items.find(
        (item) => item.type === 'ai' && item.group.turnIndex === turnIndex
      );
      if (targetItem?.type !== 'ai') return;

      const run = async (): Promise<void> => {
        const groupId = targetItem.group.id;
        await ensureGroupVisible(groupId);

        // Set group + tool highlight immediately
        setHighlightedGroupId(groupId);
        setIsNavigationHighlight(true);
        setContextNavToolUseId(toolUseId);

        // Wait for tool element to appear in DOM (up to 500ms)
        let toolElement: HTMLElement | undefined;
        const startTime = Date.now();
        while (Date.now() - startTime < 500) {
          toolElement = toolItemRefs.current.get(toolUseId);
          if (toolElement) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Scroll to tool element, or fall back to AI group
        const scrollTarget = toolElement ?? aiGroupRefs.current.get(groupId);
        if (scrollTarget) {
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Clear highlight after 2s
        if (navigationHighlightTimerRef.current) {
          clearTimeout(navigationHighlightTimerRef.current);
        }
        navigationHighlightTimerRef.current = setTimeout(() => {
          setHighlightedGroupId(null);
          setIsNavigationHighlight(false);
          setContextNavToolUseId(null);
          navigationHighlightTimerRef.current = null;
        }, 2000);
      };
      void run();
    },
    [conversation, ensureGroupVisible, setHighlightedGroupId]
  );

  // Scroll to current search result when it changes
  useEffect(() => {
    const currentMatch = currentSearchIndex >= 0 ? searchMatches[currentSearchIndex] : null;
    if (!currentMatch) return;

    let frameId = 0;
    let attempt = 0;
    let cancelled = false;

    /**
     * Promote a mark element to "current" (demote any previous) and scroll to it.
     */
    const promoteAndScroll = (el: HTMLElement): void => {
      const container = scrollContainerRef.current;
      if (container) {
        container
          .querySelectorAll<HTMLElement>('mark[data-search-result="current"]')
          .forEach((prev) => {
            /* eslint-disable no-param-reassign -- Directly mutating DOM element style/attributes is necessary for search result highlighting */
            prev.setAttribute('data-search-result', 'match');
            prev.style.backgroundColor = 'var(--highlight-bg-inactive)';
            prev.style.color = 'var(--highlight-text-inactive)';
            prev.style.boxShadow = '';
            /* eslint-enable no-param-reassign -- Re-enable after DOM mutations */
          });
      }
      /* eslint-disable no-param-reassign -- Directly mutating DOM element style/attributes is necessary for current search result highlighting */
      el.setAttribute('data-search-result', 'current');
      el.style.backgroundColor = 'var(--highlight-bg)';
      el.style.color = 'var(--highlight-text)';
      el.style.boxShadow = '0 0 0 1px var(--highlight-ring)';
      /* eslint-enable no-param-reassign -- Re-enable after DOM mutations */
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    /**
     * DOM text-search fallback: walk text nodes inside the group element to find the
     * Nth occurrence of the search query, then scroll the enclosing element into view.
     * This works even when React hasn't created <mark> elements (ReactMarkdown
     * component memoization, render timing, etc.).
     */
    const fallbackDOMSearch = (): boolean => {
      const groupEl =
        chatItemRefs.current.get(currentMatch.itemId) ??
        aiGroupRefs.current.get(currentMatch.itemId);
      if (!groupEl) return false;

      const query = useStore.getState().searchQuery;
      if (!query) return false;
      const lowerQuery = query.toLowerCase();
      let count = 0;

      // Scope to [data-search-content] elements to exclude UI chrome
      // (timestamps, labels, buttons) from text-node walking
      const searchRoots = groupEl.querySelectorAll<HTMLElement>('[data-search-content]');
      const roots = searchRoots.length > 0 ? Array.from(searchRoots) : [groupEl];

      for (const root of roots) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? '';
          const lowerText = text.toLowerCase();
          let pos = 0;
          while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
            if (count === currentMatch.matchIndexInItem) {
              const parent = node.parentElement;
              if (parent) {
                parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return true;
              }
            }
            count++;
            pos += lowerQuery.length;
          }
        }
      }
      return false;
    };

    const tryScrollToResult = (): void => {
      const container = scrollContainerRef.current;
      if (!container) return;

      // Primary: find mark by item ID + match index
      const el = container.querySelector<HTMLElement>(
        `mark[data-search-item-id="${CSS.escape(currentMatch.itemId)}"][data-search-match-index="${currentMatch.matchIndexInItem}"]`
      );
      if (el) {
        promoteAndScroll(el);
        return;
      }

      // Secondary: align by global order (nth rendered mark) as canonical fallback.
      if (attempt >= 3) {
        const orderedMarks = Array.from(
          container.querySelectorAll<HTMLElement>(
            'mark[data-search-item-id][data-search-match-index]'
          )
        );
        const byGlobal = orderedMarks[currentSearchIndex];
        if (byGlobal) {
          promoteAndScroll(byGlobal);
          return;
        }
      }

      // After a few frames, try fallback DOM text search
      if (attempt >= 6) {
        if (fallbackDOMSearch()) return;
      }

      // Keep retrying (marks may appear after async render)
      if (attempt < 60) {
        attempt++;
        frameId = requestAnimationFrame(tryScrollToResult);
      }
    };

    const run = async (): Promise<void> => {
      await ensureGroupVisible(currentMatch.itemId);
      if (cancelled) return;
      frameId = requestAnimationFrame(tryScrollToResult);
    };

    void run();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [currentSearchIndex, searchMatches, scrollContainerRef, ensureGroupVisible]);

  // Track previous active state to detect when THIS tab becomes active/inactive
  const wasActiveRef = useRef(isThisTabActive);

  // Save scroll position when THIS tab becomes inactive
  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isThisTabActive;

    // If this tab just became inactive, save its scroll position
    if (wasActive && !isThisTabActive && scrollContainerRef.current) {
      saveScrollPosition(scrollContainerRef.current.scrollTop);
    }
  }, [isThisTabActive, saveScrollPosition, scrollContainerRef]);

  // Also save on unmount (e.g., when tab is closed)
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    return () => {
      if (scrollContainer) {
        saveScrollPosition(scrollContainer.scrollTop);
      }
    };
  }, [saveScrollPosition, scrollContainerRef]);

  // Restore scroll position when THIS tab becomes active with saved position
  // Uses shouldDisableAutoScroll (covers full navigation lifecycle) instead of pendingNavigation
  // After navigation completes (transition true→false), save current position to prevent stale restore
  useEffect(() => {
    const wasDisabled = prevShouldDisableRef.current;
    prevShouldDisableRef.current = shouldDisableAutoScroll;

    // Navigation just completed — save current scroll position, skip restore
    if (wasDisabled && !shouldDisableAutoScroll && scrollContainerRef.current) {
      saveScrollPosition(scrollContainerRef.current.scrollTop);
      return;
    }

    if (
      isThisTabActive &&
      savedScrollTop !== undefined &&
      scrollContainerRef.current &&
      !conversationLoading &&
      !shouldDisableAutoScroll
    ) {
      let frameA = 0;
      let frameB = 0;
      // Use double RAF so layout + virtual rows settle before restore.
      frameA = requestAnimationFrame(() => {
        frameB = requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = savedScrollTop;
          }
        });
      });
      return () => {
        cancelAnimationFrame(frameA);
        cancelAnimationFrame(frameB);
      };
    }
  }, [
    isThisTabActive,
    savedScrollTop,
    conversationLoading,
    scrollContainerRef,
    shouldDisableAutoScroll,
    saveScrollPosition,
  ]);

  useEffect(() => {
    return () => {
      if (navigationHighlightTimerRef.current) {
        clearTimeout(navigationHighlightTimerRef.current);
      }
    };
  }, []);

  // Register ref for user/system chat items
  const registerChatItemRef = useCallback((groupId: string) => {
    return (el: HTMLElement | null) => {
      if (el) chatItemRefs.current.set(groupId, el);
      else chatItemRefs.current.delete(groupId);
    };
  }, []);

  // Register ref for individual tool items (for precise scroll targeting)
  const registerToolRef = useCallback((toolId: string, el: HTMLElement | null) => {
    if (el) toolItemRefs.current.set(toolId, el);
    else toolItemRefs.current.delete(toolId);
  }, []);

  // Loading state
  if (conversationLoading) return <ChatHistoryLoadingState />;

  // Empty state
  if (!conversation || conversation.items.length === 0) return <ChatHistoryEmptyState />;

  return (
    <ExportSelectionContext.Provider value={exportCtxValue}>
      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        {/* Export selection toolbar — shown when selection mode is active */}
        {exportSelectionMode && (
          <div
            className="flex shrink-0 flex-col gap-1 px-4 py-2"
            style={{
              backgroundColor: 'var(--color-surface-raised)',
              borderBottom: '1px solid var(--color-border-emphasis)',
            }}
          >
            {/* Row 1: category toggles + All/None shortcuts + count + Copy + Done */}
            <div className="flex items-center gap-1.5">
              {(
                [
                  ['user', 'User'],
                  ['ai-text', 'Claude'],
                  ['thinking', 'Thinking'],
                  ['tool', 'Tool Calls'],
                ] as [ExportItemType, string][]
              )
                .filter(([type]) => getCategoryItems(type).length > 0)
                .map(([type, label]) => {
                  const anyOn = isCategoryAnySelected(type);
                  const allOn = isCategoryAllSelected(type);
                  return (
                    <button
                      key={type}
                      onClick={() => toggleCategory(type)}
                      className="rounded border px-2 py-0.5 text-xs transition-colors"
                      style={{
                        borderColor: anyOn ? 'var(--color-border-emphasis)' : 'transparent',
                        color: anyOn
                          ? allOn
                            ? 'var(--color-text)'
                            : 'var(--color-text-secondary)'
                          : 'var(--color-text-muted)',
                        backgroundColor: anyOn ? 'var(--color-surface)' : 'transparent',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              <span
                className="mx-0.5 select-none text-xs"
                style={{ color: 'var(--color-border-emphasis)' }}
              >
                |
              </span>
              <button
                onClick={() => setSelectedExportIds(new Set(exportItems.map((i) => i.id)))}
                className="rounded px-1.5 py-0.5 text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}
              >
                All
              </button>
              <button
                onClick={() => setSelectedExportIds(new Set())}
                className="rounded px-1.5 py-0.5 text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}
              >
                None
              </button>
              <span
                className="mx-0.5 select-none text-xs"
                style={{ color: 'var(--color-border-emphasis)' }}
              >
                |
              </span>
              <button
                onClick={() => {
                  expandAllAIGroups(
                    conversation.items.filter((i) => i.type === 'ai').map((i) => i.group.id)
                  );
                  triggerExpandAll();
                }}
                className="rounded px-1.5 py-0.5 text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Expand All
              </button>
              <div className="flex-1" />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {selectedExportIds.size}/{exportItems.length}
              </span>
              <button
                onClick={() => void handleCopySelected()}
                disabled={selectedExportIds.size === 0}
                className="flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  backgroundColor: copyConfirmed
                    ? 'var(--badge-success-bg)'
                    : 'var(--color-surface)',
                  color: copyConfirmed ? '#fff' : 'var(--color-text)',
                  border: '1px solid var(--color-border-emphasis)',
                }}
              >
                {copyConfirmed ? (
                  <>
                    <Check className="size-3" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Clipboard className="size-3" />
                    Copy {selectedExportIds.size}
                  </>
                )}
              </button>
              <button
                onClick={closeExportSelectionMode}
                className="rounded px-2 py-0.5 text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Done
              </button>
            </div>

            {/* Row 2: tool field toggles — only shown when tool items exist */}
            {exportItems.some((i) => i.type === 'tool') && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Tool fields:
                </span>
                {(
                  [
                    ['name', 'Name'],
                    ['summary', 'Intent'],
                    ['input', 'Input'],
                    ['output', 'Output'],
                  ] as [ToolFieldKey, string][]
                ).map(([field, label]) => {
                  const on = toolFieldsEnabled.has(field);
                  return (
                    <button
                      key={field}
                      onClick={() => toggleToolField(field)}
                      className="rounded border px-2 py-0.5 text-xs transition-colors"
                      style={{
                        borderColor: on ? 'var(--color-border-emphasis)' : 'transparent',
                        color: on ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
                        backgroundColor: on ? 'var(--color-surface)' : 'transparent',
                        opacity: on ? 1 : 0.5,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="relative flex flex-1 overflow-hidden">
          {/* Chat content */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto"
            style={{ backgroundColor: 'var(--color-surface)' }}
            onScroll={checkScrollButton}
          >
            {/* Sticky Context button */}
            {allContextInjections.length > 0 && (
              <div className="pointer-events-none sticky top-0 z-10 flex justify-end px-4 pb-0 pt-3">
                <button
                  onClick={() => setContextPanelVisible(!isContextPanelVisible)}
                  onMouseEnter={() => setIsContextButtonHovered(true)}
                  onMouseLeave={() => setIsContextButtonHovered(false)}
                  className="pointer-events-auto flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs shadow-lg transition-colors"
                  style={{
                    backgroundColor: isContextPanelVisible
                      ? 'var(--context-btn-active-bg)'
                      : isContextButtonHovered
                        ? 'var(--context-btn-bg-hover)'
                        : 'var(--context-btn-bg)',
                    color: isContextPanelVisible
                      ? 'var(--context-btn-active-text)'
                      : 'var(--color-text-secondary)',
                  }}
                >
                  Context ({allContextInjections.length})
                </button>
              </div>
            )}
            <div
              className="mx-auto max-w-5xl px-6 py-8"
              style={{ marginTop: allContextInjections.length > 0 ? '-2rem' : 0 }}
            >
              <div className="space-y-8">
                {shouldVirtualize ? (
                  <div
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      width: '100%',
                      position: 'relative',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const item = conversation.items[virtualRow.index];
                      if (!item) return null;
                      return (
                        <div
                          key={virtualRow.key}
                          ref={rowVirtualizer.measureElement}
                          data-index={virtualRow.index}
                          className="pb-8"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <ChatHistoryItem
                            item={item}
                            highlightedGroupId={highlightedGroupId}
                            highlightToolUseId={effectiveHighlightToolUseId}
                            isSearchHighlight={isSearchHighlight}
                            isNavigationHighlight={isNavigationHighlight}
                            highlightColor={effectiveHighlightColor}
                            registerChatItemRef={registerChatItemRef}
                            registerAIGroupRef={registerAIGroupRefCombined}
                            registerToolRef={registerToolRef}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  conversation.items.map((item) => (
                    <ChatHistoryItem
                      key={item.group.id}
                      item={item}
                      highlightedGroupId={highlightedGroupId}
                      highlightToolUseId={effectiveHighlightToolUseId}
                      isSearchHighlight={isSearchHighlight}
                      isNavigationHighlight={isNavigationHighlight}
                      highlightColor={effectiveHighlightColor}
                      registerChatItemRef={registerChatItemRef}
                      registerAIGroupRef={registerAIGroupRefCombined}
                      registerToolRef={registerToolRef}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Scroll to bottom button */}
          {showScrollButton && (
            <button
              onClick={() => {
                scrollToBottom('smooth');
                setShowScrollButton(false);
              }}
              className="absolute bottom-5 z-20 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs shadow-lg transition-[right] duration-200"
              style={{
                right:
                  isContextPanelVisible && allContextInjections.length > 0
                    ? `calc(${CONTEXT_PANEL_WIDTH_PX}px + 1rem)`
                    : '1rem',
                backgroundColor: 'var(--context-btn-bg)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border-emphasis)',
              }}
              title="Scroll to bottom"
            >
              <ChevronsDown className="size-3.5" />
              <span>Bottom</span>
            </button>
          )}

          {/* Context panel sidebar */}
          {isContextPanelVisible && allContextInjections.length > 0 && (
            <div className="w-80 shrink-0">
              <SessionContextPanel
                injections={allContextInjections}
                onClose={() => setContextPanelVisible(false)}
                projectRoot={sessionDetail?.session?.projectPath}
                onNavigateToTurn={handleNavigateToTurn}
                onNavigateToTool={handleNavigateToTool}
                onNavigateToUserGroup={handleNavigateToUserGroup}
                totalSessionTokens={lastAiGroupTotalTokens}
                phaseInfo={sessionPhaseInfo ?? undefined}
                selectedPhase={selectedContextPhase}
                onPhaseChange={setSelectedContextPhase}
              />
            </div>
          )}
        </div>
      </div>
    </ExportSelectionContext.Provider>
  );
};
