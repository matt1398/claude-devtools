/**
 * SessionContextMenu - Right-click context menu for sidebar session items.
 * Supports opening in current pane, new tab, and split right.
 * Shows keyboard shortcut hints for actions that have them.
 */

import { useEffect, useRef, useState } from 'react';

import { MAX_PANES } from '@renderer/types/panes';
import { formatShortcut } from '@renderer/utils/stringUtils';
import { Check, ClipboardCopy, Eye, EyeOff, Pin, PinOff, Terminal } from 'lucide-react';

interface SessionContextMenuProps {
  x: number;
  y: number;
  sessionId: string;
  projectId: string;
  sessionLabel: string;
  paneCount: number;
  isPinned: boolean;
  isHidden: boolean;
  onClose: () => void;
  onOpenInCurrentPane: () => void;
  onOpenInNewTab: () => void;
  onSplitRightAndOpen: () => void;
  onTogglePin: () => void;
  onToggleHide: () => void;
}

export const SessionContextMenu = ({
  x,
  y,
  sessionId,
  paneCount,
  isPinned,
  isHidden,
  onClose,
  onOpenInCurrentPane,
  onOpenInNewTab,
  onSplitRightAndOpen,
  onTogglePin,
  onToggleHide,
}: SessionContextMenuProps): React.JSX.Element => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [copiedField, setCopiedField] = useState<'id' | 'command' | null>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const menuWidth = 240;
  const menuHeight = 290;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  const handleClick = (action: () => void) => () => {
    action();
    onClose();
  };

  const handleCopy = (text: string, field: 'id' | 'command') => async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => {
        setCopiedField(null);
        onClose();
      }, 600);
    } catch {
      // Silently fail
    }
  };

  const atMaxPanes = paneCount >= MAX_PANES;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[220px] overflow-hidden rounded-md border py-1 shadow-lg"
      style={{
        left: clampedX,
        top: clampedY,
        backgroundColor: 'var(--color-surface-overlay)',
        borderColor: 'var(--color-border-emphasis)',
        color: 'var(--color-text)',
      }}
    >
      <MenuItem label="Open in Current Pane" onClick={handleClick(onOpenInCurrentPane)} />
      <MenuItem label="Open in New Tab" shortcut={`${formatShortcut('')}Click`} onClick={handleClick(onOpenInNewTab)} />
      <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
      <MenuItem
        label="Split Right and Open"
        onClick={handleClick(onSplitRightAndOpen)}
        disabled={atMaxPanes}
      />
      <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
      <MenuItem
        label={isPinned ? 'Unpin Session' : 'Pin Session'}
        icon={isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        onClick={handleClick(onTogglePin)}
      />
      <MenuItem
        label={isHidden ? 'Unhide Session' : 'Hide Session'}
        icon={isHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        onClick={handleClick(onToggleHide)}
      />
      <div className="mx-2 my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
      <MenuItem
        label={copiedField === 'id' ? 'Copied!' : 'Copy Session ID'}
        icon={
          copiedField === 'id' ? (
            <Check className="size-4 text-green-400" />
          ) : (
            <ClipboardCopy className="size-4" />
          )
        }
        onClick={handleCopy(sessionId, 'id')}
      />
      <MenuItem
        label={copiedField === 'command' ? 'Copied!' : 'Copy Resume Command'}
        icon={
          copiedField === 'command' ? (
            <Check className="size-4 text-green-400" />
          ) : (
            <Terminal className="size-4" />
          )
        }
        onClick={handleCopy(`claude --resume ${sessionId}`, 'command')}
      />
    </div>
  );
};

const MenuItem = ({
  label,
  shortcut,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element => {
  return (
    <button
      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors hover:bg-[var(--color-surface-raised)]"
      onClick={onClick}
      disabled={disabled}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {shortcut && (
        <span className="ml-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {shortcut}
        </span>
      )}
    </button>
  );
};
