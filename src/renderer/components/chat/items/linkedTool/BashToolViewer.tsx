/**
 * BashToolViewer
 *
 * Renders Bash tool calls with a clean command display with copy button,
 * and collapsible output section.
 */

import React from 'react';

import { CopyButton } from '@renderer/components/common/CopyButton';
import { COLOR_TEXT, COLOR_TEXT_MUTED } from '@renderer/constants/cssVariables';

import { type ItemStatus } from '../BaseItem';

import { CollapsibleOutputSection } from './CollapsibleOutputSection';
import { extractOutputText, renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface BashToolViewerProps {
  linkedTool: LinkedToolItem;
  status: ItemStatus;
}

export const BashToolViewer: React.FC<BashToolViewerProps> = ({ linkedTool, status }) => {
  const command = (linkedTool.input.command as string) || '';
  const description = linkedTool.input.description as string | undefined;

  // Extract output text for copy button
  const outputText =
    !linkedTool.isOrphaned && linkedTool.result
      ? extractOutputText(linkedTool.result.content)
      : '';

  return (
    <>
      {/* Input Section — Command with copy button */}
      <div>
        <div className="mb-1 text-xs" style={{ color: 'var(--tool-item-muted)' }}>
          Input
        </div>
        <div
          className="group relative max-h-96 overflow-auto rounded p-3 font-mono text-xs"
          style={{
            backgroundColor: 'var(--code-bg)',
            border: '1px solid var(--code-border)',
          }}
        >
          {description && (
            <div className="mb-2 text-xs" style={{ color: COLOR_TEXT_MUTED }}>
              {description}
            </div>
          )}
          <code className="whitespace-pre-wrap break-all" style={{ color: COLOR_TEXT }}>
            {command}
          </code>
          <CopyButton text={command} />
        </div>
      </div>

      {/* Output Section — Collapsible with copy button */}
      {!linkedTool.isOrphaned && linkedTool.result && (
        <CollapsibleOutputSection status={status} copyText={outputText}>
          {renderOutput(linkedTool.result.content)}
        </CollapsibleOutputSection>
      )}
    </>
  );
};
