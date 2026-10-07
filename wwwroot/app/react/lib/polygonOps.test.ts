import { describe, expect, it } from 'vitest';
import {
  type LatLng,
  addRegion,
  cutRegion,
  keepRegion,
  snapToNearestEdge,
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

describe('snapToNearestEdge', () => {
  // A unit square roughly 1.1 km on a side near Auckland.
  const square: LatLng[][] = [[
    { lat: -36.850, lng: 174.760 },
    { lat: -36.850, lng: 174.772 },
    { lat: -36.860, lng: 174.772 },
    { lat: -36.860, lng: 174.760 },
  ]];

  it('returns null when nothing is within tolerance', () => {
    // ~1 km away from the square's west edge, tolerance 25 m.
    const far = { lat: -36.855, lng: 174.748 };
    expect(snapToNearestEdge(far, [square], 25)).toBeNull();
  });

  it('snaps a vertex just outside an edge onto that edge', () => {
    // A few metres west of the west edge (lng 174.760).
    const near = { lat: -36.855, lng: 174.75995 };
    const snapped = snapToNearestEdge(near, [square], 25);
    expect(snapped).not.toBeNull();
    // Lands on the edge's longitude, keeping its own latitude.
    expect(snapped!.lng).toBeCloseTo(174.760, 5);
    expect(snapped!.lat).toBeCloseTo(-36.855, 5);
  });

  it('clamps to the segment ends rather than running past a corner', () => {
    // Beyond the square's north-west corner on both axes. The foot of the
    // perpendicular would sit off the end of the edge; it must clamp to the
    // corner instead of inventing a point outside the shape.
    const offCorner = { lat: -36.8498, lng: 174.7598 };
    const snapped = snapToNearestEdge(offCorner, [square], 100);
    expect(snapped).not.toBeNull();
    expect(snapped!.lat).toBeCloseTo(-36.850, 4);
    expect(snapped!.lng).toBeCloseTo(174.760, 4);
  });

  it('treats the ring as closed so the final edge can be snapped to', () => {
    // Just outside the edge joining the LAST vertex back to the first (the
    // west edge of this ring is written last). A ring that is not closed
    // implicitly would miss it entirely.
    const nearClosingEdge = { lat: -36.8599, lng: 174.75993 };
    expect(snapToNearestEdge(nearClosingEdge, [square], 25)).not.toBeNull();
  });

  it('returns null for a non-positive tolerance', () => {
    const onEdge = { lat: -36.855, lng: 174.760 };
    expect(snapToNearestEdge(onEdge, [square], 0)).toBeNull();
  });

  it('ignores degenerate rings with fewer than two vertices', () => {
    const degenerate: LatLng[][] = [[{ lat: -36.855, lng: 174.760 }]];
    const p = { lat: -36.855, lng: 174.7601 };
    expect(snapToNearestEdge(p, [degenerate], 100)).toBeNull();
  });
});
