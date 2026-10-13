// Access Control switches for Routed Operations (Steve's Routed Ops switches
// spec 2026-09-30, sections 1 and 3).
//
// Every menu item carries a feature key. DF Admin turns screens on and off per
// client type in Access Control; the SPA reads the caller's visible keys from
// GET /api/me/visible-features, and the server enforces the same keys with
// [RequireFeature]. The menu and the route guard both read the nav tree
// (components/Layout/navItems.ts), so they cannot disagree about which switch
// a page sits behind.
//
// Distinct from lib/partnerAccess.ts, which is a fixed network-partner denial
// that tracks the RouteBuilder.* policies. Both apply.

/**
 * The keys seeded by dbmigrationsv2 20261009180000_RoutedOpsAccessSwitchKeys.sql.
 * A key used in the nav that is not here would never be granted to anyone
 * but DF Admin, so the governance test pins the two together.
 */
export const RO_FEATURE_KEYS = [
  'ro-dashboard',
  'ro-bulk-import',
  'ro-route-builder',
  'ro-route-viewer',
  'ro-route-viewer-runs',
  'ro-linehaul',
  'ro-scan-manager',
  'ro-print-manager',
  'ro-customer-services',
  'ro-mobile',
  'ro-quoting',
  'ro-recurring-routes',
  'ro-schedules',
  'ro-schedules-new',
  'ro-client-overrides',
  'ro-driver-rostering',
  'ro-polygon-builder',
  'ro-auto-assign-log',
  'ro-historic-archive',
] as const;

export type RoFeatureKey = (typeof RO_FEATURE_KEYS)[number];

export type FeaturesStatus = 'loading' | 'ready' | 'error';

/**
 * The menu's gate, same semantics as the configurator's makeFeatureAllowed:
 * ungated always shows; a failed fetch FAILS CLOSED; while loading the menu is
 * optimistic so the sidebar never flashes empty (the route guard, by
 * contrast, waits).
 */
export const makeFeatureAllowed =
  (status: FeaturesStatus, visible: ReadonlySet<string> | null) =>
  (key?: string): boolean => {
    if (!key) return true;
    if (status === 'error') return false;
    if (status === 'loading') return true;
    return !!visible && visible.has(key);
  };

/** The minimum a nav entry needs for the gate to read it. */
export interface KeyedRoute {
  to: string;
  featureKey?: string;
  children?: readonly KeyedRoute[];
}

function matches(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(to + '/');
}

/**
 * Every switch on the menu chain for `pathname` (group key, then page key).
 * ALL must be visible for the page to open: the same rule the sidebar applies
 * to show the item. The most specific (longest) matching entry wins, so
 * /route-viewer/mobile resolves to the Mobile entry, not the group root.
 * Returns [] for a path no menu entry owns (left ungated).
 */
export function routeGates(pathname: string, items: readonly KeyedRoute[]): string[] {
  let best: { to: string; keys: string[] } | null = null;
  const consider = (to: string, keys: (string | undefined)[]) => {
    if (matches(pathname, to) && (!best || to.length > best.to.length)) {
      best = { to, keys: keys.filter((k): k is string => !!k) };
    }
  };

  for (const item of items) {
    if (item.children) {
      for (const child of item.children) consider(child.to, [item.featureKey, child.featureKey]);
    } else {
      consider(item.to, [item.featureKey]);
    }
  }
  return best ? (best as { keys: string[] }).keys : [];
}
