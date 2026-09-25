import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { depotLabel, postcodeGroupLabel } from '../lib/tenantLabels';
import { SchedulesTab } from './schedules/SchedulesTab';
import { ZonesTab } from './schedules/ZonesTab';
import { ZoneGroupsTab } from './schedules/ZoneGroupsTab';
import { DepotsTab } from './schedules/DepotsTab';

// Schedules module. Nightly booking template surface (tblBulkRunSchedule)
// plus the territory data the templates reference (postcode groups, zones,
// zone groups, depots). Distinct from Recurring Routes (which lives on
// the Configurator Route entity) - the two are sibling top-level nav
// entries.

type Tab = 'schedules' | 'zones' | 'postcode-groups' | 'depots';

export default function Schedules() {
  const user = useAuth();
  const isUs = user.isUsTenant;
  // Tab labels adapt per tenant. NZ operators call BulkZonePostcodeGroup
  // "Postcode Groups" and TblBulkRegion "Depots"; US operators say
  // "Zip Groups" + "Locations" for the same rows.
  const TABS: { key: Tab; label: string }[] = [
    { key: 'schedules', label: 'Schedules' },
    { key: 'zones', label: 'Zones' },
    { key: 'postcode-groups', label: postcodeGroupLabel(isUs, true) },
    { key: 'depots', label: depotLabel(isUs, true) },
  ];
  const [activeTab, setActiveTab] = useState<Tab>('schedules');
  // Keep-alive pattern (matches RecurringRoutes.tsx): once a tab has been
  // visited, keep its subtree mounted (hidden via CSS) so switching back is
  // instant instead of re-fetching. Un-visited tabs are un-mounted on first
  // paint so we do not fire N parallel bootstraps.
  const [mounted, setMounted] = useState<Set<Tab>>(() => new Set(['schedules']));
  const activate = (t: Tab) => {
    setActiveTab(t);
    setMounted((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
  };
  const tabHidden = (t: Tab) => (activeTab === t ? '' : 'hidden');
  const shouldRender = useMemo(() => mounted, [mounted]);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3">
      {/* Page title lives in the top-of-app Header (see Header.tsx
          PAGE_NAMES). Keep the tagline; drop the inline h1 to avoid a
          duplicate. */}
      <p className="text-text-secondary text-xs">
        Booking templates that drive the nightly prebook cron. Configure schedule
        active zones, cutoffs, linehaul legs, and the postcode territory each
        schedule points at.
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
      </div>

      {shouldRender.has('schedules') && (
        <div className={tabHidden('schedules')}><SchedulesTab /></div>
      )}
      {shouldRender.has('zones') && (
        <div className={tabHidden('zones')}><ZonesTab /></div>
      )}
      {shouldRender.has('postcode-groups') && (
        <div className={tabHidden('postcode-groups')}><ZoneGroupsTab /></div>
      )}
      {shouldRender.has('depots') && (
        <div className={tabHidden('depots')}><DepotsTab /></div>
      )}
    </div>
  );
}
