import { describe, expect, it } from 'vitest';
import { type LatLng, type RingPosition, boundaryArc, closingArc } from './polygonOps';
import {
  BoundaryNetworkCache,
  buildBoundaryNetwork,
  closingPath,
  followBoundary,
  networkPath,
} from './boundaryNetwork';

// Grid in "units" of 0.001 degrees (about 111 m north-south, 89 m east-west
// at Auckland's latitude). x = east, y = north.
const U = 0.001;
const P = (x: number, y: number): LatLng => ({ lat: -36.85 + y * U, lng: 174.76 + x * U });
const lerp = (a: LatLng, b: LatLng, t: number): LatLng => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
});
const at = (key: string, path: LatLng[], pos: number): RingPosition => ({ key, path, pos });
/** Point at fractional position `pos` on a closed ring. */
const pointAt = (path: LatLng[], pos: number): LatLng => {
  const i = Math.floor(pos);
  const t = pos - i;
  return lerp(path[i % path.length], path[(i + 1) % path.length], t);
};

// Two squares sharing the edge x = 1 (corners (1,0) and (1,1)).
const A: LatLng[] = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
const B: LatLng[] = [P(1, 0), P(2, 0), P(2, 1), P(1, 1)];

describe('buildBoundaryNetwork', () => {
  it('merges vertices shared by two rings into one node', () => {
    const net = buildBoundaryNetwork([{ key: 'a', path: A }, { key: 'b', path: B }]);
    expect(net.nodeCount).toBe(6);
  });

  it('merges vertices that are within the tolerance but not identical', () => {
    // B's shared corners nudged 20 cm east: still the same node at 1 m.
    const nudge = (p: LatLng): LatLng => ({ lat: p.lat, lng: p.lng + 0.2 / 89_000 });
    const B2 = [nudge(P(1, 0)), P(2, 0), P(2, 1), nudge(P(1, 1))];
    expect(buildBoundaryNetwork([{ key: 'a', path: A }, { key: 'b', path: B2 }]).nodeCount).toBe(6);
    expect(buildBoundaryNetwork([{ key: 'a', path: A }, { key: 'b', path: B2 }], 0.05).nodeCount).toBe(8);
  });

  it('drops the closing copy of a WKT ring', () => {
    const net = buildBoundaryNetwork([{ key: 'zip', path: [...A, A[0]] }]);
    expect(net.nodeCount).toBe(4);
  });
});

