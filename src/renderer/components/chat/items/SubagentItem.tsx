import React, { useCallback, useMemo, useState } from 'react';

import {
  CARD_BG,
  CARD_BORDER_STYLE,
  CARD_HEADER_BG,
  CARD_HEADER_HOVER,
  CARD_ICON_MUTED,
  CARD_SEPARATOR,
  CARD_TEXT_LIGHT,
  CARD_TEXT_LIGHTER,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_SECONDARY,
  TAG_BG,
  TAG_BORDER,
  TAG_TEXT,
} from '@renderer/constants/cssVariables';
import { getTeamColorSet } from '@renderer/constants/teamColors';
import { useTabUI } from '@renderer/hooks/useTabUI';
import { useStore } from '@renderer/store';
import { buildDisplayItemsFromMessages, buildSummary } from '@renderer/utils/aiGroupEnhancer';
import { computeSubagentPhaseBreakdown } from '@renderer/utils/aiGroupHelpers';
import { formatDuration, formatTokensCompact } from '@renderer/utils/formatters';
import { getHighlightProps, type TriggerColor } from '@shared/constants/triggerColors';
import { getModelColorClass, parseModelString } from '@shared/utils/modelParser';
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Loader2,
  Sigma,
  Terminal,
} from 'lucide-react';

import { ExecutionTrace } from './ExecutionTrace';
import { MetricsPill } from './MetricsPill';

import type { Process, SemanticStep } from '@renderer/types/data';

// =============================================================================
// Types
// =============================================================================

interface SubagentItemProps {
  step: SemanticStep;
  subagent: Process;
  onClick: () => void;
  isExpanded: boolean;
  aiGroupId: string;
  /** Tool use ID to highlight for error deep linking */
  highlightToolUseId?: string;
  /** Custom highlight color from trigger */
  highlightColor?: TriggerColor;
  /** Map of tool use ID to trigger color for notification dots */
  notificationColorMap?: Map<string, TriggerColor>;
  /** Optional callback to register tool element refs for scroll targeting */
  registerToolRef?: (toolId: string, el: HTMLDivElement | null) => void;
}

// =============================================================================
// Main Component - Linear-style DevTools Card
// =============================================================================

