/**
 * ToolErrorDisplay
 *
 * Displays error output for tool results.
 */

import React from 'react';

import { StatusDot } from '../BaseItem';

import { renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface ToolErrorDisplayProps {
  linkedTool: LinkedToolItem;
}

export const ToolErrorDisplay: React.FC<ToolErrorDisplayProps> = React.memo(({ linkedTool }) => {
  if (!linkedTool.result?.isError) return null;

  return (
    <div>
      <div
        className="mb-1 flex items-center gap-2 text-xs"
        style={{ color: 'var(--tool-item-muted)' }}
      >
        Error
        <StatusDot status="error" />
      </div>
      <div
        className="max-h-96 overflow-auto rounded p-3 font-mono text-xs"
        style={{
          backgroundColor: 'var(--code-bg)',
          border: '1px solid var(--code-border)',
          color: 'var(--tool-result-error-text)',
        }}
      >
        {renderOutput(linkedTool.result.content)}
      </div>
    </div>
  );
});
