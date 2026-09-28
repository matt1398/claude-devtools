/**
 * ScratchpadView — full-pane view of a session's Claude Code scratchpad directory.
 *
 * Layout: master/detail.
 *   Left:  lazily-expanded file tree (one directory level fetched at a time)
 *   Right: the selected file — syntax-highlighted text, markdown preview,
 *          inline image, or a stub for binaries.
 *
 * While the tab is visible, expanded directories are re-listed on an interval
 * so files a live session writes show up without a manual refresh.
 */

import { useCallback, useEffect, useState } from 'react';

import { api, isElectronMode } from '@renderer/api';
import { CodeBlockViewer, MarkdownViewer } from '@renderer/components/chat/viewers';
import { formatDistanceToNow } from 'date-fns';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileImage,
  Folder,
  FolderOpen,
  RefreshCw,
} from 'lucide-react';

import { splitFrontmatter } from '../memory/frontmatter';
import { FrontmatterCard } from '../memory/FrontmatterCard';

import type {
  ScratchpadEntry,
  ScratchpadFileContent,
  ScratchpadReadFileResult,
} from '@shared/types';

interface ScratchpadViewProps {
  projectId: string;
  sessionId: string;
  isActive: boolean;
}

interface DirListing {
  entries: ScratchpadEntry[];
  truncated: boolean;
  signature: string;
}

interface LoadedFile {
  relativePath: string;
  result: ScratchpadReadFileResult;
}

const ROOT_DIR = '';
const POLL_INTERVAL_MS = 3000;
const TREE_DEFAULT_WIDTH = 288;
const TREE_MIN_WIDTH = 180;
const TREE_MAX_WIDTH = 720;
const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i;
const MARKDOWN_EXTENSION_RE = /\.mdx?$/i;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function parentDir(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  return slash === -1 ? ROOT_DIR : relativePath.slice(0, slash);
}

function listingSignature(entries: ScratchpadEntry[]): string {
  return entries.map((e) => `${e.name}|${e.isDirectory ? 'd' : e.size}|${e.mtimeMs}`).join('\n');
}

function fileStamp(file: ScratchpadFileContent): string {
  return `${file.size}|${file.mtimeMs}`;
}

function resultKey(result: ScratchpadReadFileResult): string {
  return result.success ? `ok|${fileStamp(result.file)}` : `error|${result.error}`;
}

