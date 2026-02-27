import React from 'react';

import { TOOL_ITEM_MUTED } from '@renderer/constants/cssVariables';
import { getStepVariantStyle, type StepVariant } from '@renderer/constants/stepVariants';
import { getTriggerColorDef, type TriggerColor } from '@shared/constants/triggerColors';
import { ChevronRight } from 'lucide-react';

import { formatDuration, formatTokens, getStatusDotColor } from './baseItemHelpers';

// =============================================================================
// Types
// =============================================================================

export type ItemStatus = 'ok' | 'error' | 'pending' | 'orphaned';

interface BaseItemProps {
  /** Icon component to display */
  icon: React.ReactNode;
  /** Primary label (e.g., "Thinking", "Output", tool name) */
  label: string;
  /** Summary text shown after the label */
  summary?: string;
  /** Token count to display */
  tokenCount?: number;
  /** Label for tokens (default: "tokens") */
  tokenLabel?: string;
  /** Status indicator (green/red/gray dot) */
  status?: ItemStatus;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Click handler for toggling */
  onClick: () => void;
  /** Whether the item is expanded */
  isExpanded: boolean;
  /** Whether the item has expandable content */
  hasExpandableContent?: boolean;
  /** Additional classes for highlighting (e.g., error deep linking) */
  highlightClasses?: string;
  /** Inline styles for highlighting (used by custom hex colors) */
  highlightStyle?: React.CSSProperties;
  /** Notification dot color for custom triggers */
  notificationDotColor?: TriggerColor;
  /** Step variant for color-coded borders and icons */
  variant?: StepVariant;
  /** Children rendered when expanded */
  children?: React.ReactNode;
}

// =============================================================================
// Helper Components
// =============================================================================

/**
 * Small status dot indicator.
 */
export const StatusDot: React.FC<{ status: ItemStatus }> = ({ status }) => {
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: getStatusDotColor(status) }}
    />
  );
};

// =============================================================================
// Main Component
// =============================================================================

/**
 * BaseItem provides a consistent layout for all expandable items in the chat view.
 *
 * Layout:
 * - Clickable header row with icon, label, summary, tokens, status, and chevron
 * - Expanded content area with left border indent
 *
 * Used by: ThinkingItem, TextItem, LinkedToolItem, SlashItem, SubagentItem
 */
export const BaseItem: React.FC<BaseItemProps> = ({
  icon,
  label,
  summary,
  tokenCount,
  tokenLabel = 'tokens',
  status,
  durationMs,
  onClick,
  isExpanded,
  hasExpandableContent = true,
  highlightClasses = '',
  highlightStyle,
  notificationDotColor,
  variant,
  children,
}) => {
  const variantStyle = variant ? getStepVariantStyle(variant) : undefined;

  return (
    <div
      className={`rounded transition-all duration-300 ${highlightClasses}`}
      style={highlightStyle}
    >
      {/* Clickable Header */}
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
        className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
        style={{ backgroundColor: 'transparent' }}
        onMouseEnter={(e) =>
          Object.assign(e.currentTarget.style, { backgroundColor: 'var(--tool-item-hover-bg)' })
        }
        onMouseLeave={(e) =>
          Object.assign(e.currentTarget.style, { backgroundColor: 'transparent' })
        }
      >
        {/* Icon */}
        <span className="size-4 shrink-0" style={{ color: variantStyle?.iconColor ?? TOOL_ITEM_MUTED }}>
          {icon}
        </span>

        {/* Label */}
        <span className="text-[13px] font-medium" style={{ color: 'var(--tool-item-name)' }}>
          {label}
        </span>

        {/* Separator and Summary */}
        {summary && (
          <>
            <span className="text-sm" style={{ color: TOOL_ITEM_MUTED }}>
              -
            </span>
            <span className="flex-1 truncate text-sm" style={{ color: 'var(--tool-item-summary)' }}>
              {summary}
            </span>
          </>
        )}

        {/* Spacer if no summary */}
        {!summary && <span className="flex-1" />}

        {/* Token count badge */}
        {tokenCount != null && tokenCount > 0 && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-xs"
            style={{
              color: TOOL_ITEM_MUTED,
              backgroundColor: 'var(--tool-item-badge-bg)',
            }}
          >
            ~{formatTokens(tokenCount)} {tokenLabel}
          </span>
        )}

        {/* Status indicator - hidden when notification dot replaces it */}
        {status && !notificationDotColor && <StatusDot status={status} />}

        {/* Notification dot (replaces status dot when present) */}
        {notificationDotColor && (
          <span
            className="inline-block size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: getTriggerColorDef(notificationDotColor).hex }}
          />
        )}

        {/* Duration */}
        {durationMs !== undefined && (
          <span className="shrink-0 text-xs" style={{ color: TOOL_ITEM_MUTED }}>
            {formatDuration(durationMs)}
          </span>
        )}

        {/* Expand/collapse chevron */}
        {hasExpandableContent && (
          <ChevronRight
            className={`size-3 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            style={{ color: TOOL_ITEM_MUTED }}
          />
        )}
      </div>

      {/* Expanded Content */}
      {isExpanded && children && (
        <div
          className="animate-expand ml-2 mt-2 space-y-3 pl-6"
          style={{ borderLeft: `2px solid ${variantStyle?.borderColor ?? 'var(--color-border)'}` }}
        >
          {children}
        </div>
      )}
    </div>
  );
};
