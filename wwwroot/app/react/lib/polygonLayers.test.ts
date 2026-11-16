import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VISIBILITY,
  NO_LAYER,
  VISIBILITY_STORAGE_KEY,
  groupByLayer,
  isPolygonVisible,
  layerNames,
  layerOf,
  loadVisibility,
  polygonColour,
  revealPolygon,
  saveVisibility,
  setShowPostcodes,
  showAllLayers,
  soloLayer,
  toggleLayerHidden,
  togglePolygonHidden,
} from './polygonLayers';

const P = [
  { polygonId: 1, layer: 'AD' },
  { polygonId: 2, layer: 'AD' },
  { polygonId: 3, layer: 'MC' },
  { polygonId: 4, layer: null },
  { polygonId: 5, layer: '   ' },
  { polygonId: 6, layer: 'ad' },
];

describe('polygonLayers', () => {
  it('layerOf trims and maps blank to NO_LAYER', () => {
    expect(layerOf({ polygonId: 1, layer: ' AD ' })).toBe('AD');
    expect(layerOf({ polygonId: 1, layer: null })).toBe(NO_LAYER);
    expect(layerOf({ polygonId: 1, layer: '  ' })).toBe(NO_LAYER);
    expect(layerOf({ polygonId: 1 })).toBe(NO_LAYER);
  });

  it('layerNames is distinct, case-insensitively sorted, without the no-layer group', () => {
    expect(layerNames(P)).toEqual(['AD', 'ad', 'MC']);
  });

  it('groupByLayer puts named layers first and unlayered last, keeping input order inside', () => {
    const groups = groupByLayer(P);
    expect(groups.map((g) => g.layer)).toEqual(['AD', 'ad', 'MC', NO_LAYER]);
    expect(groups[0].polygons.map((p) => p.polygonId)).toEqual([1, 2]);
    expect(groups[3].polygons.map((p) => p.polygonId)).toEqual([4, 5]);
  });

  it('groupByLayer omits the no-layer group when every polygon has a layer', () => {
    const groups = groupByLayer([{ polygonId: 1, layer: 'A' }]);
    expect(groups.map((g) => g.layer)).toEqual(['A']);
  });

  it('a polygon is hidden by its layer or by itself', () => {
    let s = DEFAULT_VISIBILITY;
    expect(isPolygonVisible(s, P[0])).toBe(true);
    s = toggleLayerHidden(s, 'AD');
    expect(isPolygonVisible(s, P[0])).toBe(false);
    expect(isPolygonVisible(s, P[2])).toBe(true);
    s = toggleLayerHidden(s, 'AD');
    expect(isPolygonVisible(s, P[0])).toBe(true);
    s = togglePolygonHidden(s, 1);
    expect(isPolygonVisible(s, P[0])).toBe(false);
    expect(isPolygonVisible(s, P[1])).toBe(true);
    s = togglePolygonHidden(s, 1);
    expect(isPolygonVisible(s, P[0])).toBe(true);
  });

  it('soloLayer hides every other layer including the no-layer group and clears hides inside it', () => {
    const s = soloLayer(togglePolygonHidden(DEFAULT_VISIBILITY, 2), 'AD', P);
    expect(s.hiddenLayers.sort()).toEqual([NO_LAYER, 'MC', 'ad'].sort());
    expect(s.hiddenPolygons).toEqual([]);
    expect(isPolygonVisible(s, P[0])).toBe(true);
    expect(isPolygonVisible(s, P[1])).toBe(true);
    expect(isPolygonVisible(s, P[2])).toBe(false);
    expect(isPolygonVisible(s, P[3])).toBe(false);
  });

  it('revealPolygon un-hides the polygon and its layer only', () => {
    let s = soloLayer(DEFAULT_VISIBILITY, 'AD', P);
    s = togglePolygonHidden(s, 3);
    s = revealPolygon(s, P[2]);
    expect(isPolygonVisible(s, P[2])).toBe(true);
    expect(isPolygonVisible(s, P[3])).toBe(false);
  });

  it('showAllLayers keeps the postcode switch', () => {
    const s = showAllLayers(setShowPostcodes(soloLayer(DEFAULT_VISIBILITY, 'AD', P), false));
    expect(s.hiddenLayers).toEqual([]);
    expect(s.hiddenPolygons).toEqual([]);
    expect(s.showPostcodes).toBe(false);
  });

  it('polygonColour prefers a valid colorHex, else a palette slot keyed on the id', () => {
    const palette = ['#111111', '#222222', '#333333'];
    expect(polygonColour({ polygonId: 7, colorHex: '#AbCdEf' }, palette)).toBe('#AbCdEf');
    expect(polygonColour({ polygonId: 7, colorHex: 'red' }, palette)).toBe(palette[7 % 3]);
    expect(polygonColour({ polygonId: 3 }, palette)).toBe('#111111');
    expect(polygonColour({ polygonId: 3 }, [])).toBe('#f2994a');
  });

  it('load/save round-trip and tolerate bad storage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    const s = setShowPostcodes(toggleLayerHidden(togglePolygonHidden(DEFAULT_VISIBILITY, 9), 'MC'), false);
    saveVisibility(storage, s);
    expect(loadVisibility(storage)).toEqual(s);

    store.set(VISIBILITY_STORAGE_KEY, '{not json');
    expect(loadVisibility(storage)).toEqual(DEFAULT_VISIBILITY);

    store.set(VISIBILITY_STORAGE_KEY, JSON.stringify({ hiddenLayers: [1, 'x'], hiddenPolygons: ['a', 2] }));
    expect(loadVisibility(storage)).toEqual({ hiddenLayers: ['x'], hiddenPolygons: [2], showPostcodes: true });

    expect(loadVisibility(null)).toEqual(DEFAULT_VISIBILITY);
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(loadVisibility(throwing)).toEqual(DEFAULT_VISIBILITY);
    expect(() => saveVisibility(throwing, s)).not.toThrow();
  });
});
