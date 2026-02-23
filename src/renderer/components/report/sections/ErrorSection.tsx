import { useState } from 'react';

import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';

import { ReportSection } from '../ReportSection';

import type { ReportErrors, ToolError } from '@renderer/types/sessionReport';

interface ErrorItemProps {
  error: ToolError;
}

const ErrorItem = ({ error }: ErrorItemProps) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-border/50 rounded border bg-surface p-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 text-left text-xs"
      >
        {expanded ? (
          <ChevronDown className="size-3 text-text-muted" />
        ) : (
          <ChevronRight className="size-3 text-text-muted" />
        )}
        <span className="font-medium text-text">{error.tool}</span>
        {error.isPermissionDenial && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--assess-danger) 15%, transparent)',
              color: 'var(--assess-danger)',
            }}
          >
            Permission Denied
          </span>
        )}
        <span className="ml-auto text-text-muted">msg #{error.messageIndex}</span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1.5">
          {error.inputPreview && (
            <div className="rounded bg-surface-raised p-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                Input
              </div>
              <div className="whitespace-pre-wrap break-words font-mono text-xs text-text-secondary">
                {error.inputPreview}
              </div>
            </div>
          )}
          <div className="rounded bg-surface-raised p-2">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">
              Error
            </div>
            <div
              className="whitespace-pre-wrap break-words text-xs"
              style={{ color: 'var(--assess-danger)' }}
            >
              {error.error}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface ErrorSectionProps {
  data: ReportErrors;
  defaultCollapsed?: boolean;
}

export const ErrorSection = ({ data, defaultCollapsed }: ErrorSectionProps) => {
  return (
    <ReportSection title="Errors" icon={AlertTriangle} defaultCollapsed={defaultCollapsed}>
      <div className="mb-3 flex items-center gap-3">
        <span
          className="rounded px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--assess-danger) 15%, transparent)',
            color: 'var(--assess-danger)',
          }}
        >
          {data.errors.length} error{data.errors.length !== 1 ? 's' : ''}
        </span>
        {data.permissionDenials.count > 0 && (
          <span className="text-xs text-text-muted">
            {data.permissionDenials.count} permission denial
            {data.permissionDenials.count !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {data.errors.map((error, idx) => (
          <ErrorItem key={idx} error={error} />
        ))}
      </div>
    </ReportSection>
  );
};
