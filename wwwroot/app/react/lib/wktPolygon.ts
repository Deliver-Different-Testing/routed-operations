export interface LatLng { lat: number; lng: number; }

/** Parse a WKT POLYGON string into a LatLng ring (first ring only, holes
 *  ignored). Returns null when the string is missing or malformed. WKT
 *  coordinate order is (lng lat); we swap to (lat, lng) for Google Maps. */
export function parseWktPolygon(wkt: string | null | undefined): LatLng[] | null {
  if (!wkt) return null;
  const upper = wkt.toUpperCase();
  const start = upper.indexOf('((');
  const end = upper.indexOf('))');
  if (start < 0 || end < 0) return null;
  const body = wkt.substring(start + 2, end);
  const firstRing = body.split(')')[0].replace(/\(/g, '').trim();
  const pairs = firstRing.split(',').map((p) => p.trim());
  const path: LatLng[] = [];
  for (const pair of pairs) {
    const [lng, lat] = pair.split(/\s+/).map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) path.push({ lat, lng });
  }
  return path;
}
