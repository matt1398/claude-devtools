/**
 * RankedInjectionList - All context injections sorted by token size descending.
 * Injections are shown as grouped rows (e.g., "Tool output in Turn N").
 * Tool-output rows are expandable to reveal individual tool breakdowns sorted desc.
 * Individual tools support deep-link navigation to the exact tool in chat.
 * CLAUDE.md and File items show a copy-path button.
 */

import React, { useMemo, useState } from 'react';

import { CopyButton } from '@renderer/components/common/CopyButton';
import { COLOR_TEXT_MUTED, COLOR_TEXT_SECONDARY } from '@renderer/constants/cssVariables';
import { ChevronRight } from 'lucide-react';

import { formatTokens } from '../utils/formatting';
import { parseTurnIndex } from '../utils/pathParsing';

import type { ContextInjection, ToolOutputInjection } from '@renderer/types/contextInjection';

// =============================================================================
// Constants
// =============================================================================

const CATEGORY_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  'claude-md': { bg: 'rgba(99, 102, 241, 0.15)', text: '#818cf8', label: 'CLAUDE.md' },
  'mentioned-file': { bg: 'rgba(52, 211, 153, 0.15)', text: '#34d399', label: 'File' },
  'tool-output': { bg: 'rgba(251, 191, 36, 0.15)', text: '#fbbf24', label: 'Tool' },
  'thinking-text': { bg: 'rgba(167, 139, 250, 0.15)', text: '#a78bfa', label: 'Thinking' },
  'task-coordination': { bg: 'rgba(251, 146, 60, 0.15)', text: '#fb923c', label: 'Team' },
  'user-message': { bg: 'rgba(96, 165, 250, 0.15)', text: '#60a5fa', label: 'User' },
};

// =============================================================================
// Props
// =============================================================================

