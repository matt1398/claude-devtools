import { useMemo, useState } from 'react';

import { isElectronMode } from '@renderer/api';
import { Bell, HardDrive, Server, Settings, Wrench } from 'lucide-react';

export type SettingsSection = 'general' | 'connection' | 'workspace' | 'notifications' | 'advanced';

interface SettingsTabsProps {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

interface TabConfig {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  electronOnly?: boolean;
}

const tabs: TabConfig[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'connection', label: 'Connection', icon: Server, electronOnly: true },
  { id: 'workspace', label: 'Workspaces', icon: HardDrive, electronOnly: true },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'advanced', label: 'Advanced', icon: Wrench },
];

export const SettingsTabs = ({
  activeSection,
  onSectionChange,
}: Readonly<SettingsTabsProps>): React.JSX.Element => {
  const [hoveredTab, setHoveredTab] = useState<SettingsSection | null>(null);
  const isElectron = useMemo(() => isElectronMode(), []);
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !tab.electronOnly || isElectron),
    [isElectron]
  );

  return (
    <div className="inline-flex gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
      {visibleTabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeSection === tab.id;
        const isHovered = hoveredTab === tab.id;

        const getTextColor = (): string => {
          if (isActive) return 'var(--color-text)';
          if (isHovered) return 'var(--color-text-secondary)';
          return 'var(--color-text-muted)';
        };

        return (
          <button
            key={tab.id}
            onClick={() => onSectionChange(tab.id)}
            onMouseEnter={() => setHoveredTab(tab.id)}
            onMouseLeave={() => setHoveredTab(null)}
            className={`flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
              isActive ? 'rounded-md font-medium' : ''
            }`}
            style={{
              backgroundColor: isActive ? 'var(--color-surface-raised)' : 'transparent',
              color: getTextColor(),
            }}
          >
            <Icon className="size-4" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};
