import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  FILTERS_STORAGE_KEY,
  LEGACY_VISIBILITY_STORAGE_KEY,
  NOT_USED,
  PERIMETER_CONFIRM_TEXT,
  appCounts,
  clearFilters,
  everyHasApp,
  filterPolygons,
  isFilterActive,
  layerCounts,
  layerPillText,
  loadFilters,
  matchesFilter,
  remainingBinding,
  saveFilters,
  someHaveApp,
  toggleValue,
  usedByPillText,
  withApp,
  zoneText,
  type PolygonFilterState,
} from './polygonFilters';
import { NO_LAYER } from './polygonLayers';
import type { PolygonAppCode } from '../services/bulkPolygonService';

const membership = (postcodeGroupName: string, zone: number) => ({
  id: zone, postcodeGroupId: 1, postcodeGroupName, depotId: 1, depotName: 'Akl', zone,
});

const P = [
  { polygonId: 1, name: 'AD Deep East', layer: 'AD', apps: ['AUTODISPATCH'] as PolygonAppCode[] },
  { polygonId: 2, name: 'MC8 Otahuhu', layer: 'Routes', apps: ['SCHEDULES', 'ROUTES'] as PolygonAppCode[],
    zoneMemberships: [membership('Std Auckland', 3)] },
  { polygonId: 3, name: 'Hamilton City', layer: 'Regional', apps: ['SCHEDULES', 'ZONE_RATING'] as PolygonAppCode[],
    zoneNameName: 'Hamilton Z1' },
  { polygonId: 4, name: 'Auckland metro boundary', layer: 'City boundaries', apps: ['PERIMETER'] as PolygonAppCode[] },
  { polygonId: 5, name: 'Marcus test 2', layer: null, apps: [] as PolygonAppCode[] },
  { polygonId: 6, name: 'Legacy fixture', layer: null },
];

const f = (over: Partial<PolygonFilterState>): PolygonFilterState => ({ ...DEFAULT_FILTERS, ...over });
const ids = (list: { polygonId: number }[]) => list.map((p) => p.polygonId);

