/**
 * ReadToolViewer
 *
 * Renders the Read tool result using CodeBlockViewer.
 */

import React from 'react';

import { CodeBlockViewer, MarkdownViewer } from '@renderer/components/chat/viewers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface ReadToolViewerProps {
  linkedTool: LinkedToolItem;
}

export const ReadToolViewer: React.FC<ReadToolViewerProps> = ({ linkedTool }) => {
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

  const isMarkdownFile = /\.mdx?$/i.test(filePath);
  const [viewMode, setViewMode] = React.useState<'code' | 'preview'>('code');

  React.useEffect(() => {
    setViewMode(isMarkdownFile ? 'preview' : 'code');
  }, [isMarkdownFile]);

  return (
    <div className="space-y-2">
      {isMarkdownFile && (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setViewMode('code')}
            aria-pressed={viewMode === 'code'}
            className="rounded px-2 py-1 text-xs transition-colors"
            style={{
              backgroundColor: viewMode === 'code' ? 'var(--tag-bg)' : 'transparent',
              color: viewMode === 'code' ? 'var(--tag-text)' : 'var(--color-text-muted)',
              border: '1px solid var(--tag-border)',
            }}
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => setViewMode('preview')}
            aria-pressed={viewMode === 'preview'}
            className="rounded px-2 py-1 text-xs transition-colors"
            style={{
              backgroundColor: viewMode === 'preview' ? 'var(--tag-bg)' : 'transparent',
              color: viewMode === 'preview' ? 'var(--tag-text)' : 'var(--color-text-muted)',
              border: '1px solid var(--tag-border)',
            }}
          >
            Preview
          </button>
        </div>
      )}
      {isMarkdownFile && viewMode === 'preview' ? (
        <MarkdownViewer content={content} label="Markdown Preview" copyable />
      ) : (
        <CodeBlockViewer
          fileName={filePath}
          content={content}
          startLine={startLine}
          endLine={endLine}
        />
      )}
    </div>
  );
};
