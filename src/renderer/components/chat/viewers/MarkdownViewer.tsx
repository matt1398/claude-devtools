import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';

import { api } from '@renderer/api';
import { CopyButton } from '@renderer/components/common/CopyButton';
import {
  CODE_BG,
  CODE_BORDER,
  CODE_HEADER_BG,
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_SECONDARY,
  PROSE_BLOCKQUOTE_BORDER,
  PROSE_BODY,
  PROSE_CODE_BG,
  PROSE_CODE_TEXT,
  PROSE_HEADING,
  PROSE_LINK,
  PROSE_MUTED,
  PROSE_PRE_BG,
  PROSE_PRE_BORDER,
  PROSE_TABLE_BORDER,
  PROSE_TABLE_HEADER_BG,
} from '@renderer/constants/cssVariables';
import { useStore } from '@renderer/store';
import { FileText } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import { useShallow } from 'zustand/react/shallow';

import {
  createSearchContext,
  EMPTY_SEARCH_MATCHES,
  highlightSearchInChildren,
  type SearchContext,
} from '../searchHighlightUtils';
import { MermaidViewer } from '../viewers/MermaidViewer';
import { highlightLine } from '../viewers/syntaxHighlighter';

// =============================================================================
// Types
// =============================================================================

interface MarkdownViewerProps {
  content: string;
  maxHeight?: string; // e.g., "max-h-64" or "max-h-96"
  className?: string;
  label?: string; // Optional label like "Thinking", "Output", etc.
  /** When provided, enables search term highlighting within the markdown */
  itemId?: string;
  /** When true, shows a copy button (overlay when no label, inline in header when label exists) */
  copyable?: boolean;
}

// =============================================================================
// Component factories
// =============================================================================

