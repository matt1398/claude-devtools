/**
 * SearchBar - In-session search interface component.
 * Appears at the top of the chat view when Cmd+F is pressed.
 *
 * Uses a local input state with debouncing to avoid triggering expensive
 * markdown-aware search on every keystroke.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useStore } from '@renderer/store';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

const SEARCH_DEBOUNCE_MS = 300;

interface SearchBarProps {
  tabId?: string;
}

export const SearchBar = ({ tabId }: SearchBarProps): React.JSX.Element | null => {
  const {
    searchQuery,
    searchVisible,
    searchResultCount,
    currentSearchIndex,
    searchResultsCapped,
    conversation,
    setSearchQuery,
    hideSearch,
    nextSearchResult,
    previousSearchResult,
  } = useStore(
    useShallow((s) => ({
      searchQuery: s.searchQuery,
      searchVisible: s.searchVisible,
      searchResultCount: s.searchResultCount,
      currentSearchIndex: s.currentSearchIndex,
      searchResultsCapped: s.searchResultsCapped,
      conversation: tabId
        ? (s.tabSessionData[tabId]?.conversation ?? s.conversation)
        : s.conversation,
      setSearchQuery: s.setSearchQuery,
      hideSearch: s.hideSearch,
      nextSearchResult: s.nextSearchResult,
      previousSearchResult: s.previousSearchResult,
    }))
  );

  // Local input value for responsive typing — debounced before triggering search
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(
    0 as unknown as ReturnType<typeof setTimeout>
  );

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync local state when store query changes externally (e.g., hideSearch clears it)
  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  // Debounced search dispatch
  const handleChange = useCallback(
    (value: string) => {
      setLocalQuery(value);
      clearTimeout(debounceRef.current);

      // Clear immediately when input is emptied
      if (!value.trim()) {
        setSearchQuery('', conversation);
        return;
      }

      debounceRef.current = setTimeout(() => {
        setSearchQuery(value, conversation);
      }, SEARCH_DEBOUNCE_MS);
    },
    [conversation, setSearchQuery]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  // Auto-focus input when search becomes visible
  useEffect(() => {
    if (searchVisible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [searchVisible]);

  // Handle keyboard shortcuts within search bar
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      hideSearch();
    } else if (e.key === 'Enter') {
      // Flush any pending debounce immediately on Enter
      clearTimeout(debounceRef.current);
      if (localQuery !== searchQuery) {
        setSearchQuery(localQuery, conversation);
      }
      if (e.shiftKey) {
        previousSearchResult();
      } else {
        nextSearchResult();
      }
    }
  };

  if (!searchVisible) {
    return null;
  }

  const resultLabel = searchResultsCapped
    ? `${currentSearchIndex + 1} of ${searchResultCount}+`
    : `${currentSearchIndex + 1} of ${searchResultCount}`;

  return (
    <div className="absolute right-4 top-2 z-20 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      {/* Search input */}
      <input
        ref={inputRef}
        type="text"
        value={localQuery}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in conversation..."
        className="w-48 rounded border border-border bg-surface-raised px-3 py-1.5 text-sm text-text focus:border-text-secondary focus:outline-none"
      />

      {/* Result count */}
      {searchQuery && (
        <span className="whitespace-nowrap text-xs text-text-secondary">
          {searchResultCount > 0 ? resultLabel : 'No results'}
        </span>
      )}

      {/* Navigation buttons */}
      <div className="flex gap-0.5">
        <button
          onClick={previousSearchResult}
          disabled={searchResultCount === 0}
          className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
          title="Previous result (Shift+Enter)"
        >
          <ChevronUp className="size-4" />
        </button>
        <button
          onClick={nextSearchResult}
          disabled={searchResultCount === 0}
          className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-30"
          title="Next result (Enter)"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      {/* Close button */}
      <button
        onClick={hideSearch}
        className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text"
        title="Close (Esc)"
      >
        <X className="size-4" />
      </button>
    </div>
  );
};
