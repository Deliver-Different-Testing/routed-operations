import { useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import ScheduledRoutes from './ScheduledRoutes';
import { LinehaulTab } from './recurring-routes/LinehaulTab';
import { RouteRosterTab } from './recurring-routes/RouteRosterTab';
import { LinehaulRosterTab } from './recurring-routes/LinehaulRosterTab';
import { SharedTargetsProvider } from './recurring-routes/SharedTargetsContext';

// Recurring Routes page. Merges the Configurator's four tabs (Routes,
// Linehaul, Route Roster, Linehaul Roster) plus the Recurring Jobs external
// link into RoutedOperations. Ported 2026-08-12 from
// C:\Gitlab\Configurator_Root\Configurator\wwwroot\app\react\pages\tenant\RecurringRoutes.tsx.
//
// The Routes tab body is delegated to the existing ScheduledRoutes.tsx page
// (interactive map + coverage-polygon integration + unsaved-changes guard);
// the other three tabs are freshly ported.

type Tab = 'routes' | 'linehaul' | 'roster' | 'linehaul-roster';

const TABS: { key: Tab; label: string }[] = [
  { key: 'routes', label: 'Routes' },
  { key: 'linehaul', label: 'Linehaul' },
  { key: 'roster', label: 'Route Roster' },
  { key: 'linehaul-roster', label: 'Linehaul Roster' },
];

export default function RecurringRoutes() {
  const user = useAuth();
  const recurringJobsUrl = user.despatchWebBaseUrl
    ? `${user.despatchWebBaseUrl}/#!/recurringJobs`
    : null;
  const [activeTab, setActiveTab] = useState<Tab>('routes');
  // Once a tab has been visited, keep it mounted (rendered but hidden)
  // so switching back is instant instead of re-fetching from scratch.
  // Initial page load only mounts the default tab (Routes).
  const [mounted, setMounted] = useState<Set<Tab>>(() => new Set(['routes']));
  const activate = (t: Tab) => {
    setActiveTab(t);
    setMounted((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
  };
  const tabHidden = (t: Tab) => (activeTab === t ? '' : 'hidden');
  const shouldRender = useMemo(() => mounted, [mounted]);

  return (
    <SharedTargetsProvider>
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Page title lives in the top-of-app Header (see components/Layout/
          Header.tsx PAGE_NAMES). Keep the tagline; drop the inline h1 so
          the title isn't duplicated. */}
      <p className="text-text-secondary text-xs">
        Named routes covering a cluster of zip codes, rostered to a courier, agent, or NP per day.
        The roster feeds nightly prebook job creation and surfaces in RunViewer.
      </p>

      <div className="flex gap-0.5 rounded-xl border border-border bg-white p-0.5 shadow-sm w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => activate(key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              activeTab === key
                ? 'bg-[#0d0c2c] text-white shadow-sm'
                : 'text-text-secondary hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
        {recurringJobsUrl && (
          <button
            onClick={() => window.open(recurringJobsUrl, '_blank', 'noopener,noreferrer')}
            title="Opens the Recurring Jobs view in DespatchWeb (new tab)"
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-slate-50 transition-all"
          >
            Recurring Jobs
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}
      </div>

      {/* Every visited tab stays mounted (CSS hidden when inactive) so
          switching back doesn't re-fetch. Un-visited tabs stay un-mounted
          on first page load so the initial paint isn't blocked on
          four parallel fetches. */}
      {shouldRender.has('routes') && (
        <div className={tabHidden('routes')}><ScheduledRoutes /></div>
      )}
      {shouldRender.has('linehaul') && (
        <div className={tabHidden('linehaul')}><LinehaulTab /></div>
      )}
      {shouldRender.has('roster') && (
        <div className={tabHidden('roster')}><RouteRosterTab /></div>
      )}
      {shouldRender.has('linehaul-roster') && (
        <div className={tabHidden('linehaul-roster')}><LinehaulRosterTab /></div>
      )}
    </div>
    </SharedTargetsProvider>
  );
}
