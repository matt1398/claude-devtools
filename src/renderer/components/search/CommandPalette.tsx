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
import { formatModifierShortcut } from '@renderer/utils/keyboardUtils';
import { createLogger } from '@shared/utils/logger';
import { isSessionIdFragment, isUUID } from '@shared/utils/sessionIdValidator';
import { formatDistanceToNow } from 'date-fns';
import {
  Bot,
  FileText,
  FolderGit2,
  Globe,
  Loader2,
  MessageSquare,
  Search,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { RepositoryGroup, SearchResult } from '@renderer/types/data';
import type { FindSessionByIdResult, FindSessionsByPartialIdResult } from '@shared/types';

const logger = createLogger('Component:CommandPalette');

// =============================================================================
// Search Mode Type
// =============================================================================

type SearchMode = 'projects' | 'sessions';

// =============================================================================
// Session ID Match Item (used for both exact and partial matches)
// =============================================================================

interface SessionIdMatchItemProps {
  projectName: string;
  sessionTitle: string;
  messageCount: number;
  createdAt: number;
  sessionId: string;
  isSelected: boolean;
  onClick: () => void;
}

const SessionIdMatchItemInner = ({
  projectName,
  sessionTitle,
  messageCount,
  createdAt,
  sessionId,
  isSelected,
  onClick,
}: Readonly<SessionIdMatchItemProps>): React.JSX.Element => (
  <button
    onClick={onClick}
    className={`w-full px-4 py-3 text-left transition-colors ${
      isSelected ? 'bg-surface-raised' : 'hover:bg-surface-raised/50'
    }`}
  >
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0 text-green-400">
        <FileText className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <FolderGit2 className="size-3 text-blue-400" />
          <span className="truncate text-xs font-medium text-blue-400">{projectName}</span>
        </div>
        <div className="text-sm text-text">
          {sessionTitle ? sessionTitle.slice(0, 100) : 'Untitled session'}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-text-muted">
          <span>{messageCount} messages</span>
          <span>&middot;</span>
          <span>
            {createdAt > 0
              ? formatDistanceToNow(new Date(createdAt), { addSuffix: true })
              : 'Unknown'}
          </span>
        </div>
        <div className="text-text-muted/60 mt-1 font-mono text-[10px]">{sessionId}</div>
      </div>
    </div>
  </button>
);

const SessionIdMatchItem = React.memo(SessionIdMatchItemInner);

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
  showProjectName?: boolean;
  projectName?: string;
}

