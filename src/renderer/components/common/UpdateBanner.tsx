/**
 * UpdateBanner - Slim top banner for download progress and restart prompt.
 *
 * Visible during download and after the update is ready to install.
 */

import { useStore } from '@renderer/store';
import { CheckCircle, Loader2, X } from 'lucide-react';

export const UpdateBanner = (): React.JSX.Element | null => {
  const showUpdateBanner = useStore((s) => s.showUpdateBanner);
  const updateStatus = useStore((s) => s.updateStatus);
  const downloadProgress = useStore((s) => s.downloadProgress);
  const availableVersion = useStore((s) => s.availableVersion);
  const installUpdate = useStore((s) => s.installUpdate);
  const dismissUpdateBanner = useStore((s) => s.dismissUpdateBanner);

  if (!showUpdateBanner || (updateStatus !== 'downloading' && updateStatus !== 'downloaded')) {
    return null;
  }

  const isDownloading = updateStatus === 'downloading';
  const percent = Math.round(downloadProgress);
  const clampedPercent = Math.max(0, Math.min(percent, 100));

  return (
    <div
      className="relative border-b px-4 py-2.5"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      {isDownloading ? (
        <div className="pr-8">
          <div
            className="mb-1.5 flex items-center gap-2 text-xs"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-400" />
            <span>Updating app</span>
            <span className="tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
              {clampedPercent}%
            </span>
          </div>
          <div
            className="h-1 w-full overflow-hidden rounded-full"
            style={{ backgroundColor: 'var(--color-border)' }}
          >
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300 ease-out"
              style={{ width: `${clampedPercent}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 pr-8">
          <CheckCircle className="size-4 shrink-0 text-green-400" />
          <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Update ready
            {availableVersion ? (
              <span className="ml-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                v{availableVersion}
              </span>
            ) : null}
          </span>
          <button
            onClick={installUpdate}
            className="ml-auto rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/5"
            style={{
              borderColor: 'var(--color-border-emphasis)',
              color: 'var(--color-text)',
            }}
          >
            Restart now
          </button>
        </div>
      )}

      {/* Dismiss */}
      <button
        onClick={dismissUpdateBanner}
        className="absolute right-3 top-1/2 shrink-0 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-white/10"
        style={{ color: 'var(--color-text-muted)' }}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
};
