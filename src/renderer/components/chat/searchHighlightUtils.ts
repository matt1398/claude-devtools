/**
 * Search highlighting utilities for use within ReactMarkdown components.
 * Recursively processes React children to highlight search term matches
 * while preserving the markdown-rendered element tree.
 */

import React from 'react';

import type { SearchMatch } from '@renderer/store/types';

/** Stable empty array for item-scoped search selectors (avoids re-renders) */
export const EMPTY_SEARCH_MATCHES: SearchMatch[] = [];

// Highlight styles matching SearchHighlight.tsx
const baseStyles: React.CSSProperties = {
  borderRadius: '0.125rem',
  padding: '0 0.125rem',
};

const currentHighlightStyles: React.CSSProperties = {
  ...baseStyles,
  backgroundColor: 'var(--highlight-bg)',
  color: 'var(--highlight-text)',
  boxShadow: '0 0 0 1px var(--highlight-ring)',
};

const inactiveHighlightStyles: React.CSSProperties = {
  ...baseStyles,
  backgroundColor: 'var(--highlight-bg-inactive)',
  color: 'var(--highlight-text-inactive)',
};

export interface SearchContext {
  itemId: string;
  query: string;
  lowerQuery: string;
  /** Mutable counter tracking match index within the item, incremented as text nodes are processed */
  matchCounter: { current: number };
  isCurrentItem: boolean;
  currentMatchIndexInItem: number | null;
}

/**
 * Create a SearchContext from store state.
 * Returns null if no search is active.
 */
export function createSearchContext(
  searchQuery: string,
  itemId: string,
  searchMatches: SearchMatch[],
  currentSearchIndex: number
): SearchContext | null {
  if (!searchQuery || searchQuery.trim().length === 0) return null;

  const currentMatch = currentSearchIndex >= 0 ? searchMatches[currentSearchIndex] : null;
  const isCurrentItem = currentMatch?.itemId === itemId;

  return {
    itemId,
    query: searchQuery,
    lowerQuery: searchQuery.toLowerCase(),
    matchCounter: { current: 0 },
    isCurrentItem,
    currentMatchIndexInItem: isCurrentItem ? (currentMatch?.matchIndexInItem ?? null) : null,
  };
}

/**
 * Highlight search term matches in a text string.
 * Increments matchCounter for each match found.
 */
// eslint-disable-next-line sonarjs/function-return-type -- mixed text/element return
function highlightSearchText(text: string, ctx: SearchContext): React.ReactNode {
  const lowerText = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let pos = 0;

  while ((pos = lowerText.indexOf(ctx.lowerQuery, pos)) !== -1) {
    if (pos > lastIndex) {
      parts.push(text.slice(lastIndex, pos));
    }

    const isCurrentResult =
      ctx.isCurrentItem && ctx.currentMatchIndexInItem === ctx.matchCounter.current;

    parts.push(
      React.createElement(
        'mark',
        {
          key: `s-${pos}-${ctx.matchCounter.current}`,
          style: isCurrentResult ? currentHighlightStyles : inactiveHighlightStyles,
          'data-search-result': isCurrentResult ? 'current' : 'match',
          'data-search-item-id': ctx.itemId,
          'data-search-match-index': ctx.matchCounter.current,
        },
        text.slice(pos, pos + ctx.query.length)
      )
    );

    lastIndex = pos + ctx.query.length;
    pos = lastIndex;
    ctx.matchCounter.current++;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (parts.length === 0) return text;
  if (parts.length === 1) return parts[0];
  return parts;
}

/**
 * Recursively process React children to highlight search terms in text nodes.
 * Preserves the React element tree structure (markdown components, etc.)
 * while adding <mark> tags to text content.
 */
// eslint-disable-next-line sonarjs/function-return-type -- React child manipulation inherently returns mixed node types
export function highlightSearchInChildren(
  children: React.ReactNode,
  ctx: SearchContext
): React.ReactNode {
  // eslint-disable-next-line sonarjs/function-return-type -- React child manipulation inherently returns mixed node types
  return React.Children.map(children, (child): React.ReactNode => {
    if (typeof child === 'string') {
      return highlightSearchText(child, ctx);
    }

    if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
      // Skip <mark> elements already created by search highlighting to prevent
      // double-counting when hl() is applied at multiple markdown component levels
      // (e.g., both the `strong` and `p` components process the same text)
      if (child.type === 'mark' && (child.props as Record<string, unknown>)['data-search-result']) {
        return child;
      }

      if (child.props.children) {
        return React.cloneElement(
          child,
          undefined,
          highlightSearchInChildren(child.props.children, ctx)
        );
      }
    }

    return child;
  });
}
