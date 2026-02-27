/**
 * GeneralSection - General settings including startup, appearance, browser access, and local Claude root.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { api, isElectronMode } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { THEME_OPTIONS } from '@renderer/constants/themes';
import { useStore } from '@renderer/store';
import { getFullResetState } from '@renderer/store/utils/stateResetHelpers';
import { Check, Copy, FolderOpen, Laptop, Loader2, RotateCcw } from 'lucide-react';

import { SettingRow, SettingsSectionHeader, SettingsSelect, SettingsToggle } from '../components';

import type { SafeConfig } from '../hooks/useSettingsConfig';
import type { ClaudeRootInfo, WslClaudeRootCandidate } from '@shared/types';
import type { HttpServerStatus } from '@shared/types/api';
import type { AppConfig, ThemeName } from '@shared/types/notifications';

interface GeneralSectionProps {
  readonly safeConfig: SafeConfig;
  readonly saving: boolean;
  readonly onGeneralToggle: (key: keyof AppConfig['general'], value: boolean) => void;
  readonly onThemeChange: (value: ThemeName) => void;
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

  // Claude Root state
  const connectionMode = useStore((s) => s.connectionMode);
  const fetchProjects = useStore((s) => s.fetchProjects);
  const fetchRepositoryGroups = useStore((s) => s.fetchRepositoryGroups);

  const [claudeRootInfo, setClaudeRootInfo] = useState<ClaudeRootInfo | null>(null);
  const [updatingClaudeRoot, setUpdatingClaudeRoot] = useState(false);
  const [claudeRootError, setClaudeRootError] = useState<string | null>(null);
  const [findingWslRoots, setFindingWslRoots] = useState(false);
  const [wslCandidates, setWslCandidates] = useState<WslClaudeRootCandidate[]>([]);
  const [showWslModal, setShowWslModal] = useState(false);

  // Fetch server status and Claude root info on mount
  useEffect(() => {
    void api.httpServer.getStatus().then(setServerStatus);
  }, []);

  const loadClaudeRootInfo = useCallback(async () => {
    try {
      const info = await api.config.getClaudeRootInfo();
      setClaudeRootInfo(info);
    } catch (error) {
      setClaudeRootError(
        error instanceof Error ? error.message : 'Failed to load local Claude root settings'
      );
    }
  }, []);

  useEffect(() => {
    void loadClaudeRootInfo();
  }, [loadClaudeRootInfo]);

  const handleServerToggle = useCallback(async (enabled: boolean) => {
    setServerLoading(true);
    try {
      const status = enabled ? await api.httpServer.start() : await api.httpServer.stop();
      setServerStatus(status);
    } catch {
      // Status didn't change
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

  // Claude Root handlers
  const resetWorkspaceForRootChange = useCallback((): void => {
    useStore.setState({
      projects: [],
      repositoryGroups: [],
      openTabs: [],
      activeTabId: null,
      selectedTabIds: [],
      paneLayout: {
        panes: [
          {
            id: 'pane-default',
            tabs: [],
            activeTabId: null,
            selectedTabIds: [],
            widthFraction: 1,
          },
        ],
        focusedPaneId: 'pane-default',
      },
      ...getFullResetState(),
    });
  }, []);

  const applyClaudeRootPath = useCallback(
    async (claudeRootPath: string | null): Promise<void> => {
      try {
        setUpdatingClaudeRoot(true);
        setClaudeRootError(null);

        await api.config.update('general', { claudeRootPath });
        await loadClaudeRootInfo();

        if (connectionMode === 'local') {
          resetWorkspaceForRootChange();
          await Promise.all([fetchProjects(), fetchRepositoryGroups()]);
        }
      } catch (error) {
        setClaudeRootError(error instanceof Error ? error.message : 'Failed to update Claude root');
      } finally {
        setUpdatingClaudeRoot(false);
      }
    },
    [
      connectionMode,
      fetchProjects,
      fetchRepositoryGroups,
      loadClaudeRootInfo,
      resetWorkspaceForRootChange,
    ]
  );

  const handleSelectClaudeRootFolder = useCallback(async (): Promise<void> => {
    setClaudeRootError(null);

    const selection = await api.config.selectClaudeRootFolder();
    if (!selection) {
      return;
    }

    if (!selection.isClaudeDirName) {
      const proceed = await confirm({
        title: 'Selected folder is not .claude',
        message: `This folder is named "${selection.path.split(/[\\/]/).pop() ?? selection.path}", not ".claude". Continue anyway?`,
        confirmLabel: 'Use Folder',
      });
      if (!proceed) {
        return;
      }
    }

    if (!selection.hasProjectsDir) {
      const proceed = await confirm({
        title: 'No projects directory found',
        message: 'This folder does not contain a "projects" directory. Continue anyway?',
        confirmLabel: 'Use Folder',
      });
      if (!proceed) {
        return;
      }
    }

    await applyClaudeRootPath(selection.path);
  }, [applyClaudeRootPath]);

  const handleResetClaudeRoot = useCallback(async (): Promise<void> => {
    await applyClaudeRootPath(null);
  }, [applyClaudeRootPath]);

  const applyWslCandidate = useCallback(
    async (candidate: WslClaudeRootCandidate): Promise<void> => {
      if (!candidate.hasProjectsDir) {
        const proceed = await confirm({
          title: 'WSL path missing projects directory',
          message: `"${candidate.path}" does not contain a "projects" directory. Continue anyway?`,
          confirmLabel: 'Use Path',
        });
        if (!proceed) {
          return;
        }
      }

      await applyClaudeRootPath(candidate.path);
      setShowWslModal(false);
    },
    [applyClaudeRootPath]
  );

  const handleUseWslForClaude = useCallback(async (): Promise<void> => {
    try {
      setFindingWslRoots(true);
      setClaudeRootError(null);
      const candidates = await api.config.findWslClaudeRoots();
      setWslCandidates(candidates);

      if (candidates.length === 0) {
        const pickManually = await confirm({
          title: 'No WSL Claude paths found',
          message:
            'Could not find WSL distros with Claude data automatically. Select folder manually?',
          confirmLabel: 'Select Folder',
        });
        if (pickManually) {
          await handleSelectClaudeRootFolder();
        }
        return;
      }

      const candidatesWithProjects = candidates.filter((candidate) => candidate.hasProjectsDir);
      if (candidatesWithProjects.length === 1) {
        await applyWslCandidate(candidatesWithProjects[0]);
        return;
      }

      setShowWslModal(true);
    } catch (error) {
      setClaudeRootError(
        error instanceof Error ? error.message : 'Failed to detect WSL Claude root paths'
      );
    } finally {
      setFindingWslRoots(false);
    }
  }, [applyWslCandidate, handleSelectClaudeRootFolder]);

  const isCustomClaudeRoot = Boolean(claudeRootInfo?.customPath);
  const resolvedClaudeRootPath = claudeRootInfo?.resolvedPath ?? '~/.claude';
  const defaultClaudeRootPath = claudeRootInfo?.defaultPath ?? '~/.claude';
  const isWindowsStyleDefaultPath =
    /^[a-zA-Z]:\\/.test(defaultClaudeRootPath) || defaultClaudeRootPath.startsWith('\\\\');

  const isElectron = useMemo(() => isElectronMode(), []);

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
      <SettingRow
        label="Expand AI responses by default"
        description="Automatically expand each response turn when opening a transcript or receiving a new message"
      >
        <SettingsToggle
          enabled={safeConfig.general.autoExpandAIGroups ?? false}
          onChange={(v) => onGeneralToggle('autoExpandAIGroups', v)}
          disabled={saving}
        />
      </SettingRow>
      {isElectron && !window.navigator.userAgent.includes('Macintosh') && (
        <SettingRow
          label="Use native title bar"
          description="Use the default system window frame instead of the custom title bar"
        >
          <SettingsToggle
            enabled={safeConfig.general.useNativeTitleBar}
            onChange={async (v) => {
              const shouldRelaunch = await confirm({
                title: 'Restart required',
                message: 'The app needs to restart to apply the title bar change. Restart now?',
                confirmLabel: 'Restart',
              });
              if (shouldRelaunch) {
                onGeneralToggle('useNativeTitleBar', v);
                // Small delay to let config persist before relaunch
                setTimeout(() => {
                  void window.electronAPI?.windowControls?.relaunch();
                }, 200);
              }
            }}
            disabled={saving}
          />
        </SettingRow>
      )}

      {isElectron && (
        <>
          <SettingsSectionHeader title="Local Claude Root" />
          <p className="mb-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Choose which local folder is treated as your Claude data root
          </p>

          <SettingRow
            label="Current Local Root"
            description={isCustomClaudeRoot ? 'Using custom path' : 'Using auto-detected path'}
          >
            <div className="max-w-96 text-right">
              <div className="truncate font-mono text-xs" style={{ color: 'var(--color-text)' }}>
                {resolvedClaudeRootPath}
              </div>
              <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                Auto-detected: {defaultClaudeRootPath}
              </div>
            </div>
          </SettingRow>

          <div className="flex items-center gap-3 py-2">
            <button
              onClick={() => void handleSelectClaudeRootFolder()}
              disabled={updatingClaudeRoot}
              className="rounded-md px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-surface-raised)',
                color: 'var(--color-text)',
              }}
            >
              <span className="flex items-center gap-2">
                {updatingClaudeRoot ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <FolderOpen className="size-3" />
                )}
                Select Folder
              </span>
            </button>

            <button
              onClick={() => void handleResetClaudeRoot()}
              disabled={updatingClaudeRoot || !isCustomClaudeRoot}
              className="rounded-md px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-surface-raised)',
                color: 'var(--color-text-secondary)',
              }}
            >
              <span className="flex items-center gap-2">
                <RotateCcw className="size-3" />
                Use Auto-Detect
              </span>
            </button>

            {isWindowsStyleDefaultPath && (
              <button
                onClick={() => void handleUseWslForClaude()}
                disabled={updatingClaudeRoot || findingWslRoots}
                className="rounded-md px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--color-surface-raised)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <span className="flex items-center gap-2">
                  {findingWslRoots ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Laptop className="size-3" />
                  )}
                  Using Linux/WSL?
                </span>
              </button>
            )}
          </div>

          {claudeRootError && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3">
              <p className="text-sm text-red-400">{claudeRootError}</p>
            </div>
          )}

          {showWslModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <button
                className="absolute inset-0 cursor-default"
                style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
                onClick={() => setShowWslModal(false)}
                aria-label="Close WSL path modal"
                tabIndex={-1}
              />
              <div
                className="relative mx-4 w-full max-w-2xl rounded-lg border p-5 shadow-xl"
                style={{
                  backgroundColor: 'var(--color-surface-overlay)',
                  borderColor: 'var(--color-border-emphasis)',
                }}
              >
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Select WSL Claude Root
                </h3>
                <p className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Detected WSL distributions and Claude root candidates
                </p>

                <div className="mt-4 space-y-2">
                  {wslCandidates.map((candidate) => (
                    <div
                      key={`${candidate.distro}:${candidate.path}`}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                      style={{ borderColor: 'var(--color-border)' }}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                          {candidate.distro}
                        </p>
                        <p
                          className="truncate font-mono text-[11px]"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {candidate.path}
                        </p>
                        {!candidate.hasProjectsDir && (
                          <p className="text-[11px] text-amber-400">
                            No projects directory detected
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => void applyWslCandidate(candidate)}
                        className="rounded-md px-3 py-1.5 text-xs transition-colors"
                        style={{
                          backgroundColor: 'var(--color-surface-raised)',
                          color: 'var(--color-text)',
                        }}
                      >
                        Use This Path
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setShowWslModal(false)}
                    className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-white/5"
                    style={{
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowWslModal(false);
                      void handleSelectClaudeRootFolder();
                    }}
                    className="rounded-md px-3 py-1.5 text-xs transition-colors"
                    style={{
                      backgroundColor: 'var(--color-surface-raised)',
                      color: 'var(--color-text)',
                    }}
                  >
                    Select Folder Manually
                  </button>
                </div>
              </div>
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
              <Loader2
                className="size-5 animate-spin"
                style={{ color: 'var(--color-text-muted)' }}
              />
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
              <div
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: '#22c55e' }}
              />
              <span
                className="text-xs font-medium"
                style={{ color: 'var(--color-text-secondary)' }}
              >
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
            not available — notification triggers are logged in-app only.
          </p>
        </>
      )}
    </div>
  );
};
