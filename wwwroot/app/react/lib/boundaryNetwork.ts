// Follow boundary across more than one shape (Polygon Builder, spec 4.4b).
//
// boundaryArc / closingArc in polygonOps only follow a boundary when two
// consecutive clicks snapped to the SAME ring. This module joins every
// snappable ring (saved polygons and loaded postcode boundaries) into one
// graph so a click on neighbour A followed by a click on neighbour B (or on
// a postcode boundary) runs along the shared boundary between them.
//
// Network:
// - Nodes are ring vertices. Vertices within `toleranceMetres` (default 1 m)
//   of each other merge into one node (spatial hash, so the merge is close
//   to linear in the vertex count).
// - A node lying on another ring's edge (a T-junction, the neighbour has no
//   vertex there) is inserted into that edge, splitting it.
// - Edges are the ring segments (after splitting), weighted by length in
//   metres.
//
// Path between two snapped clicks: Dijkstra (binary heap) from the first
// snap position to the second. A snap position is the same fractional ring
// index snapTo produces (`i` = vertex i, `i + t` = on the edge i -> i+1), so
// a click in the middle of an edge enters the graph at both ends of the
// sub-edge it sits on.
//
// Same ring: unchanged, boundaryArc (shorter way round). Fallback to a
// straight line when there is no connected path or the path is more than
// `maxDetour` (3x) the straight distance.

import { type LatLng, type RingPosition, boundaryArc, chainLengthMetres, closingArc, signedRingArea } from './polygonOps';

/** One snappable ring: same `key` and `path` reference that snapTo puts on
 *  the SnapRing it returns. */
export interface BoundaryRing { key: string; path: LatLng[]; }

/** A point where a ring edge passes a node: fraction `t` along the edge. */
interface EdgeStop { t: number; node: number; }

interface NetworkRing {
  path: LatLng[];
  /** Vertex count without the WKT closing copy. */
  m: number;
  /** Node id of each vertex 0..m-1. */
  nodeOf: Int32Array;
  /** Per edge i (vertex i -> vertex i+1 mod m): stops sorted by t, always
   *  starting with {t: 0, nodeOf[i]} and ending with {t: 1, nodeOf[i+1]}. */
  stops: EdgeStop[][];
  /** Length in metres of each edge. */
  edgeLen: Float64Array;
}

export interface BoundaryNetwork {
  readonly nodeCount: number;
  /** @internal */ readonly pos: LatLng[];
  /** @internal */ readonly x: Float64Array;
  /** @internal */ readonly y: Float64Array;
  /** @internal CSR adjacency: neighbours of node u are adjTo[adjStart[u] .. adjStart[u+1]). */
  readonly adjStart: Int32Array;
  /** @internal */ readonly adjTo: Int32Array;
  /** @internal */ readonly adjW: Float64Array;
  /** @internal */ readonly rings: Map<string, NetworkRing>;
}

const METRES_PER_DEG_LAT = 111_320;
const T_EPS = 1e-9;

function ringPoints(path: LatLng[]): number {
  const n = path.length;
  if (n > 1 && path[n - 1].lat === path[0].lat && path[n - 1].lng === path[0].lng) return n - 1;
  return n;
}

/**
 * Build the shared-vertex network from every ring the snap can hit. Rings
 * with fewer than 2 distinct vertices are ignored. Pure; cost is roughly
 * linear in the total vertex count.
 */
