// Polygon Builder layers (2026-11-12).
//
// A "layer" is just the polygon's `layer` string (stored in
// tblBulkRunPolygon.TagLocation). Polygons with no layer sit together in a
// trailing "No layer" group. What is drawn and listed is decided by the
// filters in polygonFilters.ts (perimeter spec 4.4), which replaced the
// per-layer / per-polygon eye toggles.
//
// Pure functions only. The page owns the state; this module owns the rules
// so they can be unit-tested without a map.

export interface LayeredPolygon {
  polygonId: number;
  layer?: string | null;
  colorHex?: string | null;
}

export interface LayerGroup<T extends LayeredPolygon> {
  /** Layer name, or NO_LAYER for the trailing group of unlayered shapes. */
  layer: string;
  polygons: T[];
}

export const NO_LAYER = '';

export function layerOf(p: LayeredPolygon): string {
  const l = (p.layer ?? '').trim();
  return l.length === 0 ? NO_LAYER : l;
}

/** Distinct layer names in use, sorted case-insensitively. Excludes NO_LAYER. */
export function layerNames(polygons: LayeredPolygon[]): string[] {
  const set = new Set<string>();
  polygons.forEach((p) => { const l = layerOf(p); if (l !== NO_LAYER) set.add(l); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Group polygons by layer, named layers first (A-Z), unlayered last. The
 *  order inside a group is the order the caller passed (the API sorts by
 *  name). */
export function groupByLayer<T extends LayeredPolygon>(polygons: T[]): LayerGroup<T>[] {
  const buckets = new Map<string, T[]>();
  polygons.forEach((p) => {
    const l = layerOf(p);
    const arr = buckets.get(l);
    if (arr) arr.push(p); else buckets.set(l, [p]);
  });
  const groups: LayerGroup<T>[] = layerNames(polygons).map((layer) => ({
    layer, polygons: buckets.get(layer) ?? [],
  }));
  const unlayered = buckets.get(NO_LAYER);
  if (unlayered && unlayered.length > 0) groups.push({ layer: NO_LAYER, polygons: unlayered });
  return groups;
}

/** Stable colour for a saved polygon: its own colorHex when set, otherwise a
 *  palette entry keyed on polygonId. Keyed on the id (not the list index)
 *  so a shape keeps its colour when others are added, removed or filtered out. */
export function polygonColour(p: LayeredPolygon, palette: readonly string[]): string {
  if (p.colorHex && /^#[0-9a-fA-F]{6}$/.test(p.colorHex)) return p.colorHex;
  if (palette.length === 0) return '#f2994a';
  const idx = Math.abs(p.polygonId) % palette.length;
  return palette[idx];
}
