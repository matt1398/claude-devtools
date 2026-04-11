/**
 * Sidebar - Breadcrumb-style navigation with project/worktree hierarchy.
 *
 * Structure:
 * - Fixed Header: Project selector (Row 1) + Worktree selector (Row 2, conditional)
 * - Scrollable Body: Date-grouped session list
 * - Resizable: Drag right edge to resize
 * - Collapsible: Cmd+B to toggle (Notion-style)
 *
 * Provides clear hierarchy visibility: Project -> Worktree -> Session
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

import { DateGroupedSessions } from '../sidebar/DateGroupedSessions';
import { LogicalProjectManager } from '../sidebar/LogicalProjectManager';

import { SidebarHeader } from './SidebarHeader';

const MIN_WIDTH = 200;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 280;

export const Sidebar = (): React.JSX.Element | null => {
  const { projects, projectsLoading, fetchProjects, sidebarCollapsed } = useStore(
    useShallow((s) => ({
      projects: s.projects,
      projectsLoading: s.projectsLoading,
      fetchProjects: s.fetchProjects,
      sidebarCollapsed: s.sidebarCollapsed,
    }))
  );
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Fetch projects on mount if not loaded
  useEffect(() => {
    if (projects.length === 0 && !projectsLoading) {
      void fetchProjects();
    }
  }, [projects.length, projectsLoading, fetchProjects]);

  // Handle mouse move during resize
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const newWidth = e.clientX;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth);
      }
    },
    [isResizing]
  );

  // Handle mouse up to stop resizing
  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Add/remove event listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault();
    setIsResizing(true);
  };

  // Collapsed state - sidebar is completely hidden (expand button is in TabBar)
  if (sidebarCollapsed) {
    return null;
  }

  return (
    <div
      ref={sidebarRef}
      className="relative flex shrink-0 flex-col border-r"
      style={{
        backgroundColor: 'var(--color-surface-sidebar)',
        borderColor: 'var(--color-border)',
        width: `${width}px`,
      }}
    >
      {/* Sidebar header with project dropdown */}
      <SidebarHeader />

      {/* Date-grouped session list */}
      <div className="flex-1 overflow-hidden">
        <DateGroupedSessions />
      </div>

      {/* Logical project manager modal (portal-mounted when open) */}
      <LogicalProjectManager />

      {/* Resize handle */}
      <button
        type="button"
        aria-label="Resize sidebar"
        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize border-0 bg-transparent p-0 transition-colors hover:bg-blue-500/50 ${
          isResizing ? 'bg-blue-500/50' : ''
        }`}
        onMouseDown={handleResizeStart}
      />
    </div>
  );
};
