/**
 * SidebarHeader - Linear-style header with project name and worktree selector.
 *
 * Layout (2 stacked horizontal bars):
 * - Row 1: Project name (left-aligned after macOS traffic lights)
 * - Row 2: Worktree selector (full-width button)
 *
 * Visual requirements:
 * - Row 1 is the drag region for window movement
 * - Row 1 reserves left space for macOS traffic lights via shared layout CSS variable
 * - Row 2 is a full-width button with no side margins
 */

import { useEffect, useRef, useState } from 'react';

import { isElectronMode } from '@renderer/api';
import { HEADER_ROW1_HEIGHT, HEADER_ROW2_HEIGHT } from '@renderer/constants/layout';
import { useStore } from '@renderer/store';
import { truncateMiddle } from '@renderer/utils/stringUtils';
import { Check, ChevronDown, GitBranch, PanelLeft } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { WorktreeBadge } from '../common/WorktreeBadge';

import type { Worktree, WorktreeSource } from '@renderer/types/data';

/**
 * Group worktrees by source for organized dropdown display.
 * Returns: main worktree first, then groups sorted by most recent activity.
 */
interface WorktreeGroup {
  source: WorktreeSource;
  label: string;
  worktrees: Worktree[];
  mostRecent: number;
}

const SOURCE_LABELS: Record<WorktreeSource, string> = {
  'vibe-kanban': 'Vibe Kanban',
  conductor: 'Conductor',
  'auto-claude': 'Auto Claude',
  '21st': '21st',
  'claude-desktop': 'Claude Desktop',
  ccswitch: 'ccswitch',
  git: 'Git',
  unknown: 'Other',
};

function groupWorktreesBySource(worktrees: Worktree[]): {
  mainWorktree: Worktree | null;
  groups: WorktreeGroup[];
} {
  // Find main worktree
  const mainWorktree = worktrees.find((w) => w.isMainWorktree) ?? null;

  // Group remaining worktrees by source
  const groupMap = new Map<WorktreeSource, Worktree[]>();

  for (const wt of worktrees) {
    if (wt.isMainWorktree) continue; // Skip main, handled separately

    const existing = groupMap.get(wt.source) ?? [];
    existing.push(wt);
    groupMap.set(wt.source, existing);
  }

  // Convert to array and sort each group internally by most recent
  const groups: WorktreeGroup[] = [];

  for (const [source, wts] of groupMap) {
    // Sort worktrees within group by most recent
    const sorted = [...wts].sort((a, b) => (b.mostRecentSession ?? 0) - (a.mostRecentSession ?? 0));

    const mostRecent = Math.max(...sorted.map((w) => w.mostRecentSession ?? 0));

    groups.push({
      source,
      label: SOURCE_LABELS[source] ?? source,
      worktrees: sorted,
      mostRecent,
    });
  }

  // Sort groups by most recent activity
  groups.sort((a, b) => b.mostRecent - a.mostRecent);

  return { mainWorktree, groups };
}

/**
 * Individual worktree item in the dropdown.
 */
interface WorktreeItemProps {
  worktree: Worktree;
  isSelected: boolean;
  onSelect: () => void;
}

const WorktreeItem = ({
  worktree,
  isSelected,
  onSelect,
}: Readonly<WorktreeItemProps>): React.JSX.Element => {
  const [isHovered, setIsHovered] = useState(false);

  const buttonStyle: React.CSSProperties = isSelected
    ? { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text)' }
    : {
        backgroundColor: isHovered ? 'var(--color-surface-raised)' : 'transparent',
        opacity: isHovered ? 0.5 : 1,
      };

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left transition-colors"
      style={buttonStyle}
    >
      <GitBranch
        className="size-3.5 shrink-0"
        style={{ color: isSelected ? '#34d399' : 'var(--color-text-muted)' }}
      />
      {/* Only show badge for main worktree - others are grouped by header */}
      {worktree.isMainWorktree && <WorktreeBadge source={worktree.source} isMain />}
      <span
        className="flex-1 truncate font-mono text-xs"
        style={{ color: isSelected ? 'var(--color-text)' : 'var(--color-text-muted)' }}
      >
        {truncateMiddle(worktree.name, 28)}
      </span>
      <span className="shrink-0 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
        {worktree.sessions.length}
      </span>
      {isSelected && <Check className="size-3.5 shrink-0 text-indigo-400" />}
    </button>
  );
};

