/**
 * ContextBadge - Displays a compact badge showing unified context injections.
 * Shows count of NEW injections (CLAUDE.md, mentioned files, tool outputs) with hover popover.
 * Replaces the standalone ClaudeMdBadge with a unified view of all context sources.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  COLOR_BORDER,
  COLOR_BORDER_SUBTLE,
  COLOR_SURFACE_RAISED,
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
  COLOR_TEXT_SECONDARY,
} from '@renderer/constants/cssVariables';
import { resolveAbsolutePath, shortenDisplayPath } from '@renderer/utils/pathDisplay';
import { formatTokensCompact as formatTokens } from '@shared/utils/tokenFormatting';
import { ChevronRight } from 'lucide-react';

import { CopyablePath } from '../common/CopyablePath';

import type {
  ClaudeMdContextInjection,
  ContextInjection,
  ContextStats,
  MentionedFileInjection,
  TaskCoordinationInjection,
  ThinkingTextInjection,
  ToolOutputInjection,
  UserMessageInjection,
} from '@renderer/types/contextInjection';

interface ContextBadgeProps {
  stats: ContextStats;
  projectRoot?: string;
}

/**
 * Type guard for ClaudeMdContextInjection.
 */
function isClaudeMdInjection(inj: ContextInjection): inj is ClaudeMdContextInjection {
  return inj.category === 'claude-md';
}

/**
 * Type guard for MentionedFileInjection.
 */
function isMentionedFileInjection(inj: ContextInjection): inj is MentionedFileInjection {
  return inj.category === 'mentioned-file';
}

/**
 * Type guard for ToolOutputInjection.
 */
function isToolOutputInjection(inj: ContextInjection): inj is ToolOutputInjection {
  return inj.category === 'tool-output';
}

/**
 * Type guard for ThinkingTextInjection.
 */
function isThinkingTextInjection(inj: ContextInjection): inj is ThinkingTextInjection {
  return inj.category === 'thinking-text';
}

/**
 * Type guard for TaskCoordinationInjection.
 */
function isTaskCoordinationInjection(inj: ContextInjection): inj is TaskCoordinationInjection {
  return inj.category === 'task-coordination';
}

/**
 * Type guard for UserMessageInjection.
 */
function isUserMessageInjection(inj: ContextInjection): inj is UserMessageInjection {
  return inj.category === 'user-message';
}

/**
 * Section component for expandable groups in the popover.
 */
const PopoverSection = ({
  title,
  count,
  tokenCount,
  children,
  defaultExpanded = false,
}: Readonly<{
  title: string;
  count: number;
  tokenCount: number;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}>): React.ReactElement => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div>
      {/* Section header */}
      <div
        role="button"
        tabIndex={0}
        className="mb-1 flex cursor-pointer items-center gap-1 text-xs font-medium hover:opacity-80"
        style={{ color: COLOR_TEXT_MUTED }}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setExpanded(!expanded);
          }
        }}
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <span>
          {title} ({count}) ~{formatTokens(tokenCount)} tokens
        </span>
      </div>
      {/* Section content */}
      {expanded && <div className="space-y-1.5 pl-4">{children}</div>}
    </div>
  );
};

