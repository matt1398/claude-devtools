import React from 'react';

import { Brain } from 'lucide-react';

import { MarkdownViewer } from '../viewers';

import { BaseItem } from './BaseItem';
import { truncateText } from './baseItemHelpers';

import type { SemanticStep } from '@renderer/types/data';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface ThinkingItemProps {
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

export const ThinkingItem: React.FC<ThinkingItemProps> = ({
  step,
  preview,
  onClick,
  isExpanded,
  highlightClasses,
  highlightStyle,
  notificationDotColor,
}) => {
  const fullContent = step.content.thinkingText ?? preview;
  const truncatedPreview = truncateText(preview, 60);

  // Get token count from step.tokens.output or step.content.tokenCount
  const tokenCount = step.tokens?.output ?? step.content.tokenCount ?? 0;

  return (
    <BaseItem
      icon={<Brain className="size-4" />}
      label="Thinking"
      summary={truncatedPreview}
      tokenCount={tokenCount}
      onClick={onClick}
      isExpanded={isExpanded}
      highlightClasses={highlightClasses}
      highlightStyle={highlightStyle}
      notificationDotColor={notificationDotColor}
      variant="thinking"
    >
      <MarkdownViewer content={fullContent} maxHeight="max-h-96" copyable collapsible />
    </BaseItem>
  );
};