interface RankedInjectionListProps {
  injections: ContextInjection[];
  onNavigateToTurn?: (turnIndex: number) => void;
  onNavigateToTool?: (turnIndex: number, toolUseId: string) => void;
  onNavigateToUserGroup?: (turnIndex: number) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function getInjectionDescription(injection: ContextInjection): string {
  switch (injection.category) {
    case 'claude-md':
      return injection.displayName || injection.path;
    case 'mentioned-file':
      return injection.displayName;
    case 'tool-output':
      return `${injection.toolCount} tool${injection.toolCount !== 1 ? 's' : ''} in Turn ${injection.turnIndex + 1}`;
    case 'thinking-text':
      return `Turn ${injection.turnIndex + 1} thinking/text`;
    case 'task-coordination':
      return `Turn ${injection.turnIndex + 1} coordination`;
    case 'user-message':
      return injection.textPreview;
  }
}

function getInjectionTurnIndex(injection: ContextInjection): number {
  switch (injection.category) {
    case 'claude-md':
      return parseTurnIndex(injection.firstSeenInGroup);
    case 'mentioned-file':
      return injection.firstSeenTurnIndex;
    case 'tool-output':
    case 'thinking-text':
    case 'task-coordination':
    case 'user-message':
      return injection.turnIndex;
  }
}

/** Get copyable path for path-based injections. */
function getCopyablePath(injection: ContextInjection): string | null {
  if (injection.category === 'claude-md') return injection.path;
  if (injection.category === 'mentioned-file') return injection.path;
  return null;
}

// =============================================================================
// Sub-components
// =============================================================================

/** Expandable tool-output row with breakdown sorted by token count desc. */
const ToolOutputRankedItem = ({
  injection,
  onNavigateToTurn,
  onNavigateToTool,
}: Readonly<{
  injection: ToolOutputInjection;
  onNavigateToTurn?: (turnIndex: number) => void;
  onNavigateToTool?: (turnIndex: number, toolUseId: string) => void;
}>): React.ReactElement => {
  const [expanded, setExpanded] = useState(false);
  const hasBreakdown = injection.toolBreakdown.length > 0;
  const categoryInfo = CATEGORY_COLORS['tool-output'];

  const sortedBreakdown = useMemo(
    () => [...injection.toolBreakdown].sort((a, b) => b.tokenCount - a.tokenCount),
    [injection.toolBreakdown]
  );

  return (
    <div>
      <button
        onClick={() => {
          if (hasBreakdown) {
            setExpanded(!expanded);
          } else if (onNavigateToTurn) {
            const turnIndex = getInjectionTurnIndex(injection);
            if (turnIndex >= 0) onNavigateToTurn(turnIndex);
          }
        }}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        {/* Expand chevron */}
        {hasBreakdown && (
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
            style={{ color: COLOR_TEXT_MUTED }}
          />
        )}
        {/* Category pill */}
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
          style={{ backgroundColor: categoryInfo.bg, color: categoryInfo.text }}
        >
          {categoryInfo.label}
        </span>
        {/* Description */}
        <span className="min-w-0 flex-1 truncate text-xs" style={{ color: COLOR_TEXT_SECONDARY }}>
          {getInjectionDescription(injection)}
        </span>
        {/* Token count */}
        <span
          className="shrink-0 text-xs font-medium tabular-nums"
          style={{ color: COLOR_TEXT_MUTED }}
        >
          {formatTokens(injection.estimatedTokens)}
        </span>
      </button>

      {/* Expanded tool breakdown */}
      {expanded && hasBreakdown && (
        <div className="ml-7 space-y-0.5 pb-1">
          {sortedBreakdown.map((tool, idx) => (
            <button
              key={`${tool.toolName}-${idx}`}
              onClick={() => {
                if (tool.toolUseId && onNavigateToTool) {
                  onNavigateToTool(injection.turnIndex, tool.toolUseId);
                } else if (onNavigateToTurn) {
                  onNavigateToTurn(injection.turnIndex);
                }
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-0.5 text-left text-xs transition-colors hover:bg-white/5"
            >
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: categoryInfo.bg, color: categoryInfo.text }}
              >
                {tool.toolName}
              </span>
              <span className="flex-1" />
              <span
                className="shrink-0 tabular-nums"
                style={{ color: COLOR_TEXT_MUTED, opacity: 0.8 }}
              >
                {formatTokens(tool.tokenCount)}
              </span>
              {tool.isError && (
                <span
                  className="shrink-0 rounded px-1 py-0.5"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    color: '#ef4444',
                    fontSize: '10px',
                  }}
                >
                  error
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Component
// =============================================================================

export const RankedInjectionList = ({
  injections,
  onNavigateToTurn,
  onNavigateToTool,
  onNavigateToUserGroup,
}: Readonly<RankedInjectionListProps>): React.ReactElement => {
  const sortedInjections = useMemo(
    () => [...injections].sort((a, b) => b.estimatedTokens - a.estimatedTokens),
    [injections]
  );

  return (
    <div className="space-y-0.5">
      {sortedInjections.map((inj) => {
        // Tool-output: expandable row
        if (inj.category === 'tool-output') {
          return (
            <ToolOutputRankedItem
              key={inj.id}
              injection={inj}
              onNavigateToTurn={onNavigateToTurn}
              onNavigateToTool={onNavigateToTool}
            />
          );
        }

        const categoryInfo = CATEGORY_COLORS[inj.category] ?? {
          bg: 'rgba(161, 161, 170, 0.15)',
          text: '#a1a1aa',
          label: inj.category,
        };
        const copyPath = getCopyablePath(inj);

        const handleClick = (): void => {
          const turnIndex = getInjectionTurnIndex(inj);
          if (turnIndex < 0) return;
          // User messages → navigate to user group; others → navigate to AI group
          if (inj.category === 'user-message' && onNavigateToUserGroup) {
            onNavigateToUserGroup(turnIndex);
          } else if (onNavigateToTurn) {
            onNavigateToTurn(turnIndex);
          }
        };

        return (
          <div key={inj.id} className="flex items-center gap-0.5">
            <button
              onClick={handleClick}
              className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-white/5"
            >
              {/* Category pill */}
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium"
                style={{ backgroundColor: categoryInfo.bg, color: categoryInfo.text }}
              >
                {categoryInfo.label}
              </span>
              {/* Description */}
              <span
                className="min-w-0 flex-1 truncate text-xs"
                style={{ color: COLOR_TEXT_SECONDARY }}
              >
                {getInjectionDescription(inj)}
              </span>
              {/* Token count */}
              <span
                className="shrink-0 text-xs font-medium tabular-nums"
                style={{ color: COLOR_TEXT_MUTED }}
              >
                {formatTokens(inj.estimatedTokens)}
              </span>
            </button>
            {/* Copy path button for CLAUDE.md and File items */}
            {copyPath && (
              <span className="shrink-0">
                <CopyButton text={copyPath} inline />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
