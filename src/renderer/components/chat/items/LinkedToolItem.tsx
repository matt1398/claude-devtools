/**
 * LinkedToolItem
 *
 * Main component for rendering linked tool calls in the chat view.
 * Uses specialized viewers for different tool types and shared utilities
 * for summary generation and token calculation.
 */

import React, { useRef } from 'react';

import { CARD_ICON_MUTED } from '@renderer/constants/cssVariables';
import { getTeamColorSet } from '@renderer/constants/teamColors';
import {
  getToolContextTokens,
  getToolStatus,
  getToolSummary,
  hasBashContent,
  hasEditContent,
  hasReadContent,
  hasSkillInstructions,
  hasWriteContent,
} from '@renderer/utils/toolRendering';
import {
  getToolHighlightProps,
  getTriggerColorDef,
  isPresetColorKey,
  TOOL_HIGHLIGHT_CLASSES,
  type TriggerColor,
} from '@shared/constants/triggerColors';
import { Wrench } from 'lucide-react';

import { BaseItem, StatusDot } from './BaseItem';
import { formatDuration } from './baseItemHelpers';
import {
  BashToolViewer,
  DefaultToolViewer,
  EditToolViewer,
  ReadToolViewer,
  SkillToolViewer,
  ToolErrorDisplay,
  WriteToolViewer,
} from './linkedTool';

import type { LinkedToolItem as LinkedToolItemType } from '@renderer/types/groups';

interface LinkedToolItemProps {
  linkedTool: LinkedToolItemType;
  onClick: () => void;
  isExpanded: boolean;
  /** Whether this item should be highlighted for error deep linking */
  isHighlighted?: boolean;
  /** Custom highlight color from trigger */
  highlightColor?: TriggerColor;
  /** Notification dot color for this tool item */
  notificationDotColor?: TriggerColor;
  /** Optional ref registration callback for external scroll control */
  registerRef?: (el: HTMLDivElement | null) => void;
}

