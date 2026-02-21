import { useState } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

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

  return (
    <div className="rounded-lg border border-border bg-surface-raised">
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
