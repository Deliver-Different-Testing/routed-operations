import { Link } from 'react-router-dom';
import { Card } from '../components/common/Card';
import { useAuth } from '../context/AuthContext';
import { postcodeLabel } from '../lib/tenantLabels';

interface ModuleCard {
  to: string;
  title: string;
  blurb: string;
  cta: string;
  /** Small pill rendered next to the title. Matches the Sidebar's NEW
   *  badge convention so a preview module reads the same in both nav
   *  surfaces. */
  badge?: string;
  /** When true, only render for internal-staff users (mirrors the
   *  Sidebar's internalOnly gate). */
  internalOnly?: boolean;
}

function buildModules(isUs: boolean, isInternal: boolean): ModuleCard[] {
  const shortLower = postcodeLabel(isUs, true).toLowerCase();
  // Order matches the Sidebar so the Dashboard cards read top-to-bottom
  // in the same sequence as the left nav: Bulk Import -> Routes ->
  // Route Viewer -> Quoting -> Recurring Routes -> Schedules ->
  // Schedules NEW -> Driver Scheduling -> Polygon Builder ->
  // Historic Archive Upload (internal only).
  // (Dashboard + Auto-Assign Log have no card - Dashboard is this page,
  // Auto-Assign Log is a diagnostics tool that operators rarely open
  // from a card.)
  const all: ModuleCard[] = [
    {
      to: '/bulk-import',
      title: 'Data Import',
      blurb: 'Direct-insert wizard that replaces BulkImportHyper. Auto column mapping, suburb / address fixup, per-depot schedule pick, staff import bypass, bulk complete and bulk delete with FK cascade.',
      cta: 'Open Data Import',
    },
    {
      to: '/routes',
      title: 'Route Builder',
      blurb: 'Batch cockpit for building, editing and dispatching runs. Full parity with the legacy RunBuilder including map right-click, multibox, group bulk-move, layout save/load, merge run and hotkeys.',
      cta: 'Open Route Builder',
    },
    {
      to: '/route-viewer',
      title: 'Route Viewer',
      blurb: 'Operator cockpit that replaces the legacy RunViewer suite. Five sub-modules: Run Viewer (primary dispatch), Scan Manager (Bulk + Routed), Print Manager, Customer Services, Linehaul. Backend endpoints under /api/runviewer/* are live and returning real tenant data; frontend UI builds out P3+.',
      cta: 'Open Route Viewer',
    },
    {
      to: '/quoting',
      title: 'Quoting',
      blurb: 'Upload a shadow-job CSV, pick a rate card and service level, then simulate to get drivers required, cost / job, cost / km and a recommended quote. Never touches operational dispatch.',
      cta: 'Open Quoting',
    },
    {
      to: '/recurring-routes',
      title: 'Recurring Routes',
      blurb: `Manage the Configurator Route table: name, area, schedule, default courier / agent / NP, ${shortLower} codes and roster. Same rows visible in DF Admin > Operations > Recurring Routes.`,
      cta: 'Open Recurring Routes',
    },
    {
      to: '/schedules',
      // "Schedules (legacy)" - the sidebar keeps the shorter "Schedules"
      // label for real estate, but on the Dashboard we distinguish so
      // screen readers don't see two identical <h2> headings. Audit
      // MEDIUM #16 (2026-09-17).
      title: 'Schedules (legacy)',
      blurb: 'Legacy tuple-keyed schedules view (Name + LegacyClientId). Still live for operators who prefer the old shape while the id-keyed Schedules NEW view rolls out.',
      cta: 'Open Schedules',
    },
    {
      to: '/schedules-new',
      title: 'Schedules',
      blurb: "Steve's 2026-09-08 multi-client schedules view keyed on ScheduleId. One schedule, many clients; overrides stay linked to their base via BaseScheduleId; recurring routes and linehaul runs sit alongside instead of on a separate page.",
      cta: 'Open Schedules NEW',
      badge: 'NEW',
    },
    {
      to: '/driver-scheduling',
      title: 'Driver Rostering',
      blurb: 'Courier availability rosters + time slots + SMS notifications. Ported from the legacy CourierManager scheduler; distinct from Schedules above (that covers booking / prebook templates, this covers driver-side rosters).',
      cta: 'Open Driver Rostering',
    },
    {
      to: '/polygon-builder',
      title: 'Polygon Builder',
      blurb: `Pick ${shortLower} boundaries on a Google Map, then save the selection as a recurring route (writes Route + RouteZipcodes so it drives the downstream prebook cron).`,
      cta: 'Open Polygon Builder',
    },
    {
      to: '/historic-archive',
      title: 'Historic Archive Upload',
      blurb: 'Load legacy job history into tucJobArchive. Internal-only surface; the server enforces the same Internal-claim gate on the controller. Field mapping supports the full 68-field OTG CSV shape.',
      cta: 'Open Historic Archive Upload',
      internalOnly: true,
    },
  ];

  return all.filter((m) => !m.internalOnly || isInternal);
}

export default function Dashboard() {
  const user = useAuth();
  const modules = buildModules(user.isUsTenant, user.isInternal);
  return (
    <div className="h-full p-6 overflow-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <Card title="You">
          <div className="text-sm text-text-secondary space-y-1">
            <div>Name: {user.fullName ?? 'Unknown'}</div>
            <div>Email: {user.email ?? 'Unknown'}</div>
            <div>Tenant: {user.currentTenantId ?? 'Unknown'}</div>
            <div>Region: {user.countryCode ?? 'Unknown'}</div>
          </div>
        </Card>

        {modules.map((m) => (
          <Card key={m.to} className="h-full flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-base font-semibold text-text-primary">{m.title}</h2>
              {m.badge && (
                <span
                  className="text-[10px] font-semibold tracking-wide rounded px-1.5 py-0.5 leading-none bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/40"
                >
                  {m.badge}
                </span>
              )}
            </div>
            <p className="text-sm text-text-secondary">{m.blurb}</p>
            <div className="mt-auto pt-3">
              <Link
                to={m.to}
                className="inline-block px-3 py-1.5 rounded bg-brand-cyan text-brand-dark text-sm font-medium hover:bg-brand-cyan/90"
              >
                {m.cta}
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
