import { describe, expect, it } from 'vitest';
import {
  NO_LAYER,
  groupByLayer,
  layerNames,
  layerOf,
  polygonColour,
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

  it('polygonColour prefers a valid colorHex, else a palette slot keyed on the id', () => {
    const palette = ['#111111', '#222222', '#333333'];
    expect(polygonColour({ polygonId: 7, colorHex: '#AbCdEf' }, palette)).toBe('#AbCdEf');
    expect(polygonColour({ polygonId: 7, colorHex: 'red' }, palette)).toBe(palette[7 % 3]);
    expect(polygonColour({ polygonId: 3 }, palette)).toBe('#111111');
    expect(polygonColour({ polygonId: 3 }, [])).toBe('#f2994a');
  });
});
