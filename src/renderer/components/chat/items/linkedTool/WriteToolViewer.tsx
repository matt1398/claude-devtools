/**
 * WriteToolViewer
 *
 * Renders the Write tool result.
 */

import React from 'react';

import { CodeBlockViewer, MarkdownViewer } from '@renderer/components/chat/viewers';

import type { LinkedToolItem } from '@renderer/types/groups';

interface WriteToolViewerProps {
  linkedTool: LinkedToolItem;
}

export const WriteToolViewer: React.FC<WriteToolViewerProps> = ({ linkedTool }) => {
  const toolUseResult = linkedTool.result?.toolUseResult as Record<string, unknown> | undefined;

  const filePath = (toolUseResult?.filePath as string) || (linkedTool.input.file_path as string);
  const content = (toolUseResult?.content as string) || (linkedTool.input.content as string) || '';
  const isCreate = toolUseResult?.type === 'create';
  const isMarkdownFile = /\.mdx?$/i.test(filePath);
  const [viewMode, setViewMode] = React.useState<'code' | 'preview'>('code');

  return (
    <div className="space-y-2">
      <div className="mb-1 text-xs text-zinc-500">
        {isCreate ? 'Created file' : 'Wrote to file'}
      </div>
      {isMarkdownFile && (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setViewMode('code')}
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
        <CodeBlockViewer fileName={filePath} content={content} startLine={1} />
      )}
    </div>
  );
};
