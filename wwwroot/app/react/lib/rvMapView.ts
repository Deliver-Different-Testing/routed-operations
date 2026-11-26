// Route Viewer map: what to do with the viewport after the job pins are
// (re)built. Pure so the decision is unit-testable without Google Maps.
//
// Cheetah M3: a CAPS route run with no job pins (no jobs yet, or the job
// list failed to load) used to leave the map on the tenant-wide default.
// When the run carries its route origin (Routes.OriginLatitude /
// OriginLongitude, synthetic route runs only), centre there instead.

/** Zoom used when centring on a route origin with no pins to fit. */
export const RV_ORIGIN_ZOOM = 11;

export type RvMapView =
  | { kind: 'fit' }
  | { kind: 'centre'; lat: number; lng: number; zoom: number }
  | { kind: 'none' };

const coord = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v !== 0 ? v : null;

/**
 * markerCount > 0 -> fit to the markers (unchanged behaviour).
 * No markers + a usable origin -> centre on the origin at zoom 11.
 * No markers + no origin -> leave the map where it is (unchanged).
 */
export function decideRvMapView(
  markerCount: number,
  originLat: number | null | undefined,
  originLng: number | null | undefined,
): RvMapView {
  if (markerCount > 0) return { kind: 'fit' };
  const lat = coord(originLat);
  const lng = coord(originLng);
  if (lat == null || lng == null) return { kind: 'none' };
  return { kind: 'centre', lat, lng, zoom: RV_ORIGIN_ZOOM };
}
