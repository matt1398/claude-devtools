import { severityColor } from '@renderer/utils/reportAssessments';
import { MessageSquareWarning } from 'lucide-react';

import { AssessmentBadge } from '../AssessmentBadge';
import { ReportSection } from '../ReportSection';

import type { ReportFrictionSignals, ReportThrashingSignals } from '@renderer/types/sessionReport';

interface FrictionSectionProps {
  data: ReportFrictionSignals;
  thrashing: ReportThrashingSignals;
  defaultCollapsed?: boolean;
}

export const FrictionSection = ({ data, thrashing, defaultCollapsed }: FrictionSectionProps) => {
  const frictionSeverity =
    data.frictionRate <= 0.1 ? 'good' : data.frictionRate <= 0.25 ? 'warning' : 'danger';
  const frictionColor = severityColor(frictionSeverity);

  return (
    <ReportSection
      title="Friction Signals"
      icon={MessageSquareWarning}
      defaultCollapsed={defaultCollapsed}
    >
      <div className="mb-4 flex items-center gap-3">
        <span
          className="rounded px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: `color-mix(in srgb, ${frictionColor} 12%, transparent)`,
            color: frictionColor,
          }}
        >
          Friction Rate: {(data.frictionRate * 100).toFixed(1)}%
        </span>
        <span className="text-xs text-text-muted">
          {data.correctionCount} correction{data.correctionCount !== 1 ? 's' : ''}
        </span>
      </div>

      {data.corrections.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-xs font-medium text-text-muted">Corrections</div>
          <div className="flex flex-col gap-1">
            {data.corrections.map((corr, idx) => (
              <div key={idx} className="flex items-start gap-2 rounded px-2 py-1 text-xs">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--assess-warning) 15%, transparent)',
                    color: 'var(--assess-warning)',
                  }}
                >
                  {corr.keyword}
                </span>
                <span className="truncate text-text-secondary">{corr.preview}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(thrashing.bashNearDuplicates.length > 0 || thrashing.editReworkFiles.length > 0) && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted">Thrashing Signals</span>
            <AssessmentBadge assessment={thrashing.thrashingAssessment} metricKey="thrashing" />
          </div>

          {thrashing.bashNearDuplicates.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-xs text-text-muted">Repeated Bash Commands</div>
              {thrashing.bashNearDuplicates.map((dup, idx) => (
                <div key={idx} className="flex items-center gap-2 px-2 py-0.5 text-xs">
                  <span className="text-text-muted">{dup.count}x</span>
                  <code className="truncate text-text-secondary">{dup.prefix}</code>
                </div>
              ))}
            </div>
          )}

          {thrashing.editReworkFiles.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-text-muted">Reworked Files (3+ edits)</div>
              {thrashing.editReworkFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-2 px-2 py-0.5 text-xs">
                  <span className="text-text-muted">{file.editIndices.length}x</span>
                  <span className="truncate text-text-secondary">{file.filePath}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </ReportSection>
  );
};
