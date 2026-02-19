/**
 * ConnectionStatusBadge - Visual indicator for workspace connection status.
 *
 * Renders appropriate icon based on connection state:
 * - Local: Monitor icon (muted)
 * - SSH connected: Wifi icon (green)
 * - SSH connecting: Animated spinner (muted)
 * - SSH disconnected: WifiOff icon (muted)
 * - SSH error: WifiOff icon (red)
 */

import { useStore } from '@renderer/store';
import { Loader2, Monitor, Wifi, WifiOff } from 'lucide-react';

import type { SshConnectionState } from '@shared/types';

interface ConnectionStatusBadgeProps {
  contextId: string;
  className?: string;
}

export const ConnectionStatusBadge = ({
  contextId,
  className,
}: Readonly<ConnectionStatusBadgeProps>): React.JSX.Element => {
  const { connectionState, activeContextId, availableContexts } = useStore((s) => ({
    connectionState: s.connectionState,
    activeContextId: s.activeContextId,
    availableContexts: s.availableContexts,
  }));
  const context = availableContexts.find((ctx) => ctx.id === contextId);

  // Local roots always render monitor icon
  if (context?.type === 'local') {
    return <Monitor className={`size-3.5 text-text-muted ${className ?? ''}`} />;
  }

  if (context?.type !== 'ssh') {
    return <WifiOff className={`size-3.5 text-text-muted ${className ?? ''}`} />;
  }

  const isActiveContext = contextId === activeContextId;
  let effectiveState: SshConnectionState = 'disconnected';
  if (isActiveContext) {
    effectiveState = connectionState;
  } else if (context.connected) {
    effectiveState = 'connected';
  }

  // Render icon based on connection state
  switch (effectiveState) {
    case 'connected':
      return <Wifi className={`size-3.5 text-green-400 ${className ?? ''}`} />;
    case 'connecting':
      return <Loader2 className={`size-3.5 animate-spin text-text-muted ${className ?? ''}`} />;
    case 'disconnected':
      return <WifiOff className={`size-3.5 text-text-muted ${className ?? ''}`} />;
    case 'error':
      return <WifiOff className={`size-3.5 text-red-400 ${className ?? ''}`} />;
    default:
      return <WifiOff className={`size-3.5 text-text-muted ${className ?? ''}`} />;
  }
};
