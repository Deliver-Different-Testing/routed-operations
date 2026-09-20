import { useId, type ReactNode } from 'react';

interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

/** Horizontal tab bar with `role="tablist"` / `role="tab"` semantics. */
interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  variant?: 'default' | 'pills';
  /** Accessible label for the tablist (e.g. "Settings sections"). */
  'aria-label'?: string;
}

export type { Tab, TabsProps };

export function Tabs({ tabs, activeTab, onTabChange, variant = 'default', 'aria-label': ariaLabel }: TabsProps) {
  const groupId = useId();

  const renderTab = (tab: Tab, isActive: boolean, extraClasses: string) => (
    <button
      key={tab.id}
      id={`${groupId}-tab-${tab.id}`}
      role="tab"
      aria-selected={isActive}
      aria-controls={`${groupId}-panel-${tab.id}`}
      tabIndex={isActive ? 0 : -1}
      data-testid={`tab-${tab.id}`}
      onClick={() => onTabChange(tab.id)}
      onKeyDown={(e) => {
        const idx = tabs.findIndex((t) => t.id === tab.id);
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          const next = tabs[(idx + 1) % tabs.length];
          onTabChange(next.id);
          document.getElementById(`${groupId}-tab-${next.id}`)?.focus();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
          onTabChange(prev.id);
          document.getElementById(`${groupId}-tab-${prev.id}`)?.focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          onTabChange(tabs[0].id);
          document.getElementById(`${groupId}-tab-${tabs[0].id}`)?.focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          const last = tabs[tabs.length - 1];
          onTabChange(last.id);
          document.getElementById(`${groupId}-tab-${last.id}`)?.focus();
        }
      }}
      className={extraClasses}
    >
      {tab.icon && <span className="w-4 h-4" aria-hidden="true">{tab.icon}</span>}
      {tab.label}
      {tab.count !== undefined && (
        <span className={`px-1.5 py-0.5 text-xs rounded-full ${isActive ? 'bg-brand-cyan/10 text-brand-cyan' : 'bg-gray-100 text-text-muted'}`}>
          {tab.count}
        </span>
      )}
      {/* Active indicator (default variant only) */}
      {variant === 'default' && isActive && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-cyan rounded-t-full" aria-hidden="true" />
      )}
    </button>
  );

  if (variant === 'pills') {
    return (
      <div role="tablist" aria-label={ariaLabel} className="flex gap-2 p-2 bg-surface-light rounded-lg" data-testid="tabs">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return renderTab(
            tab,
            isActive,
            `flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
              isActive ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary hover:bg-white/50'
            }`,
          );
        })}
      </div>
    );
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-1 border-b border-border bg-white" data-testid="tabs">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return renderTab(
          tab,
          isActive,
          `relative flex items-center gap-2 px-5 py-3.5 text-sm font-medium transition-all duration-200 -mb-px ${
            isActive ? 'text-brand-cyan' : 'text-text-muted hover:text-text-primary hover:bg-gray-50'
          }`,
        );
      })}
    </div>
  );
}
