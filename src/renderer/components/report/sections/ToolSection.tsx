import { assessmentColor } from '@renderer/utils/reportAssessments';
import { Wrench } from 'lucide-react';

import { AssessmentBadge } from '../AssessmentBadge';
import { ReportSection, sectionId } from '../ReportSection';

import type { ReportToolUsage } from '@renderer/types/sessionReport';

interface ToolSectionProps {
  data: ReportToolUsage;
  defaultCollapsed?: boolean;
}

export const ToolSection = ({ data, defaultCollapsed }: ToolSectionProps) => {
  const toolEntries = Object.entries(data.successRates).sort(
    (a, b) => b[1].totalCalls - a[1].totalCalls
  );

  return (
    <ReportSection title="Tool Usage" icon={Wrench} defaultCollapsed={defaultCollapsed}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-text-muted">
          {data.totalCalls.toLocaleString()} total calls across {toolEntries.length} tools
        </span>
        <AssessmentBadge assessment={data.overallToolHealth} metricKey="toolHealth" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th className="pb-2 pr-4">Tool</th>
              <th className="pb-2 pr-4 text-right">Calls</th>
              <th className="pb-2 pr-4 text-right">Errors</th>
              <th className="pb-2 pr-4 text-right">Success %</th>
              <th className="pb-2 text-right">Health</th>
            </tr>
          </thead>
          <tbody>
            {toolEntries.map(([tool, stats]) => {
              const color = assessmentColor(stats.assessment);
              return (
                <tr key={tool} className="border-border/50 border-b">
                  <td className="py-1.5 pr-4 text-text">{tool}</td>
                  <td className="py-1.5 pr-4 text-right text-text">
                    {stats.totalCalls.toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-4 text-right text-text">
                    {stats.errors > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          const el = document.getElementById(sectionId('Errors'));
                          if (el) el.dispatchEvent(new CustomEvent('report-section-expand'));
                        }}
                        className="text-red-400 underline decoration-red-400/30 underline-offset-2 hover:decoration-red-400"
                      >
                        {stats.errors.toLocaleString()}
                      </button>
                    ) : (
                      stats.errors.toLocaleString()
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-right" style={{ color }}>
                    {stats.successRatePct}%
                  </td>
                  <td className="py-1.5 text-right">
                    <AssessmentBadge assessment={stats.assessment} metricKey="toolHealth" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ReportSection>
  );
};
