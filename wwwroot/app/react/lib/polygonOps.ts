// Polygon boolean operation wrappers.
//
// Backed by mfogel/polygon-clipping (Martinez-Rueda-Feito algorithm),
// which Turf.js also switched to for its own union/intersection/difference.
// ~40KB gzipped, handles GeoJSON Polygon + MultiPolygon, returns
// MultiPolygon always, tolerates self-intersecting rings + holes.
//
// Coordinate space: we treat lat/lng as planar (x=lng, y=lat) floats.
// polygon-clipping does 2D boolean ops in whatever coordinate space you
// hand it. For coverage polygons at city/region scale (never crossing
// the dateline, never within a few degrees of the pole) planar math
// gives visually identical results to true geodesic ops. This matches
// what most Google-Maps-plus-boolean-ops apps ship with.
//
// Output shape: every op returns LatLng[][] (an array of rings, in the
// order polygon-clipping produced them). Ring 0 is the first piece's
// outer ring; subsequent CCW rings start new pieces; CW rings are
// holes of the preceding outer. Google Maps Polygon.setPaths() reads
// this convention directly.

import polygonClipping, {
  type Pair,
  type Ring,
  type Polygon as ClipPolygon,
  type MultiPolygon as ClipMultiPolygon,
} from 'polygon-clipping';
// polygon-splitter ships no TS defs (v0.0.11); ambient shim lives at
// wwwroot/app/react/types/polygon-splitter.d.ts. Purpose-built for
// splitting a GeoJSON Polygon / MultiPolygon with a LineString, returns
// a GeoJSON MultiPolygon Feature.
import polygonSplitter from 'polygon-splitter';

export interface LatLng { lat: number; lng: number; }

// ─── Coordinate translation ────────────────────────────────────────────

/** Convert one ring of LatLng into a polygon-clipping ring (Pair[]).
 *  Auto-closes the ring if the last vertex isn't already the first. */
function ringToGeoJson(ring: LatLng[]): Ring {
  const out: [number, number][] = ring.map((p) => [p.lng, p.lat]);
  if (out.length === 0) return out;
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    out.push([first[0], first[1]]);
  }
  return out;
}

/** Signed area of a ring via shoelace. Positive = CCW (outer), negative
 *  = CW (hole). Uses (lng, lat) as (x, y) - planar approximation is
 *  fine for winding detection at city / region scale. */
function signedRingArea(ring: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += (b.lng - a.lng) * (b.lat + a.lat);
  }
  return -sum / 2;
}

/** Convert a LatLng[][] shape (rings, first is outer, rest are holes)
 *  into a polygon-clipping single Polygon. Only valid when caller
 *  guarantees the input is one piece + its holes (not multi-piece). */
export function latLngRingsToPolygon(rings: LatLng[][]): ClipPolygon {
  return rings.map(ringToGeoJson);
}

/** Convert a LatLng[][] shape - which may encode a MultiPolygon via
 *  winding order (CCW = new outer piece, CW = hole of preceding outer) -
 *  into a polygon-clipping MultiPolygon. This is what boolean ops must
 *  use for target/subject inputs so pieces don't get silently merged
 *  or dropped mid-op. Bug pre-2026-08-06: latLngRingsToPolygon was
 *  used, which folded a 2-piece target into "piece 1 outer + piece 2
 *  hole" and lost coverage on the next Add / Cut / Clip. */
export function latLngRingsToMultiPolygon(rings: LatLng[][]): ClipMultiPolygon {
  const pieces: ClipPolygon[] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const ccw = signedRingArea(ring) > 0;
    if (pieces.length === 0 || ccw) {
      // First ring always starts a piece (even if it's mis-wound - we
      // trust the caller's intent that it's an outer). Subsequent CCW
      // rings start new pieces.
      pieces.push([ringToGeoJson(ring)]);
    } else {
      // CW ring = hole of the current piece.
      pieces[pieces.length - 1].push(ringToGeoJson(ring));
    }
  }
  return pieces;
}

/** Convert an array of LatLng[][] shapes (each shape is one polygon
 *  with its own outer + holes) into a polygon-clipping MultiPolygon -
 *  i.e. multiple disjoint pieces. Used when unioning several separate
 *  polygons where each one is a valid polygon in its own right (e.g.
 *  zip boundaries). */
export function shapesToMultiPolygon(shapes: LatLng[][][]): ClipMultiPolygon {
  return shapes.map((rings) => rings.map(ringToGeoJson));
}

/** Convert a polygon-clipping MultiPolygon output back into LatLng[][]
 *  form. Flattens all pieces + rings into a single ring array; ring
 *  order carries the winding-encoded topology so Google Maps'
 *  Polygon.setPaths() reproduces it faithfully. Drops the trailing
 *  duplicate closing vertex on each ring - RoutedOperations storage
 *  doesn't include the closer (auto-closed at WKT-build time). */
export function multiPolygonToLatLngRings(mp: ClipMultiPolygon): LatLng[][] {
  const rings: LatLng[][] = [];
  for (const piece of mp) {
    for (const ring of piece) {
      if (ring.length < 4) continue; // < 4 means < 3 unique vertices after close.
      // Strip the closing duplicate. polygon-clipping always closes rings.
      const stripped = ring.slice(0, ring.length - 1);
      rings.push(stripped.map((pair: Pair) => ({ lat: pair[1], lng: pair[0] })));
    }
  }
  return rings;
}

// ─── Boolean ops (all return LatLng[][] rings-of-a-multipolygon) ───────

