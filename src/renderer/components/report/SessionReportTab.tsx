import { useMemo } from 'react';

import { useStore } from '@renderer/store';
import { computeTakeaways } from '@renderer/utils/reportAssessments';
import { analyzeSession } from '@renderer/utils/sessionAnalyzer';

import { CostSection } from './sections/CostSection';
import { ErrorSection } from './sections/ErrorSection';
import { FrictionSection } from './sections/FrictionSection';
import { GitSection } from './sections/GitSection';
import { InsightsSection } from './sections/InsightsSection';
import { KeyTakeawaysSection } from './sections/KeyTakeawaysSection';
import { OverviewSection } from './sections/OverviewSection';
import { QualitySection } from './sections/QualitySection';
import { SubagentSection } from './sections/SubagentSection';
import { TimelineSection } from './sections/TimelineSection';
import { TokenSection } from './sections/TokenSection';
import { ToolSection } from './sections/ToolSection';

import type { Tab } from '@renderer/types/tabs';

interface SessionReportTabProps {
  tab: Tab;
}

export const SessionReportTab = ({ tab }: SessionReportTabProps) => {
  // Find session data from any session tab with matching sessionId
  const sessionDetail = useStore((s) => {
    const allTabs = s.paneLayout.panes.flatMap((p) => p.tabs);
    const sourceTab = allTabs.find((t) => t.type === 'session' && t.sessionId === tab.sessionId);
    return sourceTab ? s.tabSessionData[sourceTab.id]?.sessionDetail : null;
  });

  const report = useMemo(
    () => (sessionDetail ? analyzeSession(sessionDetail) : null),
    [sessionDetail]
  );

  const takeaways = useMemo(() => (report ? computeTakeaways(report) : []), [report]);

  if (!report) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        No session data available. Open the session tab first.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6" style={{ backgroundColor: 'var(--color-surface)' }}>
      <h1 className="mb-6 text-lg font-semibold text-text">Session Analysis Report</h1>
      <div className="flex flex-col gap-4">
        {takeaways.length > 0 && <KeyTakeawaysSection takeaways={takeaways} />}
        <OverviewSection data={report.overview} />
        <CostSection
          data={report.costAnalysis}
          tokensByModel={report.tokenUsage.byModel}
          commitCount={report.gitActivity.commitCount}
          linesChanged={report.gitActivity.linesChanged}
        />
        <TokenSection data={report.tokenUsage} cacheEconomics={report.cacheEconomics} />
        <ToolSection data={report.toolUsage} />
        {report.subagentMetrics.count > 0 && (
          <SubagentSection data={report.subagentMetrics} defaultCollapsed />
        )}
        {report.errors.errors.length > 0 && <ErrorSection data={report.errors} defaultCollapsed />}
        <GitSection data={report.gitActivity} defaultCollapsed />
        <FrictionSection
          data={report.frictionSignals}
          thrashing={report.thrashingSignals}
          defaultCollapsed
        />
        <TimelineSection
          idle={report.idleAnalysis}
          modelSwitches={report.modelSwitches}
          keyEvents={report.keyEvents}
          defaultCollapsed
        />
        <QualitySection
          prompt={report.promptQuality}
          startup={report.startupOverhead}
          testProgression={report.testProgression}
          fileReadRedundancy={report.fileReadRedundancy}
          defaultCollapsed
        />
        <InsightsSection
          skills={report.skillsInvoked}
          bash={report.bashCommands}
          lifecycleTasks={report.lifecycleTasks}
          userQuestions={report.userQuestions}
          outOfScope={report.outOfScopeFindings}
          agentTree={report.agentTree}
          subagentsList={report.subagentsList}
          defaultCollapsed
        />
      </div>
    </div>
  );
};
