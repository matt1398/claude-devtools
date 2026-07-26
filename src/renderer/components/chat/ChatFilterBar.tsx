import React from 'react';

import { FILTER_DEFS, type FilterType } from './chatItemFilter';

interface ChatFilterBarProps {
  /** Set of filter types that are currently HIDDEN (empty = everything shown). */
  readonly hidden: ReadonlySet<string>;
  /** Toggle a single filter type on/off. */
  readonly onToggle: (type: FilterType) => void;
  /** Show all types (clear the hidden set). */
  readonly onAll: () => void;
  /** Hide all types. */
  readonly onNone: () => void;
}

/**
 * Always-visible, wrap-friendly per-type filter bar.
 *
 * One compact chip per item type. A chip is "active" (filled) when its type is shown and
 * "inactive" (outline) when hidden. Theme-aware via CSS variables. Mounts just below the
 * Context button in ChatHistory.
 */
const ChatFilterBarInner = ({ hidden, onToggle, onAll, onNone }: ChatFilterBarProps): JSX.Element => {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-4 py-2"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderBottom: '1px solid var(--color-border)',
      }}
      role="group"
      aria-label="Filter chat items by type"
    >
      {FILTER_DEFS.map(({ type, label }) => {
        const isActive = !hidden.has(type);
        return (
          <button
            key={type}
            type="button"
            onClick={() => onToggle(type)}
            aria-pressed={isActive}
            className="rounded-full px-2 py-0.5 text-[11px] leading-tight transition-colors"
            style={{
              backgroundColor: isActive ? 'var(--context-btn-active-bg)' : 'transparent',
              color: isActive
                ? 'var(--context-btn-active-text)'
                : 'var(--color-text-secondary)',
              border: `1px solid ${isActive ? 'var(--context-btn-active-bg)' : 'var(--color-border-emphasis)'}`,
              opacity: isActive ? 1 : 0.7,
            }}
            title={isActive ? `Hide ${label}` : `Show ${label}`}
          >
            {label}
          </button>
        );
      })}

      {/* All / None affordance */}
      <span className="mx-1 h-3 w-px" style={{ backgroundColor: 'var(--color-border-emphasis)' }} />
      <button
        type="button"
        onClick={onAll}
        className="rounded px-1.5 py-0.5 text-[11px] leading-tight transition-colors"
        style={{ color: 'var(--color-text-secondary)' }}
        title="Show all types"
      >
        All
      </button>
      <button
        type="button"
        onClick={onNone}
        className="rounded px-1.5 py-0.5 text-[11px] leading-tight transition-colors"
        style={{ color: 'var(--color-text-secondary)' }}
        title="Hide all types"
      >
        None
      </button>
    </div>
  );
};

export const ChatFilterBar = React.memo(ChatFilterBarInner);
