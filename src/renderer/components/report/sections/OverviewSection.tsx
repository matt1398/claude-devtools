import { assessmentColor } from '@renderer/utils/reportAssessments';
import { Activity } from 'lucide-react';

import { ReportSection } from '../ReportSection';

import type { ReportOverview } from '@renderer/types/sessionReport';

interface OverviewSectionProps {
  data: ReportOverview;
}

export const OverviewSection = ({ data }: OverviewSectionProps) => {
  return (
    <ReportSection title="Overview" icon={Activity}>
      <div className="mb-3 truncate text-xs text-text-muted">{data.firstMessage}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-text-muted">Duration</div>
          <div className="text-sm font-medium text-text">{data.durationHuman}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Messages</div>
          <div className="text-sm font-medium text-text">{data.totalMessages.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Context Usage</div>
          <div
            className="text-sm font-medium"
            style={{ color: assessmentColor(data.contextAssessment) }}
          >
            {data.contextConsumptionPct != null ? `${data.contextConsumptionPct}%` : 'N/A'}
            {data.contextAssessment && (
              <span className="ml-1 text-xs">({data.contextAssessment})</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Compactions</div>
          <div className="text-sm font-medium text-text">{data.compactionCount}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Branch</div>
          <div className="truncate text-sm font-medium text-text">{data.gitBranch}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Subagents</div>
          <div className="text-sm font-medium text-text">{data.hasSubagents ? 'Yes' : 'No'}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Project</div>
          <div className="truncate text-sm font-medium text-text" title={data.projectPath}>
            {data.projectPath}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Session ID</div>
          <div className="truncate text-sm font-medium text-text" title={data.sessionId}>
            {data.sessionId.slice(0, 12)}...
          </div>
        </div>
      </div>
    </ReportSection>
  );
};
