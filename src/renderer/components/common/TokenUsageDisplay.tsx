/**
 * TokenUsageDisplay - Compact token usage display with detailed breakdown on hover.
 * Shows total tokens with an info icon that reveals a popover with:
 * - Input tokens breakdown
 * - Cache read/write tokens
 * - Output tokens
 * - Optional model information
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { COLOR_TEXT_MUTED, COLOR_TEXT_SECONDARY } from '@renderer/constants/cssVariables';
import { formatCostUsd } from '@shared/utils/costFormatting';
import { getModelColorClass } from '@shared/utils/modelParser';
import {
  formatTokensCompact as formatTokens,
  formatTokensDetailed,
} from '@shared/utils/tokenFormatting';
import { ChevronRight, Info } from 'lucide-react';

import type { ClaudeMdStats } from '@renderer/types/claudeMd';
import type { ContextStats } from '@renderer/types/contextInjection';
import type { ModelInfo } from '@shared/utils/modelParser';

interface TokenUsageDisplayProps {
  /** Input tokens count */
  inputTokens: number;
  /** Output tokens count */
  outputTokens: number;
  /** Cache read tokens count */
  cacheReadTokens: number;
  /** Cache creation/write tokens count */
  cacheCreationTokens: number;
  /** Thinking tokens (extended thinking content) - estimated from content */
  thinkingTokens?: number;
  /** Text output tokens (Claude's text responses) - estimated from content */
  textOutputTokens?: number;
  /** Optional model name for display */
  modelName?: string;
  /** Optional model family for color styling */
  modelFamily?: ModelInfo['family'];
  /** Size variant - 'sm' for compact, 'md' for slightly larger */
  size?: 'sm' | 'md';
  /** Optional CLAUDE.md injection statistics (deprecated, use contextStats) */
  claudeMdStats?: ClaudeMdStats;
  /** Optional unified context statistics */
  contextStats?: ContextStats;
  /** Phase number for this AI group */
  phaseNumber?: number;
  /** Total number of phases in the session */
  totalPhases?: number;
  /** Optional USD cost for this usage */
  costUsd?: number;
}

/**
 * Expandable section showing session-wide context breakdown.
 * Shows accumulated totals for CLAUDE.md, mentioned files, tool outputs, and thinking+text.
 */
