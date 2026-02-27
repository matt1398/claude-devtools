import React from 'react';

import { Slash } from 'lucide-react';

import { MarkdownViewer } from '../viewers';

import { BaseItem } from './BaseItem';

import type { SlashItem as SlashItemType } from '@renderer/types/groups';
import type { TriggerColor } from '@shared/constants/triggerColors';

interface SlashItemProps {
  slash: SlashItemType;
  onClick: () => void;
  isExpanded: boolean;
  /** Additional classes for highlighting (e.g., error deep linking) */
  highlightClasses?: string;
  /** Inline styles for highlighting (used by custom hex colors) */
  highlightStyle?: React.CSSProperties;
  /** Notification dot color for custom triggers */
  notificationDotColor?: TriggerColor;
}

/**
 * SlashItem displays a slash command invocation.
 * This unified component handles all slash types:
 * - Skills (e.g., /isolate-context)
 * - Built-in commands (e.g., /model, /context)
 * - Plugin commands
 * - MCP commands
 * - User-defined commands
 */
export const SlashItem: React.FC<SlashItemProps> = ({
  slash,
  onClick,
  isExpanded,
  highlightClasses,
  highlightStyle,
  notificationDotColor,
}) => {
  const hasInstructions = !!slash.instructions;

  // Display args or message as the description
  const description = slash.args ?? slash.message;

  return (
    <BaseItem
      icon={<Slash className="size-4" />}
      label={`/${slash.name}`}
      summary={description}
      tokenCount={slash.instructionsTokenCount}
      tokenLabel="tokens"
      status={hasInstructions ? 'ok' : undefined}
      onClick={onClick}
      isExpanded={isExpanded}
      hasExpandableContent={hasInstructions}
      highlightClasses={highlightClasses}
      highlightStyle={highlightStyle}
      notificationDotColor={notificationDotColor}
      variant="slash"
    >
      {hasInstructions && (
        <MarkdownViewer
          content={slash.instructions!}
          label="Slash Output"
          maxHeight="max-h-96"
          copyable
        />
      )}
    </BaseItem>
  );
};