export const ContextBadge = ({
  stats,
  projectRoot,
}: Readonly<ContextBadgeProps>): React.ReactElement | null => {
  const [showPopover, setShowPopover] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Calculate total new count
  const totalNew = useMemo(
    () =>
      stats.newCounts.claudeMd +
      stats.newCounts.mentionedFiles +
      stats.newCounts.toolOutputs +
      stats.newCounts.thinkingText +
      stats.newCounts.taskCoordination +
      stats.newCounts.userMessages,
    [stats.newCounts]
  );

  // Filter new injections by category
  const newClaudeMdInjections = useMemo(
    () => stats.newInjections.filter(isClaudeMdInjection),
    [stats.newInjections]
  );

  const newMentionedFileInjections = useMemo(
    () => stats.newInjections.filter(isMentionedFileInjection),
    [stats.newInjections]
  );

  const newToolOutputInjections = useMemo(
    () => stats.newInjections.filter(isToolOutputInjection),
    [stats.newInjections]
  );

  const newThinkingTextInjections = useMemo(
    () => stats.newInjections.filter(isThinkingTextInjection),
    [stats.newInjections]
  );

  const newTaskCoordinationInjections = useMemo(
    () => stats.newInjections.filter(isTaskCoordinationInjection),
    [stats.newInjections]
  );

  const newUserMessageInjections = useMemo(
    () => stats.newInjections.filter(isUserMessageInjection),
    [stats.newInjections]
  );

  // Calculate total new tokens
  const totalNewTokens = useMemo(
    () => stats.newInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [stats.newInjections]
  );

  // Calculate token totals per section
  const claudeMdTokens = useMemo(
    () => newClaudeMdInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newClaudeMdInjections]
  );

  const mentionedFileTokens = useMemo(
    () => newMentionedFileInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newMentionedFileInjections]
  );

  const toolOutputTokens = useMemo(
    () => newToolOutputInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newToolOutputInjections]
  );

  const thinkingTextTokens = useMemo(
    () => newThinkingTextInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newThinkingTextInjections]
  );

  const taskCoordinationTokens = useMemo(
    () => newTaskCoordinationInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newTaskCoordinationInjections]
  );

  const userMessageTokens = useMemo(
    () => newUserMessageInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [newUserMessageInjections]
  );

  // Linear-style neutral badge — uses theme-aware CSS variables
  const badgeStyle: React.CSSProperties = {
    backgroundColor: COLOR_SURFACE_RAISED,
    border: `1px solid ${COLOR_BORDER}`,
    color: COLOR_TEXT_SECONDARY,
  };

  // Calculate popover position based on trigger element
  useEffect(() => {
    if (showPopover && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverWidth = 300;
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
          minWidth: 260,
          maxWidth: 340,
          maxHeight,
          overflowY: 'auto',
          zIndex: 99999,
        });

        setArrowStyle({
          position: 'absolute',
          ...(openAbove
            ? {
                bottom: -4,
                borderRight: `1px solid ${COLOR_BORDER}`,
                borderBottom: `1px solid ${COLOR_BORDER}`,
                borderLeft: 'none',
                borderTop: 'none',
              }
            : {
                top: -4,
                borderLeft: `1px solid ${COLOR_BORDER}`,
                borderTop: `1px solid ${COLOR_BORDER}`,
                borderRight: 'none',
                borderBottom: 'none',
              }),
          [openLeft ? 'right' : 'left']: 12,
          width: 8,
          height: 8,
          transform: 'rotate(45deg)',
          backgroundColor: COLOR_SURFACE_RAISED,
        });
      });
    }
  }, [showPopover]);

  // Handle click outside and scroll to close popover
  useEffect(() => {
    if (!showPopover) return;

    const isInsideRect = (el: HTMLElement | null, x: number, y: number): boolean => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };

    const handleClickOutside = (e: MouseEvent): void => {
      // Use coordinate-based hit test — reliable with portals, scrollbars, and re-renders
      if (
        isInsideRect(popoverRef.current, e.clientX, e.clientY) ||
        isInsideRect(containerRef.current, e.clientX, e.clientY)
      ) {
        return;
      }
      setShowPopover(false);
    };

    const handleScroll = (e: Event): void => {
      // Don't close if scrolling inside the popover
      if (popoverRef.current && e.target instanceof Node && popoverRef.current.contains(e.target)) {
        return;
      }
      setShowPopover(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [showPopover]);

  // Only render if there are new injections
  if (totalNew === 0) {
    return null;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      ref={containerRef}
      className="relative inline-flex"
      onClick={(e) => {
        e.stopPropagation();
        setShowPopover(!showPopover);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          setShowPopover(!showPopover);
        }
      }}
    >
      {/* Badge */}
      <span
        className="inline-flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
        style={badgeStyle}
      >
        <span>Context</span>
        <span className="font-semibold">+{totalNew}</span>
      </span>

      {/* Popover - rendered via Portal to escape stacking context */}
      {showPopover &&
        createPortal(
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events -- dialog uses stopPropagation only, not interactive
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="false"
            aria-label="Context injection details"
            className="rounded-lg p-3 shadow-xl"
            style={{
              ...popoverStyle,
              backgroundColor: COLOR_SURFACE_RAISED,
              border: `1px solid ${COLOR_BORDER}`,
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Arrow pointer */}
            <div style={arrowStyle} />

            {/* Title */}
            <div
              className="mb-2 pb-2 text-xs font-semibold"
              style={{
                color: COLOR_TEXT,
                borderBottom: `1px solid ${COLOR_BORDER_SUBTLE}`,
              }}
            >
              New Context Injected In This Turn
            </div>

            {/* Sections */}
            <div className="space-y-3">
              {/* User Messages section */}
              {newUserMessageInjections.length > 0 && (
                <PopoverSection
                  title="User Messages"
                  count={newUserMessageInjections.length}
                  tokenCount={userMessageTokens}
                >
                  {newUserMessageInjections.map((injection) => (
                    <div key={injection.id} className="min-w-0">
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: COLOR_TEXT_SECONDARY }}>
                          Turn {injection.turnIndex + 1}
                        </span>
                        <span style={{ color: COLOR_TEXT_MUTED }}>
                          ~{formatTokens(injection.estimatedTokens)} tokens
                        </span>
                      </div>
                      {injection.textPreview && (
                        <div
                          className="mt-0.5 truncate text-xs italic"
                          style={{ color: COLOR_TEXT_MUTED, opacity: 0.8 }}
                        >
                          {injection.textPreview}
                        </div>
                      )}
                    </div>
                  ))}
                </PopoverSection>
              )}

              {/* CLAUDE.md Files section */}
              {newClaudeMdInjections.length > 0 && (
                <PopoverSection
                  title="CLAUDE.md Files"
                  count={newClaudeMdInjections.length}
                  tokenCount={claudeMdTokens}
                >
                  {newClaudeMdInjections.map((injection) => {
                    const displayPath =
                      shortenDisplayPath(injection.path, projectRoot) || injection.displayName;
                    const absolutePath = resolveAbsolutePath(injection.path, projectRoot);
                    return (
                      <div key={injection.id} className="min-w-0">
                        <CopyablePath
                          displayText={displayPath}
                          copyText={absolutePath}
                          className="text-xs"
                          style={{ color: COLOR_TEXT_SECONDARY }}
                        />
                        <div className="text-xs" style={{ color: COLOR_TEXT_MUTED }}>
                          ~{formatTokens(injection.estimatedTokens)} tokens
                        </div>
                      </div>
                    );
                  })}
                </PopoverSection>
              )}

              {/* Mentioned Files section */}
              {newMentionedFileInjections.length > 0 && (
                <PopoverSection
                  title="Mentioned Files"
                  count={newMentionedFileInjections.length}
                  tokenCount={mentionedFileTokens}
                >
                  {newMentionedFileInjections.map((injection) => {
                    const displayPath = shortenDisplayPath(injection.path, projectRoot);
                    const absolutePath = resolveAbsolutePath(injection.path, projectRoot);
                    return (
                      <div key={injection.id} className="min-w-0">
                        <CopyablePath
                          displayText={displayPath}
                          copyText={absolutePath}
                          className="text-xs"
                          style={{ color: COLOR_TEXT_SECONDARY }}
                        />
                        <div className="text-xs" style={{ color: COLOR_TEXT_MUTED }}>
                          ~{formatTokens(injection.estimatedTokens)} tokens
                        </div>
                      </div>
                    );
                  })}
                </PopoverSection>
              )}

              {/* Tool Outputs section */}
              {newToolOutputInjections.length > 0 && (
                <PopoverSection
                  title="Tool Outputs"
                  count={newToolOutputInjections.reduce(
                    (sum, inj) => sum + inj.toolBreakdown.length,
                    0
                  )}
                  tokenCount={toolOutputTokens}
                >
                  {newToolOutputInjections.map((injection) =>
                    injection.toolBreakdown.map((tool, idx) => (
                      <div
                        key={`${injection.id}-${tool.toolName}-${idx}`}
                        className="flex items-center justify-between text-xs"
                      >
                        <span style={{ color: COLOR_TEXT_SECONDARY }}>{tool.toolName}</span>
                        <span style={{ color: COLOR_TEXT_MUTED }}>
                          ~{formatTokens(tool.tokenCount)} tokens
                        </span>
                      </div>
                    ))
                  )}
                </PopoverSection>
              )}

              {/* Task Coordination section */}
              {newTaskCoordinationInjections.length > 0 && (
                <PopoverSection
                  title="Task Coordination"
                  count={newTaskCoordinationInjections.reduce(
                    (sum, inj) => sum + inj.breakdown.length,
                    0
                  )}
                  tokenCount={taskCoordinationTokens}
                >
                  {newTaskCoordinationInjections.map((injection) =>
                    injection.breakdown.map((item, idx) => (
                      <div
                        key={`${injection.id}-${item.label}-${idx}`}
                        className="flex items-center justify-between text-xs"
                      >
                        <span style={{ color: COLOR_TEXT_SECONDARY }}>{item.label}</span>
                        <span style={{ color: COLOR_TEXT_MUTED }}>
                          ~{formatTokens(item.tokenCount)} tokens
                        </span>
                      </div>
                    ))
                  )}
                </PopoverSection>
              )}

              {/* Thinking + Text section */}
              {newThinkingTextInjections.length > 0 && (
                <PopoverSection
                  title="Thinking + Text"
                  count={newThinkingTextInjections.length}
                  tokenCount={thinkingTextTokens}
                >
                  {newThinkingTextInjections.map((injection) => (
                    <div key={injection.id} className="min-w-0">
                      <div className="text-xs" style={{ color: COLOR_TEXT_SECONDARY }}>
                        Turn {injection.turnIndex + 1}
                      </div>
                      <div className="space-y-0.5 pl-2">
                        {injection.breakdown.map((item, idx) => (
                          <div
                            key={`${item.type}-${idx}`}
                            className="flex items-center justify-between text-xs"
                          >
                            <span style={{ color: COLOR_TEXT_MUTED }}>
                              {item.type === 'thinking' ? 'Thinking' : 'Text'}
                            </span>
                            <span style={{ color: COLOR_TEXT_MUTED }}>
                              ~{formatTokens(item.tokenCount)} tokens
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </PopoverSection>
              )}
            </div>

            {/* Total tokens footer */}
            <div
              className="mt-2 flex items-center justify-between pt-2 text-xs"
              style={{ borderTop: `1px solid ${COLOR_BORDER_SUBTLE}` }}
            >
              <span style={{ color: COLOR_TEXT_MUTED }}>Total new tokens</span>
              <span style={{ color: COLOR_TEXT_SECONDARY }}>
                ~{formatTokens(totalNewTokens)} tokens
              </span>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
