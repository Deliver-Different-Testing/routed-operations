// Polygon Builder filters (perimeter spec 4.4, Design B dropdowns).
//
// Replaces the per-layer / per-polygon eye toggles. The operator narrows
// what is drawn and listed with: a text search (name, zone or layer), a
// "Used by" app filter, and a layer filter. They AND together in that
// order. Non-matching polygons are either drawn faded (thin grey, not
// clickable) or not drawn at all. Snapping, Add, Cut and Clip still see
// every polygon: the filter only changes what is drawn and listed.
//
// State is a per-browser preference in localStorage (polygonBuilder.filters.v1,
// search excluded). Each tenant has its own hostname so the key needs no
// tenant id. Every read and write is wrapped so blocked storage or a bad
// value falls back to the defaults.
//
// Pure functions only, so the rules can be unit-tested without a map.

import { POLYGON_APPS, type BulkPolygon, type PolygonAppCode } from '../services/bulkPolygonService';
import { layerNames, layerOf, NO_LAYER } from './polygonLayers';

/** A "Used by" filter value: an app code, or NONE for "Not used by any app". */
export type AppFilterValue = PolygonAppCode | 'NONE';
export const NOT_USED = 'NONE' as const;

export type OthersMode = 'faded' | 'hidden';

export interface PolygonFilterState {
  /** Free text over name, zone and layer. Never persisted. */
  search: string;
  /** Empty = any app. A polygon matches when it has ANY of these. */
  apps: AppFilterValue[];
  /** Empty = all layers. NO_LAYER ('') stands for "No layer". */
  layers: string[];
  /** How non-matching polygons are drawn. */
  others: OthersMode;
  /** Postcode / ZIP boundary auto-load + render. Default on. */
  showPostcodes: boolean;
}

export const FILTERS_STORAGE_KEY = 'polygonBuilder.filters.v1';
/** The eye-toggle preference this replaces; removed on first load. */
export const LEGACY_VISIBILITY_STORAGE_KEY = 'polygonBuilder.visibility.v1';

export const DEFAULT_FILTERS: PolygonFilterState = {
  search: '',
  apps: [],
  layers: [],
  others: 'faded',
  showPostcodes: true,
};

export interface AppMeta {
  label: string;
  /** Short badge on a list row. */
  badge: string;
  /** One-line hint in the Used by dropdown. */
  hint: string;
  colour: string;
}

export const APP_META: Record<PolygonAppCode, AppMeta> = {
  SCHEDULES: { label: 'Schedules', badge: 'Sch', hint: 'Zones in Schedules NEW (booking availability)', colour: '#3bc7f4' },
  AUTODISPATCH: { label: 'Auto Dispatch', badge: 'AD', hint: 'Corridors in Auto Dispatch', colour: '#8b5cf6' },
  ROUTES: { label: 'Routes', badge: 'Rt', hint: 'Coverage for recurring routes', colour: '#10b981' },
  ZONE_RATING: { label: 'Zone rating', badge: 'Zr', hint: 'Prices by zone name', colour: '#f2994a' },
  PERIMETER: { label: 'City boundary', badge: 'CB', hint: 'Rating perimeter: km outside it are surcharged on distance rates', colour: '#ef4444' },
};

/** Shown before PERIMETER is turned on or off (spec 4.4.3). Exact wording. */
export const PERIMETER_CONFIRM_TEXT =
  'This changes prices for distance-rated jobs that start or end outside this area. '
  + 'Km driven outside every city boundary get the outside-perimeter charge.';

/** Confirm titles for a polygon that already is a City boundary: a new
 *  shape or removing it moves distance prices just like the tag does
 *  (review C4). The message is PERIMETER_CONFIRM_TEXT. */
export const PERIMETER_RESHAPE_TITLE = 'Change a city boundary?';
export const PERIMETER_REMOVE_TITLE = 'Remove a city boundary?';

/** Hint line on the polygon card (review C6). */
export const POLYGON_CARD_HINT = 'Each app only lists the polygons ticked for it.';