function createViewerMarkdownComponents(searchCtx: SearchContext | null): Components {
  const hl = (children: React.ReactNode): React.ReactNode =>
    searchCtx ? highlightSearchInChildren(children, searchCtx) : children;

  return {
    // Headings
    h1: ({ children }) => (
      <h1 className="mb-2 mt-4 text-xl font-semibold first:mt-0" style={{ color: PROSE_HEADING }}>
        {hl(children)}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-4 text-lg font-semibold first:mt-0" style={{ color: PROSE_HEADING }}>
        {hl(children)}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0" style={{ color: PROSE_HEADING }}>
        {hl(children)}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0" style={{ color: PROSE_HEADING }}>
        {hl(children)}
      </h4>
    ),
    h5: ({ children }) => (
      <h5 className="mb-1 mt-2 text-sm font-medium first:mt-0" style={{ color: PROSE_HEADING }}>
        {hl(children)}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="mb-1 mt-2 text-xs font-medium first:mt-0" style={{ color: PROSE_HEADING }}>
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
        className="cursor-pointer no-underline hover:underline"
        style={{ color: PROSE_LINK }}
        onClick={(e) => {
          e.preventDefault();
          if (href) {
            void api.openExternal(href);
          }
        }}
      >
        {children}
      </a>
    ),

    // Strong/Bold — inline element, no hl()
    strong: ({ children }) => (
      <strong className="font-semibold" style={{ color: PROSE_HEADING }}>
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

    // Code: inline vs block detection
    code: (props) => {
      const {
        className: codeClassName,
        children,
        node,
      } = props as {
        className?: string;
        children?: React.ReactNode;
        node?: { position?: { start: { line: number }; end: { line: number } } };
      };
      const hasLanguage = codeClassName?.includes('language-');
      const isMultiLine =
        (node?.position && node.position.end.line > node.position.start.line) ?? false;
      const isBlock = (hasLanguage ?? false) || isMultiLine;

      if (isBlock) {
        const lang = codeClassName?.replace('language-', '') ?? '';
        const raw = typeof children === 'string' ? children : '';
        const text = raw.replace(/\n$/, '');

        if (lang === 'mermaid') {
          return <MermaidViewer code={text} />;
        }

        const lines = text.split('\n');
        return (
          <code className="font-mono text-xs" style={{ color: COLOR_TEXT }}>
            {lines.map((line, i) => (
              <React.Fragment key={i}>
                {hl(highlightLine(line, lang))}
                {i < lines.length - 1 ? '\n' : null}
              </React.Fragment>
            ))}
          </code>
        );
      }
      // Inline code — no hl(); parent block element's hl() descends here
      return (
        <code
          className="rounded px-1.5 py-0.5 font-mono text-xs"
          style={{
            backgroundColor: PROSE_CODE_BG,
            color: PROSE_CODE_TEXT,
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
          className="my-3 overflow-x-auto rounded-lg p-3 text-xs leading-relaxed"
          style={{
            backgroundColor: PROSE_PRE_BG,
            border: `1px solid ${PROSE_PRE_BORDER}`,
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
          borderColor: PROSE_BLOCKQUOTE_BORDER,
          color: PROSE_MUTED,
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
          style={{ borderColor: PROSE_TABLE_BORDER }}
        >
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead style={{ backgroundColor: PROSE_TABLE_HEADER_BG }}>{children}</thead>
    ),
    th: ({ children }) => (
      <th
        className="px-3 py-2 text-left font-semibold"
        style={{
          border: `1px solid ${PROSE_TABLE_BORDER}`,
          color: PROSE_HEADING,
        }}
      >
        {hl(children)}
      </th>
    ),
    td: ({ children }) => (
      <td
        className="px-3 py-2"
        style={{
          border: `1px solid ${PROSE_TABLE_BORDER}`,
          color: PROSE_BODY,
        }}
      >
        {hl(children)}
      </td>
    ),

    // Horizontal rule
    hr: () => <hr className="my-4" style={{ borderColor: PROSE_TABLE_BORDER }} />,
  };
}

/** Default components without search highlighting */
const defaultComponents = createViewerMarkdownComponents(null);

// =============================================================================
// Component
// =============================================================================

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  maxHeight = 'max-h-96',
  className = '',
  label,
  itemId,
  copyable = false,
}) => {
  // Only re-render if THIS item has search matches
  const { searchQuery, searchMatches, currentSearchIndex } = useStore(
    useShallow((s) => {
      const hasMatch = itemId ? s.searchMatchItemIds.has(itemId) : false;
      return {
        searchQuery: hasMatch ? s.searchQuery : '',
        searchMatches: hasMatch ? s.searchMatches : EMPTY_SEARCH_MATCHES,
        currentSearchIndex: hasMatch ? s.currentSearchIndex : -1,
      };
    })
  );

  // Create search context (fresh each render so counter starts at 0)
  const searchCtx =
    searchQuery && itemId
      ? createSearchContext(searchQuery, itemId, searchMatches, currentSearchIndex)
      : null;

  // Create markdown components with optional search highlighting
  // When search is active, create fresh each render (match counter is stateful and must start at 0)
  // useMemo would cache stale closures when parent re-renders without search deps changing
  const components = searchCtx ? createViewerMarkdownComponents(searchCtx) : defaultComponents;

  return (
    <div
      className={`overflow-hidden rounded-lg shadow-sm ${copyable && !label ? 'group relative' : ''} ${className}`}
      style={{
        backgroundColor: CODE_BG,
        border: `1px solid ${CODE_BORDER}`,
      }}
    >
      {/* Copy button overlay (when no label header) */}
      {copyable && !label && <CopyButton text={content} />}

      {/* Optional header - matches CodeBlockViewer style */}
      {label && (
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{
            backgroundColor: CODE_HEADER_BG,
            borderBottom: `1px solid ${CODE_BORDER}`,
          }}
        >
          <FileText className="size-4 shrink-0" style={{ color: COLOR_TEXT_MUTED }} />
          <span className="text-sm font-medium" style={{ color: COLOR_TEXT_SECONDARY }}>
            {label}
          </span>
          {copyable && (
            <>
              <span className="flex-1" />
              <CopyButton text={content} inline />
            </>
          )}
        </div>
      )}

      {/* Markdown content with scroll */}
      <div className={`overflow-auto ${maxHeight}`}>
        <div className="p-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};
