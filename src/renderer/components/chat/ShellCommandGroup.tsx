import React, { useState } from 'react';

import { format } from 'date-fns';
import { ChevronDown, ChevronRight, TerminalSquare } from 'lucide-react';

import type { ShellGroup } from '@renderer/types/groups';

// Module-level constant - safe because .replace() resets lastIndex on g-flagged regexes
const ANSI_ESCAPE_REGEX = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

/**
 * Output longer than this (chars) starts COLLAPSED so a long command dump does
 * not flood the transcript. Short output renders expanded.
 */
const COLLAPSE_THRESHOLD = 400;

interface ShellCommandGroupProps {
  readonly shellGroup: ShellGroup;
}

const stripAnsi = (text: string): string => text.replace(ANSI_ESCAPE_REGEX, '');

/**
 * ShellCommandGroup renders an interactive `!` shell command and its captured
 * output as a terminal-style block — a `$` prompt + the command in monospace,
 * with stdout/stderr below in a muted, collapsible/scrollable code block.
 *
 * This is NOT a "You" bubble and is not attributed to the user — `!` commands
 * are shell invocations, not chat messages.
 *
 * Theme-aware via CSS variables (terminal surface in light/dark).
 */
const ShellCommandGroupInner = ({
  shellGroup,
}: ShellCommandGroupProps): React.JSX.Element => {
  const { command, stdout, stderr, timestamp } = shellGroup;

  const cleanStdout = stripAnsi(stdout);
  const cleanStderr = stripAnsi(stderr);
  const hasOutput = cleanStdout.length > 0 || cleanStderr.length > 0;
  const totalOutputLength = cleanStdout.length + cleanStderr.length;

  // Long output starts collapsed; short output starts expanded.
  const [isExpanded, setIsExpanded] = useState(totalOutputLength <= COLLAPSE_THRESHOLD);

  return (
    <div className="flex justify-start">
      <div
        className="w-full max-w-[85%] overflow-hidden rounded-lg"
        style={{
          backgroundColor: 'var(--code-bg)',
          border: '1px solid var(--code-border)',
        }}
      >
        {/* Command row */}
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: hasOutput ? '1px solid var(--code-border)' : undefined }}
        >
          <TerminalSquare
            className="size-4 shrink-0"
            style={{ color: 'var(--color-text-muted)' }}
            aria-hidden="true"
          />
          <span
            className="shrink-0 select-none font-mono text-sm"
            style={{ color: 'var(--color-text-muted)' }}
            aria-hidden="true"
          >
            $
          </span>
          <span
            className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-sm"
            style={{ color: 'var(--color-text)' }}
          >
            {command}
          </span>
          <span
            className="shrink-0 font-mono text-xs tabular-nums"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {format(timestamp, 'h:mm:ss a')}
          </span>
        </div>

        {/* Output (collapsible) */}
        {hasOutput && (
          <div>
            <button
              onClick={() => setIsExpanded((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs transition-colors hover:bg-[var(--color-surface-overlay)]"
              style={{ color: 'var(--color-text-muted)' }}
              aria-expanded={isExpanded}
            >
              {isExpanded ? (
                <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              <span>{isExpanded ? 'Hide output' : 'Show output'}</span>
            </button>

            {isExpanded && (
              <div className="max-h-96 overflow-auto px-3 pb-3">
                {cleanStdout.length > 0 && (
                  <pre
                    className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
                    style={{ color: 'var(--color-text-secondary)' }}
                  >
                    {cleanStdout}
                  </pre>
                )}
                {cleanStderr.length > 0 && (
                  <pre
                    className="mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed"
                    style={{ color: 'var(--badge-error-text, #ef4444)' }}
                  >
                    {cleanStderr}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const ShellCommandGroup = React.memo(ShellCommandGroupInner);
