/**
 * BashToolViewer
 *
 * Renders Bash tool calls with syntax-highlighted command input
 * via CodeBlockViewer and collapsible output section.
 */

import React from 'react';

import { CodeBlockViewer } from '@renderer/components/chat/viewers';

import { type ItemStatus } from '../BaseItem';

import { CollapsibleOutputSection } from './CollapsibleOutputSection';
import { renderOutput } from './renderHelpers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface BashToolViewerProps {
  linkedTool: LinkedToolItem;
  status: ItemStatus;
}

export const BashToolViewer: React.FC<BashToolViewerProps> = ({ linkedTool, status }) => {
  const command = linkedTool.input.command as string;
  const description = linkedTool.input.description as string | undefined;

  // Use the description (truncated) as the file name label, or fallback to "bash"
  const fileName = description
    ? description.length > 60
      ? description.slice(0, 57) + '...'
      : description
    : 'bash';

  return (
    <>
      {/* Input Section — Syntax-highlighted command */}
      <CodeBlockViewer
        fileName={fileName}
        content={command}
        language="bash"
      />

      {/* Output Section — Collapsible */}
      {!linkedTool.isOrphaned && linkedTool.result && (
        <CollapsibleOutputSection status={status}>
          {renderOutput(linkedTool.result.content)}
        </CollapsibleOutputSection>
      )}
    </>
  );
};
