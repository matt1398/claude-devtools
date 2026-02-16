/**
 * AdvancedSection - Advanced settings including config management and about info.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api, isElectronMode } from '@renderer/api';
import appIcon from '@renderer/favicon.png';
import { useStore } from '@renderer/store';
import { CheckCircle, Code2, Download, Loader2, RefreshCw, Upload } from 'lucide-react';

import { SettingsSectionHeader } from '../components';

interface AdvancedSectionProps {
  readonly saving: boolean;
  readonly onResetToDefaults: () => void;
  readonly onExportConfig: () => void;
  readonly onImportConfig: () => void;
  readonly onOpenInEditor: () => void;
}

export const AdvancedSection = ({
  saving,
  onResetToDefaults,
  onExportConfig,
  onImportConfig,
  onOpenInEditor,
}: AdvancedSectionProps): React.JSX.Element => {
  const isElectron = useMemo(() => isElectronMode(), []);
  const [version, setVersion] = useState<string>('');
  const updateStatus = useStore((s) => s.updateStatus);
  const availableVersion = useStore((s) => s.availableVersion);
  const checkForUpdates = useStore((s) => s.checkForUpdates);

  // Auto-revert "not-available" / "error" status back to idle after a brief display
  const revertTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (updateStatus === 'not-available' || updateStatus === 'error') {
      revertTimerRef.current = setTimeout(() => {
        useStore.setState({ updateStatus: 'idle' });
      }, 3000);
    }
    return () => {
      if (revertTimerRef.current) clearTimeout(revertTimerRef.current);
    };
  }, [updateStatus]);

  useEffect(() => {
    api.getAppVersion().then(setVersion).catch(console.error);
  }, []);

  const handleCheckForUpdates = useCallback(() => {
    checkForUpdates();
  }, [checkForUpdates]);

  const getUpdateButtonContent = (): React.JSX.Element => {
    switch (updateStatus) {
      case 'checking':
        return (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Checking...
          </>
        );
      case 'not-available':
        return (
          <>
            <CheckCircle className="size-3.5" />
            Up to date
          </>
        );
      case 'available':
      case 'downloaded':
        return (
          <>
            <Download className="size-3.5" />
            {updateStatus === 'downloaded'
              ? 'Update ready'
              : `v${availableVersion ?? 'unknown'} available`}
          </>
        );
      default:
        return (
          <>
            <RefreshCw className="size-3.5" />
            Check for Updates
          </>
        );
    }
  };

  return (
    <div>
      <SettingsSectionHeader title="Configuration" />
      <div className="space-y-2 py-2">
        <button
          onClick={onResetToDefaults}
          disabled={saving}
          className={`flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-all duration-150 ${saving ? 'cursor-not-allowed opacity-50' : ''} `}
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <RefreshCw className="size-4" />
          Reset to Defaults
        </button>
        <button
          onClick={onExportConfig}
          disabled={saving}
          className={`flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-all duration-150 ${saving ? 'cursor-not-allowed opacity-50' : ''} `}
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Download className="size-4" />
          Export Config
        </button>
        <button
          onClick={onImportConfig}
          disabled={saving}
          className={`flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-all duration-150 ${saving ? 'cursor-not-allowed opacity-50' : ''} `}
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <Upload className="size-4" />
          Import Config
        </button>
        {isElectron && (
          <button
            onClick={onOpenInEditor}
            className="flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-all duration-150"
            style={{
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-secondary)',
            }}
          >
            <Code2 className="size-4" />
            Open in Editor
          </button>
        )}
      </div>

      <SettingsSectionHeader title="About" />
      <div className="flex items-start gap-4 py-3">
        <img src={appIcon} alt="App Icon" className="size-10 rounded-lg" />
        <div>
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              claude-devtools
            </p>
            {isElectron && (
              <button
                onClick={handleCheckForUpdates}
                disabled={updateStatus === 'checking'}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5 disabled:opacity-50"
                style={{
                  borderColor: 'var(--color-border)',
                  color:
                    updateStatus === 'not-available'
                      ? 'var(--color-text-muted)'
                      : updateStatus === 'available' || updateStatus === 'downloaded'
                        ? '#60a5fa'
                        : 'var(--color-text-secondary)',
                }}
              >
                {getUpdateButtonContent()}
              </button>
            )}
            {!isElectron && (
              <span
                className="rounded-md border px-2.5 py-1 text-xs font-medium"
                style={{
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text-muted)',
                }}
              >
                Standalone
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            Version {version || '...'}
          </p>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            Visualize and analyze Claude Code session executions with interactive waterfall charts
            and detailed insights.
          </p>
        </div>
      </div>
    </div>
  );
};
