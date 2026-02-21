/**
 * Session detail slice - manages session detail, conversation, and stats.
 */

import { api } from '@renderer/api';
import { asEnhancedChunkArray } from '@renderer/types/data';
import { findTabBySession, truncateLabel } from '@renderer/types/tabs';
import { processSessionClaudeMd } from '@renderer/utils/claudeMdTracker';
import { processSessionContextWithPhases } from '@renderer/utils/contextTracker';
import {
  extractFileReferences,
  transformChunksToConversation,
} from '@renderer/utils/groupTransformer';
import { createLogger } from '@shared/utils/logger';

import { resolveFilePath } from '../utils/pathResolution';

const logger = createLogger('Store:sessionDetail');

/**
 * Tracks latest refresh generation per session to avoid stale overwrites when
 * many file-change events trigger concurrent in-place refreshes.
 */
const sessionRefreshGeneration = new Map<string, number>();
const sessionRefreshInFlight = new Set<string>();
const sessionRefreshQueued = new Set<string>();
let sessionDetailFetchGeneration = 0;
let agentConfigsCachedForProject = '';

import { getAllTabs } from '../utils/paneHelpers';

import type { AppState } from '../types';
import type { ClaudeMdStats } from '@renderer/types/claudeMd';
import type {
  ContextPhaseInfo,
  ContextStats,
  MentionedFileInfo,
} from '@renderer/types/contextInjection';
import type { ClaudeMdFileInfo, SessionDetail } from '@renderer/types/data';
import type { AIGroup, SessionConversation } from '@renderer/types/groups';
import type { AgentConfig } from '@shared/types/api';
import type { StateCreator } from 'zustand';

// =============================================================================
// Per-tab session data type
// =============================================================================

export interface TabSessionData {
  sessionDetail: SessionDetail | null;
  conversation: SessionConversation | null;
  conversationLoading: boolean;
  sessionDetailLoading: boolean;
  sessionDetailError: string | null;
  sessionClaudeMdStats: Map<string, ClaudeMdStats> | null;
  sessionContextStats: Map<string, ContextStats> | null;
  sessionPhaseInfo: ContextPhaseInfo | null;
  visibleAIGroupId: string | null;
  selectedAIGroup: AIGroup | null;
}

