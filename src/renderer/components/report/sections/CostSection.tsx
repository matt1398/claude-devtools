import { Fragment, useState } from 'react';

import { getPricing } from '@renderer/utils/sessionAnalyzer';
import { DollarSign } from 'lucide-react';

import { AssessmentBadge } from '../AssessmentBadge';
import { ReportSection, sectionId } from '../ReportSection';

import type {
  ModelPricing,
  ModelTokenStats,
  ReportCostAnalysis,
} from '@renderer/types/sessionReport';

const fmt = (v: number) => `$${v.toFixed(4)}`;
const fmtK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v));
const fmtRate = (v: number) => `$${v}`;
const lineCost = (tokens: number, ratePerM: number) => (tokens * ratePerM) / 1_000_000;

interface CostSectionProps {
  data: ReportCostAnalysis;
  tokensByModel: Record<string, ModelTokenStats>;
  commitCount: number;
  linesChanged: number;
  defaultCollapsed?: boolean;
}

interface BreakdownLine {
  label: string;
  tokens: number;
  ratePerM: number;
}

const CostBreakdownCard = ({
  stats,
  pricing,
}: {
  stats: ModelTokenStats;
  pricing: ModelPricing;
}) => {
  const lines: BreakdownLine[] = [
    { label: 'Input', tokens: stats.inputTokens, ratePerM: pricing.input },
    { label: 'Output', tokens: stats.outputTokens, ratePerM: pricing.output },
    { label: 'Cache Read', tokens: stats.cacheRead, ratePerM: pricing.cache_read },
    { label: 'Cache Write', tokens: stats.cacheCreation, ratePerM: pricing.cache_creation },
  ];
  const total = lines.reduce((sum, l) => sum + lineCost(l.tokens, l.ratePerM), 0);

  return (
    <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-text-muted">
        Cost Breakdown (per 1M tokens)
      </div>
      <div className="flex flex-col gap-1.5 font-mono text-xs">
        {lines.map((l) => {
          const cost = lineCost(l.tokens, l.ratePerM);
          return (
            <div key={l.label} className="flex items-baseline justify-between gap-4">
              <span className="text-text-muted">{l.label}</span>
              <span className="text-text-secondary">
                {l.tokens.toLocaleString()} {'\u00D7'} {fmtRate(l.ratePerM)}/M = {fmt(cost)}
              </span>
            </div>
          );
        })}
        <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-border pt-1.5">
          <span className="font-medium text-text">Total</span>
          <span className="font-medium text-text">{fmt(total)}</span>
        </div>
      </div>
    </div>
  );
};

