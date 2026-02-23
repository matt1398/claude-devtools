import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  assessmentColor,
  assessmentExplanation,
  assessmentLabel,
} from '@renderer/utils/reportAssessments';

import type { MetricKey } from '@renderer/utils/reportAssessments';

interface AssessmentBadgeProps {
  assessment: string;
  metricKey?: MetricKey;
}

export const AssessmentBadge = ({ assessment, metricKey }: AssessmentBadgeProps) => {
  const color = assessmentColor(assessment);
  const explanation = metricKey ? assessmentExplanation(metricKey, assessment) : '';
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const badgeRef = useRef<HTMLSpanElement>(null);
  const enterTimer = useRef<ReturnType<typeof setTimeout>>();
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleMouseEnter = useCallback(() => {
    if (!explanation) return;
    clearTimeout(leaveTimer.current);
    enterTimer.current = setTimeout(() => {
      if (badgeRef.current) {
        const rect = badgeRef.current.getBoundingClientRect();
        setTooltipPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
      }
      setShowTooltip(true);
    }, 200);
  }, [explanation]);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(enterTimer.current);
    leaveTimer.current = setTimeout(() => setShowTooltip(false), 150);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(enterTimer.current);
      clearTimeout(leaveTimer.current);
    };
  }, []);

  return (
    <>
      <span
        ref={badgeRef}
        className="rounded px-2 py-0.5 text-xs font-medium"
        style={{ backgroundColor: `${color}20`, color }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {assessmentLabel(assessment)}
      </span>
      {showTooltip &&
        explanation &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 max-w-60 rounded border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-text-secondary shadow-lg"
            style={{
              top: tooltipPos.top,
              left: tooltipPos.left,
              transform: 'translateX(-50%)',
            }}
          >
            {explanation}
          </div>,
          document.body
        )}
    </>
  );
};