describe('followBoundary across shapes (spec 4.4b)', () => {
  const net = buildBoundaryNetwork([{ key: 'a', path: A }, { key: 'b', path: B }]);

  it('follows A, then the shared corner, then B', () => {
    // Click 1 on A's top edge (edge 2: (1,1) -> (0,1)), click 2 on B's right
    // edge (edge 1: (2,0) -> (2,1)).
    const from = at('a', A, 2.5);
    const to = at('b', B, 1.5);
    const path = followBoundary(net, from, to, pointAt(A, 2.5), pointAt(B, 1.5));
    expect(path).toEqual([P(1, 1), P(2, 1)]);
  });

  it('goes the other way round on the way back', () => {
    const path = followBoundary(net, at('b', B, 1.5), at('a', A, 2.5), pointAt(B, 1.5), pointAt(A, 2.5));
    expect(path).toEqual([P(2, 1), P(1, 1)]);
  });

  it('works from a click on a vertex of A to a click on a vertex of B', () => {
    // A vertex 3 = (0,1) to B vertex 2 = (2,1): through the shared corner only.
    expect(followBoundary(net, at('a', A, 3), at('b', B, 2), A[3], B[2])).toEqual([P(1, 1)]);
  });

  it('a click on a shared corner (snapped as ring A) follows B to the next click', () => {
    // Shared corner (1,1) is A vertex 2. Next click on B's right edge.
    const path = followBoundary(net, at('a', A, 2), at('b', B, 1.5), A[2], pointAt(B, 1.5));
    expect(path).toEqual([P(2, 1)]);
  });

  it('two clicks on the shared edge, one snapped as A and one as B, stay straight', () => {
    // A edge 1 = (1,0) -> (1,1); B edge 3 = (1,1) -> (1,0).
    const path = followBoundary(net, at('a', A, 1.2), at('b', B, 3.3), pointAt(A, 1.2), pointAt(B, 3.3));
    expect(path).toEqual([]);
  });

  it('polygon plus postcode boundary: follows both', () => {
    // Postcode Z is a WKT ring (closing copy) sharing the corner (2,1) with
    // polygon B and nothing else.
    const Z: LatLng[] = [P(2, 1), P(3, 1), P(3, 2), P(2, 2), P(2, 1)];
    const n2 = buildBoundaryNetwork([{ key: 'poly:7:0', path: B }, { key: 'zip:42', path: Z }]);
    // From B's bottom edge (edge 0: (1,0) -> (2,0)) at (1.5,0) to Z's top edge
    // (edge 2: (3,2) -> (2,2)) at (2.5,2).
    const path = followBoundary(n2, at('poly:7:0', B, 0.5), at('zip:42', Z, 2.5), pointAt(B, 0.5), pointAt(Z, 2.5));
    expect(path).toEqual([P(2, 0), P(2, 1), P(2, 2)]);
  });

  it('no shared vertex: straight line', () => {
    // C sits 0.1 unit (about 9 m) east of A with nothing in common.
    const C: LatLng[] = [P(1.1, 0), P(2, 0), P(2, 1), P(1.1, 1)];
    const n2 = buildBoundaryNetwork([{ key: 'a', path: A }, { key: 'c', path: C }]);
    expect(followBoundary(n2, at('a', A, 2.5), at('c', C, 1.5), pointAt(A, 2.5), pointAt(C, 1.5))).toEqual([]);
  });

  it('falls back to a straight line when the network path is more than 3x the straight distance', () => {
    // D touches A only at A's top-right corner (1,1); its left side slants
    // away from A's right edge. Two clicks close together near the bottom
    // would have to go all the way up to (1,1) and back.
    const D: LatLng[] = [P(1, 1), P(1.5, 1), P(1.5, 0), P(1.05, 0)];
    const n2 = buildBoundaryNetwork([{ key: 'a', path: A }, { key: 'd', path: D }]);
    const fromPt = pointAt(A, 1.05); // (1, 0.05) on A's right edge
    const toPt = pointAt(D, 2.9); // just east of (1.05, 0) on D's bottom edge
    expect(networkPath(n2, at('a', A, 1.05), at('d', D, 2.9), fromPt, toPt)).toEqual([]);
    // A larger allowance accepts the same path, proving the path exists.
    // Up A's right edge to (1,1), then down D's slanted left side.
    expect(networkPath(n2, at('a', A, 1.05), at('d', D, 2.9), fromPt, toPt, 100)).toEqual([P(1, 1), P(1.05, 0)]);
    // Clicks that are far enough apart do follow.
    expect(followBoundary(n2, at('a', A, 2.5), at('d', D, 0.5), pointAt(A, 2.5), pointAt(D, 0.5))).toEqual([P(1, 1)]);
  });

  it('T-junction: a vertex on a neighbour edge joins that edge', () => {
    // Tall A2 = (0,0)-(1,2). B's corner (1,1) sits in the middle of A2's
    // right edge, which has no vertex there.
    const A2: LatLng[] = [P(0, 0), P(1, 0), P(1, 2), P(0, 2)];
    const n2 = buildBoundaryNetwork([{ key: 'a', path: A2 }, { key: 'b', path: B }]);
    // From A2's top edge (edge 2: (1,2) -> (0,2)) at (0.5,2) to B's top edge
    // (edge 2: (2,1) -> (1,1)) at (1.5,1): down A2's right edge to the
    // T-junction, NOT round via (1,0).
    expect(followBoundary(n2, at('a', A2, 2.5), at('b', B, 2.5), pointAt(A2, 2.5), pointAt(B, 2.5)))
      .toEqual([P(1, 2), P(1, 1)]);
    // From a click on the split part of A2's right edge (edge 1 at (1,1.5))
    // to B's bottom edge at (1.5,0): through the junction and (1,0).
    expect(followBoundary(n2, at('a', A2, 1.75), at('b', B, 0.5), pointAt(A2, 1.75), pointAt(B, 0.5)))
      .toEqual([P(1, 1), P(1, 0)]);
  });

  it('same ring keeps the existing boundaryArc behaviour', () => {
    const HEX: LatLng[] = [P(0, 0), P(1, 0), P(2, 1), P(1, 2), P(0, 2), P(-1, 1)];
    const n2 = buildBoundaryNetwork([{ key: 'h', path: HEX }]);
    for (const [f, t] of [[0, 2], [0, 4], [4, 0], [0.5, 2.5], [5.5, 1], [3.2, 3.8]]) {
      expect(followBoundary(n2, at('h', HEX, f), at('h', HEX, t), pointAt(HEX, f), pointAt(HEX, t)))
        .toEqual(boundaryArc(HEX, f, t, pointAt(HEX, f), pointAt(HEX, t)));
    }
    // Same ring works without a network at all.
    expect(followBoundary(null, at('h', HEX, 0), at('h', HEX, 2), HEX[0], HEX[2])).toEqual([HEX[1]]);
  });

  it('unsnapped clicks, unknown rings and no network give a straight line', () => {
    expect(followBoundary(net, null, at('b', B, 1.5), P(5, 5), pointAt(B, 1.5))).toEqual([]);
    expect(followBoundary(net, at('a', A, 2.5), null, pointAt(A, 2.5), P(5, 5))).toEqual([]);
    expect(followBoundary(null, at('a', A, 2.5), at('b', B, 1.5), pointAt(A, 2.5), pointAt(B, 1.5))).toEqual([]);
    expect(followBoundary(net, at('a', A, 2.5), at('zip:9', B, 1.5), pointAt(A, 2.5), pointAt(B, 1.5))).toEqual([]);
  });
});