export const CostSection = ({
  data,
  tokensByModel,
  commitCount,
  linesChanged,
  defaultCollapsed,
}: CostSectionProps) => {
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const modelEntries = Object.entries(data.costByModel).sort((a, b) => b[1] - a[1]);
  const showStackedBar = data.subagentCostUsd > 0;
  const parentPct =
    showStackedBar && data.totalSessionCostUsd > 0
      ? (data.parentCostUsd / data.totalSessionCostUsd) * 100
      : 100;

  return (
    <ReportSection title="Cost Analysis" icon={DollarSign} defaultCollapsed={defaultCollapsed}>
      <div className="mb-4 text-2xl font-bold text-text">{fmt(data.totalSessionCostUsd)}</div>

      {/* Parent/Subagent stacked bar */}
      {showStackedBar && (
        <div className="mb-4">
          <div className="mb-1.5 flex h-3 w-full overflow-hidden rounded-full">
            <div
              className="h-full"
              style={{ width: `${parentPct}%`, backgroundColor: '#60a5fa' }}
            />
            <div
              className="h-full"
              style={{ width: `${100 - parentPct}%`, backgroundColor: '#c084fc' }}
            />
          </div>
          <div className="flex gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: '#60a5fa' }}
              />
              <span className="text-text-secondary">Parent: {fmt(data.parentCostUsd)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: '#c084fc' }}
              />
              <span className="text-text-secondary">Subagent: {fmt(data.subagentCostUsd)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {!showStackedBar && (
          <>
            <div>
              <div className="text-xs text-text-muted">Parent Cost</div>
              <div className="text-sm font-medium text-text">{fmt(data.parentCostUsd)}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Subagent Cost</div>
              <div className="text-sm font-medium text-text">{fmt(data.subagentCostUsd)}</div>
            </div>
          </>
        )}
        <div>
          <div className="text-xs text-text-muted">Per Commit</div>
          <div className="text-[10px] text-text-muted">
            {commitCount > 0 ? (
              <>
                total cost {'\u00F7'} {commitCount} commit{commitCount !== 1 ? 's' : ''}
              </>
            ) : (
              'no commits'
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text">
              {data.costPerCommit != null ? fmt(data.costPerCommit) : 'N/A'}
            </span>
            {data.costPerCommitAssessment && (
              <AssessmentBadge
                assessment={data.costPerCommitAssessment}
                metricKey="costPerCommit"
              />
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Per Line Changed</div>
          <div className="text-[10px] text-text-muted">
            {linesChanged > 0 ? (
              <>
                total cost {'\u00F7'} {linesChanged.toLocaleString()} line
                {linesChanged !== 1 ? 's' : ''}
              </>
            ) : (
              'no lines changed'
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text">
              {data.costPerLineChanged != null ? `$${data.costPerLineChanged.toFixed(6)}` : 'N/A'}
            </span>
            {data.costPerLineAssessment && (
              <AssessmentBadge assessment={data.costPerLineAssessment} metricKey="costPerLine" />
            )}
          </div>
        </div>
      </div>

      {modelEntries.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th className="pb-2 pr-4">Model</th>
              <th className="pb-2 pr-4 text-right">Input</th>
              <th className="pb-2 pr-4 text-right">Output</th>
              <th className="pb-2 pr-4 text-right">Cache Read</th>
              <th className="pb-2 pr-4 text-right">Cache Write</th>
              <th className="pb-2 pr-4 text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {modelEntries.map(([model, cost]) => {
              const stats = tokensByModel[model];
              // Don't allow expansion for the synthetic aggregated row — getPricing
              // would return wrong default rates for a non-model label.
              const isAggregateRow = model === 'Subagents (combined)';
              const isExpanded = expandedModel === model && !!stats && !isAggregateRow;
              const pricing = isAggregateRow ? null : getPricing(model);
              return (
                <Fragment key={model}>
                  <tr
                    className={`border-border/50 border-b ${stats ? 'hover:bg-surface-raised/50 cursor-pointer' : ''}`}
                    onClick={() => {
                      if (isAggregateRow) {
                        const el = document.getElementById(sectionId('Subagents'));
                        if (el) {
                          el.scrollIntoView({ behavior: 'smooth' });
                          el.dispatchEvent(new CustomEvent('report-section-expand'));
                        }
                      } else if (stats) {
                        setExpandedModel(isExpanded ? null : model);
                      }
                    }}
                  >
                    <td className="py-1.5 pr-4 text-text">
                      {isAggregateRow ? (
                        <span className="mr-1.5 inline-block w-3 text-text-muted">{'\u2192'}</span>
                      ) : (
                        <span className="mr-1.5 inline-block w-3 text-text-muted">
                          {stats ? (isExpanded ? '\u25BC' : '\u25B6') : ''}
                        </span>
                      )}
                      {model}
                    </td>
                    <td className="py-1.5 pr-4 text-right text-text-secondary">
                      {stats ? fmtK(stats.inputTokens) : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-right text-text-secondary">
                      {stats ? fmtK(stats.outputTokens) : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-right text-text-secondary">
                      {stats ? fmtK(stats.cacheRead) : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-right text-text-secondary">
                      {stats ? fmtK(stats.cacheCreation) : '—'}
                    </td>
                    <td className="py-1.5 pr-4 text-right font-medium text-text">{fmt(cost)}</td>
                  </tr>
                  {isExpanded && stats && pricing && (
                    <tr>
                      <td colSpan={6} className="px-4 pb-3 pt-1">
                        <CostBreakdownCard stats={stats} pricing={pricing} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </ReportSection>
  );
};
