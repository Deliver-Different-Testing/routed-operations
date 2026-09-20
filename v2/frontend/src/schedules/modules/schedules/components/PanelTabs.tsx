// src/modules/schedules/components/PanelTabs.tsx

export type PanelTab = 'default' | 'clients';

interface PanelTabsProps {
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** Optional badge count for clients tab (number of overrides) */
  clientOverrideCount?: number;
}

export function PanelTabs({ activeTab, onTabChange, clientOverrideCount }: PanelTabsProps) {
  const tabs: { id: PanelTab; label: string; badge?: number }[] = [
    { id: 'default', label: 'Default' },
    { id: 'clients', label: 'Clients', badge: clientOverrideCount },
  ];

  return (
    <div className="flex border-b border-border bg-surface-light" data-testid="panel-tabs" aria-label="panel tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            px-4 py-2.5 text-sm font-medium transition-colors relative
            ${activeTab === tab.id
              ? 'text-brand-dark border-b-2 border-brand-cyan -mb-px bg-white'
              : 'text-text-muted hover:text-text-primary hover:bg-surface-cream'
            }
          `}
        >
          <span className="flex items-center gap-2">
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-brand-purple/10 text-brand-purple">
                {tab.badge}
              </span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