describe('polygonFilters', () => {
  it('defaults match everything, faded others, postcode lines on', () => {
    expect(DEFAULT_FILTERS).toEqual({ search: '', apps: [], layers: [], others: 'faded', showPostcodes: true });
    expect(ids(filterPolygons(P, DEFAULT_FILTERS))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(isFilterActive(DEFAULT_FILTERS)).toBe(false);
  });

  it('search matches name, zone or layer, case-insensitively', () => {
    expect(ids(filterPolygons(P, f({ search: 'deep' })))).toEqual([1]);
    expect(ids(filterPolygons(P, f({ search: 'std auckland' })))).toEqual([2]);
    expect(ids(filterPolygons(P, f({ search: 'hamilton z1' })))).toEqual([3]);
    expect(ids(filterPolygons(P, f({ search: 'city bound' })))).toEqual([4]);
    expect(ids(filterPolygons(P, f({ search: '   ' })))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('Used by matches ANY ticked app; Not used by any app matches polygons with no apps', () => {
    expect(ids(filterPolygons(P, f({ apps: ['SCHEDULES'] })))).toEqual([2, 3]);
    expect(ids(filterPolygons(P, f({ apps: ['AUTODISPATCH', 'PERIMETER'] })))).toEqual([1, 4]);
    expect(ids(filterPolygons(P, f({ apps: [NOT_USED] })))).toEqual([5, 6]);
  });

  it('Layer filter includes No layer, and search / Used by / Layer AND together', () => {
    expect(ids(filterPolygons(P, f({ layers: [NO_LAYER] })))).toEqual([5, 6]);
    expect(ids(filterPolygons(P, f({ apps: ['SCHEDULES'], layers: ['Regional'] })))).toEqual([3]);
    expect(ids(filterPolygons(P, f({ search: 'mc8', apps: ['SCHEDULES'], layers: ['Regional'] })))).toEqual([]);
    expect(matchesFilter(P[1], f({ search: 'mc8', apps: ['ROUTES'], layers: ['Routes'] }))).toBe(true);
  });

  it('app counts follow the search; layer counts follow search and Used by', () => {
    const all = appCounts(P, '');
    expect(all).toEqual({ SCHEDULES: 2, AUTODISPATCH: 1, ROUTES: 1, ZONE_RATING: 1, PERIMETER: 1, NONE: 2 });
    expect(appCounts(P, 'hamilton').SCHEDULES).toBe(1);
    expect(layerCounts(P, f({ apps: ['SCHEDULES'] }))).toEqual([
      { layer: 'AD', count: 0 },
      { layer: 'City boundaries', count: 0 },
      { layer: 'Regional', count: 1 },
      { layer: 'Routes', count: 1 },
      { layer: NO_LAYER, count: 0 },
    ]);
  });

  it('Clear resets search, Used by and Layer but keeps Others and Postcode lines', () => {
    const busy = f({ search: 'x', apps: ['ROUTES'], layers: ['AD'], others: 'hidden', showPostcodes: false });
    expect(isFilterActive(busy)).toBe(true);
    expect(clearFilters(busy)).toEqual({ search: '', apps: [], layers: [], others: 'hidden', showPostcodes: false });
  });

  it('pill text reads Any app / the app name / N apps and All / layer / N layers', () => {
    expect(usedByPillText([])).toBe('Any app');
    expect(usedByPillText(['PERIMETER'])).toBe('City boundary');
    expect(usedByPillText([NOT_USED])).toBe('Not used by any app');
    expect(usedByPillText(['ROUTES', 'SCHEDULES'])).toBe('2 apps');
    expect(layerPillText([])).toBe('All');
    expect(layerPillText([NO_LAYER])).toBe('No layer');
    expect(layerPillText(['AD', 'MC'])).toBe('2 layers');
  });

  it('toggleValue / withApp keep the list tidy and in POLYGON_APPS order', () => {
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleValue(['b'], 'a')).toEqual(['b', 'a']);
    expect(withApp(['ROUTES'], 'SCHEDULES', true)).toEqual(['SCHEDULES', 'ROUTES']);
    expect(withApp(['SCHEDULES', 'ROUTES'], 'SCHEDULES', false)).toEqual(['ROUTES']);
    expect(withApp(['ROUTES'], 'ROUTES', true)).toEqual(['ROUTES']);
  });

  it('bulk tick is on only when every selected polygon has the app', () => {
    const sel = [P[1], P[2]];
    expect(everyHasApp(sel, 'SCHEDULES')).toBe(true);
    expect(everyHasApp(sel, 'ROUTES')).toBe(false);
    expect(someHaveApp(sel, 'ROUTES')).toBe(true);
    expect(everyHasApp([], 'SCHEDULES')).toBe(false);
  });

  it('zoneText lists memberships, else the zone-rating name', () => {
    expect(zoneText(P[1])).toBe('Std Auckland - Zone 3');
    expect(zoneText(P[2])).toBe('Hamilton Z1');
    expect(zoneText(P[0])).toBe('');
  });

  it('remainingBinding reports a binding that still drives availability (Q4)', () => {
    expect(remainingBinding({ zoneMemberships: [membership('G', 1)] }, 'SCHEDULES')).toBe('1 zone membership');
    expect(remainingBinding({ zoneMemberships: [], postcodeGroupId: 4 }, 'SCHEDULES')).toBe('a zone group binding');
    expect(remainingBinding({ zoneMemberships: [], postcodeGroupId: null }, 'SCHEDULES')).toBeNull();
    expect(remainingBinding({ zoneNameId: 9 }, 'ZONE_RATING')).toBe('a zone name binding');
    expect(remainingBinding({ attachedRouteCount: 2, attachedRoutes: [] }, 'ROUTES')).toBe('2 attached routes');
    expect(remainingBinding({ attachedRouteCount: 0 }, 'ROUTES')).toBeNull();
    expect(remainingBinding({}, 'PERIMETER')).toBeNull();
  });

  it('keeps the exact perimeter confirm wording', () => {
    expect(PERIMETER_CONFIRM_TEXT).toBe(
      'This changes prices for distance-rated jobs that start or end outside this area. Km driven outside every city boundary get the outside-perimeter charge.');
  });

  it('load/save round-trip without the search, drop the legacy key, and tolerate bad storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
    store.set(LEGACY_VISIBILITY_STORAGE_KEY, '{"hiddenLayers":["AD"]}');
    const s = f({ search: 'secret', apps: ['PERIMETER', NOT_USED], layers: ['AD', NO_LAYER], others: 'hidden', showPostcodes: false });
    saveFilters(storage, s);
    expect(JSON.parse(store.get(FILTERS_STORAGE_KEY)!)).not.toHaveProperty('search');
    expect(loadFilters(storage)).toEqual({ ...s, search: '' });
    expect(store.has(LEGACY_VISIBILITY_STORAGE_KEY)).toBe(false);

    store.set(FILTERS_STORAGE_KEY, '{not json');
    expect(loadFilters(storage)).toEqual(DEFAULT_FILTERS);
    store.set(FILTERS_STORAGE_KEY, 'null');
    expect(loadFilters(storage)).toEqual(DEFAULT_FILTERS);
    store.set(FILTERS_STORAGE_KEY, JSON.stringify({ apps: ['BOGUS', 'ROUTES', 3], layers: [1, 'x'], others: 'weird' }));
    expect(loadFilters(storage)).toEqual({ ...DEFAULT_FILTERS, apps: ['ROUTES'], layers: ['x'] });

    expect(loadFilters(null)).toEqual(DEFAULT_FILTERS);
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(loadFilters(throwing)).toEqual(DEFAULT_FILTERS);
    expect(() => saveFilters(throwing, s)).not.toThrow();
  });
});