/** Quick links (spec 4.4.1): one click sets Used by to a single app. */
export const QUICK_LINKS: { label: string; app: PolygonAppCode }[] = [
  { label: 'City boundaries', app: 'PERIMETER' },
  { label: 'Schedule zones', app: 'SCHEDULES' },
  { label: 'AD corridors', app: 'AUTODISPATCH' },
];

type FilterablePolygon = Pick<BulkPolygon, 'polygonId' | 'name'> & Partial<Pick<BulkPolygon,
  'apps' | 'layer' | 'zoneMemberships' | 'zoneNameName' | 'postcodeGroupName'>>;

export function appsOf(p: { apps?: PolygonAppCode[] | null }): PolygonAppCode[] {
  return p.apps ?? [];
}

export function isPerimeter(p: { apps?: PolygonAppCode[] | null }): boolean {
  return appsOf(p).includes('PERIMETER');
}

/** The zone text under a row's name: each zone membership as
 *  "Group - Zone N", else the zone-rating binding name. Empty when none. */
export function zoneText(p: FilterablePolygon): string {
  const memberships = (p.zoneMemberships ?? []).map((m) => `${m.postcodeGroupName} - Zone ${m.zone}`);
  if (memberships.length > 0) return memberships.join(', ');
  return p.zoneNameName ?? '';
}

export function matchesSearch(p: FilterablePolygon, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (q.length === 0) return true;
  const haystack = [p.name, zoneText(p), p.postcodeGroupName ?? '', p.zoneNameName ?? '', layerOf(p)]
    .join('\n').toLowerCase();
  return haystack.includes(q);
}

export function matchesApps(p: FilterablePolygon, apps: AppFilterValue[]): boolean {
  if (apps.length === 0) return true;
  const own = appsOf(p);
  return apps.some((a) => (a === NOT_USED ? own.length === 0 : own.includes(a)));
}

export function matchesLayers(p: FilterablePolygon, layers: string[]): boolean {
  if (layers.length === 0) return true;
  return layers.includes(layerOf(p));
}

/** Search, then Used by, then Layer: all must pass. */
export function matchesFilter(p: FilterablePolygon, f: PolygonFilterState): boolean {
  return matchesSearch(p, f.search) && matchesApps(p, f.apps) && matchesLayers(p, f.layers);
}

export function filterPolygons<T extends FilterablePolygon>(polygons: T[], f: PolygonFilterState): T[] {
  return polygons.filter((p) => matchesFilter(p, f));
}

/** Counts for the Used by dropdown, over the polygons the search keeps
 *  (the filters cascade: search -> Used by -> Layer). */
export function appCounts(polygons: FilterablePolygon[], search: string): Record<AppFilterValue, number> {
  const counts = { SCHEDULES: 0, AUTODISPATCH: 0, ROUTES: 0, ZONE_RATING: 0, PERIMETER: 0, NONE: 0 } as Record<AppFilterValue, number>;
  polygons.filter((p) => matchesSearch(p, search)).forEach((p) => {
    const own = appsOf(p);
    if (own.length === 0) counts.NONE += 1;
    own.forEach((a) => { if (a in counts) counts[a] += 1; });
  });
  return counts;
}

/** Counts for the Layer dropdown, over the polygons that pass search and
 *  Used by. Lists every layer in use (named A-Z, then "No layer" when any
 *  polygon has none) so a ticked layer never disappears from the list. */
export function layerCounts(polygons: FilterablePolygon[], f: PolygonFilterState): { layer: string; count: number }[] {
  const kept = polygons.filter((p) => matchesSearch(p, f.search) && matchesApps(p, f.apps));
  const names = layerNames(polygons);
  if (polygons.some((p) => layerOf(p) === NO_LAYER)) names.push(NO_LAYER);
  return names.map((layer) => ({ layer, count: kept.filter((p) => layerOf(p) === layer).length }));
}

export function isFilterActive(f: PolygonFilterState): boolean {
  return f.search.trim().length > 0 || f.apps.length > 0 || f.layers.length > 0;
}

/** Clear resets search, Used by and Layer; Others and Postcode lines stay. */
export function clearFilters(f: PolygonFilterState): PolygonFilterState {
  return { ...f, search: '', apps: [], layers: [] };
}

