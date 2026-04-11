/**
 * Logical project slice - manages user-defined session groupings.
 *
 * A "logical project" is a user-defined tag/bucket that lets sessions be
 * grouped across Claude Code's cwd-derived project folders. Assignment is
 * two-tiered: a session can be explicitly assigned (sessionProjectMap), or
 * inherit from its cwd folder's default (cwdProjectMap). Resolution order:
 *   1. sessionProjectMap[sessionId]
 *   2. cwdProjectMap[session.projectId]
 *   3. null (Ungrouped)
 *
 * All state is persisted to AppConfig.sessions via the generic config API.
 */

import { api } from '@renderer/api';
import { createLogger } from '@shared/utils/logger';

import type { AppState } from '../types';
import type { LogicalProject, SidebarGroupBy } from '@shared/types/notifications';
import type { StateCreator } from 'zustand';

const logger = createLogger('Store:logicalProject');

// =============================================================================
// Default palette for new logical projects
// =============================================================================

const DEFAULT_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
  '#f59e0b', // amber
  '#ef4444', // red
  '#14b8a6', // teal
  '#ec4899', // pink
  '#6366f1', // indigo
];

function pickDefaultColor(existingCount: number): string {
  return DEFAULT_COLORS[existingCount % DEFAULT_COLORS.length]!;
}