const SessionContextSection = ({
  contextStats,
  totalTokens,
  thinkingTokens = 0,
  textOutputTokens = 0,
}: Readonly<{
  contextStats: ContextStats;
  totalTokens: number;
  thinkingTokens?: number;
  textOutputTokens?: number;
}>): React.JSX.Element => {
  const [expanded, setExpanded] = useState(false);

  const { tokensByCategory } = contextStats;

  // Calculate combined thinking+text tokens and include in context total
  const thinkingTextTokens = thinkingTokens + textOutputTokens;
  const adjustedContextTotal = contextStats.totalEstimatedTokens + thinkingTextTokens;
  const contextPercent =
    totalTokens > 0 ? Math.min((adjustedContextTotal / totalTokens) * 100, 100).toFixed(1) : '0.0';

  // Count accumulated injections by category
  const claudeMdCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'claude-md'
  ).length;
  const mentionedFilesCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'mentioned-file'
  ).length;
  const toolOutputsCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'tool-output'
  ).length;
  const taskCoordinationCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'task-coordination'
  ).length;
  const userMessagesCount = contextStats.accumulatedInjections.filter(
    (inj) => inj.category === 'user-message'
  ).length;

  // Calculate percentages for each category
  const claudeMdPercent =
    totalTokens > 0
      ? Math.min((tokensByCategory.claudeMd / totalTokens) * 100, 100).toFixed(1)
      : '0.0';
  const mentionedFilesPercent =
    totalTokens > 0
      ? Math.min((tokensByCategory.mentionedFiles / totalTokens) * 100, 100).toFixed(1)
      : '0.0';
  const toolOutputsPercent =
    totalTokens > 0
      ? Math.min((tokensByCategory.toolOutputs / totalTokens) * 100, 100).toFixed(1)
      : '0.0';
  const thinkingTextPercent =
    totalTokens > 0 ? Math.min((thinkingTextTokens / totalTokens) * 100, 100).toFixed(1) : '0.0';
  const taskCoordinationPercent =
    totalTokens > 0
      ? Math.min((tokensByCategory.taskCoordination / totalTokens) * 100, 100).toFixed(1)
      : '0.0';
  const userMessagesPercent =
    totalTokens > 0
      ? Math.min((tokensByCategory.userMessages / totalTokens) * 100, 100).toFixed(1)
      : '0.0';

  return (
    <div className="mt-1">
      {/* Divider */}
      <div className="my-1" style={{ borderTop: '1px solid var(--color-border-subtle)' }} />

      {/* Header - clickable to expand */}
      <div
        role="button"
        tabIndex={0}
        className="-mx-1 flex cursor-pointer items-center justify-between gap-3 rounded px-1 py-0.5 transition-colors hover:bg-white/5"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <div className="flex items-center gap-1" style={{ color: COLOR_TEXT_MUTED }}>
          <ChevronRight
            className={`size-3 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className="whitespace-nowrap text-[10px]">Visible Context</span>
        </div>
        <span
          className="whitespace-nowrap text-[10px] tabular-nums"
          style={{ color: COLOR_TEXT_MUTED }}
        >
          {formatTokens(adjustedContextTotal)} ({contextPercent}%)
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-1 space-y-1.5 pl-4">
          {/* CLAUDE.md */}
          {tokensByCategory.claudeMd > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                CLAUDE.md <span className="opacity-60">×{claudeMdCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.claudeMd)}{' '}
                <span className="opacity-60">({claudeMdPercent}%)</span>
              </span>
            </div>
          )}

          {/* Mentioned Files */}
          {tokensByCategory.mentionedFiles > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                @files <span className="opacity-60">×{mentionedFilesCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.mentionedFiles)}{' '}
                <span className="opacity-60">({mentionedFilesPercent}%)</span>
              </span>
            </div>
          )}

          {/* Tool Outputs */}
          {tokensByCategory.toolOutputs > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                Tool Outputs <span className="opacity-60">×{toolOutputsCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.toolOutputs)}{' '}
                <span className="opacity-60">({toolOutputsPercent}%)</span>
              </span>
            </div>
          )}

          {/* Task Coordination */}
          {tokensByCategory.taskCoordination > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                Task Coordination <span className="opacity-60">×{taskCoordinationCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.taskCoordination)}{' '}
                <span className="opacity-60">({taskCoordinationPercent}%)</span>
              </span>
            </div>
          )}

          {/* User Messages */}
          {tokensByCategory.userMessages > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>
                User Messages <span className="opacity-60">×{userMessagesCount}</span>
              </span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(tokensByCategory.userMessages)}{' '}
                <span className="opacity-60">({userMessagesPercent}%)</span>
              </span>
            </div>
          )}

          {/* Thinking + Text */}
          {thinkingTextTokens > 0 && (
            <div className="flex items-center justify-between text-[10px]">
              <span style={{ color: COLOR_TEXT_MUTED }}>Thinking + Text</span>
              <span className="tabular-nums" style={{ color: COLOR_TEXT_SECONDARY }}>
                {formatTokens(thinkingTextTokens)}{' '}
                <span className="opacity-60">({thinkingTextPercent}%)</span>
              </span>
            </div>
          )}

          {/* Hint about session scope */}
          <div
            className="pt-0.5 text-[9px] italic"
            style={{ color: COLOR_TEXT_MUTED, opacity: 0.7 }}
          >
            Accumulated across entire session without duplication
          </div>
        </div>
      )}
    </div>
  );
};

export const TokenUsageDisplay = ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
  thinkingTokens = 0,
  textOutputTokens = 0,
  modelName,
  modelFamily,
  size = 'sm',
  claudeMdStats,
  contextStats,
  phaseNumber,
  totalPhases,
  costUsd,
}: Readonly<TokenUsageDisplayProps>): React.JSX.Element => {
  const totalTokens = inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens;
  const formattedTotal = formatTokens(totalTokens);

  // Size-based classes
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  // Model color based on family
  const modelColorClass = modelFamily ? getModelColorClass(modelFamily) : '';

  // Use React state for hover instead of CSS group-hover to avoid
  // interference with parent components that also use the 'group' class
  const [showPopover, setShowPopover] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);

  // Clear timeout helper
  const clearHideTimeout = (): void => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  // Show popover immediately, clear any pending hide
  const handleMouseEnter = (): void => {
    clearHideTimeout();
    setShowPopover(true);
  };

  // Hide popover with delay (allows mouse to move to popover)
  const handleMouseLeave = (): void => {
    // Don't hide while dragging inside the popover
    if (isDraggingRef.current) return;
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      setShowPopover(false);
    }, 150);
  };

  // Cleanup timeout on unmount and close on scroll
  useEffect(() => {
    return () => clearHideTimeout();
  }, []);

  // Close popover on scroll
  useEffect(() => {
    if (!showPopover) return;

    const handleScroll = (e: Event): void => {
      // Don't close if scrolling inside the popover
      if (popoverRef.current && e.target instanceof Node && popoverRef.current.contains(e.target)) {
        return;
      }
      setShowPopover(false);
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [showPopover]);

  // Calculate popover position based on trigger element
  useEffect(() => {
    if (showPopover && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverWidth = 220;
      const margin = 12;

      // Determine if popover should open left or right
      const openLeft = rect.left + popoverWidth > viewportWidth - 20;

      // Determine if popover should open above or below
      const spaceBelow = viewportHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const openAbove = spaceBelow < 200 && spaceAbove > spaceBelow;

      const maxHeight = Math.max(openAbove ? spaceAbove : spaceBelow, 120) - 8;

      queueMicrotask(() => {
        setPopoverStyle({
          position: 'fixed',
          ...(openAbove ? { bottom: viewportHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
          left: openLeft ? rect.right - popoverWidth : rect.left,
          minWidth: 200,
          maxWidth: 280,
          maxHeight,
          overflowY: 'auto',
          zIndex: 99999,
        });

        setArrowStyle({
          position: 'absolute',
          ...(openAbove
            ? {
                bottom: -4,
                borderRight: '1px solid var(--color-border)',
                borderBottom: '1px solid var(--color-border)',
                borderLeft: 'none',
                borderTop: 'none',
              }
            : {
                top: -4,
                borderLeft: '1px solid var(--color-border)',
                borderTop: '1px solid var(--color-border)',
                borderRight: 'none',
                borderBottom: 'none',
              }),
          [openLeft ? 'right' : 'left']: 8,
          width: 8,
          height: 8,
          transform: 'rotate(45deg)',
          backgroundColor: 'var(--color-surface-raised)',
        });
      });
    }
  }, [showPopover]);

  return (
    <div
      className={`inline-flex items-center gap-1 ${textSize}`}
      style={{ color: COLOR_TEXT_MUTED }}
    >
      <span className="font-medium">{formattedTotal}</span>
      {totalPhases && totalPhases > 1 && phaseNumber && (
        <span
          className="rounded px-1 py-0.5 text-[10px]"
          style={{ backgroundColor: 'rgba(99, 102, 241, 0.15)', color: '#818cf8' }}
        >
          Phase {phaseNumber}/{totalPhases}
        </span>
      )}
      <div
        ref={containerRef}
        role="button"
        tabIndex={0}
        className="relative"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={(e) => {
          // Don't close if focus moved into the popover
          if (popoverRef.current?.contains(e.relatedTarget as Node)) return;
          handleMouseLeave();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setShowPopover(!showPopover);
          }
        }}
        aria-expanded={showPopover}
        aria-haspopup="true"
      >
        <Info
          className={`${iconSize} cursor-help transition-colors`}
          style={{ color: COLOR_TEXT_MUTED }}
        />
        {/* Popover - rendered via Portal to escape stacking context */}
        {showPopover &&
          createPortal(
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- tooltip uses mouse handlers for hover/drag behavior, not interactive
            <div
              ref={popoverRef}
              role="tooltip"
              className="rounded-lg p-3 shadow-xl"
              style={{
                ...popoverStyle,
                backgroundColor: 'var(--color-surface-raised)',
                border: '1px solid var(--color-border)',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onMouseDown={(e) => {
                e.stopPropagation();
                isDraggingRef.current = true;
                const handleMouseUp = (): void => {
                  isDraggingRef.current = false;
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                document.addEventListener('mouseup', handleMouseUp);
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Arrow pointer */}
              <div style={arrowStyle} />

              <div className="space-y-2 text-xs">
                {/* Input Tokens */}
                <div className="flex items-center justify-between">
                  <span style={{ color: COLOR_TEXT_MUTED }}>Input Tokens</span>
                  <span
                    className="font-medium tabular-nums"
                    style={{ color: COLOR_TEXT_SECONDARY }}
                  >
                    {formatTokensDetailed(inputTokens)}
                  </span>
                </div>

                {/* Cache Read */}
                <div className="flex items-center justify-between">
                  <span style={{ color: COLOR_TEXT_MUTED }}>Cache Read</span>
                  <span
                    className="font-medium tabular-nums"
                    style={{ color: COLOR_TEXT_SECONDARY }}
                  >
                    {formatTokensDetailed(cacheReadTokens)}
                  </span>
                </div>

                {/* Cache Write/Creation */}
                <div className="flex items-center justify-between">
                  <span style={{ color: COLOR_TEXT_MUTED }}>Cache Write</span>
                  <span
                    className="font-medium tabular-nums"
                    style={{ color: COLOR_TEXT_SECONDARY }}
                  >
                    {formatTokensDetailed(cacheCreationTokens)}
                  </span>
                </div>

                {/* Output Tokens */}
                <div className="flex items-center justify-between">
                  <span style={{ color: COLOR_TEXT_MUTED }}>Output Tokens</span>
                  <span
                    className="font-medium tabular-nums"
                    style={{ color: COLOR_TEXT_SECONDARY }}
                  >
                    {formatTokensDetailed(outputTokens)}
                  </span>
                </div>

                {/* Divider before Total */}
                <div
                  className="my-1"
                  style={{ borderTop: '1px solid var(--color-border-subtle)' }}
                />

                {/* Total */}
                <div className="flex items-center justify-between">
                  <span className="font-medium" style={{ color: COLOR_TEXT_SECONDARY }}>
                    Total
                  </span>
                  <span
                    className="font-medium tabular-nums"
                    style={{ color: 'var(--color-text-primary, var(--color-text))' }}
                  >
                    {formatTokensDetailed(totalTokens)}
                  </span>
                </div>

                {/* Cost (USD) - if available */}
                {costUsd !== undefined && costUsd > 0 && (
                  <div className="mt-1 flex items-center justify-between text-[10px]">
                    <span style={{ color: COLOR_TEXT_SECONDARY }}>Cost (USD)</span>
                    <span
                      className="tabular-nums"
                      style={{ color: 'var(--color-text-primary, var(--color-text))' }}
                    >
                      {formatCostUsd(costUsd)}
                    </span>
                  </div>
                )}

                {/* Visible Context Breakdown - expandable section */}
                {contextStats &&
                  (contextStats.totalEstimatedTokens > 0 ||
                    thinkingTokens > 0 ||
                    textOutputTokens > 0) && (
                    <SessionContextSection
                      contextStats={contextStats}
                      totalTokens={totalTokens}
                      thinkingTokens={thinkingTokens}
                      textOutputTokens={textOutputTokens}
                    />
                  )}

                {/* CLAUDE.md Breakdown - fallback when contextStats not provided (deprecated) */}
                {!contextStats && claudeMdStats && (
                  <div
                    className="mt-1 flex items-center justify-between text-[10px]"
                    style={{ color: COLOR_TEXT_MUTED }}
                  >
                    <span className="whitespace-nowrap italic">
                      incl. CLAUDE.md ×{claudeMdStats.accumulatedCount}
                    </span>
                    <span className="tabular-nums">
                      {totalTokens > 0
                        ? ((claudeMdStats.totalEstimatedTokens / totalTokens) * 100).toFixed(1)
                        : '0.0'}
                      %
                    </span>
                  </div>
                )}

                {/* Model Info (optional) */}
                {modelName && (
                  <>
                    <div
                      className="my-1"
                      style={{ borderTop: '1px solid var(--color-border-subtle)' }}
                    />
                    <div className="flex items-center justify-between">
                      <span style={{ color: COLOR_TEXT_MUTED }}>Model</span>
                      <span
                        className={`font-medium ${modelColorClass}`}
                        style={!modelColorClass ? { color: COLOR_TEXT_SECONDARY } : {}}
                      >
                        {modelName}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body
          )}
      </div>
    </div>
  );
};
