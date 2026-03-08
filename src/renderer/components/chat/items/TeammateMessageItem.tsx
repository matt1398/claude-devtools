import React, { useMemo } from 'react';

import {
  CARD_BG,
  CARD_BORDER_STYLE,
  CARD_HEADER_BG,
  CARD_ICON_MUTED,
  CARD_TEXT_LIGHT,
} from '@renderer/constants/cssVariables';
import { getTeamColorSet } from '@renderer/constants/teamColors';
import { formatTokensCompact } from '@renderer/utils/formatters';
import { ChevronRight, CornerDownLeft, MessageSquare, RefreshCw } from 'lucide-react';

import { MarkdownViewer } from '../viewers/MarkdownViewer';

import type { TeammateMessage } from '@renderer/types/groups';

// =============================================================================
// Types
// =============================================================================

interface TeammateMessageItemProps {
  teammateMessage: TeammateMessage;
  onClick: () => void;
  isExpanded: boolean;
  /** Callback to spotlight the reply link: pass toolId on hover, null on leave */
  onReplyHover?: (toolId: string | null) => void;
  /** Additional classes for highlighting (e.g., error deep linking) */
  highlightClasses?: string;
  /** Inline styles for highlighting (used by custom hex colors) */
  highlightStyle?: React.CSSProperties;
}

/** Operational noise types that should be rendered minimally */
const NOISE_TYPES = new Set([
  'idle_notification',
  'shutdown_approved',
  'teammate_terminated',
  'shutdown_request',
]);

/** Human-readable labels for noise message types */
const NOISE_LABELS: Record<string, string> = {
  idle_notification: 'Idle',
  shutdown_approved: 'Shutdown confirmed',
  teammate_terminated: 'Terminated',
  shutdown_request: 'Shutdown requested',
};

/**
 * Detect operational noise in teammate message content.
 * Returns label if noise, null if real content.
 */
function detectNoise(content: string, teammateId: string): string | null {
  // System messages are always noise
  if (teammateId === 'system') {
    const trimmed = content.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { type?: string; message?: string };
        if (parsed.type && NOISE_TYPES.has(parsed.type)) {
          return parsed.message ?? NOISE_LABELS[parsed.type] ?? parsed.type;
        }
      } catch {
        // Not JSON, fall through
      }
    }
    return trimmed.length < 200 ? trimmed : null;
  }

  // Non-system: check if content is a JSON operational message
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { type?: string };
    if (parsed.type && NOISE_TYPES.has(parsed.type)) {
      return NOISE_LABELS[parsed.type] ?? parsed.type;
    }
  } catch {
    // Not JSON
  }
  return null;
}

// =============================================================================
// Resend Detection
// =============================================================================

const RESEND_PATTERNS = [
  /\bresend/i,
  /\bre-send/i,
  /\bsent\b.{0,20}\bearlier/i,
  /\balready\s+sent/i,
  /\bsent\s+in\s+my\s+previous/i,
];

function isResendMessage(message: TeammateMessage): boolean {
  // Check summary first (cheaper)
  if (RESEND_PATTERNS.some((p) => p.test(message.summary))) return true;
  // Check first 300 chars of content
  const contentSnippet = message.content.slice(0, 300);
  return RESEND_PATTERNS.some((p) => p.test(contentSnippet));
}

// =============================================================================
// Component
// =============================================================================

/**
 * TeammateMessageItem - Card component for teammate messages.
 *
 * Visual distinction from SubagentItem:
 * - Left color accent border (3px)
 * - "Message" type label after name badge
 * - No metrics pill, no duration, no model info
 *
 * Operational noise (idle/shutdown/terminated) renders as minimal inline text.
 */
export const TeammateMessageItem: React.FC<TeammateMessageItemProps> = React.memo(({
  teammateMessage,
  onClick,
  isExpanded,
  onReplyHover,
  highlightClasses = '',
  highlightStyle,
}) => {
  const colors = getTeamColorSet(teammateMessage.color);

  // Detect operational noise
  const noiseLabel = useMemo(
    () => detectNoise(teammateMessage.content, teammateMessage.teammateId),
    [teammateMessage.content, teammateMessage.teammateId]
  );

  // Detect resent/duplicate messages
  const isResend = useMemo(() => isResendMessage(teammateMessage), [teammateMessage]);

  // Noise: minimal inline row (no card, no expand)
  if (noiseLabel) {
    return (
      <div className="flex items-center gap-2 px-3 py-1" style={{ opacity: 0.45 }}>
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors.border }} />
        <span className="text-[11px]" style={{ color: CARD_ICON_MUTED }}>
          {teammateMessage.teammateId}
        </span>
        <span className="text-[11px]" style={{ color: CARD_ICON_MUTED }}>
          {noiseLabel}
        </span>
      </div>
    );
  }

  // Real message: full card with visual distinction
  const truncatedSummary =
    teammateMessage.summary.length > 80
      ? teammateMessage.summary.slice(0, 80) + '...'
      : teammateMessage.summary;

  return (
    <div
      className={`overflow-hidden rounded-md transition-all duration-300 ${highlightClasses}`}
      style={{
        backgroundColor: CARD_BG,
        border: CARD_BORDER_STYLE,
        borderLeft: `3px solid ${colors.border}`,
        opacity: isResend ? 0.6 : undefined,
        ...highlightStyle,
      }}
    >
      {/* Header */}
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
        <ChevronRight
          className={`size-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          style={{ color: CARD_ICON_MUTED }}
        />

        {/* Message icon — distinguishes from SubagentItem's Bot/dot icon */}
        <MessageSquare className="size-3.5 shrink-0" style={{ color: colors.border }} />

        {/* Teammate name badge */}
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide"
          style={{
            backgroundColor: colors.badge,
            color: colors.text,
            border: `1px solid ${colors.border}40`,
          }}
        >
          {teammateMessage.teammateId}
        </span>

        {/* "Message" type label — parallels SubagentItem's model info */}
        <span className="text-[10px] uppercase tracking-wide" style={{ color: CARD_ICON_MUTED }}>
          Message
        </span>

        {/* Reply indicator — shows which SendMessage triggered this response */}
        {teammateMessage.replyToSummary && (
          <span
            role="presentation"
            className="flex cursor-default items-center gap-1 text-[10px]"
            style={{ color: CARD_ICON_MUTED }}
            onMouseEnter={() => onReplyHover?.(teammateMessage.replyToToolId ?? null)}
            onMouseLeave={() => onReplyHover?.(null)}
          >
            <CornerDownLeft className="size-2.5" />
            <span className="truncate" style={{ maxWidth: '180px' }}>
              {teammateMessage.replyToSummary}
            </span>
          </span>
        )}

        {/* Resend badge — marks duplicate/resent messages */}
        {isResend && (
          <span
            className="flex items-center gap-0.5 text-[10px]"
            style={{ color: CARD_ICON_MUTED }}
          >
            <RefreshCw className="size-2.5" />
            Resent
          </span>
        )}

        {/* Summary */}
        <span className="flex-1 truncate text-xs" style={{ color: CARD_TEXT_LIGHT }}>
          {truncatedSummary || 'Teammate message'}
        </span>

        {/* Context impact — tokens injected into main session */}
        {teammateMessage.tokenCount != null && teammateMessage.tokenCount > 0 && (
          <span
            className="shrink-0 font-mono text-[11px] tabular-nums"
            style={{ color: CARD_ICON_MUTED }}
          >
            ~{formatTokensCompact(teammateMessage.tokenCount)} tokens
          </span>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-3">
          <MarkdownViewer content={teammateMessage.content} copyable />
        </div>
      )}
    </div>
  );
});
