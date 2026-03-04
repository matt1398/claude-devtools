/**
 * CollapsibleOutputSection
 *
 * Reusable component that wraps tool output in a collapsed-by-default section.
 * Shows a clickable header with label, StatusDot, and chevron toggle.
 */

import React, { useState } from 'react';

import { CopyButton } from '@renderer/components/common/CopyButton';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { type ItemStatus, StatusDot } from '../BaseItem';

interface CollapsibleOutputSectionProps {
  status: ItemStatus;
  children: React.ReactNode;
  /** Label shown in the header (default: "Output") */
  label?: string;
  /** Text content for the copy button (when provided, shows a copy button) */
  copyText?: string;
}

export const CollapsibleOutputSection: React.FC<CollapsibleOutputSectionProps> = ({
  status,
  children,
  label = 'Output',
  copyText,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div>
      <button
        type="button"
        className="mb-1 flex items-center gap-2 text-xs"
        style={{
          color: 'var(--tool-item-muted)',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
        }}
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        {isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
        <StatusDot status={status} />
      </button>
      {isExpanded && (
        <div
          className="group relative max-h-96 overflow-auto rounded p-3 font-mono text-xs"
          style={{
            backgroundColor: 'var(--code-bg)',
            border: '1px solid var(--code-border)',
            color:
              status === 'error'
                ? 'var(--tool-result-error-text)'
                : 'var(--color-text-secondary)',
          }}
        >
          {children}
          {copyText && <CopyButton text={copyText} />}
        </div>
      )}
    </div>
  );
};
