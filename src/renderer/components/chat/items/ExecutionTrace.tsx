import React, { useState } from 'react';

import {
  CARD_ICON_MUTED,
  CODE_BG,
  CODE_BORDER,
  COLOR_TEXT_MUTED,
  TOOL_CALL_BG,
  TOOL_CALL_BORDER,
  TOOL_CALL_TEXT,
} from '@renderer/constants/cssVariables';
import { truncateText } from '@renderer/utils/aiGroupEnhancer';
import { formatTokensCompact } from '@renderer/utils/formatters';
import { format } from 'date-fns';
import { ChevronRight, Layers, MailOpen } from 'lucide-react';

import { MarkdownViewer } from '../viewers/MarkdownViewer';

import { BaseItem } from './BaseItem';
import { LinkedToolItem } from './LinkedToolItem';
import { TeammateMessageItem } from './TeammateMessageItem';
import { TextItem } from './TextItem';
import { ThinkingItem } from './ThinkingItem';

import type { AIGroupDisplayItem } from '@renderer/types/groups';
import type { TriggerColor } from '@shared/constants/triggerColors';

// =============================================================================
// Types
// =============================================================================

interface ExecutionTraceProps {
  items: AIGroupDisplayItem[];
  aiGroupId: string;
  highlightToolUseId?: string;
  /** Custom highlight color from trigger */
  highlightColor?: TriggerColor;
  /** Map of tool use ID to trigger color for notification dots */
  notificationColorMap?: Map<string, TriggerColor>;
  searchExpandedItemId?: string | null;
  /** Optional callback to register tool element refs for scroll targeting */
  registerToolRef?: (toolId: string, el: HTMLDivElement | null) => void;
}

// =============================================================================
// Execution Trace Component
// =============================================================================

