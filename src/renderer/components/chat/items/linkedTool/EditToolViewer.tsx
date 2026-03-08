/**
 * EditToolViewer
 *
 * Renders the Edit tool with DiffViewer.
 */

import React from 'react';

import { DiffViewer } from '@renderer/components/chat/viewers';

import { type ItemStatus, StatusDot } from '../BaseItem';
import { formatTokens } from '../baseItemHelpers';

import { renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface EditToolViewerProps {
  linkedTool: LinkedToolItem;
  status: ItemStatus;
}

export const EditToolViewer: React.FC<EditToolViewerProps> = React.memo(({ linkedTool, status }) => {
  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;

  const filePath = (toolUseResult?.filePath as string) || (linkedTool.input.file_path as string);
  const oldString =
    (toolUseResult?.oldString as string) || (linkedTool.input.old_string as string) || '';
  const newString =
    (toolUseResult?.newString as string) || (linkedTool.input.new_string as string) || '';

  return (
    <div className="space-y-3">
      <DiffViewer
        fileName={filePath}
        oldString={oldString}
        newString={newString}
        tokenCount={linkedTool.callTokens}
      />

      {/* Show result status if available */}
      {!linkedTool.isOrphaned && linkedTool.result != null && (
        <div>
          <div
            className="mb-1 flex items-center gap-2 text-xs"
            style={{ color: 'var(--tool-item-muted)' }}
          >
            Result
            <StatusDot status={status} />
            {linkedTool.result?.tokenCount !== undefined && linkedTool.result.tokenCount > 0 && (
              <span style={{ color: 'var(--color-text-muted)' }}>
                ~{formatTokens(linkedTool.result.tokenCount)} tokens
              </span>
            )}
          </div>
          <div
            className="max-h-96 overflow-auto rounded p-3 font-mono text-xs"
            style={{
              backgroundColor: 'var(--code-bg)',
              border: '1px solid var(--code-border)',
              color:
                status === 'error'
                  ? 'var(--tool-result-error-text)'
                  : 'var(--color-text-secondary)',
            }}
          >
            {renderOutput(linkedTool.result.content)}
          </div>
        </div>
      )}
    </div>
  );
});
