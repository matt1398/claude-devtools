import { assessmentColor, assessmentLabel } from '@renderer/utils/reportAssessments';
import { Clock } from 'lucide-react';

import { AssessmentBadge } from '../AssessmentBadge';
import { ReportSection } from '../ReportSection';

import type {
  KeyEvent,
  ReportIdleAnalysis,
  ReportModelSwitches,
} from '@renderer/types/sessionReport';

interface TimelineSectionProps {
  idle: ReportIdleAnalysis;
  modelSwitches: ReportModelSwitches;
  keyEvents: KeyEvent[];
  defaultCollapsed?: boolean;
}

export const TimelineSection = ({
  idle,
  modelSwitches,
  keyEvents,
  defaultCollapsed,
}: TimelineSectionProps) => {
  const idleColor = assessmentColor(idle.idleAssessment);

  return (
    <ReportSection title="Timeline & Activity" icon={Clock} defaultCollapsed={defaultCollapsed}>
      {/* Idle stats */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium text-text-muted">Idle Analysis</span>
          <AssessmentBadge assessment={idle.idleAssessment} metricKey="idle" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div className="text-xs text-text-muted">Idle Gaps</div>
            <div className="text-sm font-medium text-text">{idle.idleGapCount}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted">Total Idle</div>
            <div className="text-sm font-medium text-text">{idle.totalIdleHuman}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted">Active Time</div>
            <div className="text-sm font-medium text-text">{idle.activeWorkingHuman}</div>
          </div>
          <div>
            <div className="text-xs text-text-muted">Idle %</div>
            <div className="text-sm font-medium" style={{ color: idleColor }}>
              {idle.idlePct}%
            </div>
          </div>
        </div>
      </div>

      {/* Model switches */}
      {modelSwitches.count > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted">
              Model Switches ({modelSwitches.count})
            </span>
            {modelSwitches.switchPattern && (
              <span
                className="rounded px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: `${assessmentColor(modelSwitches.switchPattern)}20`,
                  color: assessmentColor(modelSwitches.switchPattern),
                }}
              >
                {assessmentLabel(modelSwitches.switchPattern)}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {modelSwitches.switches.map((sw, idx) => (
              <div key={idx} className="flex items-center gap-2 px-2 py-0.5 text-xs">
                <span className="text-text-secondary">{sw.from}</span>
                <span className="text-text-muted">&rarr;</span>
                <span className="text-text">{sw.to}</span>
                <span className="ml-auto text-text-muted">msg #{sw.messageIndex}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Key events */}
      {keyEvents.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-medium text-text-muted">Key Events</div>
          <div className="flex flex-col gap-1">
            {keyEvents.map((event, idx) => (
              <div key={idx} className="flex items-center gap-2 px-2 py-0.5 text-xs">
                <span className="shrink-0 text-text-muted">
                  {event.timestamp.toLocaleTimeString()}
                </span>
                <span className="truncate text-text">{event.label}</span>
                {event.deltaHuman && (
                  <span className="ml-auto shrink-0 text-text-muted">+{event.deltaHuman}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </ReportSection>
  );
};