export function buildBoundaryNetwork(rings: BoundaryRing[], toleranceMetres = 1): BoundaryNetwork {
  const tol = Math.max(toleranceMetres, 1e-6);

  // Local metric frame: equirectangular around the mean latitude. Fine at
  // city / region scale, which is all the builder ever draws.
  let latSum = 0;
  let latCount = 0;
  for (const r of rings) {
    const m = ringPoints(r.path);
    for (let i = 0; i < m; i++) { latSum += r.path[i].lat; latCount++; }
  }
  const refLat = latCount > 0 ? latSum / latCount : 0;
  const kx = METRES_PER_DEG_LAT * Math.cos((refLat * Math.PI) / 180);
  const ky = METRES_PER_DEG_LAT;

  // ── 1. Nodes: merge vertices within the tolerance (grid of cell = tol). ──
  const pos: LatLng[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const nodeGrid = new Map<string, number[]>();
  const nodeFor = (p: LatLng): number => {
    const x = p.lng * kx;
    const y = p.lat * ky;
    const cx = Math.floor(x / tol);
    const cy = Math.floor(y / tol);
    let best = -1;
    let bestD = tol * tol;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = nodeGrid.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (const id of cell) {
          const ex = xs[id] - x;
          const ey = ys[id] - y;
          const d = ex * ex + ey * ey;
          if (d <= bestD) { bestD = d; best = id; }
        }
      }
    }
    if (best >= 0) return best;
    const id = pos.length;
    pos.push(p);
    xs.push(x);
    ys.push(y);
    const key = `${cx},${cy}`;
    const cell = nodeGrid.get(key);
    if (cell) cell.push(id); else nodeGrid.set(key, [id]);
    return id;
  };

  const netRings = new Map<string, NetworkRing>();
  const ringList: NetworkRing[] = [];
  for (const r of rings) {
    const m = ringPoints(r.path);
    if (m < 2) continue;
    const nodeOf = new Int32Array(m);
    for (let i = 0; i < m; i++) nodeOf[i] = nodeFor(r.path[i]);
    const stops: EdgeStop[][] = [];
    const edgeLen = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      stops.push([{ t: 0, node: nodeOf[i] }, { t: 1, node: nodeOf[j] }]);
      edgeLen[i] = chainLengthMetres([r.path[i], r.path[j]]);
    }
    const nr: NetworkRing = { path: r.path, m, nodeOf, stops, edgeLen };
    // Last one wins on a duplicate key; snapTo keys are unique anyway.
    netRings.set(r.key, nr);
    ringList.push(nr);
  }
  const nodeCount = pos.length;

  // ── 2. T-junctions: nodes lying on another ring's edge. ──
  // Edge grid with a coarser cell. Each edge is sampled every half cell and
  // registered in the sampled cells; a node within `tol` of the edge is then
  // always in the 3x3 block around one of those cells, because samples are
  // at most cell/4 from any point of the edge and tol < cell/4.
  const lens: number[] = [];
  for (const nr of ringList) for (let i = 0; i < nr.m; i++) lens.push(nr.edgeLen[i]);
  lens.sort((a, b) => a - b);
  const median = lens.length > 0 ? lens[lens.length >> 1] : 0;
  const cellSize = Math.max(tol * 8, median);
  const edgeGrid = new Map<string, number[]>(); // flattened (ringIdx, edgeIdx) pairs
  for (let ri = 0; ri < ringList.length; ri++) {
    const nr = ringList[ri];
    for (let i = 0; i < nr.m; i++) {
      const a = nr.nodeOf[i];
      const b = nr.nodeOf[(i + 1) % nr.m];
      if (a === b) continue;
      const len = Math.hypot(xs[b] - xs[a], ys[b] - ys[a]);
      const steps = Math.max(1, Math.ceil(len / (cellSize / 2)));
      let lastKey = '';
      for (let s = 0; s <= steps; s++) {
        const f = s / steps;
        const key = `${Math.floor((xs[a] + (xs[b] - xs[a]) * f) / cellSize)},${Math.floor((ys[a] + (ys[b] - ys[a]) * f) / cellSize)}`;
        if (key === lastKey) continue;
        lastKey = key;
        const cell = edgeGrid.get(key);
        if (cell) {
          // Consecutive samples can revisit a cell only right after it; this
          // check keeps one entry per edge per cell in the common case.
          if (cell[cell.length - 2] === ri && cell[cell.length - 1] === i) continue;
          cell.push(ri, i);
        } else {
          edgeGrid.set(key, [ri, i]);
        }
      }
    }
  }
  const tolSq = tol * tol;
  for (let id = 0; id < nodeCount; id++) {
    const px = xs[id];
    const py = ys[id];
    const cx = Math.floor(px / cellSize);
    const cy = Math.floor(py / cellSize);
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = edgeGrid.get(`${cx + dx},${cy + dy}`);
        if (!cell) continue;
        for (let k = 0; k < cell.length; k += 2) {
          const ri = cell[k];
          const i = cell[k + 1];
          const tag = ri * 1_000_003 + i;
          if (seen.has(tag)) continue;
          seen.add(tag);
          const nr = ringList[ri];
          const a = nr.nodeOf[i];
          const b = nr.nodeOf[(i + 1) % nr.m];
          if (a === id || b === id || a === b) continue;
          const ex = xs[b] - xs[a];
          const ey = ys[b] - ys[a];
          const lenSq = ex * ex + ey * ey;
          const t = ((px - xs[a]) * ex + (py - ys[a]) * ey) / lenSq;
          if (t <= T_EPS || t >= 1 - T_EPS) continue;
          const fx = xs[a] + t * ex - px;
          const fy = ys[a] + t * ey - py;
          if (fx * fx + fy * fy > tolSq) continue;
          const list = nr.stops[i];
          if (list.some((s) => s.node === id)) continue;
          list.push({ t, node: id });
        }
      }
    }
  }
  for (const nr of ringList) {
    for (const list of nr.stops) if (list.length > 2) list.sort((p, q) => p.t - q.t);
  }

  // ── 3. Edges (CSR adjacency, undirected). ──
  const deg = new Int32Array(nodeCount + 1);
  const pairs: number[] = [];
  for (const nr of ringList) {
    for (const list of nr.stops) {
      for (let k = 1; k < list.length; k++) {
        const u = list[k - 1].node;
        const v = list[k].node;
        if (u === v) continue;
        pairs.push(u, v);
        deg[u]++;
        deg[v]++;
      }
    }
  }
  const adjStart = new Int32Array(nodeCount + 1);
  for (let u = 0; u < nodeCount; u++) adjStart[u + 1] = adjStart[u] + deg[u];
  const fill = adjStart.slice(0, nodeCount);
  const adjTo = new Int32Array(pairs.length);
  const adjW = new Float64Array(pairs.length);
  for (let k = 0; k < pairs.length; k += 2) {
    const u = pairs[k];
    const v = pairs[k + 1];
    const w = Math.hypot(xs[u] - xs[v], ys[u] - ys[v]);
    adjTo[fill[u]] = v; adjW[fill[u]++] = w;
    adjTo[fill[v]] = u; adjW[fill[v]++] = w;
  }

  return {
    nodeCount,
    pos,
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    adjStart,
    adjTo,
    adjW,
    rings: netRings,
  };
}

