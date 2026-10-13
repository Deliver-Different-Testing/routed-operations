import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RO_FEATURE_KEYS, makeFeatureAllowed, routeGates } from './accessSwitches';
import { navItems, type NavItem } from '../components/Layout/navItems';

const flatten = (items: readonly NavItem[]): NavItem[] =>
  items.flatMap((i) => [i, ...(i.children ?? [])]);

describe('access switch governance', () => {
  it('every nav entry declares a key the migration seeds', () => {
    const known = new Set<string>(RO_FEATURE_KEYS);
    for (const entry of flatten(navItems)) {
      expect(known.has(entry.featureKey), `${entry.to} -> ${entry.featureKey}`).toBe(true);
    }
  });

  it('every seeded key is used by exactly one nav entry', () => {
    // A key nothing reads is a switch in Access Control that does nothing.
    const used = flatten(navItems).map((e) => e.featureKey);
    for (const key of RO_FEATURE_KEYS) {
      expect(used.filter((k) => k === key), key).toHaveLength(1);
    }
  });

  it('matches the keys in dbmigrationsv2 20261009180000 exactly', () => {
    // Hard-coded mirror of the migration, so a rename on either side fails here.
    expect([...RO_FEATURE_KEYS].sort()).toEqual([
      'ro-auto-assign-log', 'ro-bulk-import', 'ro-client-overrides', 'ro-customer-services',
      'ro-dashboard', 'ro-driver-rostering', 'ro-historic-archive', 'ro-linehaul', 'ro-mobile',
      'ro-polygon-builder', 'ro-print-manager', 'ro-quoting', 'ro-recurring-routes',
      'ro-route-builder', 'ro-route-viewer', 'ro-route-viewer-runs', 'ro-scan-manager',
      'ro-schedules', 'ro-schedules-new',
    ]);
  });

  it('every page route in App.tsx sits behind at least one switch', () => {
    // Reads the route table itself, so a page added without a nav entry
    // (and so without a switch) fails here rather than opening ungated.
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1])
      .filter((p) => p !== '/' && p !== '*');
    expect(paths.length).toBeGreaterThan(15);
    for (const p of paths) {
      expect(routeGates(p, navItems).length, p).toBeGreaterThan(0);
    }
  });
});

describe('routeGates', () => {
  it.each([
    ['/dashboard', ['ro-dashboard']],
    ['/route-viewer', ['ro-route-viewer', 'ro-route-viewer-runs']],
    ['/route-viewer/scans', ['ro-route-viewer', 'ro-scan-manager']],
    // No menu entry, still gated: the group AND its own switch.
    ['/route-viewer/mobile', ['ro-route-viewer', 'ro-mobile']],
    // Segment-aware: /schedules-new is not under /schedules.
    ['/schedules-new', ['ro-schedules-new']],
    ['/schedules', ['ro-schedules']],
    ['/historic-archive', ['ro-historic-archive']],
  ])('%s needs %j', (path, keys) => {
    expect(routeGates(path, navItems)).toEqual(keys);
  });

  it('leaves a path no menu entry owns ungated', () => {
    expect(routeGates('/', navItems)).toEqual([]);
    expect(routeGates('/nowhere', navItems)).toEqual([]);
  });
});

describe('makeFeatureAllowed', () => {
  const visible = new Set(['ro-quoting']);

  it('shows ungated entries whatever the status', () => {
    expect(makeFeatureAllowed('error', null)(undefined)).toBe(true);
  });

  it('is optimistic while loading so the menu never flashes empty', () => {
    expect(makeFeatureAllowed('loading', null)('ro-quoting')).toBe(true);
  });

  it('fails closed when the fetch failed', () => {
    expect(makeFeatureAllowed('error', null)('ro-quoting')).toBe(false);
  });

  it('shows exactly the visible keys once ready', () => {
    const allowed = makeFeatureAllowed('ready', visible);
    expect(allowed('ro-quoting')).toBe(true);
    expect(allowed('ro-route-builder')).toBe(false);
  });
});
