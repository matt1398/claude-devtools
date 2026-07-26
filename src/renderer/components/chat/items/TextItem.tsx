import React from 'react';

import { MessageSquare } from 'lucide-react';

import { MarkdownViewer } from '../viewers';

import { BaseItem } from './BaseItem';

import type { SemanticStep } from '@renderer/types/data';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface TextItemProps {
  step: SemanticStep;
  preview: string;
  onClick: () => void;
  isExpanded: boolean;
  /** Additional classes for highlighting (e.g., error deep linking) */
  highlightClasses?: string;
  /** Inline styles for highlighting (used by custom hex colors) */
  highlightStyle?: React.CSSProperties;
  /** Notification dot color for custom triggers */
  notificationDotColor?: TriggerColor;
}

export const TextItem: React.FC<TextItemProps> = React.memo(function TextItem({
  step,
  preview,
  onClick,
  isExpanded,
  highlightClasses,
  highlightStyle,
  notificationDotColor,
}) {
  const fullContent = step.content.outputText ?? preview;

  // Get token count from step.tokens.output or step.content.tokenCount
  const tokenCount = step.tokens?.output ?? step.content.tokenCount ?? 0;

  return (
    <BaseItem
      icon={<MessageSquare className="size-4" />}
      label="Output"
      // No summary: the Output title is redundant with the full text rendered below.
      // BaseItem substitutes a flex spacer when summary is omitted, so the row collapses cleanly.
      tokenCount={tokenCount}
      onClick={onClick}
      isExpanded={isExpanded}
      highlightClasses={highlightClasses}
      highlightStyle={highlightStyle}
      notificationDotColor={notificationDotColor}
    >
      {/* Empty maxHeight => no fixed cap; Claude messages grow to full content height. */}
      <MarkdownViewer content={fullContent} maxHeight="" />
    </BaseItem>
  );
});