/** Where a snap position enters the graph. `at` is set when the position is
 *  exactly on a node (vertex or T-junction); otherwise it sits inside the
 *  sub-edge between `left` and `right`. */
interface Entry {
  at: number | null;
  left: number;
  right: number;
  leftCost: number;
  rightCost: number;
}

function entryFor(net: BoundaryNetwork, rp: RingPosition): Entry | null {
  const nr = net.rings.get(rp.key);
  if (!nr) return null;
  // Positions are only meaningful against the ring they were computed on.
  if (nr.path !== rp.path && ringPoints(rp.path) !== nr.m) return null;
  if (!Number.isFinite(rp.pos)) return null;
  const m = nr.m;
  const p = ((rp.pos % m) + m) % m;
  let i = Math.floor(p);
  let t = p - i;
  if (t > 1 - T_EPS) { i = (i + 1) % m; t = 0; }
  if (t < T_EPS) {
    const node = nr.nodeOf[i % m];
    return { at: node, left: node, right: node, leftCost: 0, rightCost: 0 };
  }
  const list = nr.stops[i];
  for (let k = 1; k < list.length; k++) {
    const lo = list[k - 1];
    const hi = list[k];
    if (t > hi.t + T_EPS) continue;
    if (Math.abs(t - hi.t) <= T_EPS) return { at: hi.node, left: hi.node, right: hi.node, leftCost: 0, rightCost: 0 };
    if (Math.abs(t - lo.t) <= T_EPS) return { at: lo.node, left: lo.node, right: lo.node, leftCost: 0, rightCost: 0 };
    const len = nr.edgeLen[i];
    return { at: null, left: lo.node, right: hi.node, leftCost: (t - lo.t) * len, rightCost: (hi.t - t) * len };
  }
  return null;
}

