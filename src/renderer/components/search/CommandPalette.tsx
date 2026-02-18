/**
 * CommandPalette - Spotlight/Alfred-like search modal.
 * Triggered by Cmd+K.
 *
 * Behavior:
 * - When NO project is selected: Searches projects by name/path
 * - When a project IS selected: Searches conversations within that project
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { useShallow } from 'zustand/react/shallow';

const logger = createLogger('Component:CommandPalette');
import { formatDistanceToNow } from 'date-fns';
import { Bot, FileText, FolderGit2, Loader2, MessageSquare, Search, User, X } from 'lucide-react';

import type { RepositoryGroup, SearchResult } from '@renderer/types/data';

// =============================================================================
// Search Mode Type
// =============================================================================

type SearchMode = 'projects' | 'sessions';

// =============================================================================
// Project Search Result Item
// =============================================================================

interface ProjectResultItemProps {
  repo: RepositoryGroup;
  isSelected: boolean;
  onClick: () => void;
}

const ProjectResultItemInner = ({
  repo,
  isSelected,
  onClick,
}: Readonly<ProjectResultItemProps>): React.JSX.Element => {
  const lastActivity = repo.mostRecentSession
    ? formatDistanceToNow(new Date(repo.mostRecentSession), { addSuffix: true })
    : 'No recent activity';

  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-3 text-left transition-colors ${
        isSelected ? 'bg-surface-raised' : 'hover:bg-surface-raised/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-text-secondary">
          <FolderGit2 className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-text">{repo.name}</div>
          <div className="mt-0.5 truncate font-mono text-xs text-text-muted">
            {repo.worktrees[0]?.path || ''}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
            <span>{repo.totalSessions} sessions</span>
            <span>·</span>
            <span>{lastActivity}</span>
          </div>
        </div>
      </div>
    </button>
  );
};

const ProjectResultItem = React.memo(ProjectResultItemInner);

// =============================================================================
// Session Search Result Item
// =============================================================================

interface SessionResultItemProps {
  result: SearchResult;
  isSelected: boolean;
  onClick: () => void;
  highlightMatch: (context: string, matchedText: string) => React.ReactNode;
}

const SessionResultItemInner = ({
  result,
  isSelected,
  onClick,
  highlightMatch,
}: Readonly<SessionResultItemProps>): React.JSX.Element => {
  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-3 text-left transition-colors ${
        isSelected ? 'bg-surface-raised' : 'hover:bg-surface-raised/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 shrink-0 ${
            result.messageType === 'user' ? 'text-blue-400' : 'text-green-400'
          }`}
        >
          {result.messageType === 'user' ? <User className="size-4" /> : <Bot className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <FileText className="size-3 text-text-muted" />
            <span className="truncate text-xs text-text-muted">
              {result.sessionTitle.slice(0, 60)}
              {result.sessionTitle.length > 60 ? '...' : ''}
            </span>
          </div>
          <div className="text-sm leading-relaxed text-text">
            {highlightMatch(result.context, result.matchedText)}
          </div>
          <div className="text-text-muted/60 mt-1 text-xs">
            {new Date(result.timestamp).toLocaleDateString()}{' '}
            {new Date(result.timestamp).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </button>
  );
};

const SessionResultItem = React.memo(SessionResultItemInner);

// =============================================================================
// Main Component
// =============================================================================

export const CommandPalette = (): React.JSX.Element | null => {
  const {
    commandPaletteOpen,
    closeCommandPalette,
    selectedProjectId,
    navigateToSession,
    repositoryGroups,
    fetchRepositoryGroups,
    selectRepository,
    pendingSearchQuery,
    clearPendingSearchQuery,
  } = useStore(
    useShallow((s) => ({
      commandPaletteOpen: s.commandPaletteOpen,
      closeCommandPalette: s.closeCommandPalette,
      selectedProjectId: s.selectedProjectId,
      navigateToSession: s.navigateToSession,
      repositoryGroups: s.repositoryGroups,
      fetchRepositoryGroups: s.fetchRepositoryGroups,
      selectRepository: s.selectRepository,
      pendingSearchQuery: s.pendingSearchQuery,
      clearPendingSearchQuery: s.clearPendingSearchQuery,
    }))
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [sessionResults, setSessionResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [searchIsPartial, setSearchIsPartial] = useState(false);
  const latestSearchRequestRef = useRef(0);

  // Determine search mode based on whether a project is selected
  const searchMode: SearchMode = selectedProjectId ? 'sessions' : 'projects';

  // Filter projects for project search mode
  const filteredProjects = useMemo(() => {
    if (searchMode !== 'projects' || query.trim().length < 1) {
      return repositoryGroups.slice(0, 10);
    }

    const q = query.toLowerCase().trim();
    return repositoryGroups
      .filter((repo) => {
        if (repo.name.toLowerCase().includes(q)) return true;
        const path = repo.worktrees[0]?.path || '';
        if (path.toLowerCase().includes(q)) return true;
        return false;
      })
      .slice(0, 10);
  }, [repositoryGroups, query, searchMode]);

  // Results count for current mode
  const resultsCount = searchMode === 'projects' ? filteredProjects.length : sessionResults.length;

  // Fetch repository groups if needed
  useEffect(() => {
    if (commandPaletteOpen && searchMode === 'projects' && repositoryGroups.length === 0) {
      void fetchRepositoryGroups();
    }
  }, [commandPaletteOpen, searchMode, repositoryGroups.length, fetchRepositoryGroups]);

  // Focus input when palette opens, pre-filling any pending deep link query
  useEffect(() => {
    if (commandPaletteOpen && inputRef.current) {
      if (pendingSearchQuery) {
        setQuery(pendingSearchQuery);
        clearPendingSearchQuery();
      } else {
        setQuery('');
      }
      inputRef.current.focus();
      setSessionResults([]);
      setSelectedIndex(0);
      setTotalMatches(0);
      setSearchIsPartial(false);
    }
  }, [commandPaletteOpen, pendingSearchQuery, clearPendingSearchQuery]);

  // Search sessions with debounce (only in session mode)
  useEffect(() => {
    if (
      !commandPaletteOpen ||
      searchMode !== 'sessions' ||
      !selectedProjectId ||
      query.trim().length < 2
    ) {
      setSessionResults([]);
      setTotalMatches(0);
      setSearchIsPartial(false);
      return;
    }

    const timeoutId = setTimeout(async () => {
      const requestId = latestSearchRequestRef.current + 1;
      latestSearchRequestRef.current = requestId;
      setLoading(true);
      try {
        const searchResult = await api.searchSessions(selectedProjectId, query.trim(), 50);
        if (latestSearchRequestRef.current !== requestId) {
          return;
        }
        setSessionResults(searchResult.results);
        setTotalMatches(searchResult.totalMatches);
        setSearchIsPartial(!!searchResult.isPartial);
        setSelectedIndex(0);
      } catch (error) {
        if (latestSearchRequestRef.current !== requestId) {
          return;
        }
        logger.error('Search error:', error);
        setSessionResults([]);
        setTotalMatches(0);
        setSearchIsPartial(false);
      } finally {
        if (latestSearchRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [query, selectedProjectId, commandPaletteOpen, searchMode]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredProjects, sessionResults]);

  // Handle project click
  const handleProjectClick = useCallback(
    (repo: RepositoryGroup) => {
      closeCommandPalette();
      selectRepository(repo.id);
    },
    [closeCommandPalette, selectRepository]
  );

  // Handle session result click
  const handleSessionResultClick = useCallback(
    (result: SearchResult) => {
      closeCommandPalette();
      navigateToSession(result.projectId, result.sessionId, true, {
        query: query.trim(),
        messageTimestamp: result.timestamp,
        matchedText: result.matchedText,
        targetGroupId: result.groupId,
        targetMatchIndexInItem: result.matchIndexInItem,
        targetMatchStartOffset: result.matchStartOffset,
        targetMessageUuid: result.messageUuid,
      });
    },
    [closeCommandPalette, navigateToSession, query]
  );

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        closeCommandPalette();
      }
    },
    [closeCommandPalette]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, resultsCount - 1));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === 'Enter' && resultsCount > 0) {
        e.preventDefault();
        if (searchMode === 'projects') {
          const selected = filteredProjects[selectedIndex];
          if (selected) {
            handleProjectClick(selected);
          }
        } else {
          const selected = sessionResults[selectedIndex];
          if (selected) {
            handleSessionResultClick(selected);
          }
        }
      }
    },
    [
      resultsCount,
      selectedIndex,
      closeCommandPalette,
      searchMode,
      filteredProjects,
      sessionResults,
      handleProjectClick,
      handleSessionResultClick,
    ]
  );

  // Highlight matched text in context
  const highlightMatch = useCallback((context: string, matchedText: string) => {
    const lowerContext = context.toLowerCase();
    const lowerMatch = matchedText.toLowerCase();
    const matchIndex = lowerContext.indexOf(lowerMatch);

    if (matchIndex === -1) {
      return <span>{context}</span>;
    }

    const before = context.slice(0, matchIndex);
    const match = context.slice(matchIndex, matchIndex + matchedText.length);
    const after = context.slice(matchIndex + matchedText.length);

    return (
      <>
        <span>{before}</span>
        <mark
          className="rounded px-0.5"
          style={{
            backgroundColor: 'var(--highlight-bg)',
            color: 'var(--highlight-text)',
          }}
        >
          {match}
        </mark>
        <span>{after}</span>
      </>
    );
  }, []);

  if (!commandPaletteOpen) {
    return null;
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh] backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        {/* Mode indicator */}
        <div className="bg-surface-raised/50 border-b border-border px-4 py-2">
          <div className="flex items-center gap-2">
            {searchMode === 'projects' ? (
              <>
                <FolderGit2 className="size-3.5 text-text-muted" />
                <span className="text-xs text-text-muted">Search projects</span>
              </>
            ) : (
              <>
                <MessageSquare className="size-3.5 text-text-muted" />
                <span className="text-xs text-text-muted">Search in projects</span>
                <span className="text-text-muted/50 mx-1 text-xs">·</span>
                <span className="truncate text-xs text-text-secondary">
                  {repositoryGroups.find((r) => r.worktrees.some((w) => w.id === selectedProjectId))
                    ?.name ?? 'Current project'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="size-5 shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              searchMode === 'projects' ? 'Search projects...' : 'Search conversations...'
            }
            className="placeholder:text-text-muted/50 flex-1 bg-transparent text-base text-text focus:outline-none"
          />
          {loading && <Loader2 className="size-4 animate-spin text-text-muted" />}
          <button
            onClick={closeCommandPalette}
            className="rounded p-1 text-text-muted transition-colors hover:text-text"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {searchMode === 'projects' ? (
            // Project search results
            filteredProjects.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                {query.trim() ? `No projects found for "${query}"` : 'No projects found'}
              </div>
            ) : (
              <div className="py-2">
                {filteredProjects.map((repo, index) => (
                  <ProjectResultItem
                    key={repo.id}
                    repo={repo}
                    isSelected={index === selectedIndex}
                    onClick={() => handleProjectClick(repo)}
                  />
                ))}
              </div>
            )
          ) : // Session search results
          query.trim().length < 2 ? (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              Type at least 2 characters to search
            </div>
          ) : sessionResults.length === 0 && !loading ? (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              {searchIsPartial
                ? `No fast results in recent sessions for "${query}"`
                : `No results found for "${query}"`}
            </div>
          ) : (
            <div className="py-2">
              {sessionResults.map((result, index) => (
                <SessionResultItem
                  key={`${result.sessionId}-${index}`}
                  result={result}
                  isSelected={index === selectedIndex}
                  onClick={() => handleSessionResultClick(result)}
                  highlightMatch={highlightMatch}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-text-muted">
          <span>
            {searchMode === 'projects'
              ? `${filteredProjects.length} project${filteredProjects.length !== 1 ? 's' : ''}`
              : totalMatches > 0
                ? `${totalMatches} ${searchIsPartial ? 'fast ' : ''}result${totalMatches !== 1 ? 's' : ''}`
                : 'Type to search'}
          </span>
          <div className="flex items-center gap-4">
            <span>
              <kbd className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px]">↑↓</kbd>{' '}
              navigate
            </span>
            <span>
              <kbd className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px]">↵</kbd>{' '}
              {searchMode === 'projects' ? 'select' : 'open'}
            </span>
            <span>
              <kbd className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px]">esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
