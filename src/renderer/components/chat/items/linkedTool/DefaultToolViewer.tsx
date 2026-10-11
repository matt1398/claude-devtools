/**
 * DefaultToolViewer
 *
 * Default rendering for tools that don't have specialized viewers.
 */

import React from 'react';

import { useExportSelection } from '@renderer/contexts/ExportSelectionContext';

import { type ItemStatus } from '../BaseItem';

import { CollapsibleOutputSection } from './CollapsibleOutputSection';
import { renderInput, renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface DefaultToolViewerProps {
  linkedTool: LinkedToolItem;
  status: ItemStatus;
  exportId?: string;
}

export const DefaultToolViewer: React.FC<DefaultToolViewerProps> = ({
  linkedTool,
  status,
  exportId,
}) => {
  const { isActive, getToolFields, toggleToolItemField } = useExportSelection();
  const showCheckbox = isActive && Boolean(exportId);
  const inputChecked = exportId ? getToolFields(exportId).has('input') : true;

  return (
    <>
      {/* Input Section */}
      <div>
        <div className="mb-1 flex items-center gap-1.5">
          <span className="text-xs" style={{ color: 'var(--tool-item-muted)' }}>
            Input
          </span>
          {showCheckbox && (
            <input
              type="checkbox"
              checked={inputChecked}
              onChange={() => toggleToolItemField(exportId!, 'input')}
              title="Include input in copy"
              aria-label="Include input in copy"
              className="cursor-pointer accent-indigo-500"
            />
          )}
        </div>
        <div
          className="max-h-96 overflow-auto rounded p-3 font-mono text-xs"
          style={{
            backgroundColor: 'var(--code-bg)',
            border: '1px solid var(--code-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {renderInput(linkedTool.name, linkedTool.input)}
        </div>
      </div>

      {/* Output Section — Collapsed by default */}
      {!linkedTool.isOrphaned && linkedTool.result && (
        <CollapsibleOutputSection status={status} exportId={exportId}>
          {renderOutput(linkedTool.result.content)}
        </CollapsibleOutputSection>
      )}
    </>
  );
};