/** Minimal binary min-heap of (key, node). */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (k[parent] <= key) break;
      k[i] = k[parent]; v[i] = v[parent];
      i = parent;
    }
    k[i] = key; v[i] = val;
  }
  /** Pops the smallest; returns [key, node]. Caller checks size first. */
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const topK = k[0];
    const topV = v[0];
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return [topK, topV];
  }
}

/**
 * Vertices strictly between two snapped clicks on DIFFERENT rings, along the
 * shortest path through the network. Endpoints are not included (same
 * contract as boundaryArc). Returns [] (straight line) when either ring is
 * not in the network, there is no connected path, or the path is longer than
 * `maxDetour` times the straight distance.
 */
export function networkPath(
  net: BoundaryNetwork,
  from: RingPosition,
  to: RingPosition,
  fromPoint: LatLng,
  toPoint: LatLng,
  maxDetour = 3,
): LatLng[] {
  const src = entryFor(net, from);
  const dst = entryFor(net, to);
  if (!src || !dst) return [];
  const straight = chainLengthMetres([fromPoint, toPoint]);
  if (!(straight > 0)) return [];

  // Both clicks inside the same sub-edge (possibly snapped via two rings
  // that share that edge): the boundary IS the straight line.
  if (src.at === null && dst.at === null
    && ((src.left === dst.left && src.right === dst.right) || (src.left === dst.right && src.right === dst.left))) {
    return [];
  }
  if (src.at !== null && src.at === dst.at) return [];

  const n = net.nodeCount;
  const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const seed = (node: number, cost: number) => {
    if (cost < dist[node]) { dist[node] = cost; prev[node] = -1; heap.push(cost, node); }
  };
  seed(src.left, src.leftCost);
  seed(src.right, src.rightCost);
  const targetCost = new Map<number, number>();
  targetCost.set(dst.left, dst.leftCost);
  if (!targetCost.has(dst.right) || dst.rightCost < (targetCost.get(dst.right) as number)) targetCost.set(dst.right, dst.rightCost);

  // Anything longer than this is thrown away anyway, so stop searching.
  const bound = straight * maxDetour;
  let best = Number.POSITIVE_INFINITY;
  let bestNode = -1;
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (d >= best || d > bound) break;
    const tc = targetCost.get(u);
    if (tc !== undefined && d + tc < best) { best = d + tc; bestNode = u; }
    for (let e = net.adjStart[u]; e < net.adjStart[u + 1]; e++) {
      const v = net.adjTo[e];
      const nd = d + net.adjW[e];
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
    }
  }
  if (bestNode < 0) return [];

  const nodes: number[] = [];
  for (let u = bestNode; u >= 0; u = prev[u]) nodes.push(u);
  nodes.reverse();
  // A click exactly on a node IS that node: the caller already has it.
  if (src.at !== null && nodes[0] === src.at) nodes.shift();
  if (dst.at !== null && nodes[nodes.length - 1] === dst.at) nodes.pop();
  const out = nodes
    .map((id) => net.pos[id])
    .filter((p) => !(p.lat === fromPoint.lat && p.lng === fromPoint.lng) && !(p.lat === toPoint.lat && p.lng === toPoint.lng));

  if (chainLengthMetres([fromPoint, ...out, toPoint]) > bound) return [];
  return out;
}

