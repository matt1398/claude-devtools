import { useEffect, useRef, useState } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

const sectionId = (title: string) =>
  `report-section-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

interface ReportSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export const ReportSection = ({
  title,
  icon: Icon,
  children,
  defaultCollapsed = false,
}: ReportSectionProps) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => {
      setCollapsed(false);
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    el.addEventListener('report-section-expand', handler);
    return () => el.removeEventListener('report-section-expand', handler);
  }, []);

  return (
    <div
      ref={ref}
      id={sectionId(title)}
      className="rounded-lg border border-border bg-surface-raised"
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 p-4 text-left"
      >
        {collapsed ? (
          <ChevronRight className="size-4 text-text-muted" />
        ) : (
          <ChevronDown className="size-4 text-text-muted" />
        )}
        <Icon className="size-4 text-text-secondary" />
        <span className="text-sm font-semibold text-text">{title}</span>
      </button>
      {!collapsed && <div className="border-t border-border px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
};

export { sectionId };
