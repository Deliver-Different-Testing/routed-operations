// Polygon Builder layers + visibility (2026-11-12).
//
// A "layer" is just the polygon's `layer` string (stored in
// tblBulkRunPolygon.TagLocation). Polygons with no layer sit together in a
// trailing "No layer" group. Visibility is a per-browser preference, not
// data: hidden layers / polygons and the postcode-boundaries switch live in
// localStorage keyed per origin (each tenant has its own hostname, so the
// key needs no tenant id).
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

export interface VisibilityState {
  hiddenLayers: string[];
  hiddenPolygons: number[];
  /** Postcode / ZIP boundary auto-load + render. Default on. */
  showPostcodes: boolean;
}

export const NO_LAYER = '';
export const VISIBILITY_STORAGE_KEY = 'polygonBuilder.visibility.v1';

export const DEFAULT_VISIBILITY: VisibilityState = {
  hiddenLayers: [],
  hiddenPolygons: [],
  showPostcodes: true,
};

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

export function isLayerHidden(state: VisibilityState, layer: string): boolean {
  return state.hiddenLayers.includes(layer);
}

/** A polygon shows when neither it nor its layer is hidden. */
export function isPolygonVisible(state: VisibilityState, p: LayeredPolygon): boolean {
  if (state.hiddenPolygons.includes(p.polygonId)) return false;
  return !isLayerHidden(state, layerOf(p));
}

export function toggleLayerHidden(state: VisibilityState, layer: string): VisibilityState {
  const hidden = isLayerHidden(state, layer);
  return {
    ...state,
    hiddenLayers: hidden
      ? state.hiddenLayers.filter((l) => l !== layer)
      : [...state.hiddenLayers, layer],
  };
}

export function togglePolygonHidden(state: VisibilityState, polygonId: number): VisibilityState {
  const hidden = state.hiddenPolygons.includes(polygonId);
  return {
    ...state,
    hiddenPolygons: hidden
      ? state.hiddenPolygons.filter((id) => id !== polygonId)
      : [...state.hiddenPolygons, polygonId],
  };
}

/** Show only this layer: every other layer in `allLayers` is hidden, this one
 *  is shown, and any per-polygon hides inside it are cleared so "Only" always
 *  means "everything in this layer and nothing else". */
export function soloLayer<T extends LayeredPolygon>(
  state: VisibilityState, layer: string, polygons: T[],
): VisibilityState {
  const all = new Set(groupByLayer(polygons).map((g) => g.layer));
  all.delete(layer);
  const inLayer = new Set(polygons.filter((p) => layerOf(p) === layer).map((p) => p.polygonId));
  return {
    ...state,
    hiddenLayers: Array.from(all),
    hiddenPolygons: state.hiddenPolygons.filter((id) => !inLayer.has(id)),
  };
}

/** Make sure one polygon is on screen: un-hide it and its layer. */
export function revealPolygon(state: VisibilityState, p: LayeredPolygon): VisibilityState {
  const layer = layerOf(p);
  return {
    ...state,
    hiddenLayers: state.hiddenLayers.filter((l) => l !== layer),
    hiddenPolygons: state.hiddenPolygons.filter((id) => id !== p.polygonId),
  };
}

export function showAllLayers(state: VisibilityState): VisibilityState {
  return { ...state, hiddenLayers: [], hiddenPolygons: [] };
}

export function setShowPostcodes(state: VisibilityState, show: boolean): VisibilityState {
  return { ...state, showPostcodes: show };
}

/** Stable colour for a saved polygon: its own colorHex when set, otherwise a
 *  palette entry keyed on polygonId. Keyed on the id (not the list index)
 *  so a shape keeps its colour when others are added, removed or hidden. */
export function polygonColour(p: LayeredPolygon, palette: readonly string[]): string {
  if (p.colorHex && /^#[0-9a-fA-F]{6}$/.test(p.colorHex)) return p.colorHex;
  if (palette.length === 0) return '#f2994a';
  const idx = Math.abs(p.polygonId) % palette.length;
  return palette[idx];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read the saved preference. Any failure (private window, blocked storage,
 *  bad JSON, old shape) falls back to the default so the page always renders. */
export function loadVisibility(storage: StorageLike | null | undefined): VisibilityState {
  try {
    const raw = storage?.getItem(VISIBILITY_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VISIBILITY };
    const parsed = JSON.parse(raw) as Partial<VisibilityState>;
    return {
      hiddenLayers: Array.isArray(parsed.hiddenLayers)
        ? parsed.hiddenLayers.filter((l): l is string => typeof l === 'string') : [],
      hiddenPolygons: Array.isArray(parsed.hiddenPolygons)
        ? parsed.hiddenPolygons.filter((id): id is number => typeof id === 'number') : [],
      showPostcodes: typeof parsed.showPostcodes === 'boolean' ? parsed.showPostcodes : true,
    };
  } catch {
    return { ...DEFAULT_VISIBILITY };
  }
}

export function saveVisibility(storage: StorageLike | null | undefined, state: VisibilityState): void {
  try {
    storage?.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the preference just does not persist.
  }
}
