import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import ScheduledRoutes from './ScheduledRoutes';
import { LinehaulTab } from './recurring-routes/LinehaulTab';
import { RouteRosterTab } from './recurring-routes/RouteRosterTab';
import { LinehaulRosterTab } from './recurring-routes/LinehaulRosterTab';

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

  return (
    <div className="space-y-3 p-4">
      <div>
        <h1 className="text-lg font-semibold text-[#0d0c2c] leading-tight">Recurring Routes</h1>
        <p className="text-text-secondary text-xs mt-0.5">
          Named routes covering a cluster of zip codes, rostered to a courier, agent, or NP per day.
          The roster feeds nightly prebook job creation and surfaces in RunViewer.
        </p>
      </div>

      <div className="flex gap-0.5 rounded-xl border border-border bg-white p-0.5 shadow-sm w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
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

      {activeTab === 'routes' && <ScheduledRoutes />}
      {activeTab === 'linehaul' && <LinehaulTab />}
      {activeTab === 'roster' && <RouteRosterTab />}
      {activeTab === 'linehaul-roster' && <LinehaulRosterTab />}
    </div>
  );
}