/** Union all given shapes. If input is a single shape with holes, output
 *  is that shape normalised. If input is multiple disjoint shapes that
 *  touch or overlap, output merges them into fewer / one piece; if they
 *  don't touch, output is a MultiPolygon with N disjoint pieces (each
 *  becomes its own outer ring in the returned list). Empty input
 *  returns []. */
export function unionShapes(shapes: LatLng[][][]): LatLng[][] {
  if (shapes.length === 0) return [];
  // polygon-clipping.union takes 1+ Polygon or MultiPolygon args; we
  // pass every shape as its own single-Polygon geometry so overlapping /
  // touching pieces get merged and disjoint ones survive as separate
  // pieces in the returned MultiPolygon.
  const geoms = shapes.map((rings) => latLngRingsToPolygon(rings));
  const [head, ...tail] = geoms;
  const out = tail.length === 0
    ? polygonClipping.union(head)
    : polygonClipping.union(head, ...tail);
  return multiPolygonToLatLngRings(out);
}

/** Grow the target polygon to include the drawn region.
 *  Target is passed as MultiPolygon so multi-piece polygons keep every
 *  piece intact through the union. Drawn is one ring (Polygon of one
 *  outer, no holes). */
export function addRegion(target: LatLng[][], drawn: LatLng[]): LatLng[][] {
  const out = polygonClipping.union(
    latLngRingsToMultiPolygon(target),
    latLngRingsToPolygon([drawn]),
  );
  return multiPolygonToLatLngRings(out);
}

/** Subtract the drawn region from the target polygon. Result may split
 *  the polygon into multiple disjoint pieces (each becomes an outer ring
 *  in the returned list) or introduce holes (CW rings after the outer). */
export function cutRegion(target: LatLng[][], drawn: LatLng[]): LatLng[][] {
  const out = polygonClipping.difference(
    latLngRingsToMultiPolygon(target),
    latLngRingsToPolygon([drawn]),
  );
  return multiPolygonToLatLngRings(out);
}

/** Keep only the parts of the target polygon that fall inside the drawn
 *  region. If they don't overlap, result is [] - caller should surface
 *  a toast + skip applying. */
export function keepRegion(target: LatLng[][], drawn: LatLng[]): LatLng[][] {
  const out = polygonClipping.intersection(
    latLngRingsToMultiPolygon(target),
    latLngRingsToPolygon([drawn]),
  );
  return multiPolygonToLatLngRings(out);
}

/** Split the target polygon by a polyline. Line must cross the polygon
 *  boundary at 2+ points; otherwise returns the target unchanged with
 *  wasSplit=false so callers can toast + no-op. Backed by the
 *  polygon-splitter npm package (rowanwins, ~10KB, purpose-built for
 *  exactly this - handles concave polygons, holes, MultiPolygon input).
 *  A line that crosses multiple pieces of a multi-piece polygon will
 *  split each crossed piece independently.  */
export function splitByLine(
  target: LatLng[][],
  line: LatLng[],
): { rings: LatLng[][]; wasSplit: boolean } {
  if (target.length === 0 || line.length < 2) {
    return { rings: target, wasSplit: false };
  }
  // Assemble the target as a GeoJSON MultiPolygon so multi-piece inputs
  // survive the split with untouched pieces preserved.
  const targetMp = latLngRingsToMultiPolygon(target);
  const targetGeom = {
    type: 'MultiPolygon' as const,
    coordinates: targetMp.map((piece) => piece.map((ring) => ring.map((pair) => [pair[0], pair[1]]))),
  };
  const lineGeom = {
    type: 'LineString' as const,
    coordinates: line.map((p) => [p.lng, p.lat] as [number, number]),
  };

  let result;
  try {
    result = polygonSplitter(targetGeom, lineGeom);
  } catch {
    // polygon-splitter throws on degenerate input (zero-length line,
    // fully-outside line, etc.). Surface as no-op to the caller.
    return { rings: target, wasSplit: false };
  }

  // Convert result MultiPolygon coordinates back to LatLng[][] rings.
  const outRings: LatLng[][] = [];
  const coords = result?.geometry?.coordinates;
  if (!Array.isArray(coords)) return { rings: target, wasSplit: false };
  for (const piece of coords) {
    if (!Array.isArray(piece)) continue;
    for (const ring of piece) {
      if (!Array.isArray(ring) || ring.length < 4) continue;
      // polygon-splitter closes rings; strip the closing duplicate to
      // match our storage convention.
      const stripped = ring.slice(0, ring.length - 1);
      outRings.push(stripped.map((pair) => ({ lat: pair[1], lng: pair[0] })));
    }
  }
  if (outRings.length === 0) return { rings: target, wasSplit: false };

  // Count original vs result outer pieces (CCW rings) to decide whether
  // the operation actually split anything. If the counts match, the line
  // didn't produce a new piece (didn't cross the boundary at 2+ points
  // for any piece) - flag as wasSplit=false so caller can toast.
  const countCcw = (rings: LatLng[][]) => {
    let n = 0;
    for (const r of rings) {
      // Shoelace, positive = CCW = outer piece.
      let sum = 0;
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        sum += (b.lng - a.lng) * (b.lat + a.lat);
      }
      if (-sum / 2 > 0) n++;
    }
    return n;
  };
  const wasSplit = countCcw(outRings) > countCcw(target);
  return { rings: outRings, wasSplit };
}

// ─── Housekeeping ──────────────────────────────────────────────────────

/** Total vertex count across all rings. Used to gate auto-simplification
 *  when boolean ops produce vertex-explosion results. */
export function totalVertexCount(rings: LatLng[][]): number {
  let n = 0;
  for (const r of rings) n += r.length;
  return n;
}