const SessionResultItemInner = ({
  result,
  isSelected,
  onClick,
  highlightMatch,
  showProjectName = false,
  projectName,
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
          {showProjectName && projectName && (
            <div className="mb-1 flex items-center gap-2">
              <FolderGit2 className="size-3 text-blue-400" />
              <span className="truncate text-xs font-medium text-blue-400">{projectName}</span>
            </div>
          )}
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
  } = useStore(
    useShallow((s) => ({
      commandPaletteOpen: s.commandPaletteOpen,
      closeCommandPalette: s.closeCommandPalette,
      selectedProjectId: s.selectedProjectId,
      navigateToSession: s.navigateToSession,
      repositoryGroups: s.repositoryGroups,
      fetchRepositoryGroups: s.fetchRepositoryGroups,
      selectRepository: s.selectRepository,
    }))
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [sessionResults, setSessionResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [searchIsPartial, setSearchIsPartial] = useState(false);
  const [globalSearchEnabled, setGlobalSearchEnabled] = useState(false);
  const [fuzzyEnabled, setFuzzyEnabled] = useState(false);
  const [sessionIdMatch, setSessionIdMatch] = useState<FindSessionByIdResult | null>(null);
  const [partialIdMatches, setPartialIdMatches] = useState<
    FindSessionsByPartialIdResult['results']
  >([]);
  const latestSearchRequestRef = useRef(0);

  // Memoize query classification to avoid redundant calls per render
  const queryIsUUID = useMemo(() => isUUID(query), [query]);
  const queryIsFragment = useMemo(() => isSessionIdFragment(query), [query]);
  const queryIsSessionId = queryIsUUID || queryIsFragment;

  // Memoize project ID → repo name lookup map
  const projectNameByWorktreeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const repo of repositoryGroups) {
      for (const wt of repo.worktrees) {
        map.set(wt.id, repo.name);
      }
    }
    return map;
  }, [repositoryGroups]);

  // Memoize repository name lookup for the selected project
  const selectedProjectName = useMemo(
    () =>
      (selectedProjectId ? projectNameByWorktreeId.get(selectedProjectId) : undefined) ??
      'Current project',
    [projectNameByWorktreeId, selectedProjectId]
  );

  // Determine search mode based on whether a project is selected OR global search is enabled
  const searchMode: SearchMode = selectedProjectId || globalSearchEnabled ? 'sessions' : 'projects';

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
  const resultsCount = queryIsUUID
    ? sessionIdMatch?.found
      ? 1
      : 0
    : queryIsFragment
      ? partialIdMatches.length
      : searchMode === 'projects'
        ? filteredProjects.length
        : sessionResults.length;

  // Fetch repository groups if needed
  useEffect(() => {
    if (
      commandPaletteOpen &&
      (searchMode === 'projects' || globalSearchEnabled) &&
      repositoryGroups.length === 0
    ) {
      void fetchRepositoryGroups();
    }
  }, [
    commandPaletteOpen,
    searchMode,
    globalSearchEnabled,
    repositoryGroups.length,
    fetchRepositoryGroups,
  ]);

  // Focus input when palette opens
  useEffect(() => {
    if (commandPaletteOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
      setSessionResults([]);
      setSelectedIndex(0);
      setTotalMatches(0);
      setSearchIsPartial(false);
      setGlobalSearchEnabled(false);
      setSessionIdMatch(null);
      setPartialIdMatches([]);
    }
  }, [commandPaletteOpen]);

  // Detect UUID input and look up session by ID (exact match)
  useEffect(() => {
    if (!commandPaletteOpen || !queryIsUUID) {
      setSessionIdMatch(null);
      return;
    }

    setPartialIdMatches([]);
    const timeoutId = setTimeout(async () => {
      const requestId = latestSearchRequestRef.current + 1;
      latestSearchRequestRef.current = requestId;
      setLoading(true);
      try {
        const result = await api.findSessionById(query.trim());
        if (latestSearchRequestRef.current !== requestId) return;
        setSessionIdMatch(result);
        setSessionResults([]);
        setTotalMatches(0);
        setSearchIsPartial(false);
        setSelectedIndex(0);
      } catch (error) {
        if (latestSearchRequestRef.current !== requestId) return;
        logger.error('Session ID lookup error:', error);
        setSessionIdMatch(null);
      } finally {
        if (latestSearchRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [query, commandPaletteOpen, queryIsUUID]);

  // Detect partial session ID fragment and look up matching sessions
  useEffect(() => {
    if (!commandPaletteOpen || !queryIsFragment) {
      setPartialIdMatches([]);
      return;
    }

    setSessionIdMatch(null);
    setSessionResults([]);
    const timeoutId = setTimeout(async () => {
      const requestId = latestSearchRequestRef.current + 1;
      latestSearchRequestRef.current = requestId;
      setLoading(true);
      try {
        const result = await api.findSessionsByPartialId(query.trim());
        if (latestSearchRequestRef.current !== requestId) return;
        setPartialIdMatches(result.results);
        setSelectedIndex(0);
      } catch (error) {
        if (latestSearchRequestRef.current !== requestId) return;
        logger.error('Partial session ID lookup error:', error);
        setPartialIdMatches([]);
      } finally {
        if (latestSearchRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, commandPaletteOpen, queryIsFragment]);

  // Search sessions with debounce (only in session mode, skip when session ID detected)
  useEffect(() => {
    // Skip text search when query is a UUID or fragment (handled by dedicated lookups above)
    if (queryIsSessionId) {
      return;
    }

    // Only clear results when query is too short or palette is closed
    if (!commandPaletteOpen || query.trim().length < 2) {
      setSessionResults([]);
      setTotalMatches(0);
      setSearchIsPartial(false);
      return;
    }

    // Early return without clearing if we're not in the right mode
    if (searchMode !== 'sessions' || (!globalSearchEnabled && !selectedProjectId)) {
      return;
    }

    const timeoutId = setTimeout(async () => {
      const requestId = latestSearchRequestRef.current + 1;
      latestSearchRequestRef.current = requestId;
      setLoading(true);
      try {
        const searchResult = globalSearchEnabled
          ? await api.searchAllProjects(query.trim(), 50, fuzzyEnabled)
          : await api.searchSessions(selectedProjectId!, query.trim(), 50, fuzzyEnabled);
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
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [
    query,
    selectedProjectId,
    commandPaletteOpen,
    searchMode,
    globalSearchEnabled,
    fuzzyEnabled,
    queryIsSessionId,
  ]);

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

  // Handle session ID match click (direct navigation)
  const handleSessionIdMatchClick = useCallback(() => {
    if (sessionIdMatch?.found && sessionIdMatch.projectId && sessionIdMatch.session) {
      closeCommandPalette();
      navigateToSession(sessionIdMatch.projectId, sessionIdMatch.session.id, false);
    }
  }, [closeCommandPalette, navigateToSession, sessionIdMatch]);

  // Handle partial ID match click
  const handlePartialMatchClick = useCallback(
    (projectId: string, sessionId: string) => {
      closeCommandPalette();
      navigateToSession(projectId, sessionId, false);
    },
    [closeCommandPalette, navigateToSession]
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
      if (e.key === 'g' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setGlobalSearchEnabled((prev) => !prev);
        return;
      }

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

      if (e.key === 'Enter') {
        e.preventDefault();
        // Handle UUID session ID match
        if (queryIsUUID && sessionIdMatch?.found) {
          handleSessionIdMatchClick();
          return;
        }
        // Handle partial ID match selection
        if (queryIsFragment && partialIdMatches.length > 0) {
          const selected = partialIdMatches[selectedIndex];
          if (selected) {
            handlePartialMatchClick(selected.projectId, selected.session.id);
          }
          return;
        }
        if (resultsCount > 0) {
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
      }
    },
    [
      resultsCount,
      selectedIndex,
      closeCommandPalette,
      searchMode,
      filteredProjects,
      sessionResults,
      sessionIdMatch,
      partialIdMatches,
      queryIsUUID,
      queryIsFragment,
      handleProjectClick,
      handleSessionResultClick,
      handleSessionIdMatchClick,
      handlePartialMatchClick,
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[15vh]"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
        {/* Mode indicator */}
        <div className="bg-surface-raised/50 border-b border-border px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {queryIsSessionId ? (
                <>
                  <Search className="size-3.5 text-green-400" />
                  <span className="text-xs text-green-400">Session ID search</span>
                </>
              ) : searchMode === 'projects' ? (
                <>
                  <FolderGit2 className="size-3.5 text-text-muted" />
                  <span className="text-xs text-text-muted">Search projects</span>
                </>
              ) : (
                <>
                  <MessageSquare className="size-3.5 text-text-muted" />
                  <span className="text-xs text-text-muted">
                    {globalSearchEnabled ? 'Search across all projects' : 'Search in project'}
                  </span>
                  {!globalSearchEnabled && (
                    <>
                      <span className="text-text-muted/50 mx-1 text-xs">&middot;</span>
                      <span className="truncate text-xs text-text-secondary">
                        {selectedProjectName}
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFuzzyEnabled(!fuzzyEnabled)}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                  fuzzyEnabled
                    ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                    : 'text-text-muted hover:bg-surface-raised hover:text-text'
                }`}
                title="Fuzzy matching — tolerate typos and approximate spelling"
              >
                <Sparkles className="size-3" />
                <span>Fuzzy</span>
              </button>
              <button
                onClick={() => setGlobalSearchEnabled(!globalSearchEnabled)}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                  globalSearchEnabled
                    ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
                    : 'text-text-muted hover:bg-surface-raised hover:text-text'
                }`}
                title={
                  !globalSearchEnabled
                    ? `Search across all projects (${formatModifierShortcut('G')})`
                    : undefined
                }
              >
                <Globe className="size-3" />
                <span>Global</span>
              </button>
            </div>
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
              searchMode === 'projects'
                ? 'Search projects or paste session ID...'
                : 'Search conversations or paste session ID...'
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
          {queryIsUUID ? (
            // Exact UUID lookup result
            loading ? null : sessionIdMatch?.found && sessionIdMatch.session ? (
              <div className="py-2">
                <SessionIdMatchItem
                  projectName={
                    (sessionIdMatch.projectId
                      ? projectNameByWorktreeId.get(sessionIdMatch.projectId)
                      : undefined) ??
                    sessionIdMatch.projectId ??
                    'Unknown'
                  }
                  sessionTitle={sessionIdMatch.session.firstMessage ?? ''}
                  messageCount={sessionIdMatch.session.messageCount}
                  createdAt={sessionIdMatch.session.createdAt}
                  sessionId={query.trim()}
                  isSelected
                  onClick={handleSessionIdMatchClick}
                />
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                No session found with ID &ldquo;{query.trim().slice(0, 8)}...&rdquo;
              </div>
            )
          ) : queryIsFragment ? (
            // Partial session ID fragment results
            loading ? null : partialIdMatches.length > 0 ? (
              <div className="py-2">
                {partialIdMatches.map((match, index) => (
                  <SessionIdMatchItem
                    key={match.session.id}
                    projectName={projectNameByWorktreeId.get(match.projectId) ?? match.projectId}
                    sessionTitle={match.session.firstMessage ?? ''}
                    messageCount={match.session.messageCount}
                    createdAt={match.session.createdAt}
                    sessionId={match.session.id}
                    isSelected={index === selectedIndex}
                    onClick={() => handlePartialMatchClick(match.projectId, match.session.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                No sessions found matching &ldquo;{query.trim()}&rdquo;
              </div>
            )
          ) : searchMode === 'projects' ? (
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
              {sessionResults.map((result, index) => {
                const projectName = globalSearchEnabled
                  ? projectNameByWorktreeId.get(result.projectId)
                  : undefined;

                return (
                  <SessionResultItem
                    key={`${result.sessionId}-${index}`}
                    result={result}
                    isSelected={index === selectedIndex}
                    onClick={() => handleSessionResultClick(result)}
                    highlightMatch={highlightMatch}
                    showProjectName={globalSearchEnabled}
                    projectName={projectName}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-text-muted">
          <span>
            {searchMode === 'projects'
              ? `${filteredProjects.length} project${filteredProjects.length !== 1 ? 's' : ''}`
              : totalMatches > 0
                ? `${totalMatches} ${searchIsPartial ? 'fast ' : ''}result${totalMatches !== 1 ? 's' : ''}${globalSearchEnabled ? ' across all projects' : ''}`
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
              <kbd className="rounded bg-surface-overlay px-1.5 py-0.5 text-[10px]">
                {formatModifierShortcut('G')}
              </kbd>{' '}
              global
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
