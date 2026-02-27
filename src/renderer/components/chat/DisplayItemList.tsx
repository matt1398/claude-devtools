import React, { useCallback, useState } from 'react';

import {
  CODE_BG,
  CODE_BORDER,
  COLOR_TEXT_MUTED,
  TOOL_CALL_BG,
  TOOL_CALL_BORDER,
  TOOL_CALL_TEXT,
} from '@renderer/constants/cssVariables';
import { formatTokensCompact } from '@renderer/utils/formatters';
import { format } from 'date-fns';
import { ChevronRight, Layers, MailOpen } from 'lucide-react';

import { BaseItem } from './items/BaseItem';
import { LinkedToolItem } from './items/LinkedToolItem';
import { SlashItem } from './items/SlashItem';
import { SubagentItem } from './items/SubagentItem';
import { TeammateMessageItem } from './items/TeammateMessageItem';
import { TextItem } from './items/TextItem';
import { ThinkingItem } from './items/ThinkingItem';
import { MarkdownViewer } from './viewers/MarkdownViewer';

import type { AIGroupDisplayItem } from '@renderer/types/groups';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface DisplayItemListProps {
  items: AIGroupDisplayItem[];
  onItemClick: (itemId: string) => void;
  expandedItemIds: Set<string>;
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

/**
 * Truncates text to a maximum length and adds ellipsis if needed.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength) + '...';
}

/**
 * Renders a flat list of AIGroupDisplayItem[] into the appropriate components.
 *
 * This component maps each display item to its corresponding component based on type:
 * - thinking -> ThinkingItem
 * - output -> TextItem
 * - tool -> LinkedToolItem
 * - subagent -> SubagentItem
 * - slash -> SlashItem
 *
 * The list is completely flat with no nested toggles or hierarchies.
 */
export const DisplayItemList = ({
  items,
  onItemClick,
  expandedItemIds,
  aiGroupId,
  highlightToolUseId,
  highlightColor,
  notificationColorMap,
  registerToolRef,
}: Readonly<DisplayItemListProps>): React.JSX.Element => {
  // Reply-link highlight: when hovering a reply badge, dim everything except the linked pair
  const [replyLinkToolId, setReplyLinkToolId] = useState<string | null>(null);

  const handleReplyHover = useCallback((toolId: string | null) => {
    setReplyLinkToolId(toolId);
  }, []);

  /** Check if an item is part of the currently highlighted reply link */
  const isItemInReplyLink = (item: AIGroupDisplayItem): boolean => {
    if (!replyLinkToolId) return false;
    if (item.type === 'tool' && item.tool.id === replyLinkToolId) return true;
    if (item.type === 'teammate_message' && item.teammateMessage.replyToToolId === replyLinkToolId)
      return true;
    return false;
  };

  if (!items || items.length === 0) {
    return (
      <div className="px-3 py-2 text-sm italic text-claude-dark-text-secondary">
        No items to display
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        let itemKey = '';
        let element: React.ReactNode = null;

        switch (item.type) {
          case 'thinking': {
            itemKey = `thinking-${index}`;
            const thinkingStep = {
              id: itemKey,
              type: 'thinking' as const,
              startTime: item.timestamp,
              endTime: item.timestamp,
              durationMs: 0,
              content: { thinkingText: item.content, tokenCount: item.tokenCount },
              tokens: { input: 0, output: item.tokenCount ?? 0 },
              context: 'main' as const,
            };
            element = (
              <ThinkingItem
                step={thinkingStep}
                preview={truncateText(item.content, 150)}
                onClick={() => onItemClick(itemKey)}
                isExpanded={expandedItemIds.has(itemKey)}
              />
            );
            break;
          }

          case 'output': {
            itemKey = `output-${index}`;
            const textStep = {
              id: itemKey,
              type: 'output' as const,
              startTime: item.timestamp,
              endTime: item.timestamp,
              durationMs: 0,
              content: { outputText: item.content, tokenCount: item.tokenCount },
              tokens: { input: 0, output: item.tokenCount ?? 0 },
              context: 'main' as const,
            };
            element = (
              <TextItem
                step={textStep}
                preview={truncateText(item.content, 150)}
                onClick={() => onItemClick(itemKey)}
                isExpanded={expandedItemIds.has(itemKey)}
              />
            );
            break;
          }

          case 'tool': {
            itemKey = `tool-${item.tool.id}-${index}`;
            element = (
              <LinkedToolItem
                linkedTool={item.tool}
                onClick={() => onItemClick(itemKey)}
                isExpanded={expandedItemIds.has(itemKey)}
                isHighlighted={highlightToolUseId === item.tool.id}
                highlightColor={highlightColor}
                notificationDotColor={notificationColorMap?.get(item.tool.id)}
                registerRef={
                  registerToolRef ? (el) => registerToolRef(item.tool.id, el) : undefined
                }
              />
            );
            break;
          }

          case 'subagent': {
            itemKey = `subagent-${item.subagent.id}-${index}`;
            const subagentStep = {
              id: itemKey,
              type: 'subagent' as const,
              startTime: item.subagent.startTime,
              endTime: item.subagent.endTime,
              durationMs: item.subagent.durationMs,
              content: {
                subagentId: item.subagent.id,
                subagentDescription: item.subagent.description,
              },
              isParallel: item.subagent.isParallel,
              context: 'main' as const,
            };
            element = (
              <SubagentItem
                step={subagentStep}
                subagent={item.subagent}
                onClick={() => onItemClick(itemKey)}
                isExpanded={expandedItemIds.has(itemKey)}
                aiGroupId={aiGroupId}
                highlightToolUseId={highlightToolUseId}
                highlightColor={highlightColor}
                notificationColorMap={notificationColorMap}
                registerToolRef={registerToolRef}
              />
            );
            break;
          }

          case 'slash': {
            itemKey = `slash-${item.slash.name}-${index}`;
            element = (
              <SlashItem
                slash={item.slash}
                onClick={() => onItemClick(itemKey)}
                isExpanded={expandedItemIds.has(itemKey)}
              />
            );
            break;
          }

          case 'teammate_message': {
            itemKey = `teammate-${item.teammateMessage.id}-${index}`;
            element = (
              <TeammateMessageItem
                teammateMessage={item.teammateMessage}
                onClick={() => onItemClick(itemKey)}
                isExpanded={expandedItemIds.has(itemKey)}
                onReplyHover={handleReplyHover}
              />
            );
            break;
          }

          case 'subagent_input': {
            itemKey = `input-${index}`;
            const inputContent = item.content;
            const inputTokenCount = item.tokenCount;
            element = (
              <BaseItem
                icon={<MailOpen className="size-4" />}
                label="Input"
                summary={truncateText(inputContent, 80)}
                tokenCount={inputTokenCount}
                onClick={() => onItemClick(itemKey)}
                isExpanded={expandedItemIds.has(itemKey)}
              >
                <MarkdownViewer content={inputContent} copyable />
              </BaseItem>
            );
            break;
          }

          case 'compact_boundary': {
            itemKey = `compact-${index}`;
            const compactContent = item.content;
            const compactExpanded = expandedItemIds.has(itemKey);
            element = (
              <div>
                <button
                  onClick={() => onItemClick(itemKey)}
                  className="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-all duration-200"
                  style={{
                    backgroundColor: TOOL_CALL_BG,
                    border: `1px solid ${TOOL_CALL_BORDER}`,
                  }}
                  aria-expanded={compactExpanded}
                >
                  <div
                    className="flex shrink-0 items-center gap-1.5"
                    style={{ color: TOOL_CALL_TEXT }}
                  >
                    <ChevronRight
                      size={14}
                      className={`transition-transform duration-200 ${compactExpanded ? 'rotate-90' : ''}`}
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
                {compactExpanded && compactContent && (
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
                      <MarkdownViewer content={compactContent} copyable />
                    </div>
                  </div>
                )}
              </div>
            );
            break;
          }

          default:
            return null;
        }

        // Apply reply-link spotlight: dim items not in the highlighted pair
        const isDimmed = replyLinkToolId !== null && !isItemInReplyLink(item);
        return (
          <div
            key={itemKey}
            style={
              replyLinkToolId !== null
                ? { opacity: isDimmed ? 0.2 : 1, transition: 'opacity 150ms ease' }
                : undefined
            }
          >
            {element}
          </div>
        );
      })}
    </div>
  );
};