export const SubagentItem: React.FC<SubagentItemProps> = ({
  step,
  subagent,
  onClick,
  isExpanded,
  aiGroupId,
  highlightToolUseId,
  highlightColor,
  notificationColorMap,
  registerToolRef,
}) => {
  const description = subagent.description ?? step.content.subagentDescription ?? 'Subagent';
  const subagentType = subagent.subagentType ?? 'Task';
  const truncatedDesc = description.length > 60 ? description.slice(0, 60) + '...' : description;

  // Team member colors (when this subagent is a team member)
  const teamColors = subagent.team ? getTeamColorSet(subagent.team.memberColor) : null;

  // Detect shutdown-only team activations (trivial: just a shutdown_response)
  const isShutdownOnly = useMemo(() => {
    if (!subagent.team || !subagent.messages?.length) return false;
    const assistantMsgs = subagent.messages.filter((m) => m.type === 'assistant');
    if (assistantMsgs.length !== 1) return false;
    const calls = assistantMsgs[0].toolCalls ?? [];
    return (
      calls.length === 1 &&
      calls[0].name === 'SendMessage' &&
      calls[0].input?.type === 'shutdown_response'
    );
  }, [subagent.team, subagent.messages]);

  // Per-tab trace expansion state (replaces local useState for true per-tab isolation)
  const { isSubagentTraceExpanded, toggleSubagentTraceExpansion } = useTabUI();
  const isTraceManuallyExpanded = isSubagentTraceExpanded(subagent.id);

  // Check if contains highlighted error
  // Also matches when the highlight targets the parent Task tool_use that spawned this subagent
  const containsHighlightedError = useMemo(() => {
    if (!highlightToolUseId) return false;
    // Match parent Task tool_use ID (trigger matched the Task call itself)
    if (subagent.parentTaskId === highlightToolUseId) return true;
    // Match inner tool calls/results within the subagent
    if (!subagent.messages) return false;
    for (const msg of subagent.messages) {
      if (msg.toolCalls?.some((tc) => tc.id === highlightToolUseId)) return true;
      if (msg.toolResults?.some((tr) => tr.toolUseId === highlightToolUseId)) return true;
    }
    return false;
  }, [highlightToolUseId, subagent.parentTaskId, subagent.messages]);

  // Build display items
  const displayItems = useMemo(() => {
    if ((!isExpanded && !containsHighlightedError) || !subagent.messages?.length) {
      return [];
    }
    return buildDisplayItemsFromMessages(subagent.messages, []);
  }, [isExpanded, containsHighlightedError, subagent.messages]);

  // Build summary
  const itemsSummary = useMemo(() => {
    if (!isExpanded && !containsHighlightedError) {
      const toolCount =
        subagent.messages?.filter(
          (m) =>
            m.type === 'assistant' &&
            Array.isArray(m.content) &&
            m.content.some((b) => b.type === 'tool_use')
        ).length ?? 0;
      return toolCount > 0 ? `${toolCount} tools` : '';
    }
    return buildSummary(displayItems);
  }, [isExpanded, containsHighlightedError, displayItems, subagent.messages]);

  // Model info
  const modelInfo = useMemo(() => {
    const msg = subagent.messages?.find(
      (m) => m.type === 'assistant' && m.model && m.model !== '<synthetic>'
    );
    return msg?.model ? parseModelString(msg.model) : null;
  }, [subagent.messages]);

  // Last usage
  const lastUsage = useMemo(() => {
    const messages = subagent.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === 'assistant' && messages[i].usage) {
        return messages[i].usage;
      }
    }
    return null;
  }, [subagent.messages]);

  // Multi-phase context breakdown (for subagents with compaction)
  const phaseData = useMemo(() => {
    if (!subagent.messages?.length) return null;
    return computeSubagentPhaseBreakdown(subagent.messages);
  }, [subagent.messages]);

  // Search expansion
  const searchExpandedSubagentIds = useStore((s) => s.searchExpandedSubagentIds);
  const searchCurrentSubagentItemId = useStore((s) => s.searchCurrentSubagentItemId);
  const shouldExpandForSearch = searchExpandedSubagentIds.has(subagent.id);

  // Combine manual expansion with auto-expansion for errors/search
  const isTraceExpanded =
    isTraceManuallyExpanded || containsHighlightedError || shouldExpandForSearch;
  const [isTraceHeaderHovered, setIsTraceHeaderHovered] = useState(false);

  // Outer card highlight when this subagent contains the highlighted tool
  const outerHighlight = useMemo(() => {
    if (!containsHighlightedError)
      return { className: '', style: undefined as React.CSSProperties | undefined };
    return getHighlightProps(highlightColor);
  }, [containsHighlightedError, highlightColor]);

  // Register outer card as a tool ref target for the parent Task tool_use ID
  // so the navigation controller can scroll directly to this SubagentItem
  const outerCardRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (subagent.parentTaskId && registerToolRef) {
        registerToolRef(subagent.parentTaskId, el);
      }
    },
    [subagent.parentTaskId, registerToolRef]
  );

  // Cumulative metrics for team members — show total output generated
  const cumulativeMetrics = useMemo(() => {
    if (!subagent.team || !subagent.metrics) return undefined;
    const turnCount =
      subagent.messages?.filter((m) => m.type === 'assistant' && m.usage).length ?? 0;
    return {
      outputTokens: subagent.metrics.outputTokens,
      turnCount,
    };
  }, [subagent.team, subagent.metrics, subagent.messages]);

  // Computed values for metrics
  const hasMainImpact = subagent.mainSessionImpact && subagent.mainSessionImpact.totalTokens > 0;
  const hasIsolated = lastUsage && lastUsage.input_tokens + lastUsage.output_tokens > 0;
  const isMultiPhase = phaseData != null && phaseData.compactionCount > 0;
  const isolatedTotal = isMultiPhase
    ? phaseData.totalConsumption
    : lastUsage
      ? lastUsage.input_tokens +
        lastUsage.output_tokens +
        (lastUsage.cache_read_input_tokens ?? 0) +
        (lastUsage.cache_creation_input_tokens ?? 0)
      : 0;

  // Shutdown-only team activations: minimal inline row (no metrics, no expand)
  if (isShutdownOnly && teamColors && subagent.team) {
    return (
      <div
        className="flex items-center gap-2 rounded-md px-3 py-1.5"
        style={{
          backgroundColor: CARD_BG,
          border: CARD_BORDER_STYLE,
          opacity: 0.6,
        }}
      >
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: teamColors.border }}
        />
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
          style={{
            backgroundColor: teamColors.badge,
            color: teamColors.text,
            border: `1px solid ${teamColors.border}40`,
          }}
        >
          {subagent.team.memberName}
        </span>
        <span className="text-xs" style={{ color: CARD_ICON_MUTED }}>
          Shutdown confirmed
        </span>
        <span className="flex-1" />
        <span
          className="shrink-0 font-mono text-[11px] tabular-nums"
          style={{ color: CARD_ICON_MUTED }}
        >
          {formatDuration(subagent.durationMs)}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={outerCardRef}
      className={`overflow-hidden rounded-md transition-all duration-300 ${outerHighlight.className}`}
      style={{
        backgroundColor: CARD_BG,
        border: CARD_BORDER_STYLE,
        ...outerHighlight.style,
      }}
    >
      {/* ========== Level 1: Clickable Header ========== */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors"
        style={{
          backgroundColor: isExpanded ? CARD_HEADER_BG : 'transparent',
          borderBottom: isExpanded ? CARD_BORDER_STYLE : 'none',
        }}
      >
        {/* Expand chevron */}
        <ChevronRight
          className={`size-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          style={{ color: CARD_ICON_MUTED }}
        />

        {/* Icon - colored dot for team members, Bot icon for regular subagents */}
        {teamColors ? (
          <span
            className="size-3.5 shrink-0 rounded-full"
            style={{ backgroundColor: teamColors.border }}
          />
        ) : (
          <Bot
            className="size-4 shrink-0"
            style={{ color: subagent.isOngoing ? '#3b82f6' : COLOR_TEXT_MUTED }}
          />
        )}

        {/* Type badge - team member name or generic type */}
        {teamColors && subagent.team ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
            style={{
              backgroundColor: teamColors.badge,
              color: teamColors.text,
              border: `1px solid ${teamColors.border}40`,
            }}
          >
            {subagent.team.memberName}
          </span>
        ) : (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{
              backgroundColor: TAG_BG,
              color: TAG_TEXT,
              border: `1px solid ${TAG_BORDER}`,
            }}
          >
            {subagentType}
          </span>
        )}

        {/* Model */}
        {modelInfo && (
          <span className={`text-[11px] ${getModelColorClass(modelInfo.family)}`}>
            {modelInfo.name}
          </span>
        )}

        {/* Description */}
        <span className="flex-1 truncate text-xs" style={{ color: CARD_TEXT_LIGHT }}>
          {truncatedDesc}
        </span>

        {/* Status indicator */}
        {subagent.isOngoing ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" style={{ color: '#3b82f6' }} />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0" style={{ color: '#22c55e' }} />
        )}

        {/* Unified Metrics Pill — team members don't show mainSessionImpact
            (spawn cost only; real main impact comes from teammate messages) */}
        <MetricsPill
          mainSessionImpact={subagent.team ? undefined : subagent.mainSessionImpact}
          lastUsage={lastUsage ?? undefined}
          isolatedLabel={subagent.team ? 'Context Window' : undefined}
          isolatedOverride={
            phaseData && phaseData.compactionCount > 0 ? phaseData.totalConsumption : undefined
          }
          phaseBreakdown={phaseData?.phases}
        />

        {/* Duration */}
        <span
          className="shrink-0 font-mono text-[11px] tabular-nums"
          style={{ color: CARD_ICON_MUTED }}
        >
          {formatDuration(subagent.durationMs)}
        </span>
      </div>

      {/* ========== Level 1 Expanded: Dashboard Content ========== */}
      {isExpanded && (
        <div className="space-y-3 p-3">
          {/* ========== Row 1: Meta Info (Horizontal Flow) ========== */}
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
            style={{ color: COLOR_TEXT_MUTED }}
          >
            <span>
              <span style={{ color: CARD_ICON_MUTED }}>Type</span>{' '}
              <span className="font-mono" style={{ color: CARD_TEXT_LIGHT }}>
                {subagentType}
              </span>
            </span>
            <span style={{ color: CARD_SEPARATOR }}>•</span>
            <span>
              <span style={{ color: CARD_ICON_MUTED }}>Duration</span>{' '}
              <span className="font-mono tabular-nums" style={{ color: CARD_TEXT_LIGHT }}>
                {formatDuration(subagent.durationMs)}
              </span>
            </span>
            {modelInfo && (
              <>
                <span style={{ color: CARD_SEPARATOR }}>•</span>
                <span>
                  <span style={{ color: CARD_ICON_MUTED }}>Model</span>{' '}
                  <span className={`font-mono ${getModelColorClass(modelInfo.family)}`}>
                    {modelInfo.name}
                  </span>
                </span>
              </>
            )}
            <span style={{ color: CARD_SEPARATOR }}>•</span>
            <span>
              <span style={{ color: CARD_ICON_MUTED }}>ID</span>{' '}
              <span
                className="inline-block max-w-[120px] truncate align-bottom font-mono"
                style={{ color: CARD_ICON_MUTED }}
                title={subagent.id}
              >
                {subagent.id.slice(0, 8)}
              </span>
            </span>
          </div>

          {/* ========== Row 2: Context Usage (Clean List) ========== */}
          {(hasMainImpact ?? hasIsolated) && (
            <div className="pt-2">
              {/* Overline title */}
              <div
                className="mb-2 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: CARD_ICON_MUTED }}
              >
                Context Usage
              </div>

              {/* Token rows - floating alignment */}
              <div className="space-y-1.5">
                {hasMainImpact && !subagent.team && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ArrowUpRight
                        className="size-3"
                        style={{ color: 'rgba(251, 191, 36, 0.7)' }}
                      />
                      <span className="text-xs" style={{ color: COLOR_TEXT_SECONDARY }}>
                        Main Context
                      </span>
                    </div>
                    <span
                      className="font-mono text-xs font-medium tabular-nums"
                      style={{ color: CARD_TEXT_LIGHTER }}
                    >
                      {subagent.mainSessionImpact!.totalTokens.toLocaleString()}
                    </span>
                  </div>
                )}

                {cumulativeMetrics && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sigma className="size-3" style={{ color: 'rgba(168, 85, 247, 0.7)' }} />
                      <span className="text-xs" style={{ color: COLOR_TEXT_SECONDARY }}>
                        Total Output
                      </span>
                    </div>
                    <span
                      className="font-mono text-xs font-medium tabular-nums"
                      style={{ color: CARD_TEXT_LIGHTER }}
                    >
                      {cumulativeMetrics.outputTokens.toLocaleString()}
                      <span style={{ color: CARD_ICON_MUTED }}>
                        {' '}
                        ({cumulativeMetrics.turnCount} turns)
                      </span>
                    </span>
                  </div>
                )}

                {hasIsolated && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CircleDot className="size-3" style={{ color: 'rgba(56, 189, 248, 0.7)' }} />
                      <span className="text-xs" style={{ color: COLOR_TEXT_SECONDARY }}>
                        {subagent.team ? 'Context Window' : 'Subagent Context'}
                      </span>
                    </div>
                    <span
                      className="font-mono text-xs font-medium tabular-nums"
                      style={{ color: CARD_TEXT_LIGHTER }}
                    >
                      {isolatedTotal.toLocaleString()}
                    </span>
                  </div>
                )}

                {/* Per-phase breakdown when multi-phase */}
                {isMultiPhase &&
                  phaseData.phases.map((phase) => (
                    <div key={phase.phaseNumber} className="flex items-center justify-between pl-5">
                      <span className="text-[11px]" style={{ color: CARD_ICON_MUTED }}>
                        Phase {phase.phaseNumber}
                      </span>
                      <span
                        className="font-mono text-[11px] tabular-nums"
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
              </div>
            </div>
          )}

          {/* ========== Level 2: Execution Trace Toggle ========== */}
          {displayItems.length > 0 && (
            <div
              className="overflow-hidden rounded-md"
              style={{
                border: CARD_BORDER_STYLE,
                backgroundColor: CARD_HEADER_BG,
              }}
            >
              {/* Trace Header (clickable) */}
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSubagentTraceExpansion(subagent.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSubagentTraceExpansion(subagent.id);
                  }
                }}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors"
                style={{
                  borderBottom: isTraceExpanded ? CARD_BORDER_STYLE : 'none',
                  backgroundColor: isTraceHeaderHovered ? CARD_HEADER_HOVER : 'transparent',
                }}
                onMouseEnter={() => setIsTraceHeaderHovered(true)}
                onMouseLeave={() => setIsTraceHeaderHovered(false)}
              >
                <ChevronRight
                  className={`size-3 shrink-0 transition-transform ${isTraceExpanded ? 'rotate-90' : ''}`}
                  style={{ color: CARD_ICON_MUTED }}
                />
                <Terminal className="size-3.5" style={{ color: CARD_ICON_MUTED }} />
                <span className="text-xs" style={{ color: COLOR_TEXT_SECONDARY }}>
                  Execution Trace
                </span>
                <span className="text-[11px]" style={{ color: CARD_ICON_MUTED }}>
                  · {itemsSummary}
                </span>
              </div>

              {/* Trace Content */}
              {isTraceExpanded && (
                <div className="p-2">
                  <ExecutionTrace
                    items={displayItems}
                    aiGroupId={aiGroupId}
                    highlightToolUseId={highlightToolUseId}
                    highlightColor={highlightColor}
                    notificationColorMap={notificationColorMap}
                    searchExpandedItemId={
                      shouldExpandForSearch ? searchCurrentSubagentItemId : null
                    }
                    registerToolRef={registerToolRef}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
