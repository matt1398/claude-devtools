/**
 * GeneralSection - General settings including startup, appearance, browser access, and data roots.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, isElectronMode } from '@renderer/api';
import { confirm, prompt } from '@renderer/components/common/ConfirmDialog';
import { useStore } from '@renderer/store';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wifi,
} from 'lucide-react';

import { SettingRow, SettingsSectionHeader, SettingsSelect, SettingsToggle } from '../components';

import type { SafeConfig } from '../hooks/useSettingsConfig';
import type { DataRoot, SshConnectionProfile } from '@shared/types';
import type { HttpServerStatus } from '@shared/types/api';

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
] as const;

interface GeneralSectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly onGeneralToggle: (key: 'launchAtLogin' | 'showDockIcon', value: boolean) => void;
  readonly onThemeChange: (value: 'dark' | 'light' | 'system') => void;
}

export const GeneralSection = ({
  safeConfig,
  saving,
  onGeneralToggle,
  onThemeChange,
}: GeneralSectionProps): React.JSX.Element => {
  const [serverStatus, setServerStatus] = useState<HttpServerStatus>({
    running: false,
    port: 3456,
  });
  const [serverLoading, setServerLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [roots, setRoots] = useState<DataRoot[]>([]);
  const [sshProfiles, setSshProfiles] = useState<SshConnectionProfile[]>([]);
  const [rootsLoading, setRootsLoading] = useState(false);
  const [rootsError, setRootsError] = useState<string | null>(null);

  const [newSshRootName, setNewSshRootName] = useState('');
  const [newSshProfileId, setNewSshProfileId] = useState('');
  const [newSshRemotePath, setNewSshRemotePath] = useState('');

  const fetchAvailableContexts = useStore((s) => s.fetchAvailableContexts);
  const deleteSnapshot = useStore((s) => s.deleteSnapshot);

  const isElectron = useMemo(() => isElectronMode(), []);

  useEffect(() => {
    void api.httpServer.getStatus().then(setServerStatus);
  }, []);

  const loadRoots = useCallback(async () => {
    try {
      setRootsLoading(true);
      setRootsError(null);
      const config = await api.config.get();
      const sortedRoots = [...config.roots.items].sort((a, b) => a.order - b.order);
      setRoots(sortedRoots);
      const profiles = config.ssh?.profiles ?? [];
      setSshProfiles(profiles);
      setNewSshProfileId((currentProfileId) => {
        if (profiles.length === 0) return '';
        if (currentProfileId && profiles.some((profile) => profile.id === currentProfileId)) {
          return currentProfileId;
        }
        return profiles[0].id;
      });
    } catch (error) {
      setRootsError(error instanceof Error ? error.message : 'Failed to load roots');
    } finally {
      setRootsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    void loadRoots();
  }, [isElectron, loadRoots]);

  const runRootMutation = useCallback(
    async (operation: () => Promise<void>, fallbackMessage: string) => {
      try {
        setRootsError(null);
        await operation();
      } catch (error) {
        setRootsError(error instanceof Error ? error.message : fallbackMessage);
      }
    },
    []
  );

  const handleServerToggle = useCallback(async (enabled: boolean) => {
    setServerLoading(true);
    try {
      const status = enabled ? await api.httpServer.start() : await api.httpServer.stop();
      setServerStatus(status);
    } catch {
      // Toggle failed — status unchanged, loading cleared below
    } finally {
      setServerLoading(false);
    }
  }, []);

  const serverUrl = `http://localhost:${serverStatus.port}`;

  const handleCopyUrl = useCallback(() => {
    void navigator.clipboard.writeText(serverUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [serverUrl]);

  const handleRenameRoot = useCallback(
    async (root: DataRoot) => {
      const value = await prompt({
        title: 'Rename Root',
        message: 'Enter a new name for this root.',
        defaultValue: root.name,
        placeholder: 'Root name',
        confirmLabel: 'Save',
      });
      const name = value?.trim();
      if (!name || name === root.name) return;
      await runRootMutation(async () => {
        await api.config.updateRoot(root.id, { name });
        await loadRoots();
        await fetchAvailableContexts();
      }, 'Failed to rename root');
    },
    [fetchAvailableContexts, loadRoots, runRootMutation]
  );

  const handleMoveRoot = useCallback(
    async (rootId: string, direction: 'up' | 'down') => {
      const sorted = [...roots].sort((a, b) => a.order - b.order);
      const index = sorted.findIndex((root) => root.id === rootId);
      if (index < 0) return;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= sorted.length) return;

      const reordered = [...sorted];
      [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
      await runRootMutation(async () => {
        await api.config.reorderRoots(reordered.map((root) => root.id));
        await loadRoots();
        await fetchAvailableContexts();
      }, 'Failed to reorder roots');
    },
    [fetchAvailableContexts, loadRoots, roots, runRootMutation]
  );

  const handleEditLocalRootPath = useCallback(
    async (root: Extract<DataRoot, { type: 'local' }>) => {
      await runRootMutation(async () => {
        const selection = await api.config.selectClaudeRootFolder(root.id);
        if (!selection) return;

        if (!selection.isClaudeDirName) {
          const proceed = await confirm({
            title: 'Selected folder is not .claude',
            message: 'This folder is not named ".claude". Continue anyway?',
            confirmLabel: 'Use Folder',
          });
          if (!proceed) return;
        }

        if (!selection.hasProjectsDir) {
          const proceed = await confirm({
            title: 'No projects directory found',
            message: 'This folder does not contain a "projects" directory. Continue anyway?',
            confirmLabel: 'Use Folder',
          });
          if (!proceed) return;
        }

        await api.config.updateRoot(root.id, { claudeRootPath: selection.path });
        await loadRoots();
        await fetchAvailableContexts();
      }, 'Failed to update local root path');
    },
    [fetchAvailableContexts, loadRoots, runRootMutation]
  );

  const handleEditSshRemotePath = useCallback(
    async (root: Extract<DataRoot, { type: 'ssh' }>) => {
      const nextPath = await prompt({
        title: 'Remote Claude Root Path',
        message: 'Set a remote Claude root path. Leave blank to use ~/.claude.',
        defaultValue: root.remoteClaudeRootPath ?? '',
        placeholder: '~/.claude',
        confirmLabel: 'Save',
      });
      if (nextPath === null) return;
      await runRootMutation(async () => {
        await api.config.updateRoot(root.id, { remoteClaudeRootPath: nextPath.trim() || null });
        await loadRoots();
        await fetchAvailableContexts();
      }, 'Failed to update remote root path');
    },
    [fetchAvailableContexts, loadRoots, runRootMutation]
  );

  const handleDeleteRoot = useCallback(
    async (root: DataRoot) => {
      const confirmed = await confirm({
        title: 'Delete Root',
        message: `Delete root "${root.name}"?`,
        confirmLabel: 'Delete',
        variant: 'danger',
      });
      if (!confirmed) return;

      await runRootMutation(async () => {
        await api.config.removeRoot(root.id);
        await deleteSnapshot(root.id);
        await loadRoots();
        await fetchAvailableContexts();
      }, 'Failed to delete root');
    },
    [deleteSnapshot, fetchAvailableContexts, loadRoots, runRootMutation]
  );

  const handleAddLocalRoot = useCallback(async () => {
    await runRootMutation(async () => {
      const selection = await api.config.selectClaudeRootFolder();
      if (!selection) return;

      const derivedName = selection.path.split(/[\\/]/).pop() || 'Local Root';
      await api.config.addRoot({
        type: 'local',
        name: derivedName,
        claudeRootPath: selection.path,
      });
      await loadRoots();
      await fetchAvailableContexts();
    }, 'Failed to add local root');
  }, [fetchAvailableContexts, loadRoots, runRootMutation]);

  const handleAddSshRoot = useCallback(async () => {
    if (!newSshProfileId || !newSshRootName.trim()) {
      setRootsError('SSH root requires a name and SSH profile');
      return;
    }

    await runRootMutation(async () => {
      await api.config.addRoot({
        type: 'ssh',
        name: newSshRootName.trim(),
        sshProfileId: newSshProfileId,
        remoteClaudeRootPath: newSshRemotePath.trim() || null,
      });

      setNewSshRootName('');
      setNewSshRemotePath('');
      await loadRoots();
      await fetchAvailableContexts();
    }, 'Failed to add SSH root');
  }, [
    fetchAvailableContexts,
    loadRoots,
    newSshProfileId,
    newSshRemotePath,
    newSshRootName,
    runRootMutation,
  ]);

  const inputClass = 'w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1';
  const inputStyle = {
    backgroundColor: 'var(--color-surface-raised)',
    borderColor: 'var(--color-border)',
    color: 'var(--color-text)',
  };

  return (
    <div>
      {isElectron && (
        <>
          <SettingsSectionHeader title="Startup" />
          <SettingRow
            label="Launch at login"
            description="Automatically start the app when you log in"
          >
            <SettingsToggle
              enabled={safeConfig.general.launchAtLogin}
              onChange={(v) => onGeneralToggle('launchAtLogin', v)}
              disabled={saving}
            />
          </SettingRow>
          {window.navigator.userAgent.includes('Macintosh') && (
            <SettingRow
              label="Show dock icon"
              description="Display the app icon in the dock (macOS)"
            >
              <SettingsToggle
                enabled={safeConfig.general.showDockIcon}
                onChange={(v) => onGeneralToggle('showDockIcon', v)}
                disabled={saving}
              />
            </SettingRow>
          )}
        </>
      )}

      <SettingsSectionHeader title="Appearance" />
      <SettingRow label="Theme" description="Choose your preferred color theme">
        <SettingsSelect
          value={safeConfig.general.theme}
          options={THEME_OPTIONS}
          onChange={onThemeChange}
          disabled={saving}
        />
      </SettingRow>

      {isElectron && (
        <>
          <SettingsSectionHeader title="Data Roots" />
          {rootsError && (
            <div className="mb-3 rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3">
              <p className="text-sm text-red-400">{rootsError}</p>
            </div>
          )}

          {rootsLoading ? (
            <div className="mb-4 flex items-center gap-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              <Loader2 className="size-4 animate-spin" />
              Loading roots...
            </div>
          ) : (
            <div className="space-y-2">
              {roots.map((root, index) => {
                const profile = root.type === 'ssh'
                  ? sshProfiles.find((item) => item.id === root.sshProfileId)
                  : null;
                const rootDescription =
                  root.type === 'local'
                    ? root.claudeRootPath ?? 'Auto-detect (~/.claude)'
                    : [profile?.name ?? 'Missing profile', root.remoteClaudeRootPath]
                        .filter((value): value is string => Boolean(value))
                        .join(' • ');

                return (
                  <div
                    key={root.id}
                    className="rounded-md border p-3"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: 'var(--color-surface-raised)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                          {root.name}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          {rootDescription}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleMoveRoot(root.id, 'up')}
                        disabled={index === 0}
                        title={`Move ${root.name} up`}
                        aria-label={`Move ${root.name} up`}
                        className="rounded-md p-1.5 transition-colors disabled:opacity-40"
                        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveRoot(root.id, 'down')}
                        disabled={index === roots.length - 1}
                        title={`Move ${root.name} down`}
                        aria-label={`Move ${root.name} down`}
                        className="rounded-md p-1.5 transition-colors disabled:opacity-40"
                        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRenameRoot(root)}
                        title={`Rename ${root.name}`}
                        aria-label={`Rename ${root.name}`}
                        className="rounded-md p-1.5 transition-colors"
                        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void (root.type === 'local'
                            ? handleEditLocalRootPath(root)
                            : handleEditSshRemotePath(root))
                        }
                        title={root.type === 'local' ? `Edit local path for ${root.name}` : `Edit SSH path for ${root.name}`}
                        aria-label={root.type === 'local' ? `Edit local path for ${root.name}` : `Edit SSH path for ${root.name}`}
                        className="rounded-md p-1.5 transition-colors"
                        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
                      >
                        {root.type === 'local' ? (
                          <FolderOpen className="size-3.5" />
                        ) : (
                          <Wifi className="size-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteRoot(root)}
                        disabled={root.id === 'default-local'}
                        title={
                          root.id === 'default-local'
                            ? 'Default local root cannot be deleted'
                            : `Delete ${root.name}`
                        }
                        aria-label={
                          root.id === 'default-local'
                            ? 'Default local root cannot be deleted'
                            : `Delete ${root.name}`
                        }
                        className="rounded-md p-1.5 transition-colors disabled:opacity-40"
                        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleAddLocalRoot()}
              className="rounded-md px-3 py-1.5 text-sm transition-colors"
              style={{ backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text)' }}
            >
              <span className="flex items-center gap-1.5">
                <Plus className="size-3.5" />
                Add Local Root
              </span>
            </button>
          </div>

          {sshProfiles.length === 0 ? (
            <div
              className="mt-3 rounded-md border px-3 py-2.5 text-xs"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface-raised)',
                color: 'var(--color-text-muted)',
              }}
            >
              Add an SSH profile in the Workspace section before creating SSH roots.
            </div>
          ) : (
            <div className="mt-3 space-y-2 rounded-md border p-3" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Add SSH Root
              </p>
              <input
                type="text"
                value={newSshRootName}
                onChange={(e) => setNewSshRootName(e.target.value)}
                placeholder="Root name"
                className={inputClass}
                style={inputStyle}
              />
              <SettingsSelect
                value={newSshProfileId}
                options={sshProfiles.map((profile) => ({ value: profile.id, label: profile.name }))}
                onChange={setNewSshProfileId}
                fullWidth
              />
              <input
                type="text"
                value={newSshRemotePath}
                onChange={(e) => setNewSshRemotePath(e.target.value)}
                placeholder="Remote Claude path (optional)"
                className={inputClass}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => void handleAddSshRoot()}
                className="rounded-md px-3 py-1.5 text-sm transition-colors"
                style={{ backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text)' }}
              >
                Add SSH Root
              </button>
            </div>
          )}
        </>
      )}

      {isElectron ? (
        <>
          <SettingsSectionHeader title="Browser Access" />
          <SettingRow
            label="Enable server mode"
            description="Start an HTTP server to access the UI from a browser or embed in iframes"
          >
            {serverLoading ? (
              <Loader2 className="size-5 animate-spin" style={{ color: 'var(--color-text-muted)' }} />
            ) : (
              <SettingsToggle
                enabled={serverStatus.running}
                onChange={handleServerToggle}
                disabled={saving}
              />
            )}
          </SettingRow>

          {serverStatus.running && (
            <div
              className="mb-2 flex items-center gap-3 rounded-md px-3 py-2.5"
              style={{ backgroundColor: 'var(--color-surface-raised)' }}
            >
              <div className="size-2 shrink-0 rounded-full" style={{ backgroundColor: '#22c55e' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Running on
              </span>
              <code
                className="rounded px-1.5 py-0.5 font-mono text-xs"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {serverUrl}
              </code>
              <button
                onClick={handleCopyUrl}
                className="ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5"
                style={{
                  borderColor: 'var(--color-border)',
                  color: copied ? '#22c55e' : 'var(--color-text-secondary)',
                }}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy URL'}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <SettingsSectionHeader title="Server" />
          <div
            className="mb-2 flex items-center gap-3 rounded-md px-3 py-2.5"
            style={{ backgroundColor: 'var(--color-surface-raised)' }}
          >
            <div className="size-2 shrink-0 rounded-full" style={{ backgroundColor: '#22c55e' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              Running on
            </span>
            <code
              className="rounded px-1.5 py-0.5 font-mono text-xs"
              style={{
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
            >
              {window.location.origin}
            </code>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(window.location.origin);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="ml-auto flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5"
              style={{
                borderColor: 'var(--color-border)',
                color: copied ? '#22c55e' : 'var(--color-text-secondary)',
              }}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Running in standalone mode. The HTTP server is always active. System notifications are
            not available - notification triggers are logged in-app only.
          </p>
        </>
      )}
    </div>
  );
};