export const ScratchpadView = ({
  projectId,
  sessionId,
  isActive,
}: ScratchpadViewProps): React.JSX.Element => {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [exists, setExists] = useState<boolean | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [listings, setListings] = useState<Record<string, DirListing | undefined>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'code'>('preview');
  const [refreshing, setRefreshing] = useState(false);
  const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);
  const [resizeOrigin, setResizeOrigin] = useState<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (!resizeOrigin) return;
    const handleMouseMove = (e: MouseEvent): void => {
      const next = resizeOrigin.width + e.clientX - resizeOrigin.x;
      setTreeWidth(Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, next)));
    };
    const handleMouseUp = (): void => setResizeOrigin(null);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return (): void => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizeOrigin]);

  const loadDir = useCallback(
    async (relativeDir: string): Promise<void> => {
      const result = await api.scratchpad.list(projectId, sessionId, relativeDir);
      if (!result.success) {
        if (relativeDir === ROOT_DIR) {
          setError(result.error);
          setExists(false);
        } else {
          setExpanded((prev) => prev.filter((dir) => dir !== relativeDir));
          setListings((prev) => ({ ...prev, [relativeDir]: undefined }));
        }
        return;
      }
      if (relativeDir === ROOT_DIR) {
        setError(null);
        setRootPath(result.rootPath);
        setExists(result.exists);
      }
      const signature = listingSignature(result.entries);
      setListings((prev) =>
        prev[relativeDir]?.signature === signature
          ? prev
          : {
              ...prev,
              [relativeDir]: { entries: result.entries, truncated: result.truncated, signature },
            }
      );
    },
    [projectId, sessionId]
  );

  const loadFile = useCallback(
    async (relativePath: string): Promise<void> => {
      const result = await api.scratchpad.readFile(projectId, sessionId, relativePath);
      setLoadedFile((prev) =>
        prev?.relativePath === relativePath && resultKey(prev.result) === resultKey(result)
          ? prev
          : { relativePath, result }
      );
    },
    [projectId, sessionId]
  );

  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([ROOT_DIR, ...expanded].map((dir) => loadDir(dir)));
  }, [expanded, loadDir]);

  useEffect(() => {
    void loadDir(ROOT_DIR);
  }, [loadDir]);

  useEffect(() => {
    if (!isActive || !exists) return;
    const timer = setInterval(() => {
      void refreshAll();
    }, POLL_INTERVAL_MS);
    return (): void => clearInterval(timer);
  }, [isActive, exists, refreshAll]);

  useEffect(() => {
    if (!selectedPath || loadedFile?.relativePath !== selectedPath) return;
    const siblings = listings[parentDir(selectedPath)];
    if (!siblings) return;
    const entry = siblings.entries.find((e) => e.relativePath === selectedPath);
    const current = loadedFile.result.success ? fileStamp(loadedFile.result.file) : null;
    if (!entry || current !== `${entry.size}|${entry.mtimeMs}`) {
      void loadFile(selectedPath);
    }
  }, [listings, selectedPath, loadedFile, loadFile]);

  const handleRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await refreshAll();
      if (selectedPath) await loadFile(selectedPath);
    } finally {
      setRefreshing(false);
    }
  }, [refreshAll, loadFile, selectedPath]);

  const toggleDir = useCallback(
    (relativeDir: string): void => {
      if (expanded.includes(relativeDir)) {
        setExpanded((prev) => prev.filter((dir) => dir !== relativeDir));
        return;
      }
      setExpanded((prev) => [...prev, relativeDir]);
      if (!listings[relativeDir]) void loadDir(relativeDir);
    },
    [expanded, listings, loadDir]
  );

  const selectFile = useCallback(
    (relativePath: string): void => {
      setSelectedPath(relativePath);
      setMarkdownMode('preview');
      void loadFile(relativePath);
    },
    [loadFile]
  );

  const openInFileManager = useCallback(
    (relativePath: string): void => {
      void api.scratchpad.openPath(projectId, sessionId, relativePath);
    },
    [projectId, sessionId]
  );

  const fileCount = listings[ROOT_DIR]?.entries.length ?? 0;

  const renderEntries = (relativeDir: string, depth: number): React.JSX.Element => {
    const listing = listings[relativeDir];
    if (!listing) {
      return (
        <div className="py-1 text-[11px] text-text-muted" style={{ paddingLeft: 12 + depth * 14 }}>
          Loading…
        </div>
      );
    }
    if (listing.entries.length === 0) {
      return (
        <div className="py-1 text-[11px] text-text-muted" style={{ paddingLeft: 12 + depth * 14 }}>
          Empty
        </div>
      );
    }
    return (
      <>
        {listing.entries.map((entry) => {
          const isOpen = entry.isDirectory && expanded.includes(entry.relativePath);
          const isSelected = !entry.isDirectory && entry.relativePath === selectedPath;
          const Icon = entry.isDirectory
            ? isOpen
              ? FolderOpen
              : Folder
            : IMAGE_EXTENSION_RE.test(entry.name)
              ? FileImage
              : File;
          const Chevron = isOpen ? ChevronDown : ChevronRight;
          return (
            <div key={entry.relativePath}>
              <button
                type="button"
                onClick={(): void =>
                  entry.isDirectory ? toggleDir(entry.relativePath) : selectFile(entry.relativePath)
                }
                title={entry.relativePath}
                className="flex w-full items-center gap-1.5 py-1 pr-3 text-left text-xs hover:bg-surface-raised"
                style={{
                  paddingLeft: 8 + depth * 14,
                  backgroundColor: isSelected ? 'var(--color-surface-raised)' : undefined,
                  color: isSelected ? 'var(--color-text)' : 'var(--color-text-secondary)',
                }}
              >
                {entry.isDirectory ? (
                  <Chevron className="size-3 shrink-0 text-text-muted" />
                ) : (
                  <span className="size-3 shrink-0" />
                )}
                <Icon className="size-3.5 shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {!entry.isDirectory && (
                  <span className="shrink-0 text-[10px] text-text-muted">
                    {formatBytes(entry.size)}
                  </span>
                )}
              </button>
              {isOpen && renderEntries(entry.relativePath, depth + 1)}
            </div>
          );
        })}
        {listing.truncated && (
          <div
            className="py-1 text-[11px] text-text-muted"
            style={{ paddingLeft: 12 + depth * 14 }}
          >
            Showing the first {listing.entries.length} entries
          </div>
        )}
      </>
    );
  };

  if (exists === undefined) {
    return <div className="flex flex-1 items-center justify-center text-text-muted">Loading…</div>;
  }

  if (!exists) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-text-muted">
        <div>{error ?? 'This session has no scratchpad directory.'}</div>
        {rootPath && <code className="text-[11px]">{rootPath}</code>}
      </div>
    );
  }

  const selectedFile =
    selectedPath !== null && loadedFile?.relativePath === selectedPath ? loadedFile.result : null;
  const canOpenInFileManager = isElectronMode();

  return (
    <div className="flex flex-1 overflow-hidden">
      <div
        className="relative flex shrink-0 flex-col border-r"
        style={{
          backgroundColor: 'var(--color-surface-sidebar)',
          borderColor: 'var(--color-border)',
          width: `${treeWidth}px`,
        }}
      >
        <div className="flex items-center gap-1 px-3 pb-1 pt-3">
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Scratchpad {fileCount > 0 && <span>({fileCount})</span>}
          </span>
          {canOpenInFileManager && (
            <button
              type="button"
              onClick={(): void => openInFileManager(ROOT_DIR)}
              className="rounded p-1 text-text-muted hover:bg-surface-raised hover:text-text"
              title="Open folder"
            >
              <FolderOpen className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={(): void => {
              void handleRefresh();
            }}
            className="rounded p-1 text-text-muted hover:bg-surface-raised hover:text-text"
            title="Refresh"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {rootPath && (
          <div
            className="truncate px-3 pb-2 font-mono text-[10px] text-text-muted"
            title={rootPath}
          >
            {rootPath}
          </div>
        )}
        <div className="flex-1 overflow-y-auto pb-2">{renderEntries(ROOT_DIR, 0)}</div>
        <button
          type="button"
          aria-label="Resize file tree"
          title="Drag to resize, double-click to reset"
          className={`absolute right-0 top-0 h-full w-1 cursor-col-resize border-0 bg-transparent p-0 transition-colors hover:bg-blue-500/50 ${
            resizeOrigin ? 'bg-blue-500/50' : ''
          }`}
          onMouseDown={(e): void => {
            e.preventDefault();
            setResizeOrigin({ x: e.clientX, width: treeWidth });
          }}
          onDoubleClick={(): void => setTreeWidth(TREE_DEFAULT_WIDTH)}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {selectedPath && (
          <div
            className="flex items-center gap-3 border-b px-4 py-2 text-xs"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <span className="min-w-0 flex-1 truncate font-mono text-text" title={selectedPath}>
              {selectedPath}
            </span>
            {selectedFile?.success && (
              <span className="shrink-0 text-text-muted">
                {formatBytes(selectedFile.file.size)} · modified{' '}
                {formatDistanceToNow(selectedFile.file.mtimeMs, { addSuffix: true })}
              </span>
            )}
            {selectedFile?.success &&
              selectedFile.file.kind === 'text' &&
              MARKDOWN_EXTENSION_RE.test(selectedPath) && (
                <div className="flex shrink-0 items-center gap-1">
                  {(['code', 'preview'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={(): void => setMarkdownMode(mode)}
                      className="rounded px-2 py-0.5 capitalize transition-colors"
                      style={{
                        backgroundColor: markdownMode === mode ? 'var(--tag-bg)' : 'transparent',
                        color:
                          markdownMode === mode ? 'var(--tag-text)' : 'var(--color-text-muted)',
                        border: '1px solid var(--tag-border)',
                      }}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              )}
            {canOpenInFileManager && (
              <button
                type="button"
                onClick={(): void => openInFileManager(selectedPath)}
                className="shrink-0 rounded-md border px-2 py-1 text-text hover:bg-surface-raised"
                style={{
                  backgroundColor: 'var(--color-surface-overlay)',
                  borderColor: 'var(--color-border-emphasis)',
                }}
              >
                Reveal in folder
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!selectedPath ? (
            <div className="text-text-muted">Select a file to view its content.</div>
          ) : !selectedFile ? (
            <div className="text-text-muted">Loading…</div>
          ) : !selectedFile.success ? (
            <div className="text-text-muted">Could not read this file: {selectedFile.error}</div>
          ) : (
            <ScratchpadFileBody
              relativePath={selectedPath}
              file={selectedFile.file}
              markdownMode={markdownMode}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const ScratchpadFileBody = ({
  relativePath,
  file,
  markdownMode,
}: {
  relativePath: string;
  file: ScratchpadFileContent;
  markdownMode: 'preview' | 'code';
}): React.JSX.Element => {
  if (file.kind === 'image') {
    return (
      <img
        src={file.dataUrl}
        alt={relativePath}
        className="max-w-full rounded border"
        style={{ borderColor: 'var(--color-border)' }}
      />
    );
  }

  if (file.kind === 'binary') {
    return (
      <div className="text-text-muted">
        Binary file ({formatBytes(file.size)}) — no preview available.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {file.truncated && (
        <div className="text-xs text-text-muted">
          Showing the first {formatBytes(file.content.length)} of {formatBytes(file.size)}.
        </div>
      )}
      {MARKDOWN_EXTENSION_RE.test(relativePath) && markdownMode === 'preview' ? (
        <MarkdownPreview content={file.content} />
      ) : (
        <CodeBlockViewer fileName={relativePath} content={file.content} maxHeight="max-h-none" />
      )}
    </div>
  );
};

const MarkdownPreview = ({ content }: { content: string }): React.JSX.Element => {
  const { frontmatter, body } = splitFrontmatter(content);
  const hasCardFields =
    frontmatter !== null &&
    (Boolean(frontmatter.name) ||
      Boolean(frontmatter.description) ||
      Object.keys(frontmatter.metadata).length > 0);
  const card = hasCardFields ? frontmatter : null;
  return (
    <>
      {card && <FrontmatterCard frontmatter={card} />}
      <MarkdownViewer content={card ? body : content} maxHeight="max-h-none" copyable />
    </>
  );
};
