import { describe, expect, it } from 'vitest';
import {
  type LatLng,
  addRegion,
  cutRegion,
  keepRegion,
  latLngRingsToMultiPolygon,
  latLngRingsToPolygon,
  multiPolygonToLatLngRings,
  shapesToMultiPolygon,
  splitByLine,
  totalVertexCount,
  unionShapes,
} from './polygonOps';

const SQUARE: LatLng[] = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 10 },
  { lat: 10, lng: 10 },
  { lat: 10, lng: 0 },
];

const OVERLAPPING: LatLng[] = [
  { lat: 5, lng: 5 },
  { lat: 5, lng: 15 },
  { lat: 15, lng: 15 },
  { lat: 15, lng: 5 },
];

const DISJOINT: LatLng[] = [
  { lat: 100, lng: 100 },
  { lat: 100, lng: 110 },
  { lat: 110, lng: 110 },
  { lat: 110, lng: 100 },
];

const RIGHT_HALF: LatLng[] = [
  { lat: -1, lng: 5 },
  { lat: -1, lng: 20 },
  { lat: 11, lng: 20 },
  { lat: 11, lng: 5 },
];

describe('latLngRingsToPolygon', () => {
  it('auto-closes a ring when the last vertex differs from the first', () => {
    const out = latLngRingsToPolygon([SQUARE]);
    expect(out).toHaveLength(1);
    const ring = out[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('does not double-close a pre-closed ring', () => {
    const closed = [...SQUARE, { lat: 0, lng: 0 }];
    const out = latLngRingsToPolygon([closed]);
    expect(out[0]).toHaveLength(closed.length);
  });

  it('handles an empty ring', () => {
    const out = latLngRingsToPolygon([[]]);
    expect(out[0]).toEqual([]);
  });
});

describe('latLngRingsToMultiPolygon', () => {
  it('starts a piece for the first ring', () => {
    const out = latLngRingsToMultiPolygon([SQUARE]);
    expect(out).toHaveLength(1);
  });

  it('skips rings with fewer than 3 vertices', () => {
    const out = latLngRingsToMultiPolygon([[{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]]);
    expect(out).toEqual([]);
  });

  it('groups CW rings as holes of the preceding CCW piece', () => {
    const ccw = SQUARE;
    const holeCw: LatLng[] = [
      { lat: 2, lng: 2 },
      { lat: 8, lng: 2 },
      { lat: 8, lng: 8 },
      { lat: 2, lng: 8 },
    ];
    const out = latLngRingsToMultiPolygon([ccw, holeCw]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
  });
});

describe('shapesToMultiPolygon', () => {
  it('converts an array of shapes into a MultiPolygon', () => {
    const out = shapesToMultiPolygon([[SQUARE], [DISJOINT]]);
    expect(out).toHaveLength(2);
  });

  it('returns empty MultiPolygon for empty shapes input', () => {
    expect(shapesToMultiPolygon([])).toEqual([]);
  });
});

describe('multiPolygonToLatLngRings', () => {
  it('flattens pieces and strips the closing duplicate', () => {
    const mp = latLngRingsToPolygon([SQUARE]);
    const out = multiPolygonToLatLngRings([mp]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(SQUARE.length);
  });

  it('drops rings that have fewer than 4 points', () => {
    const out = multiPolygonToLatLngRings([[[[0, 0], [1, 1], [0, 0]]]]);
    expect(out).toEqual([]);
  });
});

describe('unionShapes', () => {
  it('returns empty when no shapes given', () => {
    expect(unionShapes([])).toEqual([]);
  });

  it('returns the shape unchanged when only one is given', () => {
    const out = unionShapes([[SQUARE]]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(SQUARE.length);
  });

  it('merges two overlapping shapes into one piece', () => {
    const out = unionShapes([[SQUARE], [OVERLAPPING]]);
    expect(out).toHaveLength(1);
  });

  it('keeps two disjoint shapes as separate pieces', () => {
    const out = unionShapes([[SQUARE], [DISJOINT]]);
    expect(out).toHaveLength(2);
  });
});

describe('addRegion', () => {
  it('unions the drawn region into the target', () => {
    const out = addRegion([SQUARE], OVERLAPPING);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it('adds a disjoint region as a second piece', () => {
    const out = addRegion([SQUARE], DISJOINT);
    expect(out).toHaveLength(2);
  });
});

describe('cutRegion', () => {
  it('removes the drawn region from the target', () => {
    const out = cutRegion([SQUARE], OVERLAPPING);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty when the cut fully swallows the target', () => {
    const enveloping: LatLng[] = [
      { lat: -100, lng: -100 },
      { lat: -100, lng: 100 },
      { lat: 100, lng: 100 },
      { lat: 100, lng: -100 },
    ];
    const out = cutRegion([SQUARE], enveloping);
    expect(out).toEqual([]);
  });
});

describe('keepRegion', () => {
  it('keeps the intersection of target and drawn', () => {
    const out = keepRegion([SQUARE], OVERLAPPING);
    expect(out).toHaveLength(1);
  });

  it('returns empty when target and drawn do not overlap', () => {
    const out = keepRegion([SQUARE], DISJOINT);
    expect(out).toEqual([]);
  });
});

describe('splitByLine', () => {
  it('sets wasSplit=false when target is empty', () => {
    const out = splitByLine([], [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }]);
    expect(out.wasSplit).toBe(false);
  });

  it('sets wasSplit=false when line has fewer than 2 points', () => {
    const out = splitByLine([SQUARE], [{ lat: 0, lng: 0 }]);
    expect(out.wasSplit).toBe(false);
    expect(out.rings).toEqual([SQUARE]);
  });

  it('sets wasSplit=true when the line crosses the boundary', () => {
    const line: LatLng[] = [
      { lat: 5, lng: -1 },
      { lat: 5, lng: 11 },
    ];
    const out = splitByLine([SQUARE], line);
    expect(out.wasSplit).toBe(true);
    expect(out.rings.length).toBeGreaterThanOrEqual(2);
  });

  it('sets wasSplit=false when the line does not cross the boundary at 2+ points', () => {
    const line: LatLng[] = [
      { lat: 100, lng: 100 },
      { lat: 101, lng: 101 },
    ];
    const out = splitByLine([SQUARE], line);
    expect(out.wasSplit).toBe(false);
  });
});

describe('totalVertexCount', () => {
  it('returns 0 for empty input', () => {
    expect(totalVertexCount([])).toBe(0);
  });

  it('sums vertices across all rings', () => {
    expect(totalVertexCount([SQUARE, RIGHT_HALF])).toBe(SQUARE.length + RIGHT_HALF.length);
  });
});
