import { describe, expect, it } from 'vitest';
import {
  type LatLng,
  addRegion,
  boundaryArc,
  chainLengthMetres,
  closingArc,
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

describe('boundaryArc (follow boundary)', () => {
  // A small, slightly irregular hexagon near Auckland so metre lengths are
  // realistic. Indices: 0..5, closed implicitly.
  const HEX: LatLng[] = [
    { lat: -36.850, lng: 174.760 },
    { lat: -36.852, lng: 174.765 },
    { lat: -36.856, lng: 174.766 },
    { lat: -36.860, lng: 174.762 },
    { lat: -36.858, lng: 174.756 },
    { lat: -36.853, lng: 174.755 },
  ];
  const at = (i: number) => HEX[i];
  const onEdge = (i: number, t: number): LatLng => {
    const a = HEX[i], b = HEX[(i + 1) % HEX.length];
    return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  };

  it('returns the vertices between two vertex positions, shorter way round', () => {
    expect(boundaryArc(HEX, 0, 2, at(0), at(2))).toEqual([HEX[1]]);
    // 0 -> 4 is shorter going backwards through 5.
    expect(boundaryArc(HEX, 0, 4, at(0), at(4))).toEqual([HEX[5]]);
    // Reverse direction of the same pair.
    expect(boundaryArc(HEX, 4, 0, at(4), at(0))).toEqual([HEX[5]]);
  });

  it('neighbouring vertices and a single shared edge yield no intermediates', () => {
    expect(boundaryArc(HEX, 1, 2, at(1), at(2))).toEqual([]);
    expect(boundaryArc(HEX, 2, 1, at(2), at(1))).toEqual([]);
    expect(boundaryArc(HEX, 3.2, 3.8, onEdge(3, 0.2), onEdge(3, 0.8))).toEqual([]);
    expect(boundaryArc(HEX, 3.8, 3.2, onEdge(3, 0.8), onEdge(3, 0.2))).toEqual([]);
    expect(boundaryArc(HEX, 2, 2, at(2), at(2))).toEqual([]);
  });

  it('handles edge positions on both ends, including across the ring closure', () => {
    // From the middle of edge 0-1 to the middle of edge 2-3: vertices 1, 2.
    expect(boundaryArc(HEX, 0.5, 2.5, onEdge(0, 0.5), onEdge(2, 0.5))).toEqual([HEX[1], HEX[2]]);
    // From a vertex to the edge after it: nothing between.
    expect(boundaryArc(HEX, 1, 1.5, at(1), onEdge(1, 0.5))).toEqual([]);
    // From the middle of edge 5-0 back to vertex 4: crosses the closure, via 5.
    expect(boundaryArc(HEX, 5.5, 4, onEdge(5, 0.5), at(4))).toEqual([HEX[5]]);
    // From the middle of edge 5-0 forward to vertex 1: via 0.
    expect(boundaryArc(HEX, 5.5, 1, onEdge(5, 0.5), at(1))).toEqual([HEX[0]]);
  });

  it('a WKT-closed ring (last vertex repeats the first) never emits the seam twice', () => {
    const CLOSED: LatLng[] = [...HEX, HEX[0]];
    // Middle of edge 5-0 (edge 5-6 in the closed ring) to vertex 1: via 0, once.
    expect(boundaryArc(CLOSED, 5.5, 1, onEdge(5, 0.5), at(1))).toEqual([HEX[0]]);
    // Snapped to the closing copy (index 6) behaves like vertex 0.
    expect(boundaryArc(CLOSED, 6, 2, at(0), at(2))).toEqual([HEX[1]]);
    // Vertex 5 to vertex 2 across the seam: 0, 1 with no duplicate.
    expect(boundaryArc(CLOSED, 5, 2, at(5), at(2))).toEqual([HEX[0], HEX[1]]);
  });

  it('picks the shorter arc by length when the vertex counts tie', () => {
    // Stretch the ring so the forward way (through 1, 2) is much longer
    // than the backward way (through 5, 4) between vertices 0 and 3.
    const stretched: LatLng[] = HEX.map((p, i) => (i === 1 || i === 2)
      ? { lat: p.lat, lng: p.lng + 0.05 } : p);
    expect(boundaryArc(stretched, 0, 3, stretched[0], stretched[3])).toEqual([stretched[5], stretched[4]]);
  });

  it('chainLengthMetres sums segment lengths and is zero for fewer than two points', () => {
    expect(chainLengthMetres([])).toBe(0);
    expect(chainLengthMetres([at(0)])).toBe(0);
    const d01 = chainLengthMetres([at(0), at(1)]);
    const d12 = chainLengthMetres([at(1), at(2)]);
    expect(chainLengthMetres([at(0), at(1), at(2)])).toBeCloseTo(d01 + d12, 6);
    expect(d01).toBeGreaterThan(400);
    expect(d01).toBeLessThan(600);
  });
});

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

describe('closingArc (follow boundary on the closing edge)', () => {
  // A neighbour polygon: a square with extra vertices down its east side.
  // The operator starts on that side, draws out to the east and comes back
  // to it lower down. The closing edge must run up the neighbour's side.
  const NEIGHBOUR: LatLng[] = [
    { lat: -36.850, lng: 174.750 },
    { lat: -36.850, lng: 174.760 },
    { lat: -36.852, lng: 174.761 },
    { lat: -36.854, lng: 174.759 },
    { lat: -36.856, lng: 174.761 },
    { lat: -36.858, lng: 174.760 },
    { lat: -36.858, lng: 174.750 },
  ];
  const ring = (pos: number) => ({ key: 'poly:1', path: NEIGHBOUR, pos });
  const FREE_A: LatLng = { lat: -36.851, lng: 174.770 };
  const FREE_B: LatLng = { lat: -36.857, lng: 174.770 };

  it('follows the neighbour between the last click and the first', () => {
    const vertices = [NEIGHBOUR[1], FREE_A, FREE_B, NEIGHBOUR[5]];
    const snaps = [ring(1), null, null, ring(5)];
    expect(closingArc(vertices, snaps)).toEqual([NEIGHBOUR[4], NEIGHBOUR[3], NEIGHBOUR[2]]);
  });

  it('is a straight close when first and last are not on the same ring', () => {
    const vertices = [NEIGHBOUR[1], FREE_A, FREE_B];
    expect(closingArc(vertices, [ring(1), null, null])).toEqual([]);
    const other = { key: 'zip:1010', path: NEIGHBOUR, pos: 5 };
    expect(closingArc([NEIGHBOUR[1], FREE_A, NEIGHBOUR[5]], [ring(1), null, other])).toEqual([]);
  });

  it('does not double back when every click sat on that one ring', () => {
    // Clicks 1 -> 5 already followed the ring; closing along it again would
    // give a shape with no area.
    const vertices = [NEIGHBOUR[1], NEIGHBOUR[2], NEIGHBOUR[3], NEIGHBOUR[4], NEIGHBOUR[5]];
    expect(closingArc(vertices, [ring(1), ring(5)])).toEqual([]);
  });

  it('follows the side the shape sits on, even when that is the longer way round', () => {
    // Kevin review 2026-11-18. A 10 x 10 neighbour. The shape starts on its
    // top edge near the west corner, wraps round its whole east side outside
    // it and comes back on its bottom edge. The shared edge (east side) is
    // the LONGER way round; the shorter way (west side) would make the new
    // polygon swallow the neighbour.
    const s = 0.001;
    const P = (x: number, y: number): LatLng => ({ lat: -36.85 + y * s, lng: 174.75 + x * s });
    const SQUARE = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
    const sq = (pos: number) => ({ key: 'poly:2', path: SQUARE, pos });
    const vertices = [P(2, 10), P(2, 12), P(12, 12), P(12, -2), P(6, -2), P(6, 0)];
    const snaps = [sq(2.8), null, null, null, null, sq(0.6)];
    expect(closingArc(vertices, snaps)).toEqual([P(10, 0), P(10, 10)]);
  });

  it('needs at least two clicks', () => {
    expect(closingArc([NEIGHBOUR[1]], [ring(1)])).toEqual([]);
    expect(closingArc([], [])).toEqual([]);
  });
});

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