describe('closingPath (closing edge across shapes)', () => {
  const net = buildBoundaryNetwork([{ key: 'a', path: A }, { key: 'b', path: B }]);

  it('closes from the last click on B back to the first click on A along the network', () => {
    // First click on A's top edge at (0.5,1); a free point up north; last
    // click on B's right edge at (2,0.5). Closing runs B -> (2,1) -> (1,1) -> A.
    const first = pointAt(A, 2.5);
    const last = pointAt(B, 1.5);
    const vertices = [first, P(1, 3), last];
    const snaps = [at('a', A, 2.5), null, at('b', B, 1.5)];
    expect(closingPath(net, vertices, snaps)).toEqual([P(2, 1), P(1, 1)]);
  });

  it('first and last on the same ring: exactly closingArc', () => {
    const vertices = [pointAt(A, 2.5), P(0.5, 3), pointAt(A, 2.8)];
    const snaps = [at('a', A, 2.5), null, at('a', A, 2.8)];
    expect(closingPath(net, vertices, snaps)).toEqual(closingArc(vertices, snaps));
  });

  it('unsnapped ends or no network: straight close', () => {
    const vertices = [pointAt(A, 2.5), P(1, 3), pointAt(B, 1.5)];
    expect(closingPath(net, vertices, [null, null, at('b', B, 1.5)])).toEqual([]);
    expect(closingPath(null, vertices, [at('a', A, 2.5), null, at('b', B, 1.5)])).toEqual([]);
  });

  it('straight close when the network path would retrace the drawn outline (no area)', () => {
    // Clicked on A's top edge, then on B's top edge: the drawn path already
    // ran A -> (1,1) -> B. Closing back the same way would give a sliver with
    // no area, so it closes straight instead.
    const first = pointAt(A, 2.5);
    const last = pointAt(B, 2.5);
    const vertices = [first, P(1, 1), last];
    const snaps = [at('a', A, 2.5), at('b', B, 2.5)];
    expect(closingPath(net, vertices, snaps)).toEqual([]);
  });
});

