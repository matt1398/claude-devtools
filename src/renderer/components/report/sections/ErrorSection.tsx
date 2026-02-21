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
            style={{ backgroundColor: 'rgba(248, 113, 113, 0.15)', color: '#f87171' }}
          >
            Permission Denied
          </span>
        )}
        <span className="ml-auto text-text-muted">msg #{error.messageIndex}</span>
      </button>
      {expanded && (
        <div className="mt-2 whitespace-pre-wrap break-words rounded bg-surface-raised p-2 text-xs text-text-secondary">
          {error.error}
        </div>
      )}
    </div>
  );
};

interface ErrorSectionProps {
  data: ReportErrors;
}

export const ErrorSection = ({ data }: ErrorSectionProps) => {
  return (
    <ReportSection title="Errors" icon={AlertTriangle}>
      <div className="mb-3 flex items-center gap-3">
        <span
          className="rounded px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: 'rgba(248, 113, 113, 0.15)', color: '#f87171' }}
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
