import { assessmentColor, assessmentLabel } from '@renderer/utils/reportAssessments';
import { DollarSign } from 'lucide-react';

import { ReportSection } from '../ReportSection';

import type { ReportCostAnalysis } from '@renderer/types/sessionReport';

const fmt = (v: number) => `$${v.toFixed(4)}`;

interface CostSectionProps {
  data: ReportCostAnalysis;
}

export const CostSection = ({ data }: CostSectionProps) => {
  const modelEntries = Object.entries(data.costByModel).sort((a, b) => b[1] - a[1]);

  return (
    <ReportSection title="Cost Analysis" icon={DollarSign}>
      <div className="mb-4 text-2xl font-bold text-text">{fmt(data.totalSessionCostUsd)}</div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-text-muted">Parent Cost</div>
          <div className="text-sm font-medium text-text">{fmt(data.parentCostUsd)}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Subagent Cost</div>
          <div className="text-sm font-medium text-text">{fmt(data.subagentCostUsd)}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Per Commit</div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text">
              {data.costPerCommit != null ? fmt(data.costPerCommit) : 'N/A'}
            </span>
            {data.costPerCommitAssessment && (
              <span
                className="rounded px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: `${assessmentColor(data.costPerCommitAssessment)}20`,
                  color: assessmentColor(data.costPerCommitAssessment),
                }}
              >
                {assessmentLabel(data.costPerCommitAssessment)}
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Per Line Changed</div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text">
              {data.costPerLineChanged != null ? `$${data.costPerLineChanged.toFixed(6)}` : 'N/A'}
            </span>
            {data.costPerLineAssessment && (
              <span
                className="rounded px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: `${assessmentColor(data.costPerLineAssessment)}20`,
                  color: assessmentColor(data.costPerLineAssessment),
                }}
              >
                {assessmentLabel(data.costPerLineAssessment)}
              </span>
            )}
          </div>
        </div>
      </div>

      {data.subagentCostSharePct != null && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xs text-text-muted">Subagent Cost Share:</span>
          <span className="text-sm font-medium text-text">{data.subagentCostSharePct}%</span>
          {data.subagentCostShareAssessment && (
            <span
              className="rounded px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: `${assessmentColor(data.subagentCostShareAssessment)}20`,
                color: assessmentColor(data.subagentCostShareAssessment),
              }}
            >
              {assessmentLabel(data.subagentCostShareAssessment)}
            </span>
          )}
        </div>
      )}

      {modelEntries.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th className="pb-2 pr-4">Model</th>
              <th className="pb-2 pr-4 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {modelEntries.map(([model, cost]) => (
              <tr key={model} className="border-border/50 border-b">
                <td className="py-1.5 pr-4 text-text">{model}</td>
                <td className="py-1.5 pr-4 text-right text-text">{fmt(cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportSection>
  );
};
