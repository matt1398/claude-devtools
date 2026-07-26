import React from 'react';

import { COLOR_BORDER_SUBTLE, COLOR_TEXT_MUTED } from '@renderer/constants/cssVariables';
import { format } from 'date-fns';
import { Settings2 } from 'lucide-react';

import type { NotificationGroup } from '@renderer/types/groups';

interface TaskNotificationDividerProps {
  readonly notificationGroup: NotificationGroup;
}

/**
 * TaskNotificationDivider renders an auto-injected background-task /
 * agent-completion event (`<task-notification>`) as a small, centered, muted
 * divider line — NOT a message bubble and NOT attributed to "You".
 *
 * Target look:  ·····  ⚙ <label> · 10:45  ·····
 *
 * Theme-aware via CSS variables (muted text + subtle border in light/dark).
 */
const TaskNotificationDividerInner = ({
  notificationGroup,
}: TaskNotificationDividerProps): React.JSX.Element => {
  const { label, timestamp } = notificationGroup;
  const time = format(timestamp, 'HH:mm');

  return (
    <div className="my-2 flex w-full items-center gap-3 px-4" role="separator">
      <div className="h-px flex-1" style={{ backgroundColor: COLOR_BORDER_SUBTLE }} />
      <div
        className="flex min-w-0 shrink items-center gap-1.5 text-xs"
        style={{ color: COLOR_TEXT_MUTED }}
      >
        <Settings2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums opacity-70">· {time}</span>
      </div>
      <div className="h-px flex-1" style={{ backgroundColor: COLOR_BORDER_SUBTLE }} />
    </div>
  );
};

export const TaskNotificationDivider = React.memo(TaskNotificationDividerInner);
