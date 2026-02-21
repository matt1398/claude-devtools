/**
 * WorkspaceIndicator - Floating bottom-right pill badge for workspace switching.
 *
 * Shows active workspace (Local or SSH host) with connection status badge.
 * Clicking opens an upward dropdown to switch between available workspaces.
 * Only renders when multiple contexts are available (hidden in local-only mode).
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useStore } from '@renderer/store';
import { Check, ChevronDown } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { ConnectionStatusBadge } from './ConnectionStatusBadge';

export const WorkspaceIndicator = (): React.JSX.Element | null => {
  const {
    activeContextId,
    isContextSwitching,
    availableContexts,
    switchContext,
    openSettingsTab,
  } = useStore(
    useShallow((s) => ({
      activeContextId: s.activeContextId,
      isContextSwitching: s.isContextSwitching,
      availableContexts: s.availableContexts,
      switchContext: s.switchContext,
      openSettingsTab: s.openSettingsTab,
    }))
  );

  const [isOpen, setIsOpen] = useState(false);
  const [focusedContextId, setFocusedContextId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const activeContext = availableContexts.find((ctx) => ctx.id === activeContextId);
  const activeLabel = activeContext?.rootName ?? 'Local';
  const localContexts = useMemo(
    () => availableContexts.filter((ctx) => ctx.type === 'local'),
    [availableContexts]
  );
  const remoteContexts = useMemo(
    () => availableContexts.filter((ctx) => ctx.type === 'ssh'),
    [availableContexts]
  );
  const selectableContexts = useMemo(
    () => [...localContexts, ...remoteContexts],
    [localContexts, remoteContexts]
  );
  const resolvedFocusedContextId = useMemo(() => {
    if (focusedContextId && selectableContexts.some((ctx) => ctx.id === focusedContextId)) {
      return focusedContextId;
    }
    if (selectableContexts.some((ctx) => ctx.id === activeContextId)) {
      return activeContextId;
    }
    return selectableContexts[0]?.id ?? null;
  }, [activeContextId, focusedContextId, selectableContexts]);

  useEffect(() => {
    if (isOpen && !isContextSwitching) {
      listboxRef.current?.focus();
    }
  }, [isContextSwitching, isOpen]);

  const handleContextSelect = (contextId: string): void => {
    void switchContext(contextId);
    setIsOpen(false);
  };

  const handleListboxKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (selectableContexts.length === 0) {
      return;
    }
    const currentIndex = selectableContexts.findIndex((ctx) => ctx.id === resolvedFocusedContextId);
    const fallbackIndex = currentIndex >= 0 ? currentIndex : 0;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const nextIndex = (fallbackIndex + 1) % selectableContexts.length;
        setFocusedContextId(selectableContexts[nextIndex].id);
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const previousIndex = (fallbackIndex - 1 + selectableContexts.length) % selectableContexts.length;
        setFocusedContextId(selectableContexts[previousIndex].id);
        return;
      }
      case 'Home': {
        event.preventDefault();
        setFocusedContextId(selectableContexts[0].id);
        return;
      }
      case 'End': {
        event.preventDefault();
        setFocusedContextId(selectableContexts[selectableContexts.length - 1].id);
        return;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (resolvedFocusedContextId) {
          handleContextSelect(resolvedFocusedContextId);
        }
        return;
      }
      default:
        return;
    }
  };

  if (availableContexts.length <= 1) {
    return null;
  }

  return (
    <div ref={dropdownRef} className="fixed bottom-4 right-4 z-30">
      {/* Trigger pill */}
      <button
        type="button"
        onClick={() => {
          if (isContextSwitching) {
            return;
          }
          setIsOpen((currentOpen) => {
            const nextOpen = !currentOpen;
            if (nextOpen) {
              setFocusedContextId(resolvedFocusedContextId);
            }
            return nextOpen;
          });
        }}
        disabled={isContextSwitching}
        aria-haspopup="listbox"
        aria-expanded={isOpen && !isContextSwitching}
        aria-controls={listboxId}
        className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs shadow-lg transition-opacity hover:opacity-90 ${isContextSwitching ? 'opacity-50' : ''}`}
        style={{
          backgroundColor: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border-emphasis)',
        }}
      >
        <ConnectionStatusBadge contextId={activeContextId} />
        <span
          className="font-medium"
          style={{ color: isContextSwitching ? 'var(--color-text-muted)' : 'var(--color-text)' }}
        >
          {activeLabel}
        </span>
        <ChevronDown
          className={`size-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          style={{ color: 'var(--color-text-muted)' }}
        />
      </button>

      {/* Upward dropdown */}
      {isOpen && !isContextSwitching && (
        <>
          {/* Backdrop */}
          <div
            role="presentation"
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown content - opens upward */}
          <div
            className="absolute bottom-full right-0 z-20 mb-2 max-h-[250px] w-56 overflow-y-auto rounded-lg py-1 shadow-xl"
            style={{
              backgroundColor: 'var(--color-surface-sidebar)',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: 'var(--color-border)',
            }}
          >
            {/* Header */}
            <div
              className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Switch Workspace
            </div>

            <div
              id={listboxId}
              ref={listboxRef}
              role="listbox"
              tabIndex={0}
              aria-label="Available workspaces"
              aria-activedescendant={
                resolvedFocusedContextId
                  ? `${listboxId}-option-${resolvedFocusedContextId}`
                  : undefined
              }
              onKeyDown={handleListboxKeyDown}
            >
              {localContexts.length > 0 && (
                <>
                  <div
                    className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    Local
                  </div>
                  {localContexts.map((ctx) => (
                    <ContextItem
                      key={ctx.id}
                      optionId={`${listboxId}-option-${ctx.id}`}
                      context={ctx}
                      isSelected={ctx.id === activeContextId}
                      isFocused={ctx.id === resolvedFocusedContextId}
                      onFocus={() => setFocusedContextId(ctx.id)}
                      onSelect={() => handleContextSelect(ctx.id)}
                    />
                  ))}
                </>
              )}

              {remoteContexts.length > 0 && (
                <>
                  <div
                    className="mt-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    Remote
                  </div>
                  {remoteContexts.map((ctx) => (
                    <ContextItem
                      key={ctx.id}
                      optionId={`${listboxId}-option-${ctx.id}`}
                      context={ctx}
                      isSelected={ctx.id === activeContextId}
                      isFocused={ctx.id === resolvedFocusedContextId}
                      onFocus={() => setFocusedContextId(ctx.id)}
                      onSelect={() => handleContextSelect(ctx.id)}
                    />
                  ))}
                </>
              )}
            </div>

            <div className="my-1 border-t" style={{ borderColor: 'var(--color-border)' }} />
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-xs transition-colors hover:bg-surface-raised"
              style={{ color: 'var(--color-text-secondary)' }}
              onClick={() => {
                openSettingsTab('general');
                setIsOpen(false);
              }}
            >
              Manage Roots...
            </button>
          </div>
        </>
      )}
    </div>
  );
};

