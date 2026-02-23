/**
 * SessionContextHeader - Header component with title, help tooltip, and token stats.
 */

import React from 'react';

import {
  COLOR_BORDER,
  COLOR_BORDER_SUBTLE,
  COLOR_SURFACE_OVERLAY,
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_SECONDARY,
} from '@renderer/constants/cssVariables';
import { formatCostUsd } from '@shared/utils/costFormatting';
import { ArrowDownWideNarrow, FileText, LayoutList, X } from 'lucide-react';

import { formatTokens } from '../utils/formatting';

import { SessionContextHelpTooltip } from './SessionContextHelpTooltip';

import type { ContextViewMode } from '../types';
import type { ContextPhaseInfo } from '@renderer/types/contextInjection';
import type { SessionMetrics } from '@shared/types';

interface SessionContextHeaderProps {
  injectionCount: number;
  totalTokens: number;
  totalSessionTokens?: number;
  sessionMetrics?: SessionMetrics;
  onClose?: () => void;
  phaseInfo?: ContextPhaseInfo;
  selectedPhase: number | null;
  onPhaseChange: (phase: number | null) => void;
  viewMode: ContextViewMode;
  onViewModeChange: (mode: ContextViewMode) => void;
}

export const SessionContextHeader = ({
  injectionCount,
  totalTokens,
  totalSessionTokens,
  sessionMetrics,
  onClose,
  phaseInfo,
  selectedPhase,
  onPhaseChange,
  viewMode,
  onViewModeChange,
}: Readonly<SessionContextHeaderProps>): React.ReactElement => {
  return (
    <div className="shrink-0 px-4 py-3" style={{ borderBottom: `1px solid ${COLOR_BORDER}` }}>
      {/* Title row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={16} style={{ color: COLOR_TEXT_SECONDARY }} />
          <h2 className="text-sm font-semibold" style={{ color: COLOR_TEXT }}>
            Visible Context
          </h2>
          <span
            className="rounded px-1.5 py-0.5 text-xs"
            style={{
              backgroundColor: COLOR_SURFACE_OVERLAY,
              color: COLOR_TEXT_SECONDARY,
            }}
          >
            {injectionCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SessionContextHelpTooltip />
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 transition-colors hover:bg-white/10"
              style={{ color: COLOR_TEXT_SECONDARY }}
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Token comparison stats */}
      <div
        className="mt-2 flex items-center justify-between pt-2 text-xs"
        style={{ borderTop: `1px solid ${COLOR_BORDER_SUBTLE}` }}
      >
        <div className="flex items-center gap-4">
          {/* Visible Context tokens */}
          <div>
            <span style={{ color: COLOR_TEXT_MUTED }}>Visible: </span>
            <span className="font-medium tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
              ~{formatTokens(totalTokens)}
            </span>
          </div>
          {/* Total Session tokens (if provided) */}
          {totalSessionTokens !== undefined && totalSessionTokens > 0 && (
            <div>
              <span style={{ color: COLOR_TEXT_MUTED }}>Total: </span>
              <span className="font-medium tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(totalSessionTokens)}
              </span>
            </div>
          )}
        </div>
        {/* Percentage of total */}
        {totalSessionTokens !== undefined && totalSessionTokens > 0 && (
          <span
            className="rounded px-1.5 py-0.5 tabular-nums"
            style={{
              backgroundColor: COLOR_SURFACE_OVERLAY,
              color: COLOR_TEXT_MUTED,
            }}
          >
            {Math.min((totalTokens / totalSessionTokens) * 100, 100).toFixed(1)}% of total
          </span>
        )}
      </div>

      {/* Session Metrics Breakdown */}
      {sessionMetrics && (
        <div
          className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 pt-2 text-[10px]"
          style={{ borderTop: `1px solid ${COLOR_BORDER_SUBTLE}` }}
        >
          {/* Cost */}
          {sessionMetrics.costUsd !== undefined && sessionMetrics.costUsd > 0 && (
            <div className="col-span-2">
              <span style={{ color: COLOR_TEXT_MUTED }}>Session Cost: </span>
              <span className="font-medium tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatCostUsd(sessionMetrics.costUsd)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Phase selector - only shown when compactions exist */}
      {phaseInfo && phaseInfo.phases.length > 1 && (
        <div
          className="mt-2 flex flex-wrap items-center gap-1 pt-2"
          style={{ borderTop: `1px solid ${COLOR_BORDER_SUBTLE}` }}
        >
          <span className="mr-1 text-[10px]" style={{ color: COLOR_TEXT_MUTED }}>
            Phase:
          </span>
          {phaseInfo.phases.map((phase) => (
            <button
              key={phase.phaseNumber}
              onClick={() =>
                onPhaseChange(phase.phaseNumber === selectedPhase ? null : phase.phaseNumber)
              }
              className="rounded px-1.5 py-0.5 text-[10px] transition-colors"
              style={{
                backgroundColor:
                  selectedPhase === phase.phaseNumber
                    ? 'rgba(99, 102, 241, 0.2)'
                    : COLOR_SURFACE_OVERLAY,
                color: selectedPhase === phase.phaseNumber ? '#818cf8' : COLOR_TEXT_MUTED,
              }}
            >
              {phase.phaseNumber}
            </button>
          ))}
          <button
            onClick={() => onPhaseChange(null)}
            className="rounded px-1.5 py-0.5 text-[10px] transition-colors"
            style={{
              backgroundColor:
                selectedPhase === null ? 'rgba(99, 102, 241, 0.2)' : COLOR_SURFACE_OVERLAY,
              color: selectedPhase === null ? '#818cf8' : COLOR_TEXT_MUTED,
            }}
          >
            Current
          </button>
        </div>
      )}

      {/* View mode toggle */}
      <div
        className="mt-2 flex items-center gap-1 pt-2"
        style={{ borderTop: `1px solid ${COLOR_BORDER_SUBTLE}` }}
      >
        <span className="mr-1 text-[10px]" style={{ color: COLOR_TEXT_MUTED }}>
          View:
        </span>
        <button
          onClick={() => onViewModeChange('category')}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
          style={{
            backgroundColor:
              viewMode === 'category' ? 'rgba(99, 102, 241, 0.2)' : COLOR_SURFACE_OVERLAY,
            color: viewMode === 'category' ? '#818cf8' : COLOR_TEXT_MUTED,
          }}
        >
          <LayoutList size={10} />
          Category
        </button>
        <button
          onClick={() => onViewModeChange('ranked')}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors"
          style={{
            backgroundColor:
              viewMode === 'ranked' ? 'rgba(99, 102, 241, 0.2)' : COLOR_SURFACE_OVERLAY,
            color: viewMode === 'ranked' ? '#818cf8' : COLOR_TEXT_MUTED,
          }}
        >
          <ArrowDownWideNarrow size={10} />
          By Size
        </button>
      </div>
    </div>
  );
};
