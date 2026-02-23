import { severityColor } from '@renderer/utils/reportAssessments';
import { AlertTriangle, CheckCircle, ChevronRight, Info, XCircle } from 'lucide-react';

import { sectionId } from '../ReportSection';

import type { Severity, Takeaway } from '@renderer/utils/reportAssessments';

const SEVERITY_ICONS: Record<Severity, React.ComponentType<{ className?: string }>> = {
  danger: XCircle,
  warning: AlertTriangle,
  good: CheckCircle,
  neutral: Info,
};

const scrollToSection = (sectionTitle: string) => {
  const el = document.getElementById(sectionId(sectionTitle));
  if (!el) return;
  el.dispatchEvent(new CustomEvent('report-section-expand'));
};

interface KeyTakeawaysSectionProps {
  takeaways: Takeaway[];
}

export const KeyTakeawaysSection = ({ takeaways }: KeyTakeawaysSectionProps) => {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-4">
      <div className="mb-3 text-sm font-semibold text-text">Key Takeaways</div>
      <div className="flex flex-col gap-2">
        {takeaways.map((t, idx) => {
          const Icon = SEVERITY_ICONS[t.severity];
          const color = severityColor(t.severity);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => scrollToSection(t.sectionTitle)}
              className="flex w-full items-start gap-3 rounded-md border-l-2 bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-raised"
              style={{ borderLeftColor: color }}
            >
              <span className="mt-0.5 shrink-0" style={{ color }}>
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text">{t.title}</div>
                <div className="text-xs text-text-secondary">{t.detail}</div>
              </div>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-text-muted" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
