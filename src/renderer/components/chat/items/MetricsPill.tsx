import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  CARD_ICON_MUTED,
  CARD_SEPARATOR,
  CARD_TEXT_LIGHT,
  COLOR_TEXT_MUTED,
  TAG_BG,
  TAG_BORDER,
  TAG_TEXT,
} from '@renderer/constants/cssVariables';
import { formatTokensCompact } from '@renderer/utils/formatters';

// =============================================================================
// Types
// =============================================================================
import type { PhaseTokenBreakdown } from '@renderer/types/data';

interface MetricsPillProps {
  mainSessionImpact?: {
    callTokens: number;
    resultTokens: number;
    totalTokens: number;
  };
  lastUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  /** Label override for the right segment (e.g. "Context Window" for team members) */
  isolatedLabel?: string;
  /** Override isolated total (for multi-phase total consumption) */
  isolatedOverride?: number;
  /** Phase breakdown for tooltip (shown when multiple phases exist) */
  phaseBreakdown?: PhaseTokenBreakdown[];
}

// =============================================================================
// Unified Metrics Pill - Compact monospace pill with tooltip
// =============================================================================

export const MetricsPill = ({
  mainSessionImpact,
  lastUsage,
  isolatedLabel,
  isolatedOverride,
  phaseBreakdown,
}: Readonly<MetricsPillProps>): React.ReactElement | null => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasMainImpact = mainSessionImpact && mainSessionImpact.totalTokens > 0;
  const hasIsolated =
    isolatedOverride != null
      ? isolatedOverride > 0
      : lastUsage && lastUsage.input_tokens + lastUsage.output_tokens > 0;

  const isolatedTotal =
    isolatedOverride ??
    (lastUsage
      ? lastUsage.input_tokens +
        lastUsage.output_tokens +
        (lastUsage.cache_read_input_tokens ?? 0) +
        (lastUsage.cache_creation_input_tokens ?? 0)
      : 0);

  const hasPhases = phaseBreakdown && phaseBreakdown.length > 1;

  const clearHideTimeout = (): void => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const handleMouseEnter = (): void => {
    clearHideTimeout();
    setShowTooltip(true);
  };

  const handleMouseLeave = (): void => {
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => setShowTooltip(false), 100);
  };

  useEffect(() => {
    if (showTooltip && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const tooltipWidth = 220;
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;
      if (left < 8) left = 8;
      if (left + tooltipWidth > window.innerWidth - 8) {
        left = window.innerWidth - tooltipWidth - 8;
      }
      setTooltipStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 6,
        left,
        width: tooltipWidth,
        zIndex: 99999,
      });
    }
  }, [showTooltip]);

  useEffect(() => {
    if (!showTooltip) return;
    const handleScroll = (): void => setShowTooltip(false);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [showTooltip]);

  useEffect(() => {
    return () => clearHideTimeout();
  }, []);

  if (!hasMainImpact && !hasIsolated) {
    return null;
  }

  const mainValue = hasMainImpact ? formatTokensCompact(mainSessionImpact.totalTokens) : null;
  const isolatedValue = hasIsolated ? formatTokensCompact(isolatedTotal) : null;
  const rightLabel = isolatedLabel ?? 'Subagent Context';

  return (
    <>
      <div
        ref={containerRef}
        role="tooltip"
        className="inline-flex cursor-default items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px]"
        style={{
          backgroundColor: TAG_BG,
          border: `1px solid ${TAG_BORDER}`,
          color: TAG_TEXT,
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {mainValue && <span className="tabular-nums">{mainValue}</span>}
        {mainValue && isolatedValue && <span style={{ color: CARD_SEPARATOR }}>|</span>}
        {isolatedValue && <span className="tabular-nums">{isolatedValue}</span>}
      </div>

      {showTooltip &&
        createPortal(
          <div
            role="tooltip"
            className="rounded-md bg-surface-overlay p-2 text-[11px] shadow-xl"
            style={{
              ...tooltipStyle,
              border: `1px solid ${TAG_BORDER}`,
              backdropFilter: 'blur(8px)',
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="space-y-1">
              {hasMainImpact && (
                <div className="flex items-center justify-between gap-3">
                  <span style={{ color: COLOR_TEXT_MUTED }}>Main Context</span>
                  <span className="font-mono tabular-nums" style={{ color: CARD_TEXT_LIGHT }}>
                    {mainSessionImpact.totalTokens.toLocaleString()}
                  </span>
                </div>
              )}
              {hasIsolated && (
                <div className="flex items-center justify-between gap-3">
                  <span style={{ color: COLOR_TEXT_MUTED }}>{rightLabel}</span>
                  <span className="font-mono tabular-nums" style={{ color: CARD_TEXT_LIGHT }}>
                    {isolatedTotal.toLocaleString()}
                  </span>
                </div>
              )}
              {hasPhases &&
                phaseBreakdown.map((phase) => (
                  <div
                    key={phase.phaseNumber}
                    className="flex items-center justify-between gap-3 pl-2"
                  >
                    <span className="text-[10px]" style={{ color: CARD_ICON_MUTED }}>
                      Phase {phase.phaseNumber}
                    </span>
                    <span
                      className="font-mono text-[10px] tabular-nums"
                      style={{ color: CARD_ICON_MUTED }}
                    >
                      {formatTokensCompact(phase.peakTokens)}
                      {phase.postCompaction != null && (
                        <span style={{ color: '#4ade80' }}>
                          {' '}
                          → {formatTokensCompact(phase.postCompaction)}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              <div
                className="mt-1 pt-1.5 text-[10px]"
                style={{ borderTop: `1px solid ${TAG_BORDER}`, color: CARD_ICON_MUTED }}
              >
                {hasMainImpact && hasIsolated
                  ? 'Left: parent injection · Right: internal'
                  : hasMainImpact
                    ? 'Tokens injected to parent'
                    : 'Internal token usage'}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