/**
 * Drop-in for the click listener: vertices to insert between the previous
 * click and this one. Same ring = boundaryArc exactly as before; different
 * rings = networkPath; either end not snapped (or no network) = [].
 * Alt-click stays the caller's job (do not call this when Alt is held).
 */
export function followBoundary(
  net: BoundaryNetwork | null,
  from: RingPosition | null,
  to: RingPosition | null,
  fromPoint: LatLng,
  toPoint: LatLng,
  maxDetour = 3,
): LatLng[] {
  if (!from || !to) return [];
  if (from.key === to.key) return boundaryArc(to.path, from.pos, to.pos, fromPoint, toPoint);
  if (!net) return [];
  return networkPath(net, from, to, fromPoint, toPoint, maxDetour);
}

/**
 * Drop-in for closingArc: vertices to append after the last drawn vertex so
 * the closing edge follows the boundary. First and last clicks on the same
 * ring = closingArc exactly as before (area rule, all-on-one-ring guard);
 * on different rings = networkPath from the last click back to the first,
 * unless it retraces the outline or makes the shape larger (then straight).
 */
export function closingPath(
  net: BoundaryNetwork | null,
  vertices: LatLng[],
  snaps: Array<RingPosition | null>,
  maxDetour = 3,
): LatLng[] {
  if (vertices.length < 2 || snaps.length < 2) return [];
  const first = snaps[0];
  const last = snaps[snaps.length - 1];
  if (!first || !last) return [];
  if (first.key === last.key) return closingArc(vertices, snaps);
  if (!net) return [];
  const path = networkPath(net, last, first, vertices[vertices.length - 1], vertices[0], maxDetour);
  // Cross-ring version of closingArc's no-area guard: if the way back runs
  // through a vertex the drawn outline already has (other than its two ends),
  // following it would retrace the outline and leave a sliver with no area.
  const drawn = vertices.slice(1, -1);
  const tolDeg = 1 / METRES_PER_DEG_LAT;
  const retraces = path.some((p) => drawn.some((v) =>
    Math.abs(v.lat - p.lat) <= tolDeg && Math.abs(v.lng - p.lng) <= tolDeg));
  if (retraces) return [];
  // Cross-ring version of closingArc's area rule (review C1, 2026-11-23).
  // The shortest way back can run round the far side of the neighbours, so
  // the closed shape would swallow them. Following the boundary should only
  // ever trim the shape back to the neighbours' edge, so if the path makes
  // the shape LARGER than closing it straight, close it straight instead.
  const area = (tail: LatLng[]) => Math.abs(signedRingArea([...vertices, ...tail]));
  return area(path) > area([]) ? [] : path;
}

/**
 * Keeps one network per ring set. `get` rebuilds only when the set of rings
 * (keys and path references) changed, e.g. a postcode batch loaded mid-draw
 * or a polygon was saved. Checking is O(rings), so calling it on every
 * click is fine.
 */
export class BoundaryNetworkCache {
  private rings: BoundaryRing[] | null = null;
  private net: BoundaryNetwork | null = null;
  constructor(private readonly toleranceMetres = 1) {}

  get(rings: BoundaryRing[]): BoundaryNetwork {
    if (this.net && this.rings && sameRings(this.rings, rings)) return this.net;
    this.rings = rings.slice();
    this.net = buildBoundaryNetwork(rings, this.toleranceMetres);
    return this.net;
  }

  clear(): void {
    this.rings = null;
    this.net = null;
  }
}

function sameRings(a: BoundaryRing[], b: BoundaryRing[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].path !== b[i].path) return false;
  }
  return true;
}