export function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function appLabel(a: AppFilterValue): string {
  return a === NOT_USED ? 'Not used by any app' : APP_META[a].label;
}

/** Used by pill text: "Any app", the one app's name, or "N apps". */
export function usedByPillText(apps: AppFilterValue[]): string {
  if (apps.length === 0) return 'Any app';
  if (apps.length === 1) return appLabel(apps[0]);
  return `${apps.length} apps`;
}

export function layerPillText(layers: string[]): string {
  if (layers.length === 0) return 'All';
  if (layers.length === 1) return layers[0] === NO_LAYER ? 'No layer' : layers[0];
  return `${layers.length} layers`;
}

/** Add or remove one app, keeping POLYGON_APPS order. */
export function withApp(apps: PolygonAppCode[], app: PolygonAppCode, on: boolean): PolygonAppCode[] {
  const set = new Set(apps);
  if (on) set.add(app); else set.delete(app);
  return POLYGON_APPS.filter((a) => set.has(a));
}

/** Bulk "Used by: Set..." tick state: on only when every selected polygon has it. */
export function everyHasApp(selected: { apps?: PolygonAppCode[] | null }[], app: PolygonAppCode): boolean {
  return selected.length > 0 && selected.every((p) => appsOf(p).includes(app));
}

export function someHaveApp(selected: { apps?: PolygonAppCode[] | null }[], app: PolygonAppCode): boolean {
  return selected.some((p) => appsOf(p).includes(app));
}

type BindingPolygon = Partial<Pick<BulkPolygon,
  'zoneMemberships' | 'postcodeGroupId' | 'zoneNameId' | 'attachedRouteCount' | 'attachedRoutes'>>;

/** Q4: an app can be unticked while the polygon is still bound to that
 *  app's object. Availability reads the binding, not the tag, so say so.
 *  Returns the binding description, or null when there is none (or the
 *  frontend cannot see it, as for Auto Dispatch corridors). */
export function remainingBinding(p: BindingPolygon, app: PolygonAppCode): string | null {
  switch (app) {
    case 'SCHEDULES': {
      const n = p.zoneMemberships?.length ?? 0;
      if (n > 0) return `${n} zone membership${n === 1 ? '' : 's'}`;
      if (p.postcodeGroupId != null) return 'a zone group binding';
      return null;
    }
    case 'ZONE_RATING':
      return p.zoneNameId != null ? 'a zone name binding' : null;
    case 'ROUTES': {
      const n = Math.max(p.attachedRouteCount ?? 0, p.attachedRoutes?.length ?? 0);
      return n > 0 ? `${n} attached route${n === 1 ? '' : 's'}` : null;
    }
    default:
      return null;
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function isApp(v: unknown): v is AppFilterValue {
  return typeof v === 'string' && (v === NOT_USED || (POLYGON_APPS as readonly string[]).includes(v));
}

/** Read the saved filters. Any failure (private window, blocked storage,
 *  bad JSON, old shape) falls back to the defaults so the page renders.
 *  Search always starts empty. The old visibility key is dropped. */
export function loadFilters(storage: StorageLike | null | undefined): PolygonFilterState {
  try { storage?.removeItem?.(LEGACY_VISIBILITY_STORAGE_KEY); } catch { /* best effort */ }
  try {
    const raw = storage?.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FILTERS };
    const parsed = JSON.parse(raw) as Partial<PolygonFilterState> | null;
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_FILTERS };
    return {
      search: '',
      apps: Array.isArray(parsed.apps) ? parsed.apps.filter(isApp) : [],
      layers: Array.isArray(parsed.layers) ? parsed.layers.filter((l): l is string => typeof l === 'string') : [],
      others: parsed.others === 'hidden' ? 'hidden' : 'faded',
      showPostcodes: typeof parsed.showPostcodes === 'boolean' ? parsed.showPostcodes : true,
    };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export function saveFilters(storage: StorageLike | null | undefined, f: PolygonFilterState): void {
  try {
    const { search: _search, ...persisted } = f;
    storage?.setItem(FILTERS_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Storage unavailable: the preference just does not persist.
  }
}