/**
 * Individual project/repository item in the dropdown.
 */
interface ProjectDropdownItemProps {
  name: string;
  path?: string;
  sessionCount: number;
  isSelected: boolean;
  onSelect: () => void;
}

const ProjectDropdownItem = ({
  name,
  path,
  sessionCount,
  isSelected,
  onSelect,
}: Readonly<ProjectDropdownItemProps>): React.JSX.Element => {
  const [isHovered, setIsHovered] = useState(false);

  const buttonStyle: React.CSSProperties = isSelected
    ? { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text)' }
    : {
        backgroundColor: isHovered ? 'var(--color-surface-raised)' : 'transparent',
        opacity: isHovered ? 0.5 : 1,
      };

  return (
    <button
      onClick={onSelect}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors"
      style={buttonStyle}
    >
      <div className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm ${isSelected ? 'font-medium' : ''}`}
          style={{ color: isSelected ? 'var(--color-text)' : 'var(--color-text-muted)' }}
        >
          {name}
        </span>
        {path && (
          <span className="block truncate text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {path}
          </span>
        )}
      </div>
      <span className="shrink-0 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
        {sessionCount}
      </span>
      {isSelected && <Check className="size-3.5 shrink-0 text-indigo-400" />}
    </button>
  );
};

export const SidebarHeader = (): React.JSX.Element => {
  const isMacElectron =
    isElectronMode() && window.navigator.userAgent.toLowerCase().includes('mac');

  const {
    repositoryGroups,
    selectedRepositoryId,
    selectedWorktreeId,
    selectWorktree,
    selectRepository,
    viewMode,
    projects,
    activeProjectId,
    setActiveProject,
    fetchRepositoryGroups,
    fetchProjects,
    toggleSidebar,
    combinedModeEnabled,
  } = useStore(
    useShallow((s) => ({
      repositoryGroups: s.repositoryGroups,
      selectedRepositoryId: s.selectedRepositoryId,
      selectedWorktreeId: s.selectedWorktreeId,
      selectWorktree: s.selectWorktree,
      selectRepository: s.selectRepository,
      viewMode: s.viewMode,
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      setActiveProject: s.setActiveProject,
      fetchRepositoryGroups: s.fetchRepositoryGroups,
      fetchProjects: s.fetchProjects,
      toggleSidebar: s.toggleSidebar,
      combinedModeEnabled: s.combinedModeEnabled,
    }))
  );

  // Fetch data on mount based on view mode
  useEffect(() => {
    if (viewMode === 'grouped' && repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    } else if (viewMode === 'flat' && projects.length === 0) {
      void fetchProjects();
    }
  }, [viewMode, repositoryGroups.length, projects.length, fetchRepositoryGroups, fetchProjects]);

  const [isWorktreeDropdownOpen, setIsWorktreeDropdownOpen] = useState(false);
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const worktreeDropdownRef = useRef<HTMLDivElement>(null);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  // Find the active repository and worktree
  const activeRepo = repositoryGroups.find((r) => r.id === selectedRepositoryId);
  const activeWorktree = activeRepo?.worktrees.find((w) => w.id === selectedWorktreeId);
  // Filter worktrees to only show those with sessions
  const worktrees = (activeRepo?.worktrees ?? []).filter((w) => w.sessions.length > 0);
  const hasMultipleWorktrees = worktrees.length > 1;

  // Group worktrees by source for organized dropdown
  const worktreeGroupingResult = groupWorktreesBySource(worktrees);
  const mainWorktree = worktreeGroupingResult.mainWorktree;
  const worktreeGroups = worktreeGroupingResult.groups;

  // For flat mode
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Get display name — keep showing the project/repo name even in combined mode
  // for layout stability. The "All Sessions" label is shown in the session list.
  const projectName =
    viewMode === 'grouped'
      ? (activeRepo?.name ?? 'Select Project')
      : (activeProject?.name ?? 'Select Project');

  const worktreeName = activeWorktree?.name ?? 'main';
  const hasSelection = combinedModeEnabled || (viewMode === 'grouped' ? !!activeRepo : !!activeProject);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (
        worktreeDropdownRef.current &&
        !worktreeDropdownRef.current.contains(event.target as Node)
      ) {
        setIsWorktreeDropdownOpen(false);
      }
      if (
        projectDropdownRef.current &&
        !projectDropdownRef.current.contains(event.target as Node)
      ) {
        setIsProjectDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsWorktreeDropdownOpen(false);
        setIsProjectDropdownOpen(false);
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const handleSelectWorktree = (worktree: Worktree): void => {
    selectWorktree(worktree.id);
    setIsWorktreeDropdownOpen(false);
  };

  const handleSelectRepo = (repoId: string): void => {
    selectRepository(repoId);
    setIsProjectDropdownOpen(false);
  };

  const handleSelectProject = (projectId: string): void => {
    setActiveProject(projectId);
    setIsProjectDropdownOpen(false);
  };

  // Items for project dropdown - filter out repositories/projects with 0 sessions
  const projectItems =
    viewMode === 'grouped'
      ? repositoryGroups.filter((r) => r.totalSessions > 0)
      : projects.filter((p) => p.sessions.length > 0);

  const [isCollapseHovered, setIsCollapseHovered] = useState(false);

  return (
    <div
      className="flex w-full flex-col"
      style={{ backgroundColor: 'var(--color-surface-sidebar)' }}
    >
      {/* ROW 1: Project Identity (Title Bar / Drag Region) */}
      <div
        ref={projectDropdownRef}
        className="relative flex select-none items-center gap-2 pr-2"
        style={
          {
            height: `${HEADER_ROW1_HEIGHT}px`,
            paddingLeft: isMacElectron ? 'var(--macos-traffic-light-padding-left, 72px)' : '16px',
            WebkitAppRegion: isMacElectron ? 'drag' : undefined,
          } as React.CSSProperties
        }
      >
        {/* Project name dropdown button */}
        <button
          onClick={() => {
            if (!combinedModeEnabled) {
              setIsProjectDropdownOpen(!isProjectDropdownOpen);
            }
          }}
          disabled={combinedModeEnabled}
          className="flex min-w-0 items-center gap-2 transition-opacity hover:opacity-80"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <span
            className="min-w-0 truncate text-sm font-bold tracking-tight"
            style={{ color: hasSelection ? 'var(--color-text)' : 'var(--color-text-muted)' }}
          >
            {projectName}
          </span>
          {!combinedModeEnabled && (
            <ChevronDown
              className={`size-3.5 shrink-0 transition-transform ${isProjectDropdownOpen ? 'rotate-180' : ''}`}
              style={{ color: 'var(--color-text-muted)' }}
            />
          )}
        </button>

        {/* Collapse sidebar button */}
        <button
          onClick={toggleSidebar}
          onMouseEnter={() => setIsCollapseHovered(true)}
          onMouseLeave={() => setIsCollapseHovered(false)}
          className="ml-auto shrink-0 rounded-md p-1.5 transition-colors"
          style={
            {
              WebkitAppRegion: 'no-drag',
              color: isCollapseHovered ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
              backgroundColor: isCollapseHovered ? 'var(--color-surface-raised)' : 'transparent',
            } as React.CSSProperties
          }
          title="Collapse sidebar (⌘B)"
        >
          <PanelLeft className="size-4" />
        </button>

        {/* Project Dropdown */}
        {!combinedModeEnabled && isProjectDropdownOpen && (
          <>
            <div
              role="presentation"
              className="fixed inset-0 z-10"
              onClick={() => setIsProjectDropdownOpen(false)}
            />
            <div
              className="absolute inset-x-4 top-full z-20 mt-1 max-h-[350px] overflow-y-auto rounded-lg py-1 shadow-xl"
              style={{
                backgroundColor: 'var(--color-surface-sidebar)',
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: 'var(--color-border)',
              }}
            >
              <div
                className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Switch {viewMode === 'grouped' ? 'Repository' : 'Project'}
              </div>

              {projectItems.length === 0 ? (
                <div className="p-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                  No {viewMode === 'grouped' ? 'repositories' : 'projects'} found
                </div>
              ) : (
                projectItems.map((item) => {
                  const isSelected =
                    viewMode === 'grouped'
                      ? item.id === selectedRepositoryId
                      : item.id === activeProjectId;
                  const itemSessions =
                    viewMode === 'grouped'
                      ? (item as (typeof repositoryGroups)[0]).totalSessions
                      : (item as (typeof projects)[0]).sessions.length;
                  // Get path for display
                  const itemPath =
                    viewMode === 'grouped'
                      ? (item as (typeof repositoryGroups)[0]).worktrees[0]?.path
                      : (item as (typeof projects)[0]).path;

                  return (
                    <ProjectDropdownItem
                      key={item.id}
                      name={item.name}
                      path={itemPath}
                      sessionCount={itemSessions}
                      isSelected={isSelected}
                      onSelect={() =>
                        viewMode === 'grouped'
                          ? handleSelectRepo(item.id)
                          : handleSelectProject(item.id)
                      }
                    />
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* ROW 2: Worktree Selector (Full Width) — always rendered at fixed height for layout stability */}
      {viewMode === 'grouped' && activeRepo && (
        <div ref={worktreeDropdownRef} className="relative w-full">
          <button
            onClick={() =>
              !combinedModeEnabled &&
              hasMultipleWorktrees &&
              setIsWorktreeDropdownOpen(!isWorktreeDropdownOpen)
            }
            disabled={combinedModeEnabled || !hasMultipleWorktrees}
            className={`flex w-full items-center justify-between px-4 text-left transition-colors ${!combinedModeEnabled && hasMultipleWorktrees ? 'cursor-pointer' : 'cursor-default'}`}
            style={{
              height: `${HEADER_ROW2_HEIGHT}px`,
              backgroundColor: isWorktreeDropdownOpen
                ? 'var(--color-surface-raised)'
                : 'var(--color-surface-sidebar)',
              color: isWorktreeDropdownOpen ? 'var(--color-text)' : 'var(--color-text-muted)',
              opacity: combinedModeEnabled ? 0.4 : 1,
              transition: 'opacity 150ms ease',
            }}
          >
            <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
              <GitBranch
                className="size-4 shrink-0"
                style={{ color: isWorktreeDropdownOpen ? '#34d399' : 'rgba(52, 211, 153, 0.7)' }}
              />
              {activeWorktree?.isMainWorktree ? (
                <WorktreeBadge source={activeWorktree.source} isMain />
              ) : (
                activeWorktree?.source && <WorktreeBadge source={activeWorktree.source} />
              )}
              <span className="truncate font-mono text-xs">{truncateMiddle(worktreeName, 28)}</span>
            </div>
            {hasMultipleWorktrees && (
              <ChevronDown
                className={`size-4 shrink-0 transition-transform ${isWorktreeDropdownOpen ? 'rotate-180' : ''}`}
                style={{ color: 'var(--color-text-muted)' }}
              />
            )}
          </button>

          {/* Worktree Dropdown */}
          {!combinedModeEnabled && isWorktreeDropdownOpen && hasMultipleWorktrees && (
            <>
              <div
                role="presentation"
                className="fixed inset-0 z-10"
                onClick={() => setIsWorktreeDropdownOpen(false)}
              />
              <div
                className="absolute inset-x-0 top-full z-20 mt-0 max-h-[400px] overflow-y-auto py-1 shadow-xl"
                style={{
                  backgroundColor: 'var(--color-surface-sidebar)',
                  borderWidth: '1px',
                  borderTopWidth: '0',
                  borderStyle: 'solid',
                  borderColor: 'var(--color-border)',
                }}
              >
                <div
                  className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  Switch Worktree
                </div>

                {/* Main worktree first */}
                {mainWorktree && (
                  <WorktreeItem
                    worktree={mainWorktree}
                    isSelected={mainWorktree.id === selectedWorktreeId}
                    onSelect={() => handleSelectWorktree(mainWorktree)}
                  />
                )}

                {/* Grouped worktrees by source */}
                {worktreeGroups.map((group) => (
                  <div key={group.source}>
                    {/* Group header */}
                    <div
                      className="mt-1 px-4 py-1.5 text-[9px] font-medium uppercase tracking-wider"
                      style={{
                        borderTopWidth: '1px',
                        borderTopStyle: 'solid',
                        borderTopColor: 'var(--color-border)',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {group.label}
                    </div>
                    {/* Worktrees in group */}
                    {group.worktrees.map((worktree) => (
                      <WorktreeItem
                        key={worktree.id}
                        worktree={worktree}
                        isSelected={worktree.id === selectedWorktreeId}
                        onSelect={() => handleSelectWorktree(worktree)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