export const LinkedToolItem: React.FC<LinkedToolItemProps> = ({
  linkedTool,
  onClick,
  isExpanded,
  isHighlighted,
  highlightColor,
  notificationDotColor,
  registerRef,
}) => {
  const status = getToolStatus(linkedTool);
  const summary = getToolSummary(linkedTool.name, linkedTool.input);
  const elementRef = useRef<HTMLDivElement>(null);

  // Combined ref callback - handles both internal ref and external registration
  const handleRef = (el: HTMLDivElement | null): void => {
    // Update internal ref
    (elementRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    // Call external registration if provided
    registerRef?.(el);
  };

  // Render teammate_spawned results as a minimal inline row
  const isTeammateSpawned = linkedTool.result?.toolUseResult?.status === 'teammate_spawned';
  if (isTeammateSpawned) {
    const teamResult = linkedTool.result!.toolUseResult!;
    const name = (teamResult.name as string) || 'teammate';
    const color = (teamResult.color as string) || '';
    const colors = getTeamColorSet(color);
    return (
      <div ref={handleRef} className="flex items-center gap-2 px-3 py-1.5">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: colors.border }} />
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: colors.badge, color: colors.text }}
        >
          {name}
        </span>
        <span className="text-xs" style={{ color: CARD_ICON_MUTED }}>
          Teammate spawned
        </span>
      </div>
    );
  }

  // Render SendMessage shutdown_request as a minimal inline row
  const isShutdownRequest =
    linkedTool.name === 'SendMessage' && linkedTool.input?.type === 'shutdown_request';
  if (isShutdownRequest) {
    const target = (linkedTool.input?.recipient as string) || 'teammate';
    return (
      <div ref={handleRef} className="flex items-center gap-2 px-3 py-1.5">
        <span className="size-2 rounded-full bg-zinc-500" />
        <span className="text-xs" style={{ color: CARD_ICON_MUTED }}>
          Shutdown requested &rarr;{' '}
          <span className="font-medium text-text-secondary">{target}</span>
        </span>
      </div>
    );
  }

  // Note: We no longer scroll locally - the navigation coordinator handles this
  // via the registered ref. This prevents double-scroll issues.

  // Highlight animation for error deep linking (supports custom hex)
  const effectiveColor = highlightColor ?? 'red';
  let highlightClasses = '';
  let highlightStyle: React.CSSProperties | undefined;
  if (isHighlighted) {
    if (isPresetColorKey(effectiveColor)) {
      highlightClasses = TOOL_HIGHLIGHT_CLASSES[effectiveColor];
    } else {
      const hp = getToolHighlightProps(effectiveColor);
      highlightClasses = hp.className;
      highlightStyle = hp.style;
    }
  }

  // Determine which specialized viewer to use
  const useReadViewer =
    linkedTool.name === 'Read' && hasReadContent(linkedTool) && !linkedTool.result?.isError;
  const useEditViewer = linkedTool.name === 'Edit' && hasEditContent(linkedTool);
  const useWriteViewer =
    linkedTool.name === 'Write' && hasWriteContent(linkedTool) && !linkedTool.result?.isError;
  const useSkillViewer = linkedTool.name === 'Skill' && hasSkillInstructions(linkedTool);
  const useBashViewer = linkedTool.name === 'Bash' && hasBashContent(linkedTool);
  const useDefaultViewer =
    !useReadViewer && !useEditViewer && !useWriteViewer && !useSkillViewer && !useBashViewer;

  // Check if we should show error display for Read/Write tools
  const showReadError = linkedTool.name === 'Read' && linkedTool.result?.isError;
  const showWriteError = linkedTool.name === 'Write' && linkedTool.result?.isError;

  return (
    <div ref={handleRef}>
      <BaseItem
        icon={
          <Wrench
            className="size-4"
            style={{ color: isHighlighted ? getTriggerColorDef(highlightColor).hex : undefined }}
          />
        }
        label={linkedTool.name}
        summary={summary}
        tokenCount={getToolContextTokens(linkedTool)}
        status={status}
        durationMs={linkedTool.durationMs}
        onClick={onClick}
        isExpanded={isExpanded}
        highlightClasses={highlightClasses}
        highlightStyle={highlightStyle}
        notificationDotColor={notificationDotColor}
      >
        {/* Read tool with CodeBlockViewer */}
        {useReadViewer && <ReadToolViewer linkedTool={linkedTool} />}

        {/* Edit tool with DiffViewer */}
        {useEditViewer && <EditToolViewer linkedTool={linkedTool} status={status} />}

        {/* Write tool */}
        {useWriteViewer && <WriteToolViewer linkedTool={linkedTool} />}

        {/* Skill tool with instructions */}
        {useSkillViewer && <SkillToolViewer linkedTool={linkedTool} />}

        {/* Bash tool with syntax-highlighted command */}
        {useBashViewer && <BashToolViewer linkedTool={linkedTool} status={status} />}

        {/* Default rendering for other tools */}
        {useDefaultViewer && <DefaultToolViewer linkedTool={linkedTool} status={status} />}

        {/* Error output for Read tool */}
        {showReadError && <ToolErrorDisplay linkedTool={linkedTool} />}

        {/* Error output for Write tool */}
        {showWriteError && <ToolErrorDisplay linkedTool={linkedTool} />}

        {/* Orphaned indicator */}
        {linkedTool.isOrphaned && (
          <div
            className="flex items-center gap-2 text-xs italic"
            style={{ color: 'var(--tool-item-muted)' }}
          >
            <StatusDot status="orphaned" />
            No result received
          </div>
        )}

        {/* Timing */}
        <div className="text-xs" style={{ color: 'var(--tool-item-muted)' }}>
          Duration: {formatDuration(linkedTool.durationMs)}
        </div>
      </BaseItem>
    </div>
  );
};