describe('closingPath area rule across two rings', () => {
  // Planar area in square metres (x = east, y = north), for checking which
  // side of the neighbours the closed shape ends up on.
  const M_LAT = 111_320;
  const M_LNG = 111_320 * Math.cos((-36.85 * Math.PI) / 180);
  const shoelace = (pts: LatLng[]) =>
    Math.abs(pts.reduce((s, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return s + (p.lng * M_LNG) * (q.lat * M_LAT) - (q.lng * M_LNG) * (p.lat * M_LAT);
    }, 0)) / 2;

  // Two tall neighbours sharing x = 1. The shortest way round the network
  // between their outer edges near the bottom is along the bottom.
  const TA = [P(0, 0), P(1, 0), P(1, 3), P(0, 3)];
  const TB = [P(1, 0), P(2, 0), P(2, 3), P(1, 3)];
  const net = buildBoundaryNetwork([{ key: 'a', path: TA }, { key: 'b', path: TB }]);
  const firstSnap = at('a', TA, 3 + 2.5 / 3); // (0, 0.5) on A's left edge
  const lastSnap = at('b', TB, 1 + 0.5 / 3); // (2, 0.5) on B's right edge

  it('a shape drawn round the TOP of both neighbours is not closed along the bottom (it would swallow them)', () => {
    // Out from A's left edge, up and over both neighbours, back to B's right
    // edge. Closing along the bottom would put A and B inside the new shape.
    const vertices = [P(0, 0.5), P(-1, 0.5), P(-1, 4), P(3, 4), P(3, 0.5), P(2, 0.5)];
    const snaps = [firstSnap, null, null, null, null, lastSnap];
    const tail = closingPath(net, vertices, snaps);
    const neighbourArea = shoelace([P(0, 0), P(2, 0), P(2, 3), P(0, 3)]);
    expect(tail).not.toContainEqual(P(1, 0));
    expect(shoelace([...vertices, ...tail])).toBeLessThan(shoelace(vertices) + neighbourArea * 0.1);
  });

  it('a shape drawn round the BOTTOM of both neighbours still follows the bottom edges (near side)', () => {
    // Mirror case: the new shape sits below A and B, so the bottom path hugs
    // them on the near side and is followed.
    const vertices = [P(0, 0.5), P(-1, 0.5), P(-1, -1), P(3, -1), P(3, 0.5), P(2, 0.5)];
    const snaps = [firstSnap, null, null, null, null, lastSnap];
    const tail = closingPath(net, vertices, snaps);
    expect(tail).toEqual([P(2, 0), P(1, 0), P(0, 0)]);
    expect(shoelace([...vertices, ...tail])).toBeLessThan(shoelace(vertices));
  });
});

describe('BoundaryNetworkCache', () => {
  it('reuses the network while the ring set is unchanged and rebuilds when it changes', () => {
    const cache = new BoundaryNetworkCache();
    const r1 = [{ key: 'a', path: A }, { key: 'b', path: B }];
    const n1 = cache.get(r1);
    expect(cache.get([{ key: 'a', path: A }, { key: 'b', path: B }])).toBe(n1);
    const n2 = cache.get([{ key: 'a', path: A }]);
    expect(n2).not.toBe(n1);
    expect(n2.nodeCount).toBe(4);
    cache.clear();
    expect(cache.get([{ key: 'a', path: A }])).not.toBe(n2);
  });
});

describe('performance', () => {
  it('builds and queries a few thousand vertices quickly', () => {
    // 20 x 20 grid of squares, 8 vertices each (edge midpoints included),
    // all sharing edges: 3,200 ring vertices.
    const rings: { key: string; path: LatLng[] }[] = [];
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        rings.push({
          key: `s${i}:${j}`,
          path: [P(i, j), P(i + 0.5, j), P(i + 1, j), P(i + 1, j + 0.5), P(i + 1, j + 1), P(i + 0.5, j + 1), P(i, j + 1), P(i, j + 0.5)],
        });
      }
    }
    const t0 = performance.now();
    const net = buildBoundaryNetwork(rings);
    const r0 = rings[0];
    const r1 = rings[rings.length - 1];
    // Bottom-left square bottom edge to top-right square right edge: far
    // apart, the path is a staircase/L of about 40 units vs 28 straight.
    const path = followBoundary(net, at(r0.key, r0.path, 0.5), at(r1.key, r1.path, 3.5), pointAt(r0.path, 0.5), pointAt(r1.path, 3.5));
    const elapsed = performance.now() - t0;
    expect(net.nodeCount).toBe(21 * 21 + 2 * 20 * 21); // corners + edge midpoints
    expect(path.length).toBeGreaterThan(10);
    expect(elapsed).toBeLessThan(500);
  });
});