function generateId(): string {
  return `lp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Slice Interface
// =============================================================================

export interface LogicalProjectSlice {
  // State
  logicalProjects: Record<string, LogicalProject>;
  sessionProjectMap: Record<string, string>;
  cwdProjectMap: Record<string, string>;
  sidebarGroupBy: SidebarGroupBy;

  // Actions
  loadLogicalProjects: () => Promise<void>;
  createLogicalProject: (name: string, color?: string) => Promise<LogicalProject | null>;
  updateLogicalProject: (
    id: string,
    updates: Partial<Pick<LogicalProject, 'name' | 'color' | 'icon' | 'order'>>
  ) => Promise<void>;
  deleteLogicalProject: (id: string) => Promise<void>;
  assignSessionToLogicalProject: (
    sessionId: string,
    logicalProjectId: string | null
  ) => Promise<void>;
  assignCwdToLogicalProject: (cwdProjectId: string, logicalProjectId: string | null) => Promise<void>;
  setSidebarGroupBy: (mode: SidebarGroupBy) => Promise<void>;

  // Selectors (pure helpers — call via get() outside of render, or inline in selectors)
  resolveLogicalProjectId: (sessionId: string, cwdProjectId: string) => string | null;
}

// =============================================================================
// Persistence helper
// =============================================================================

async function persistSessionsPatch(patch: {
  logicalProjects?: Record<string, LogicalProject>;
  sessionProjectMap?: Record<string, string>;
  cwdProjectMap?: Record<string, string>;
  sidebarGroupBy?: SidebarGroupBy;
}): Promise<void> {
  await api.config.update('sessions', patch);
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createLogicalProjectSlice: StateCreator<AppState, [], [], LogicalProjectSlice> = (
  set,
  get
) => ({
  // Initial state
  logicalProjects: {},
  sessionProjectMap: {},
  cwdProjectMap: {},
  sidebarGroupBy: 'date',

  // Load from persisted config
  loadLogicalProjects: async () => {
    try {
      const config = await api.config.get();
      const sessions = config.sessions;
      set({
        logicalProjects: sessions?.logicalProjects ?? {},
        sessionProjectMap: sessions?.sessionProjectMap ?? {},
        cwdProjectMap: sessions?.cwdProjectMap ?? {},
        sidebarGroupBy: sessions?.sidebarGroupBy ?? 'date',
      });
    } catch (error) {
      logger.error('loadLogicalProjects error:', error);
    }
  },

  // Create a new logical project
  createLogicalProject: async (name: string, color?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const existing = get().logicalProjects;
    const id = generateId();
    const project: LogicalProject = {
      id,
      name: trimmed,
      color: color ?? pickDefaultColor(Object.keys(existing).length),
      order: Object.keys(existing).length,
      createdAt: Date.now(),
    };

    const next = { ...existing, [id]: project };
    const previous = existing;
    set({ logicalProjects: next });
    try {
      await persistSessionsPatch({ logicalProjects: next });
      return project;
    } catch (error) {
      set({ logicalProjects: previous });
      logger.error('createLogicalProject error:', error);
      return null;
    }
  },

  // Update fields of an existing logical project
  updateLogicalProject: async (id, updates) => {
    const existing = get().logicalProjects;
    const current = existing[id];
    if (!current) return;

    const next = { ...existing, [id]: { ...current, ...updates } };
    set({ logicalProjects: next });
    try {
      await persistSessionsPatch({ logicalProjects: next });
    } catch (error) {
      set({ logicalProjects: existing });
      logger.error('updateLogicalProject error:', error);
    }
  },

  // Delete a logical project and clear any assignments that reference it
  deleteLogicalProject: async (id) => {
    const state = get();
    const { [id]: _removed, ...remaining } = state.logicalProjects;
    const nextSessionMap: Record<string, string> = {};
    for (const [sid, lpid] of Object.entries(state.sessionProjectMap)) {
      if (lpid !== id) nextSessionMap[sid] = lpid;
    }
    const nextCwdMap: Record<string, string> = {};
    for (const [cwdId, lpid] of Object.entries(state.cwdProjectMap)) {
      if (lpid !== id) nextCwdMap[cwdId] = lpid;
    }

    const previous = {
      logicalProjects: state.logicalProjects,
      sessionProjectMap: state.sessionProjectMap,
      cwdProjectMap: state.cwdProjectMap,
    };
    set({
      logicalProjects: remaining,
      sessionProjectMap: nextSessionMap,
      cwdProjectMap: nextCwdMap,
    });
    try {
      await persistSessionsPatch({
        logicalProjects: remaining,
        sessionProjectMap: nextSessionMap,
        cwdProjectMap: nextCwdMap,
      });
    } catch (error) {
      set(previous);
      logger.error('deleteLogicalProject error:', error);
    }
  },

  // Assign (or clear with null) a single session to a logical project
  assignSessionToLogicalProject: async (sessionId, logicalProjectId) => {
    const existing = get().sessionProjectMap;
    const next = { ...existing };
    if (logicalProjectId === null) {
      delete next[sessionId];
    } else {
      next[sessionId] = logicalProjectId;
    }
    set({ sessionProjectMap: next });
    try {
      await persistSessionsPatch({ sessionProjectMap: next });
    } catch (error) {
      set({ sessionProjectMap: existing });
      logger.error('assignSessionToLogicalProject error:', error);
    }
  },

  // Assign (or clear) an entire cwd project folder — applies to all its sessions
  assignCwdToLogicalProject: async (cwdProjectId, logicalProjectId) => {
    const existing = get().cwdProjectMap;
    const next = { ...existing };
    if (logicalProjectId === null) {
      delete next[cwdProjectId];
    } else {
      next[cwdProjectId] = logicalProjectId;
    }
    set({ cwdProjectMap: next });
    try {
      await persistSessionsPatch({ cwdProjectMap: next });
    } catch (error) {
      set({ cwdProjectMap: existing });
      logger.error('assignCwdToLogicalProject error:', error);
    }
  },

  // Switch sidebar grouping mode
  setSidebarGroupBy: async (mode) => {
    const previous = get().sidebarGroupBy;
    set({ sidebarGroupBy: mode });
    try {
      await persistSessionsPatch({ sidebarGroupBy: mode });
    } catch (error) {
      set({ sidebarGroupBy: previous });
      logger.error('setSidebarGroupBy error:', error);
    }
  },

  // Resolve which logical project (if any) a session belongs to.
  // Order: explicit session assignment → cwd-folder default → null.
  resolveLogicalProjectId: (sessionId, cwdProjectId) => {
    const state = get();
    const explicit = state.sessionProjectMap[sessionId];
    if (explicit && state.logicalProjects[explicit]) return explicit;
    const inherited = state.cwdProjectMap[cwdProjectId];
    if (inherited && state.logicalProjects[inherited]) return inherited;
    return null;
  },
});