/**
 * Individual context item in the dropdown.
 */
interface ContextItemProps {
  optionId: string;
  context: {
    id: string;
    rootName: string;
    connected: boolean;
    type: 'local' | 'ssh';
  };
  isSelected: boolean;
  isFocused: boolean;
  onSelect: () => void;
  onFocus: () => void;
}

const ContextItem = ({
  optionId,
  context,
  isSelected,
  isFocused,
  onSelect,
  onFocus,
}: Readonly<ContextItemProps>): React.JSX.Element => {
  const isHighlighted = isSelected || isFocused;

  const buttonStyle: React.CSSProperties = isHighlighted
    ? { backgroundColor: 'var(--color-surface-raised)', color: 'var(--color-text)' }
    : { backgroundColor: 'transparent' };

  return (
    <button
      id={optionId}
      type="button"
      role="option"
      aria-selected={isSelected}
      tabIndex={-1}
      onClick={onSelect}
      onMouseEnter={onFocus}
      className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-raised"
      style={buttonStyle}
    >
      <ConnectionStatusBadge contextId={context.id} />
      <span
        className="flex-1 truncate text-sm"
        style={{ color: isHighlighted ? 'var(--color-text)' : 'var(--color-text-muted)' }}
      >
        {context.rootName}
      </span>
      {context.type === 'ssh' && !context.connected && (
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          Connect
        </span>
      )}
      {isSelected && <Check className="size-3.5 shrink-0 text-indigo-400" />}
    </button>
  );
};