export const ExecutionTrace: React.FC<ExecutionTraceProps> = ({
  items,
  aiGroupId: _aiGroupId,
  highlightToolUseId,
  highlightColor,
  notificationColorMap,
  searchExpandedItemId,
  registerToolRef,
}): React.JSX.Element => {
  const [manualExpandedItemId, setManualExpandedItemId] = useState<string | null>(null);

  // Use searchExpandedItemId if set, otherwise use manually expanded item
  const expandedItemId = searchExpandedItemId ?? manualExpandedItemId;

  const handleItemClick = (itemId: string): void => {
    setManualExpandedItemId((prev) => (prev === itemId ? null : itemId));
  };

  if (!items || items.length === 0) {
    return (
      <div className="px-3 py-2 text-xs" style={{ color: CARD_ICON_MUTED }}>
        No execution items
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((item, index) => {
        switch (item.type) {
          case 'thinking': {
            const itemId = `subagent-thinking-${index}`;
            const thinkingStep = {
              id: itemId,
              type: 'thinking' as const,
              startTime: item.timestamp,
              endTime: item.timestamp,
              durationMs: 0,
              content: { thinkingText: item.content, tokenCount: item.tokenCount },
              tokens: { input: 0, output: item.tokenCount ?? 0 },
              context: 'subagent' as const,
            };
            const preview = truncateText(item.content, 150);
            const isExpanded = expandedItemId === itemId;
            return (
              <ThinkingItem
                key={itemId}
                step={thinkingStep}
                preview={preview}
                onClick={() => handleItemClick(itemId)}
                isExpanded={isExpanded}
              />
            );
          }

          case 'output': {
            const itemId = `subagent-output-${index}`;
            const textStep = {
              id: itemId,
              type: 'output' as const,
              startTime: item.timestamp,
              endTime: item.timestamp,
              durationMs: 0,
              content: { outputText: item.content, tokenCount: item.tokenCount },
              tokens: { input: 0, output: item.tokenCount ?? 0 },
              context: 'subagent' as const,
            };
            const preview = truncateText(item.content, 150);
            const isExpanded = expandedItemId === itemId;
            return (
              <TextItem
                key={itemId}
                step={textStep}
                preview={preview}
                onClick={() => handleItemClick(itemId)}
                isExpanded={isExpanded}
              />
            );
          }

          case 'tool': {
            const itemId = `subagent-tool-${item.tool.id}`;
            const isExpanded = expandedItemId === itemId;
            const isHighlighted = highlightToolUseId === item.tool.id;
            return (
              <LinkedToolItem
                key={itemId}
                linkedTool={item.tool}
                onClick={() => handleItemClick(itemId)}
                isExpanded={isExpanded}
                isHighlighted={isHighlighted}
                highlightColor={highlightColor}
                notificationDotColor={notificationColorMap?.get(item.tool.id)}
                registerRef={
                  registerToolRef ? (el) => registerToolRef(item.tool.id, el) : undefined
                }
              />
            );
          }

          case 'subagent':
            return (
              <div
                key={`nested-subagent-${index}`}
                className="px-2 py-1 text-xs"
                style={{ color: CARD_ICON_MUTED }}
              >
                Nested: {item.subagent.description ?? item.subagent.id}
              </div>
            );

          case 'subagent_input': {
            const itemId = `subagent-input-${index}`;
            const isExpanded = expandedItemId === itemId;
            return (
              <BaseItem
                key={itemId}
                icon={<MailOpen className="size-4" />}
                label="Input"
                summary={truncateText(item.content, 80)}
                tokenCount={item.tokenCount}
                onClick={() => handleItemClick(itemId)}
                isExpanded={isExpanded}
              >
                <MarkdownViewer content={item.content} copyable />
              </BaseItem>
            );
          }

          case 'teammate_message': {
            const itemId = `subagent-teammate-${item.teammateMessage.id}-${index}`;
            const isExpanded = expandedItemId === itemId;
            return (
              <TeammateMessageItem
                key={itemId}
                teammateMessage={item.teammateMessage}
                onClick={() => handleItemClick(itemId)}
                isExpanded={isExpanded}
              />
            );
          }

          case 'compact_boundary': {
            const itemId = `subagent-compact-${index}`;
            const isExpanded = expandedItemId === itemId;
            return (
              <div key={itemId}>
                {/* Header — matches CompactBoundary.tsx amber styling */}
                <button
                  onClick={() => handleItemClick(itemId)}
                  className="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-all duration-200"
                  style={{
                    backgroundColor: TOOL_CALL_BG,
                    border: `1px solid ${TOOL_CALL_BORDER}`,
                  }}
                  aria-expanded={isExpanded}
                >
                  <div
                    className="flex shrink-0 items-center gap-1.5"
                    style={{ color: TOOL_CALL_TEXT }}
                  >
                    <ChevronRight
                      size={14}
                      className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                    />
                    <Layers size={14} />
                  </div>
                  <span className="shrink-0 text-xs font-medium" style={{ color: TOOL_CALL_TEXT }}>
                    Compacted
                  </span>
                  {item.tokenDelta && (
                    <span
                      className="min-w-0 truncate text-[11px] tabular-nums"
                      style={{ color: COLOR_TEXT_MUTED }}
                    >
                      {formatTokensCompact(item.tokenDelta.preCompactionTokens)} →{' '}
                      {formatTokensCompact(item.tokenDelta.postCompactionTokens)}
                      <span style={{ color: '#4ade80' }}>
                        {' '}
                        ({formatTokensCompact(Math.abs(item.tokenDelta.delta))} freed)
                      </span>
                    </span>
                  )}
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: 'rgba(99, 102, 241, 0.15)',
                      color: '#818cf8',
                    }}
                  >
                    Phase {item.phaseNumber}
                  </span>
                  <span
                    className="ml-auto shrink-0 text-[11px]"
                    style={{ color: COLOR_TEXT_MUTED }}
                  >
                    {format(new Date(item.timestamp), 'h:mm:ss a')}
                  </span>
                </button>
                {/* Expanded content */}
                {isExpanded && item.content && (
                  <div
                    className="mt-1 overflow-hidden rounded-lg"
                    style={{
                      backgroundColor: CODE_BG,
                      border: `1px solid ${CODE_BORDER}`,
                    }}
                  >
                    <div
                      className="max-h-64 overflow-y-auto border-l-2 px-3 py-2"
                      style={{ borderColor: 'var(--chat-ai-border)' }}
                    >
                      <MarkdownViewer content={item.content} copyable />
                    </div>
                  </div>
                )}
              </div>
            );
          }

          default:
            return null;
        }
      })}
    </div>
  );
};
