import { Link } from 'react-router-dom';
import { Card } from '../components/common/Card';
import { useAuth } from '../context/AuthContext';
import { postcodeLabel } from '../lib/tenantLabels';

interface ModuleCard {
  to: string;
  title: string;
  blurb: string;
  cta: string;
}

function buildModules(isUs: boolean): ModuleCard[] {
  const shortLower = postcodeLabel(isUs, true).toLowerCase();
  // Order matches the Sidebar so the Dashboard cards read top-to-bottom
  // in the same sequence as the left nav: Bulk Import → Routes →
  // Route Viewer → Quoting → Recurring Routes → Polygon Builder.
  // (Dashboard + Auto-Assign Log have no card - Dashboard is this page,
  // Auto-Assign Log is a diagnostics tool that operators rarely open
  // from a card.)
  return [
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
      blurb: 'Operator cockpit that replaces the legacy RunViewer suite. Six sub-modules: Run Viewer (primary dispatch), Scan Manager (Bulk + Routed), Print Manager, Customer Services, Linehaul, Mobile. Backend endpoints under /api/runviewer/* are live and returning real tenant data; frontend UI builds out P3+.',
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
      to: '/polygon-builder',
      title: 'Polygon Builder',
      blurb: `Pick ${shortLower} boundaries on a Google Map, then save the selection as a recurring route (writes Route + RouteZipcodes so it drives the downstream prebook cron).`,
      cta: 'Open Polygon Builder',
    },
  ];
}

export default function Dashboard() {
  const user = useAuth();
  const modules = buildModules(user.isUsTenant);
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
          <Card key={m.to} title={m.title} className="h-full flex flex-col">
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
