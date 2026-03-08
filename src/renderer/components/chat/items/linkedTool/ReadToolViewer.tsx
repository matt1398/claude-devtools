/**
 * ReadToolViewer
 *
 * Renders the Read tool result using CodeBlockViewer.
 */

import React from 'react';

import { CodeBlockViewer } from '@renderer/components/chat/viewers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface ReadToolViewerProps {
  linkedTool: LinkedToolItem;
}

export const ReadToolViewer: React.FC<ReadToolViewerProps> = React.memo(({ linkedTool }) => {
  const filePath = linkedTool.input.file_path as string;

  // Prefer enriched toolUseResult data
  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;
  const fileData = toolUseResult?.file as
    | {
        content?: string;
        startLine?: number;
        totalLines?: number;
        numLines?: number;
      }
    | undefined;

  // Get content: prefer enriched file data, fall back to raw result content
  let content: string;
  if (fileData?.content) {
    content = fileData.content;
  } else {
    const resultContent = linkedTool.result?.content;
    content =
      typeof resultContent === 'string'
        ? resultContent
        : Array.isArray(resultContent)
          ? resultContent
              .map((item: unknown) => (typeof item === 'string' ? item : JSON.stringify(item)))
              .join('\n')
          : JSON.stringify(resultContent, null, 2);
  }

  // Get line range
  const startLine = fileData?.startLine ?? (linkedTool.input.offset as number | undefined) ?? 1;
  const numLinesRead = fileData?.numLines;
  const limit = linkedTool.input.limit as number | undefined;
  const endLine = numLinesRead
    ? startLine + numLinesRead - 1
    : limit
      ? startLine + limit - 1
      : undefined;

  return (
    <CodeBlockViewer
      fileName={filePath}
      content={content}
      startLine={startLine}
      endLine={endLine}
    />
  );
});
