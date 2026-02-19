/**
 * ContextSwitchOverlay - Full-screen loading overlay during context switches.
 *
 * Displayed when isContextSwitching is true, preventing stale data flash
 * during workspace transitions.
 */

import React from 'react';

import { useStore } from '@renderer/store';
import { useShallow } from 'zustand/react/shallow';

export const ContextSwitchOverlay: React.FC = () => {
  const { isContextSwitching, targetContextId, availableContexts } = useStore(
    useShallow((state) => ({
      isContextSwitching: state.isContextSwitching,
      targetContextId: state.targetContextId,
      availableContexts: state.availableContexts,
    }))
  );

  if (!isContextSwitching) {
    return null;
  }

  const contextLabel =
    availableContexts.find((ctx) => ctx.id === targetContextId)?.rootName ?? 'Unknown';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-4">
        {/* Spinner */}
        <div className="size-8 animate-spin rounded-full border-4 border-text border-t-transparent" />

        {/* Text */}
        <div className="flex flex-col items-center gap-1">
          <p className="text-text">Switching to {contextLabel}...</p>
          <p className="text-sm text-text-secondary">Loading workspace</p>
        </div>
      </div>
    </div>
  );
};
