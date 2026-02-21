import { assessmentColor, assessmentLabel } from '@renderer/utils/reportAssessments';
import { Wrench } from 'lucide-react';

import { ReportSection } from '../ReportSection';

import type { ReportToolUsage } from '@renderer/types/sessionReport';

interface ToolSectionProps {
  data: ReportToolUsage;
}

export const ToolSection = ({ data }: ToolSectionProps) => {
  const toolEntries = Object.entries(data.successRates).sort(
    (a, b) => b[1].totalCalls - a[1].totalCalls
  );

  const healthColor = assessmentColor(data.overallToolHealth);

  return (
    <ReportSection title="Tool Usage" icon={Wrench}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-text-muted">
          {data.totalCalls.toLocaleString()} total calls across {toolEntries.length} tools
        </span>
        <span
          className="rounded px-2 py-0.5 text-xs font-medium"
          style={{
            backgroundColor: `${healthColor}20`,
            color: healthColor,
          }}
        >
          {assessmentLabel(data.overallToolHealth)}
        </span>
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
                    {stats.errors.toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-4 text-right" style={{ color }}>
                    {stats.successRatePct}%
                  </td>
                  <td className="py-1.5 text-right">
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ backgroundColor: `${color}20`, color }}
                    >
                      {assessmentLabel(stats.assessment)}
                    </span>
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
