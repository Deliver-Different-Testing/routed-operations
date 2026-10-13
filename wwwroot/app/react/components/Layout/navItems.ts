// The Routed Operations menu. ONE tree, read by the Sidebar (what to show) and
// by AppLayout's FeatureRoute guard (which switches a URL needs), so the menu
// and the guard cannot disagree about which switch a page sits behind.
//
// Every entry carries its Access Control switch (featureKey), DisplayName =
// the label (Routed Ops switches spec section 1). Keys are seeded by
// dbmigrationsv2 20261009180000; lib/accessSwitches.ts lists them and
// navItems.test.ts pins the two together.

import type { RoFeatureKey } from '../../lib/accessSwitches';

export interface NavItem {
  to: string;
  label: string;
  /** Access Control switch for this entry. A group's key gates the whole group. */
  featureKey: RoFeatureKey;
  /** Small pill rendered inline after the label. Used to flag preview
   *  or NEW modules (e.g. the id-keyed Schedules NEW view sitting
   *  alongside the legacy tuple-keyed Schedules page). */
  badge?: string;
  /** When set, the item renders as a collapsible group header.
   *  Auto-expanded when any child's route matches the current path. */
  children?: NavItem[];
  /** A routable page with its own switch but no menu entry (Mobile). The
   *  route guard reads it; the Sidebar does not render it. */
  hidden?: boolean;
}

export const navItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', featureKey: 'ro-dashboard' },
  { to: '/bulk-import', label: 'Bulk Import', featureKey: 'ro-bulk-import' },
  { to: '/routes', label: 'Route Builder', featureKey: 'ro-route-builder' },
  // Route Viewer sits directly below Route Builder since the two cockpits are
  // the operator's most-used surfaces and share the same run+job data.
  {
    to: '/route-viewer',
    label: 'Route Viewer',
    featureKey: 'ro-route-viewer',
    children: [
      { to: '/route-viewer',           label: 'Route Viewer',      featureKey: 'ro-route-viewer-runs' },
      { to: '/route-viewer/linehaul',  label: 'Linehaul',          featureKey: 'ro-linehaul' },
      { to: '/route-viewer/scans',     label: 'Scan Manager',      featureKey: 'ro-scan-manager' },
      { to: '/route-viewer/print',     label: 'Print Manager',     featureKey: 'ro-print-manager' },
      { to: '/route-viewer/cs',        label: 'Customer Services', featureKey: 'ro-customer-services' },
      { to: '/route-viewer/mobile',    label: 'Mobile',            featureKey: 'ro-mobile', hidden: true },
    ],
  },
  { to: '/quoting', label: 'Quoting', featureKey: 'ro-quoting' },
  { to: '/recurring-routes', label: 'Recurring Routes', featureKey: 'ro-recurring-routes' },
  { to: '/schedules', label: 'Schedules', featureKey: 'ro-schedules' },
  // Steve's 2026-09-08 brief: the id-keyed multi-client schedules view
  // sits alongside the legacy tuple-keyed Schedules page until ops sign
  // off on the new one. Both read the same day rows; the new one lifts
  // Dane's visual builder + client link tables + BaseScheduleId
  // overrides. Both stay live throughout Phase 1..5 of the workstream.
  // Its switch is "Schedules (NEW)" so the two read apart in Access Control.
  { to: '/schedules-new', label: 'Schedules', badge: 'NEW', featureKey: 'ro-schedules-new' },
  // Client-first override view (F1 UI polish, 2026-09-24). Pick a client,
  // see every schedule they differ from - the view ops actually wanted,
  // impossible on the schedule-first surface without opening 2,725 rows.
  { to: '/client-overrides', label: 'Client Overrides', featureKey: 'ro-client-overrides' },
  // Driver Scheduling module (2026-09-07 port from CourierManager).
  // Distinct from Schedules above - that's booking / prebook
  // templates, this is courier availability rosters + time slots +
  // SMS notifications.
  { to: '/driver-scheduling', label: 'Driver Rostering', featureKey: 'ro-driver-rostering' },
  { to: '/polygon-builder', label: 'Polygon Builder', featureKey: 'ro-polygon-builder' },
  { to: '/auto-assign-log', label: 'Auto-Assign Log', featureKey: 'ro-auto-assign-log' },
  // DFRNT-staff tool that loads legacy job history into tucJobArchive. Its
  // switch is seeded for DF Admin only (spec section 1); it used to be gated
  // on the Internal billing-flag claim.
  { to: '/historic-archive', label: 'Historic Archive Upload', featureKey: 'ro-historic-archive' },
];
