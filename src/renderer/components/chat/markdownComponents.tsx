import React from 'react';

import { PROSE_BODY } from '@renderer/constants/cssVariables';

import { MermaidViewer } from './viewers/MermaidViewer';
import { highlightSearchInChildren, type SearchContext } from './searchHighlightUtils';

import type { Components } from 'react-markdown';

/**
 * Create inline markdown components for rendering prose content.
 * When searchCtx is provided, search term highlighting is applied
 * to text nodes while preserving full markdown rendering.
 */
export function createMarkdownComponents(searchCtx: SearchContext | null): Components {
  const hl = (children: React.ReactNode): React.ReactNode =>
    searchCtx ? highlightSearchInChildren(children, searchCtx) : children;

  return {
    // Headings - Bold text with generous spacing to break up content
    h1: ({ children }) => (
      <h1
        className="mb-3 mt-6 text-lg font-semibold first:mt-0"
        style={{ color: 'var(--prose-heading)' }}
      >
        {hl(children)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className="mb-2 mt-5 text-base font-semibold first:mt-0"
        style={{ color: 'var(--prose-heading)' }}
      >
        {hl(children)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className="mb-2 mt-4 text-sm font-semibold first:mt-0"
        style={{ color: 'var(--prose-heading)' }}
      >
        {hl(children)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4
        className="mb-1.5 mt-3 text-sm font-semibold first:mt-0"
        style={{ color: 'var(--prose-heading)' }}
      >
        {hl(children)}
      </h4>
    ),
    h5: ({ children }) => (
      <h5
        className="mb-1 mt-2 text-sm font-medium first:mt-0"
        style={{ color: 'var(--prose-heading)' }}
      >
        {hl(children)}
      </h5>
    ),
    h6: ({ children }) => (
      <h6
        className="mb-1 mt-2 text-xs font-medium first:mt-0"
        style={{ color: 'var(--prose-heading)' }}
      >
        {hl(children)}
      </h6>
    ),

    // Paragraphs
    p: ({ children }) => (
      <p
        className="my-2 text-sm leading-relaxed first:mt-0 last:mb-0"
        style={{ color: PROSE_BODY }}
      >
        {hl(children)}
      </p>
    ),

    // Links — inline element, no hl(); parent block element's hl() descends here
    a: ({ href, children }) => (
      <a
        href={href}
        className="no-underline hover:underline"
        style={{ color: 'var(--prose-link)' }}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    // Strong/Bold — inline element, no hl()
    strong: ({ children }) => (
      <strong className="font-semibold" style={{ color: 'var(--prose-heading)' }}>
        {children}
      </strong>
    ),

    // Emphasis/Italic — inline element, no hl()
    em: ({ children }) => (
      <em className="italic" style={{ color: PROSE_BODY }}>
        {children}
      </em>
    ),

    // Strikethrough — inline element, no hl()
    del: ({ children }) => (
      <del className="line-through" style={{ color: PROSE_BODY }}>
        {children}
      </del>
    ),

    // Inline code vs block code
    code: ({ className, children }) => {
      const hasLanguageClass = className?.includes('language-');
      const content = typeof children === 'string' ? children : '';
      const isMultiLine = content.includes('\n');
      const isBlock = (hasLanguageClass ?? false) || isMultiLine;

      if (isBlock) {
        const lang = className?.replace('language-', '') ?? '';
        const text = content.replace(/\n$/, '');

        if (lang === 'mermaid') {
          return <MermaidViewer code={text} />;
        }

        return (
          <code className="block font-mono text-xs" style={{ color: 'var(--color-text)' }}>
            {hl(children)}
          </code>
        );
      }
      // Inline code — no hl(); parent block element's hl() descends here
      return (
        <code
          className="rounded px-1.5 py-0.5 font-mono text-xs"
          style={{
            backgroundColor: 'var(--prose-code-bg)',
            color: 'var(--prose-code-text)',
          }}
        >
          {children}
        </code>
      );
    },

    // Code blocks — skip <pre> wrapper for mermaid diagrams
    pre: ({ children }) => {
      const child = React.Children.only(children) as React.ReactElement;
      if (child?.type === MermaidViewer) {
        return children as React.ReactElement;
      }
      return (
        <pre
          className="my-3 overflow-x-auto rounded-lg p-3 font-mono text-xs leading-relaxed"
          style={{
            backgroundColor: 'var(--prose-pre-bg)',
            border: '1px solid var(--prose-pre-border)',
            color: 'var(--color-text)',
          }}
        >
          {children}
        </pre>
      );
    },

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote
        className="my-3 border-l-4 pl-4 italic"
        style={{
          borderColor: 'var(--prose-blockquote-border)',
          color: 'var(--prose-muted)',
        }}
      >
        {hl(children)}
      </blockquote>
    ),

    // Lists
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5" style={{ color: PROSE_BODY }}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5" style={{ color: PROSE_BODY }}>
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="text-sm" style={{ color: PROSE_BODY }}>
        {hl(children)}
      </li>
    ),

    // Tables
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table
          className="min-w-full border-collapse text-sm"
          style={{ borderColor: 'var(--prose-table-border)' }}
        >
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead style={{ backgroundColor: 'var(--prose-table-header-bg)' }}>{children}</thead>
    ),
    th: ({ children }) => (
      <th
        className="px-3 py-2 text-left font-semibold"
        style={{
          border: '1px solid var(--prose-table-border)',
          color: 'var(--prose-heading)',
        }}
      >
        {hl(children)}
      </th>
    ),
    td: ({ children }) => (
      <td
        className="px-3 py-2"
        style={{
          border: '1px solid var(--prose-table-border)',
          color: PROSE_BODY,
        }}
      >
        {hl(children)}
      </td>
    ),

    // Horizontal rule
    hr: () => <hr className="my-4" style={{ borderColor: 'var(--prose-table-border)' }} />,
  };
}

/** Default markdown components without search highlighting (used by CompactBoundary) */
export const markdownComponents: Components = createMarkdownComponents(null);
