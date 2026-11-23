import type { BulkPolygon, PolygonAppCode } from '../services/bulkPolygonService';

/**
 * The polygons a picker for one app should list (perimeter spec 4.5).
 *
 * A polygon is listed when it is tagged for the app (tblBulkRunPolygonApp),
 * or when it is already attached to the object being edited (product
 * decision Q2). Without the second rule an existing schedule / zone that uses
 * an untagged polygon would render that attachment blank, and the next save
 * would silently drop it.
 *
 * The picker passes the UNFILTERED list (the same `bulkPolygonService.list()`
 * the Builder uses) so the attached rows are in hand without a second request.
 * A row with no `apps` field at all comes from a payload that predates the
 * tags and is kept, so nothing disappears when the field is missing; the API
 * always sends `apps` (empty array = used by no app).
 *
 * Order of the input is kept.
 */
export function polygonsForApp(
  polygons: readonly BulkPolygon[],
  app: PolygonAppCode,
  keepIds: Iterable<number> = [],
): BulkPolygon[] {
  const keep = new Set(keepIds);
  return polygons.filter((p) =>
    p.apps === undefined || p.apps.includes(app) || keep.has(p.polygonId));
}
