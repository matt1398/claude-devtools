/**
 * MoreMenu - Dropdown menu behind a "..." icon for less-frequent toolbar actions.
 *
 * Groups: Search, Export (session-only), Settings.
 * Closes on outside click or Escape.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { triggerDownload } from '@renderer/utils/sessionExporter';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { Braces, FileText, MoreHorizontal, Search, Settings, Type } from 'lucide-react';

import type { Tab } from '@renderer/types/tabs';
import type { ExportFormat } from '@renderer/utils/sessionExporter';

interface MoreMenuProps {
  activeTab: Tab | undefined;
  /** Whether the active tab has session data loaded (used to show export options). */
  activeTabHasSession: boolean;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onClick: () => void;
}

export const MoreMenu = ({
  activeTab,
  activeTabHasSession,
}: Readonly<MoreMenuProps>): React.JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const [buttonHover, setButtonHover] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const openCommandPalette = useStore((s) => s.openCommandPalette);
  const openSettingsTab = useStore((s) => s.openSettingsTab);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (activeTab?.type !== 'session' || !activeTab.projectId || !activeTab.sessionId) return;
      const { projectId, sessionId } = activeTab;
      setIsOpen(false);
      setExportLoading(true);
      // Re-fetch full detail (with chunks) since we strip them from the store to save memory.
      // No knownFingerprint passed, so the response is always SessionDetail | null
      // at runtime. Narrow defensively for type safety.
      void api
        .getSessionDetail(projectId, sessionId)
        .then((response) => {
          if (response && !('unchanged' in response)) {
            triggerDownload(response, format);
          }
        })
        .finally(() => {
          setExportLoading(false);
        });
    },
    [activeTab]
  );

  const isSessionWithData = activeTab?.type === 'session' && activeTabHasSession;

  // Build menu sections
  const topItems: MenuItem[] = [
    {
      id: 'search',
      label: 'Search',
      icon: Search,
      shortcut: formatShortcut('K'),
      onClick: () => {
        openCommandPalette();
        setIsOpen(false);
      },
    },
  ];

  const sessionItems: MenuItem[] = isSessionWithData
    ? [
        {
          id: 'export-md',
          label: exportLoading ? 'Exporting…' : 'Export as Markdown',
          icon: FileText,
          shortcut: '.md',
          onClick: () => handleExport('markdown'),
        },
        {
          id: 'export-json',
          label: exportLoading ? 'Exporting…' : 'Export as JSON',
          icon: Braces,
          shortcut: '.json',
          onClick: () => handleExport('json'),
        },
        {
          id: 'export-txt',
          label: exportLoading ? 'Exporting…' : 'Export as Plain Text',
          icon: Type,
          shortcut: '.txt',
          onClick: () => handleExport('plaintext'),
        },
      ]
    : [];

  const bottomItems: MenuItem[] = [
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      shortcut: formatShortcut(','),
      onClick: () => {
        openSettingsTab();
        setIsOpen(false);
      },
    },
  ];

  const renderItem = (item: MenuItem): React.JSX.Element => (
    <button
      key={item.id}
      onClick={item.onClick}
      onMouseEnter={() => setHoveredId(item.id)}
      onMouseLeave={() => setHoveredId(null)}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors"
      style={{
        color: hoveredId === item.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
        backgroundColor: hoveredId === item.id ? 'var(--color-surface-raised)' : 'transparent',
      }}
    >
      <item.icon className="size-3.5" />
      <span className="flex-1">{item.label}</span>
      {item.shortcut && (
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {item.shortcut}
        </span>
      )}
    </button>
  );

  const separator = (
    <div className="my-0.5" style={{ borderBottom: '1px solid var(--color-border)' }} />
  );

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setButtonHover(true)}
        onMouseLeave={() => setButtonHover(false)}
        className="rounded-md p-2 transition-colors"
        style={{
          color: buttonHover || isOpen ? 'var(--color-text)' : 'var(--color-text-muted)',
          backgroundColor: buttonHover || isOpen ? 'var(--color-surface-raised)' : 'transparent',
        }}
        title="More actions"
      >
        <MoreHorizontal className="size-4" />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-md border shadow-lg"
          style={{
            backgroundColor: 'var(--color-surface-overlay)',
            borderColor: 'var(--color-border)',
          }}
        >
          {topItems.map(renderItem)}

          {sessionItems.length > 0 && (
            <>
              {separator}
              {sessionItems.map(renderItem)}
            </>
          )}

          {separator}
          {bottomItems.map(renderItem)}
        </div>
      )}
    </div>
  );
};
