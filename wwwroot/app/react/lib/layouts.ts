/**
 * Cockpit panel layout persistence. Each layout captures the current sizes
 * of every horizontal + vertical panel group in the cockpit so operators
 * can save and restore custom arrangements (e.g. "Full-screen map" vs
 * "Detail focus" vs "Route Building").
 *
 * Stored in localStorage as JSON. Frontend-only for now - Layout persistence
 * on a server would need per-user storage and an auth call for every
 * save/load; for a small operator base, localStorage is enough.
 */

const KEY = 'RoutedOps_layouts';

// Route Viewer scope keys. Each module persists a distinct list under its
// own localStorage key so a "Big map" layout saved on Home does not
// clobber a "Focus label notes" layout saved on Print Manager. Matches
// master Section 14.1 (per-module `Layouts` / `CsLayouts` /
// `LinehaulLayouts` / etc.).
type LayoutScope =
  | 'default' // Route Builder cockpit (existing)
  | 'home'    // Route Viewer home / Run Viewer
  | 'cs'
  | 'linehaul'
  | 'scans'
  | 'print'
  | 'mobile';

const SCOPE_KEY_SUFFIX: Record<LayoutScope, string> = {
  default: '',
  home: '_RvHome',
  cs: '_RvCs',
  linehaul: '_RvLinehaul',
  scans: '_RvScans',
  print: '_RvPrint',
  mobile: '_RvMobile',
};

function scopedKey(scope: LayoutScope): string {
  return KEY + SCOPE_KEY_SUFFIX[scope];
}

export interface CockpitLayout {
  name: string;
  // Route Builder cockpit uses these percent-based slot sizes.
  horizontal: number[];       // [Left, RunColumn, Fleets, Map]
  leftVertical: number[];     // [GroupedJobs, JobsList, JobDetail]
  runVertical: number[];      // [RunList, RunBuilder]
  // Route Viewer Home cockpit uses percent-based slot sizes via
  // react-resizable-panels - matches the Routes cockpit exactly so
  // both surfaces share resize UX. Each array is fed straight into a
  // PanelGroup.setLayout() call on Apply.
  rvHorizontal?: number[];    // [Left, Middle, Slim, Right]
  rvLeftV?: number[];         // [Overview, RunList]
  rvMidV?: number[];          // [RunJobs, JobDetail]
  rvSlimV?: number[];         // [PreAssigned, Returns, Exceptions]
  rvRightV?: number[];        // [Map, ScanDetail]
}

export const DEFAULT_LAYOUT: CockpitLayout = {
  name: 'Default',
  horizontal: [28, 26, 14, 32],
  leftVertical: [25, 45, 30],
  runVertical: [50, 50],
  // Route Viewer Home default column split matches the arrangement
  // Kevin's screenshots reference: Overview + RunList on the left,
  // Run + JobDetail middle, Pre Assigned / Returns / Exceptions slim,
  // Map + Scan Detail right. Percentages must sum to 100 within each
  // group (react-resizable-panels normalises otherwise but staying
  // exact avoids visual drift on first load).
  rvHorizontal: [25, 30, 15, 30],
  rvLeftV: [30, 70],
  rvMidV: [40, 60],
  rvSlimV: [33, 33, 34],
  rvRightV: [60, 40],
};

export function loadLayouts(scope: LayoutScope = 'default'): CockpitLayout[] {
  try {
    const raw = localStorage.getItem(scopedKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CockpitLayout[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLayouts(layouts: CockpitLayout[], scope: LayoutScope = 'default'): void {
  try {
    localStorage.setItem(scopedKey(scope), JSON.stringify(layouts));
  } catch { /* quota / private mode - non-fatal */ }
}

export function upsertLayout(existing: CockpitLayout[], next: CockpitLayout): CockpitLayout[] {
  const idx = existing.findIndex((l) => l.name === next.name);
  if (idx < 0) return [...existing, next];
  const copy = existing.slice();
  copy[idx] = next;
  return copy;
}

export function deleteLayout(existing: CockpitLayout[], name: string): CockpitLayout[] {
  return existing.filter((l) => l.name !== name);
}