function createEmptyTabSessionData(): TabSessionData {
  return {
    sessionDetail: null,
    conversation: null,
    conversationLoading: false,
    sessionDetailLoading: false,
    sessionDetailError: null,
    sessionClaudeMdStats: null,
    sessionContextStats: null,
    sessionPhaseInfo: null,
    visibleAIGroupId: null,
    selectedAIGroup: null,
  };
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface SessionDetailSlice {
  // State
  sessionDetail: SessionDetail | null;
  sessionDetailLoading: boolean;
  sessionDetailError: string | null;

  // Conversation state
  conversation: SessionConversation | null;
  conversationLoading: boolean;

  // CLAUDE.md stats (injection tracking per AI group)
  sessionClaudeMdStats: Map<string, ClaudeMdStats> | null;
  // Unified context stats (CLAUDE.md + mentioned files + tool outputs)
  sessionContextStats: Map<string, ContextStats> | null;
  // Context phase info (compaction boundaries)
  sessionPhaseInfo: ContextPhaseInfo | null;

  // Agent configs from .claude/agents/ (keyed by agent name)
  agentConfigs: Record<string, AgentConfig>;

  // Visible AI Group
  visibleAIGroupId: string | null;
  selectedAIGroup: AIGroup | null;

  // Per-tab session data (keyed by tabId)
  tabSessionData: Record<string, TabSessionData>;

  // Actions
  fetchSessionDetail: (projectId: string, sessionId: string, tabId?: string) => Promise<void>;
  /** Refresh session without loading states or UI resets - for real-time updates */
  refreshSessionInPlace: (projectId: string, sessionId: string) => Promise<void>;
  setVisibleAIGroup: (aiGroupId: string | null) => void;
  /** Set visible AI group for a specific tab */
  setTabVisibleAIGroup: (tabId: string, aiGroupId: string | null) => void;
  /** Clean up per-tab session data when tab is closed */
  cleanupTabSessionData: (tabId: string) => void;
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createSessionDetailSlice: StateCreator<AppState, [], [], SessionDetailSlice> = (
  set,
  get
) => ({
  // Initial state
  sessionDetail: null,
  sessionDetailLoading: false,
  sessionDetailError: null,

  conversation: null,
  conversationLoading: false,

  // CLAUDE.md stats (injection tracking per AI group)
  sessionClaudeMdStats: null,
  // Unified context stats (CLAUDE.md + mentioned files + tool outputs)
  sessionContextStats: null,
  // Context phase info (compaction boundaries)
  sessionPhaseInfo: null,

  agentConfigs: {},

  visibleAIGroupId: null,
  selectedAIGroup: null,

  // Per-tab session data
  tabSessionData: {},

  // Fetch full session detail with chunks and subagents
  fetchSessionDetail: async (projectId: string, sessionId: string, tabId?: string) => {
    const requestGeneration = ++sessionDetailFetchGeneration;
    set({
      sessionDetailLoading: true,
      sessionDetailError: null,
      conversationLoading: true,
    });

    // Also set per-tab loading state
    if (tabId) {
      const prev = get().tabSessionData;
      set({
        tabSessionData: {
          ...prev,
          [tabId]: {
            ...(prev[tabId] ?? createEmptyTabSessionData()),
            sessionDetailLoading: true,
            sessionDetailError: null,
            conversationLoading: true,
          },
        },
      });
    }
    try {
      const detail = await api.getSessionDetail(projectId, sessionId);
      if (requestGeneration !== sessionDetailFetchGeneration) {
        return;
      }

      // Transform chunks to conversation
      // Chunks are EnhancedChunk[] at runtime - validate with type guard
      // Pass isOngoing to mark the last AI group when session is still in progress
      const isOngoing = detail?.session?.isOngoing ?? false;
      const enhancedChunks = detail ? asEnhancedChunkArray(detail.chunks) : null;
      const conversation: SessionConversation | null =
        detail && enhancedChunks
          ? transformChunksToConversation(enhancedChunks, detail.processes, isOngoing)
          : null;

      // Initialize visibleAIGroupId to first AI Group if available
      const firstAIItem = conversation?.items?.find((item) => item.type === 'ai');
      const firstAIGroupId = firstAIItem?.type === 'ai' ? firstAIItem.group.id : null;
      const firstAIGroup = firstAIItem?.type === 'ai' ? firstAIItem.group : null;

      // Compute CLAUDE.md stats for the session
      const projectRoot = detail?.session?.projectPath ?? '';
      const { connectionMode } = get();
      let claudeMdStats: Map<string, ClaudeMdStats> | null = null;
      let contextStats: Map<string, ContextStats> | null = null;
      let phaseInfo: ContextPhaseInfo | null = null;
      // Fetch agent configs from .claude/agents/ (only when project changes)
      if (connectionMode !== 'ssh' && projectRoot && projectRoot !== agentConfigsCachedForProject) {
        try {
          const configs = await api.readAgentConfigs(projectRoot);
          if (requestGeneration !== sessionDetailFetchGeneration) return;
          agentConfigsCachedForProject = projectRoot;
          set({ agentConfigs: configs });
        } catch (err) {
          logger.error('Failed to read agent configs:', err);
        }
      }

      if (connectionMode !== 'ssh' && conversation?.items) {
        // Fetch real CLAUDE.md token data
        let claudeMdTokenData: Record<string, ClaudeMdFileInfo> = {};
        try {
          claudeMdTokenData = await api.readClaudeMdFiles(projectRoot);
          if (requestGeneration !== sessionDetailFetchGeneration) {
            return;
          }
        } catch (err) {
          logger.error('Failed to read CLAUDE.md files:', err);
        }

        claudeMdStats = processSessionClaudeMd(conversation.items, projectRoot, claudeMdTokenData);

        // Fetch real tokens for directory CLAUDE.md files
        // Directory injections are detected dynamically from Read tool paths and aren't in pre-fetched tokenData
        // We need to validate these BEFORE calling processSessionContext so both trackers have consistent data
        const directoryTokenData: Record<string, ClaudeMdFileInfo> = {}; // Validated directory token data

        if (claudeMdStats && claudeMdStats.size > 0) {
          // Collect all unique directory injection paths
          const directoryPaths = new Set<string>();
          for (const stats of claudeMdStats.values()) {
            for (const injection of stats.accumulatedInjections) {
              if (injection.source === 'directory') {
                directoryPaths.add(injection.path);
              }
            }
          }

          // Fetch real tokens for each directory path (parallel IPC calls)
          if (directoryPaths.size > 0) {
            const directoryTokens = new Map<string, number>();
            const nonExistentPaths = new Set<string>();

            const directoryResults = await Promise.all(
              Array.from(directoryPaths).map(async (fullPath) => {
                try {
                  const dirPath = fullPath.replace(/[\\/]CLAUDE\.md$/, '');
                  const fileInfo = await api.readDirectoryClaudeMd(dirPath);
                  return { fullPath, fileInfo, error: false };
                } catch (err) {
                  logger.error('Failed to read directory CLAUDE.md:', fullPath, err);
                  return { fullPath, fileInfo: null, error: true };
                }
              })
            );
            if (requestGeneration !== sessionDetailFetchGeneration) {
              return;
            }

            for (const { fullPath, fileInfo, error } of directoryResults) {
              if (error || !fileInfo) {
                nonExistentPaths.add(fullPath);
              } else if (fileInfo.exists && fileInfo.estimatedTokens > 0) {
                directoryTokens.set(fullPath, fileInfo.estimatedTokens);
                directoryTokenData[fullPath] = fileInfo;
              } else {
                nonExistentPaths.add(fullPath);
              }
            }

            // Update stats: set real tokens and REMOVE non-existent files
            for (const [, stats] of claudeMdStats.entries()) {
              // Filter out non-existent paths
              stats.accumulatedInjections = stats.accumulatedInjections.filter(
                (inj) => inj.source !== 'directory' || !nonExistentPaths.has(inj.path)
              );
              stats.newInjections = stats.newInjections.filter(
                (inj) => inj.source !== 'directory' || !nonExistentPaths.has(inj.path)
              );

              // Update tokens for existing files
              for (const injection of stats.accumulatedInjections) {
                if (injection.source === 'directory' && directoryTokens.has(injection.path)) {
                  injection.estimatedTokens = directoryTokens.get(injection.path)!;
                }
              }
              for (const injection of stats.newInjections) {
                if (injection.source === 'directory' && directoryTokens.has(injection.path)) {
                  injection.estimatedTokens = directoryTokens.get(injection.path)!;
                }
              }

              // Recalculate totals and counts
              stats.totalEstimatedTokens = stats.accumulatedInjections.reduce(
                (sum, inj) => sum + inj.estimatedTokens,
                0
              );
              stats.accumulatedCount = stats.accumulatedInjections.length;
              stats.newCount = stats.newInjections.length;
            }
          }
        }

        // Compute unified context stats (CLAUDE.md + mentioned files + tool outputs)
        // Extract all mentioned file paths from user groups
        const mentionedFilePaths = new Set<string>();
        for (const item of conversation.items) {
          if (item.type === 'user' && item.group.content.fileReferences) {
            for (const ref of item.group.content.fileReferences) {
              // Use resolveFilePath to properly handle ./ and ../ prefixes
              const absolutePath = resolveFilePath(projectRoot, ref.path);
              mentionedFilePaths.add(absolutePath);
            }
          }
        }

        // Also collect @-mentions from isMeta:true user messages in AI responses
        for (const item of conversation.items) {
          if (item.type === 'ai') {
            for (const msg of item.group.responses) {
              if (msg.type !== 'user') continue;
              let text = '';
              if (typeof msg.content === 'string') {
                text = msg.content;
              } else if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === 'text' && block.text) text += block.text;
                }
              }
              if (text) {
                for (const ref of extractFileReferences(text)) {
                  const absolutePath = resolveFilePath(projectRoot, ref.path);
                  mentionedFilePaths.add(absolutePath);
                }
              }
            }
          }
        }

        // Fetch token data for each mentioned file (parallel IPC calls)
        const mentionedFileTokenData = new Map<string, MentionedFileInfo>();
        const mentionedFileResults = await Promise.all(
          Array.from(mentionedFilePaths).map(async (filePath) => {
            try {
              const fileInfo = await api.readMentionedFile(filePath, projectRoot);
              return { filePath, fileInfo };
            } catch (err) {
              logger.error('Failed to read mentioned file:', filePath, err);
              return { filePath, fileInfo: null };
            }
          })
        );
        if (requestGeneration !== sessionDetailFetchGeneration) {
          return;
        }
        for (const { filePath, fileInfo } of mentionedFileResults) {
          if (fileInfo) {
            mentionedFileTokenData.set(filePath, fileInfo);
          }
        }

        // Process Visible Context with all token data
        // Pass validated directory token data so contextTracker can filter non-existent files
        const phaseResult = processSessionContextWithPhases(
          conversation.items,
          projectRoot,
          claudeMdTokenData,
          mentionedFileTokenData,
          directoryTokenData
        );
        contextStats = phaseResult.statsMap;
        phaseInfo = phaseResult.phaseInfo;
      }

      // Update tab label if this session is open in a tab
      const currentState = get();
      if (requestGeneration !== sessionDetailFetchGeneration) {
        return;
      }
      const activeTab = currentState.getActiveTab();
      const stillViewingSession =
        currentState.selectedSessionId === sessionId ||
        (activeTab?.type === 'session' &&
          activeTab.sessionId === sessionId &&
          activeTab.projectId === projectId);
      if (!stillViewingSession) {
        set({
          sessionDetailLoading: false,
          conversationLoading: false,
        });
        return;
      }
      const existingTab = findTabBySession(currentState.openTabs, sessionId);
      if (existingTab && detail) {
        const newLabel = detail.session.firstMessage
          ? truncateLabel(detail.session.firstMessage)
          : `Session ${sessionId.slice(0, 8)}`;
        currentState.updateTabLabel(existingTab.id, newLabel);
      }

      set({
        sessionDetail: detail,
        sessionDetailLoading: false,
        conversation,
        conversationLoading: false,
        visibleAIGroupId: firstAIGroupId,
        selectedAIGroup: firstAIGroup,
        sessionClaudeMdStats: claudeMdStats,
        sessionContextStats: contextStats,
        sessionPhaseInfo: phaseInfo,
      });

      // Store per-tab session data
      if (tabId) {
        const prev = get().tabSessionData;
        set({
          tabSessionData: {
            ...prev,
            [tabId]: {
              sessionDetail: detail,
              conversation,
              conversationLoading: false,
              sessionDetailLoading: false,
              sessionDetailError: null,
              sessionClaudeMdStats: claudeMdStats,
              sessionContextStats: contextStats,
              sessionPhaseInfo: phaseInfo,
              visibleAIGroupId: firstAIGroupId,
              selectedAIGroup: firstAIGroup,
            },
          },
        });
      }
    } catch (error) {
      logger.error('fetchSessionDetail error:', error);
      if (requestGeneration !== sessionDetailFetchGeneration) {
        return;
      }
      const errorMsg = error instanceof Error ? error.message : 'Failed to fetch session detail';
      set({
        sessionDetailError: errorMsg,
        sessionDetailLoading: false,
        conversationLoading: false,
      });

      // Store per-tab error state
      if (tabId) {
        const prev = get().tabSessionData;
        set({
          tabSessionData: {
            ...prev,
            [tabId]: {
              ...(prev[tabId] ?? createEmptyTabSessionData()),
              sessionDetailError: errorMsg,
              sessionDetailLoading: false,
              conversationLoading: false,
            },
          },
        });
      }
    }
  },

  // Refresh session in place without loading states or UI resets
  // Used for real-time file change updates to avoid flickering
  refreshSessionInPlace: async (projectId: string, sessionId: string) => {
    const currentState = get();

    // Check if any tab is viewing this session (across all panes)
    const allTabs = getAllTabs(currentState.paneLayout);
    const tabsViewingSession = allTabs.filter(
      (t) => t.type === 'session' && t.sessionId === sessionId
    );

    // Only refresh if we're actually viewing this session
    if (currentState.selectedSessionId !== sessionId && tabsViewingSession.length === 0) {
      return;
    }

    const refreshKey = `${projectId}/${sessionId}`;

    // Coalesce duplicate in-flight refreshes for the same session.
    if (sessionRefreshInFlight.has(refreshKey)) {
      sessionRefreshQueued.add(refreshKey);
      return;
    }
    const generation = (sessionRefreshGeneration.get(refreshKey) ?? 0) + 1;
    sessionRefreshGeneration.set(refreshKey, generation);
    sessionRefreshInFlight.add(refreshKey);

    try {
      const detail = await api.getSessionDetail(projectId, sessionId);

      // Drop stale responses if a newer refresh started while this one was in flight.
      if (sessionRefreshGeneration.get(refreshKey) !== generation) {
        return;
      }

      if (!detail) {
        return;
      }

      // Transform chunks to conversation - validate with type guard
      const isOngoing = detail.session?.isOngoing ?? false;
      const enhancedChunks = asEnhancedChunkArray(detail.chunks);
      if (!enhancedChunks) {
        return;
      }
      const newConversation = transformChunksToConversation(
        enhancedChunks,
        detail.processes,
        isOngoing
      );

      if (!newConversation) {
        return;
      }

      const latestState = get();
      const latestAllTabs = getAllTabs(latestState.paneLayout);
      const stillViewingSession =
        latestState.selectedSessionId === sessionId ||
        latestAllTabs.some((tab) => tab.type === 'session' && tab.sessionId === sessionId);
      if (!stillViewingSession) {
        return;
      }

      // Preserve current visibleAIGroupId if it still exists in new conversation
      // Otherwise keep it (it might be scrolled to an item that still exists)
      const currentVisibleId = currentState.visibleAIGroupId;
      const currentSelectedGroup = currentState.selectedAIGroup;

      // Check if current visible group still exists
      const visibleGroupStillExists =
        currentVisibleId &&
        newConversation.items.some(
          (item) => item.type === 'ai' && item.group.id === currentVisibleId
        );

      // Find the updated group if it exists
      let updatedSelectedGroup = currentSelectedGroup;
      if (visibleGroupStillExists && currentVisibleId) {
        const foundItem = newConversation.items.find(
          (item) => item.type === 'ai' && item.group.id === currentVisibleId
        );
        if (foundItem?.type === 'ai') {
          updatedSelectedGroup = foundItem.group;
        }
      }

      // Update only the data, preserve UI states
      set((state) => ({
        sessionDetail: detail,
        conversation: newConversation,
        // Update on latest sessions state to avoid restoring stale sidebar snapshots.
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, isOngoing: detail.session?.isOngoing ?? false } : s
        ),
        // Preserve visible group if it still exists, otherwise keep current
        ...(visibleGroupStillExists
          ? {
              selectedAIGroup: updatedSelectedGroup,
            }
          : {}),
        // Note: aiGroupExpansionLevels and expandedStepIds are NOT touched
        // so expansion states are preserved
      }));

      // Also update per-tab session data for all tabs viewing this session
      const latestTabSessionData = { ...get().tabSessionData };
      for (const tab of latestAllTabs) {
        if (tab.type === 'session' && tab.sessionId === sessionId && latestTabSessionData[tab.id]) {
          const tabData = latestTabSessionData[tab.id];
          // Preserve per-tab visibleAIGroupId
          const tabVisibleId = tabData.visibleAIGroupId;
          const tabGroupStillExists =
            tabVisibleId &&
            newConversation.items.some(
              (item) => item.type === 'ai' && item.group.id === tabVisibleId
            );
          let tabSelectedGroup = tabData.selectedAIGroup;
          if (tabGroupStillExists && tabVisibleId) {
            const found = newConversation.items.find(
              (item) => item.type === 'ai' && item.group.id === tabVisibleId
            );
            if (found?.type === 'ai') tabSelectedGroup = found.group;
          }

          latestTabSessionData[tab.id] = {
            ...tabData,
            sessionDetail: detail,
            conversation: newConversation,
            ...(tabGroupStillExists ? { selectedAIGroup: tabSelectedGroup } : {}),
          };
        }
      }
      set({ tabSessionData: latestTabSessionData });
    } catch (error) {
      logger.error('refreshSessionInPlace error:', error);
      // Don't set error state - this is a background refresh
    } finally {
      sessionRefreshInFlight.delete(refreshKey);
      if (sessionRefreshQueued.has(refreshKey)) {
        sessionRefreshQueued.delete(refreshKey);
        void get().refreshSessionInPlace(projectId, sessionId);
      }
    }
  },

  // Set visible AI Group (called by scroll observer)
  setVisibleAIGroup: (aiGroupId: string | null) => {
    const state = get();

    if (aiGroupId === state.visibleAIGroupId) return;

    // Find the AIGroup in the conversation
    let selectedAIGroup: AIGroup | null = null;
    if (aiGroupId && state.conversation) {
      for (const item of state.conversation.items) {
        if (item.type === 'ai' && item.group.id === aiGroupId) {
          selectedAIGroup = item.group;
          break;
        }
      }
    }

    set({
      visibleAIGroupId: aiGroupId,
      selectedAIGroup,
    });
  },

  // Set visible AI Group for a specific tab
  setTabVisibleAIGroup: (tabId: string, aiGroupId: string | null) => {
    const state = get();
    const tabData = state.tabSessionData[tabId];
    if (!tabData) return;

    if (aiGroupId === tabData.visibleAIGroupId) return;

    // Find the AIGroup in the tab's conversation
    let selectedAIGroup: AIGroup | null = null;
    if (aiGroupId && tabData.conversation) {
      for (const item of tabData.conversation.items) {
        if (item.type === 'ai' && item.group.id === aiGroupId) {
          selectedAIGroup = item.group;
          break;
        }
      }
    }

    set({
      tabSessionData: {
        ...state.tabSessionData,
        [tabId]: {
          ...tabData,
          visibleAIGroupId: aiGroupId,
          selectedAIGroup,
        },
      },
    });
  },

  // Clean up per-tab session data when tab is closed
  cleanupTabSessionData: (tabId: string) => {
    const prev = get().tabSessionData;
    if (!(tabId in prev)) return;
    const next = { ...prev };
    delete next[tabId];
    set({ tabSessionData: next });
  },
});
