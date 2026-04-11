/**
 * LogicalProjectManager - Modal for creating, renaming, recoloring,
 * deleting logical projects and mapping the current cwd project folder
 * to a logical project.
 *
 * Outer component conditionally mounts the inner dialog so local form
 * state resets naturally when the modal closes.
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { useStore } from '@renderer/store';
import { ChevronDown, ChevronUp, FolderTree, Plus, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

const COLOR_PALETTE = [
  '#22c55e',
  '#3b82f6',
  '#a855f7',
  '#f59e0b',
  '#ef4444',
  '#14b8a6',
  '#ec4899',
  '#6366f1',
  '#eab308',
  '#06b6d4',
];

const DEFAULT_COLOR = COLOR_PALETTE[0] ?? '#22c55e';

export const LogicalProjectManager = (): React.JSX.Element | null => {
  const { open, close } = useStore(
    useShallow((s) => ({
      open: s.logicalProjectManagerOpen,
      close: s.closeLogicalProjectManager,
    }))
  );

  if (!open) return null;
  return createPortal(<LogicalProjectManagerDialog onClose={close} />, document.body);
};

interface DialogProps {
  onClose: () => void;
}

const LogicalProjectManagerDialog = ({ onClose }: DialogProps): React.JSX.Element => {
  const {
    logicalProjects,
    cwdProjectMap,
    activeProjectId,
    createLogicalProject,
    updateLogicalProject,
    deleteLogicalProject,
    assignCwdToLogicalProject,
  } = useStore(
    useShallow((s) => ({
      logicalProjects: s.logicalProjects,
      cwdProjectMap: s.cwdProjectMap,
      activeProjectId: s.activeProjectId,
      createLogicalProject: s.createLogicalProject,
      updateLogicalProject: s.updateLogicalProject,
      deleteLogicalProject: s.deleteLogicalProject,
      assignCwdToLogicalProject: s.assignCwdToLogicalProject,
    }))
  );

  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const sortedProjects = useMemo(
    () => Object.values(logicalProjects).sort((a, b) => a.order - b.order),
    [logicalProjects]
  );

  const currentCwdAssignment = activeProjectId ? cwdProjectMap[activeProjectId] : undefined;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleCreate = async (): Promise<void> => {
    const name = newName.trim();
    if (!name) return;
    await createLogicalProject(name, newColor);
    setNewName('');
  };

  const handleRenameCommit = async (id: string): Promise<void> => {
    const name = renameValue.trim();
    if (name) {
      await updateLogicalProject(id, { name });
    }
    setRenamingId(null);
    setRenameValue('');
  };

  // Swap the order field of the project at `index` with its neighbour at
  // `index + direction`. Sequentially-awaited so the two persist calls don't
  // race each other to the config file.
  const handleMove = async (index: number, direction: -1 | 1): Promise<void> => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sortedProjects.length) return;
    const a = sortedProjects[index];
    const b = sortedProjects[targetIndex];
    if (!a || !b) return;
    await updateLogicalProject(a.id, { order: b.order });
    await updateLogicalProject(b.id, { order: a.order });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      />
      <div
        className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border shadow-2xl"
        style={{
          backgroundColor: 'var(--color-surface-overlay)',
          borderColor: 'var(--color-border-emphasis)',
          color: 'var(--color-text)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Manage Logical Projects"
      >
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2">
            <FolderTree className="size-4" style={{ color: 'var(--color-text-muted)' }} />
            <h2 className="text-sm font-semibold">Logical Projects</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 transition-colors hover:bg-white/5"
            title="Close"
          >
            <X className="size-4" style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
          {/* Create new */}
          <section className="space-y-2">
            <div
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-text-muted)' }}
            >
              New Project
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                }}
                placeholder="Name (e.g. Cowork)"
                className="flex-1 rounded border px-2 py-1 text-sm outline-none focus:border-indigo-400"
                style={{
                  backgroundColor: 'var(--color-surface-raised)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)',
                }}
              />
              <button
                onClick={() => void handleCreate()}
                disabled={!newName.trim()}
                className="rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-white/5 disabled:opacity-40"
                style={{ color: 'var(--color-text)' }}
                title="Create project"
              >
                <Plus className="size-4" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className="size-5 rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: c,
                    outline: newColor === c ? '2px solid white' : 'none',
                    outlineOffset: '1px',
                  }}
                  aria-label={`Pick color ${c}`}
                />
              ))}
            </div>
          </section>

          {/* Existing projects */}
          <section className="space-y-2">
            <div
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Projects ({sortedProjects.length})
            </div>
            {sortedProjects.length === 0 ? (
              <div
                className="rounded border border-dashed px-3 py-4 text-center text-xs"
                style={{
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text-muted)',
                }}
              >
                No logical projects yet. Create one above.
              </div>
            ) : (
              <ul className="space-y-1">
                {sortedProjects.map((lp, index) => (
                  <li
                    key={lp.id}
                    className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5"
                  >
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => void handleMove(index, -1)}
                        disabled={index === 0}
                        className="rounded p-0.5 transition-colors hover:bg-white/10 disabled:opacity-30"
                        title="Move up"
                        aria-label="Move up"
                      >
                        <ChevronUp className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMove(index, 1)}
                        disabled={index === sortedProjects.length - 1}
                        className="rounded p-0.5 transition-colors hover:bg-white/10 disabled:opacity-30"
                        title="Move down"
                        aria-label="Move down"
                      >
                        <ChevronDown className="size-3" />
                      </button>
                    </div>
                    <input
                      type="color"
                      value={lp.color}
                      onChange={(e) => void updateLogicalProject(lp.id, { color: e.target.value })}
                      className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                      title="Change color"
                    />
                    {renamingId === lp.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void handleRenameCommit(lp.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRenameCommit(lp.id);
                          if (e.key === 'Escape') {
                            setRenamingId(null);
                            setRenameValue('');
                          }
                        }}
                        className="flex-1 rounded border px-1 py-0.5 text-sm outline-none focus:border-indigo-400"
                        style={{
                          backgroundColor: 'var(--color-surface-raised)',
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-text)',
                        }}
                      />
                    ) : (
                      <button
                        className="flex-1 truncate text-left"
                        onClick={() => {
                          setRenamingId(lp.id);
                          setRenameValue(lp.name);
                        }}
                        title="Click to rename"
                      >
                        {lp.name}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete "${lp.name}"? Sessions assigned to it will become Ungrouped.`
                          )
                        ) {
                          void deleteLogicalProject(lp.id);
                        }
                      }}
                      className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
                      title="Delete project"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Current cwd mapping */}
          <section className="space-y-2">
            <div
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Current Cwd Folder Mapping
            </div>
            {activeProjectId ? (
              <div className="space-y-1.5">
                <div
                  className="truncate text-xs"
                  style={{ color: 'var(--color-text-muted)' }}
                  title={activeProjectId}
                >
                  {activeProjectId}
                </div>
                <select
                  value={currentCwdAssignment ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    void assignCwdToLogicalProject(
                      activeProjectId,
                      value === '' ? null : value
                    );
                  }}
                  className="w-full rounded border px-2 py-1 text-sm outline-none focus:border-indigo-400"
                  style={{
                    backgroundColor: 'var(--color-surface-raised)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="">— Ungrouped —</option>
                  {sortedProjects.map((lp) => (
                    <option key={lp.id} value={lp.id}>
                      {lp.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  Every session under this cwd folder inherits this assignment unless
                  individually overridden.
                </p>
              </div>
            ) : (
              <div
                className="rounded border border-dashed px-3 py-2 text-center text-xs"
                style={{
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text-muted)',
                }}
              >
                Select a project to map its cwd folder.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
