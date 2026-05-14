/**
 * EditToolViewer
 *
 * Renders the Edit tool with DiffViewer.
 */

import React from 'react';

import { DiffViewer } from '@renderer/components/chat/viewers';
import { useExportSelection } from '@renderer/contexts/ExportSelectionContext';

import { type ItemStatus, StatusDot } from '../BaseItem';
import { formatTokens } from '../baseItemHelpers';

import { renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface EditToolViewerProps {
  linkedTool: LinkedToolItem;
  status: ItemStatus;
  exportId?: string;
}

export const EditToolViewer: React.FC<EditToolViewerProps> = ({ linkedTool, status, exportId }) => {
  const { isActive, getToolFields, toggleToolItemField } = useExportSelection();
  const showCheckbox = isActive && Boolean(exportId);
  const inputChecked = exportId ? getToolFields(exportId).has('input') : true;
  const outputChecked = exportId ? getToolFields(exportId).has('output') : true;

  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;

  const filePath = (toolUseResult?.filePath as string) || (linkedTool.input.file_path as string);
  const oldString =
    (toolUseResult?.oldString as string) || (linkedTool.input.old_string as string) || '';
  const newString =
    (toolUseResult?.newString as string) || (linkedTool.input.new_string as string) || '';

  return (
    <div className="space-y-3">
      {/* Input: the diff */}
      <div>
        {showCheckbox && (
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--tool-item-muted)' }}>
              Diff
            </span>
            <input
              type="checkbox"
              checked={inputChecked}
              onChange={() => toggleToolItemField(exportId!, 'input')}
              title="Include diff in copy"
              className="cursor-pointer accent-indigo-500"
            />
          </div>
        )}
        <DiffViewer
          fileName={filePath}
          oldString={oldString}
          newString={newString}
          tokenCount={linkedTool.callTokens}
        />
      </div>

      {/* Output: result status */}
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
            {showCheckbox && (
              <input
                type="checkbox"
                checked={outputChecked}
                onChange={() => toggleToolItemField(exportId!, 'output')}
                title="Include result in copy"
                className="cursor-pointer accent-indigo-500"
              />
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
};
