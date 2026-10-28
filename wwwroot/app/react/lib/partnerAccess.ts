// Which app surfaces a logged-in network partner may not reach.
//
// ONE list, imported by both Sidebar.tsx (hides the nav entry) and App.tsx
// (redirects the route). Keeping them on separate lists is how the two drift:
// a nav-only hide leaves every page reachable by typing the URL, and a
// route-only guard leaves dead links in the sidebar.
//
// This is UX, not security. The real gate is server-side: the RouteBuilder.*
// authorization policies in Program.cs deny the NP claim, so every endpoint
// behind them 403s regardless of what the browser renders. This list exists so
// a partner is not shown pages that would only break.
//
// Scope. The list is "every surface a partner would be refused anyway", which
// is wider than the three entries Steve's spec names (D15 -> D17, Kevin
// 2026-10-01).
//
// Steve asked to hide "the Route Builder / cockpit / bulk import entries",
// which is /routes and /bulk-import. But the policy names are misleading:
// RouteBuilder.Read alone guards 16 controllers, so denying Read/Build/Admin
// (D1 = B) also 403s Schedules, Schedules NEW, Recurring Routes, Client
// Overrides, Driver Rostering and Polygon Builder. Hiding only Steve's three
// would have left six entries that open and then fail every data call. The
// list therefore tracks the server, not the spec wording, and the gap is in
// the Part 4 report for Steve.
//
// /quoting and /auto-assign-log were deliberately absent until 2026-10-07.
// RouteBuilder.Quote and .Polygon kept no network-partner check under D1 = B,
// so a partner reached both and they worked, including MarginPct, CostPerJob
// and RecommendedQuote on the quoting page. Hiding a working page would have
// been wrong. Steve ruled on 2026-10-06 that a partner is denied both, so
// CanUsePlaceholderModule now refuses them and this list follows, in that
// order: the server is the gate, the list only stops the dead links.
//
// Note the 16-17 Sep configurator change already removed Recurring Routes and
// Schedules from the NP lane. Routed Operations still shows them, so the two
// products disagree about the same partner. Also flagged for Steve.
//
// See NP-PAY-PART4-TODO.md T2 / T3 / D15.

/** Top-level paths a network partner may not open. */
export const PARTNER_DENIED_PATHS: readonly string[] = [
  // Steve's spec names these two.
  '/routes',             // Route Builder cockpit
  '/bulk-import',
  // These six 403 under RouteBuilder.Read / .Admin, so showing them would only
  // produce broken pages. Schedules and Recurring Routes also match the
  // 16-17 Sep configurator decision that took them out of the NP lane.
  '/schedules',
  '/schedules-new',
  '/recurring-routes',
  '/client-overrides',
  '/driver-scheduling',
  '/polygon-builder',
  // Added 2026-10-07 with the RouteBuilder.Quote / .Polygon denial. Note
  // .Polygon guards AutoAssignLogController and ZonesController, not the
  // Polygon Builder page above, which was already denied through Read/Admin.
  '/quoting',
  '/auto-assign-log',
];

/**
 * True when `pathname` is one of the denied surfaces, or sits underneath one.
 *
 * Segment-aware on purpose. A bare `startsWith` would deny a sibling path by
 * accident, e.g. '/schedules-new' against '/schedules' if that pair is ever
 * added to the list.
 */
export function isPartnerDeniedPath(pathname: string): boolean {
  return PARTNER_DENIED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}
