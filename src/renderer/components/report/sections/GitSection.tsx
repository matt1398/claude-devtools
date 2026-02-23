import { GitBranch } from 'lucide-react';

import { ReportSection } from '../ReportSection';

import type { ReportGitActivity } from '@renderer/types/sessionReport';

interface GitSectionProps {
  data: ReportGitActivity;
  defaultCollapsed?: boolean;
}

export const GitSection = ({ data, defaultCollapsed }: GitSectionProps) => {
  return (
    <ReportSection title="Git Activity" icon={GitBranch} defaultCollapsed={defaultCollapsed}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-text-muted">Commits</div>
          <div className="text-sm font-medium text-text">{data.commitCount}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Pushes</div>
          <div className="text-sm font-medium text-text">{data.pushCount}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Lines Added</div>
          <div className="text-sm font-medium" style={{ color: 'var(--assess-good)' }}>
            +{data.linesAdded.toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Lines Removed</div>
          <div className="text-sm font-medium" style={{ color: 'var(--assess-danger)' }}>
            -{data.linesRemoved.toLocaleString()}
          </div>
        </div>
      </div>

      {data.commits.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-text-muted">Commits</div>
          <div className="flex flex-col gap-1">
            {data.commits.map((commit, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded px-2 py-1 text-xs text-text"
              >
                <span className="text-text-muted">#{commit.messageIndex}</span>
                <span className="truncate">{commit.messagePreview}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.branchCreations.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-medium text-text-muted">Branches Created</div>
          <div className="flex flex-wrap gap-1">
            {data.branchCreations.map((branch, idx) => (
              <span
                key={idx}
                className="rounded bg-surface px-2 py-0.5 text-xs text-text-secondary"
              >
                {branch}
              </span>
            ))}
          </div>
        </div>
      )}
    </ReportSection>
  );
};
