/**
 * ToolBreakdownItem - Single tool breakdown item display.
 */

import React from 'react';

import { capitalize } from '@renderer/utils/stringUtils';

import { formatTokens } from '../utils/formatting';

import type { ToolTokenBreakdown } from '@renderer/types/contextInjection';

interface ToolBreakdownItemProps {
  tool: ToolTokenBreakdown;
}

export const ToolBreakdownItem = ({
  tool,
}: Readonly<ToolBreakdownItemProps>): React.ReactElement => {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span style={{ color: 'var(--color-text-muted)' }}>{capitalize(tool.toolName)}</span>
      <span style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
        ~{formatTokens(tool.tokenCount)}
      </span>
      {tool.isError && (
        <span
          className="rounded px-1 py-0.5"
          style={{
            backgroundColor: 'var(--color-error-subtle)',
            color: 'var(--color-error)',
            fontSize: '10px',
          }}
        >
          error
        </span>
      )}
    </div>
  );
};
