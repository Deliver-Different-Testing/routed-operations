import { useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface NavItem {
  to: string;
  label: string;
  /** Small pill rendered inline after the label. Used to flag preview
   *  or NEW modules (e.g. the id-keyed Schedules NEW view sitting
   *  alongside the legacy tuple-keyed Schedules page). */
  badge?: string;
  /** When set, the item renders as a collapsible group header.
   *  Auto-expanded when any child's route matches the current path. */
  children?: NavItem[];
  /** When true, only render for internal-staff users. */
  internalOnly?: boolean;
}

const items: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/bulk-import', label: 'Bulk Import' },
  { to: '/routes', label: 'Route Builder' },
  // Route Viewer sits directly below Route Builder since the two cockpits are
  // the operator's most-used surfaces and share the same run+job data.
  {
    to: '/route-viewer',
    label: 'Route Viewer',
    children: [
      { to: '/route-viewer',           label: 'Route Viewer' },
      { to: '/route-viewer/linehaul',  label: 'Linehaul' },
      { to: '/route-viewer/scans',     label: 'Scan Manager' },
      { to: '/route-viewer/print',     label: 'Print Manager' },
      { to: '/route-viewer/cs',        label: 'Customer Services' },
    ],
  },
  { to: '/quoting', label: 'Quoting' },
  { to: '/recurring-routes', label: 'Recurring Routes' },
  { to: '/schedules', label: 'Schedules' },
  // Steve's 2026-09-08 brief: the id-keyed multi-client schedules view
  // sits alongside the legacy tuple-keyed Schedules page until ops sign
  // off on the new one. Both read the same day rows; the new one lifts
  // Dane's visual builder + client link tables + BaseScheduleId
  // overrides. Both stay live throughout Phase 1..5 of the workstream.
  { to: '/schedules-new', label: 'Schedules', badge: 'NEW' },
  // Driver Scheduling module (2026-09-07 port from CourierManager).
  // Distinct from Schedules above - that's booking / prebook
  // templates, this is courier availability rosters + time slots +
  // SMS notifications.
  { to: '/driver-scheduling', label: 'Driver Rostering' },
  { to: '/polygon-builder', label: 'Polygon Builder' },
  { to: '/auto-assign-log', label: 'Auto-Assign Log' },
  // Internal-only surface. Loads legacy job history into tucJobArchive.
  // Server enforces the same Internal-claim gate on the controller; this
  // just hides the nav from operators who can't use it.
  { to: '/historic-archive', label: 'Historic Archive Upload', internalOnly: true },
];

function isGroupActive(pathname: string, group: NavItem): boolean {
  if (!group.children) return false;
  return pathname === group.to || pathname.startsWith(group.to + '/');
}

function ChildLink({ item, groupRoot }: { item: NavItem; groupRoot: string }) {
  // `end` semantics: the group root child (e.g. Run Viewer at
  // /route-viewer) must ONLY highlight on exact match, so
  // /route-viewer/scans does not also light up Run Viewer.
  return (
    <NavLink
      to={item.to}
      end={item.to === groupRoot}
      className={({ isActive }) =>
        `pl-6 pr-3 py-1.5 rounded text-sm transition-colors block ${
          isActive
            ? 'bg-brand-cyan text-brand-dark font-medium'
            : 'text-white/70 hover:bg-white/10'
        }`
      }
    >
      {item.label}
    </NavLink>
  );
}

export function Sidebar() {
  const location = useLocation();
  const auth = useAuth();

  // Filter out internal-only entries for non-internal users. Server also
  // enforces this on the corresponding controllers; this is UX only.
  const visibleItems = useMemo(
    () => items.filter((item) => !item.internalOnly || auth.isInternal),
    [auth.isInternal],
  );

  // Auto-expand whichever group owns the currently-active route.
  const initiallyExpanded = useMemo(() => {
    const set = new Set<string>();
    for (const item of visibleItems) {
      if (item.children && isGroupActive(location.pathname, item)) {
        set.add(item.to);
      }
    }
    return set;
  }, [location.pathname, visibleItems]);
  const [expanded, setExpanded] = useState<Set<string>>(initiallyExpanded);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <aside className="w-56 bg-brand-dark text-white flex flex-col">
      <div className="px-4 py-4 text-lg font-semibold tracking-wide">Routed Operations</div>
      <nav className="flex-1 flex flex-col gap-1 px-2 overflow-y-auto">
        {visibleItems.map((item) => {
          if (!item.children) {
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `px-3 py-2 rounded text-sm transition-colors flex items-center gap-2 ${
                    isActive
                      ? 'bg-brand-cyan text-brand-dark font-medium'
                      : 'text-white/80 hover:bg-white/10'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span>{item.label}</span>
                    {item.badge && (
                      // Badge swaps to a dark pill on the active
                      // (cyan) background so it stays legible. Idle
                      // state uses the cyan-tinted pill Kevin drew.
                      <span
                        className={`text-[10px] font-semibold tracking-wide rounded px-1.5 py-0.5 leading-none ${
                          isActive
                            ? 'bg-brand-dark text-brand-cyan border border-brand-dark'
                            : 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/40'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            );
          }
          const groupActive = isGroupActive(location.pathname, item);
          const isOpen = expanded.has(item.to) || groupActive;
          // Chevron + panel animation ported from Configurator's Sidebar
          // (wwwroot/app/react/components/Layout/Sidebar.tsx:712-720). The
          // chevron is a proper SVG down-arrow that flips to point up when
          // expanded via `rotate-180` on a `transition-transform duration-200`.
          // The sub-panel uses the grid-rows 0fr <-> 1fr trick so the height
          // animates from 0 to auto without needing a hard-coded max-h.
          return (
            <div key={item.to} className="flex flex-col">
              <button
                type="button"
                onClick={() => toggle(item.to)}
                className={`px-3 py-2 rounded text-sm transition-colors flex items-center justify-between w-full text-left ${
                  groupActive
                    ? 'text-white font-medium bg-white/5'
                    : 'text-white/80 hover:bg-white/10'
                }`}
                aria-expanded={isOpen}
              >
                <span>{item.label}</span>
                <svg
                  className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} ${
                    groupActive ? 'text-brand-cyan' : 'text-white/60'
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div
                className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                  isOpen ? 'grid-rows-[1fr] mt-0.5 mb-1' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="flex flex-col gap-0.5">
                    {item.children.map((child) => (
                      <ChildLink key={child.to} item={child} groupRoot={item.to} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </nav>
      <div className="px-4 py-3 text-xs text-white/50">Stage 1 - Route Builder</div>
    </aside>
  );
}
