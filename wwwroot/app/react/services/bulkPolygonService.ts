import { request } from './api';

export interface PolygonPoint {
  /** 0 = the polygon's first ring. Multi-ring polygons use 1, 2, ... for
   *  holes and / or disjoint pieces. Winding order distinguishes hole vs
   *  outer (CCW = new outer piece, CW = hole of the preceding outer),
   *  matching Google Maps Polygon.setPaths() interpretation. Legacy
   *  pre-2026-08-06 rows are all ringIndex = 0. */
  ringIndex: number;
  orderIndex: number;
  lat: number;
  lng: number;
}

export interface BulkPolygonAttachedRoute {
  routeId: number;
  routeName: string;
}

export interface BulkPolygon {
  polygonId: number;
  name: string;
  /** 0 = Manual draw, 1 = seeded from a ZipPolygon. */
  sourceType: number;
  /** ZIP / postcode code when sourceType === 1; null when Manual. */
  sourceCode: string | null;
  centroidLatitude: number;
  centroidLongitude: number;
  active: boolean;
  points: PolygonPoint[];
  attachedRouteCount: number;
  /** Active routes this polygon is attached to (empty if unattached).
   *  Polygon Builder sidebar renders these as clickable links that
   *  jump into the route editor via `?edit=<routeId>` on the
   *  Recurring Routes page. */
  attachedRoutes: BulkPolygonAttachedRoute[];
  /** Comma-delimited zip list with leading + trailing commas, derived at
   *  save/reshape time by spatial overlay against ZipPolygon. Null when the
   *  overlay found zero intersections OR the polygon predates the feature. */
  partiallyIncludedZips: string | null;
  createdUtc: string;
  createdBy: string;
  lastModifiedUtc: string | null;
  updatedBy: string | null;
  /** Bindings (Phase 5 + 8). Populated on list + get; ignored on create/update. */
  zoneNameId: number | null;
  postcodeGroupId: number | null;
  attachedScheduleNames: string[];
  /** Resolved ZoneName.ZoneName1 for the zoneNameId binding. Null when
   *  unbound or the referenced row was deleted. Prefer this for chip
   *  labels; fall back to `zone #{zoneNameId}` when null but the id is set. */
  zoneNameName: string | null;
  /** Resolved BulkZonePostcodeGroup.Name for the postcodeGroupId binding.
   *  Null when unbound or the referenced row was deleted. */
  postcodeGroupName: string | null;
}

/** Parse the comma-delimited PartiallyIncludedZips string (with sentinel
 *  leading + trailing commas) into an ordered list. Empty-list-safe. */
export function parsePartiallyIncludedZips(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((z) => z.trim())
    .filter((z) => z.length > 0);
}

export interface CreateBulkPolygonBody {
  name: string;
  centroidLatitude: number;
  centroidLongitude: number;
  points: PolygonPoint[];
  sourceType?: number;
  sourceCode?: string | null;
}

export interface UpdateBulkPolygonShapeBody {
  centroidLatitude: number;
  centroidLongitude: number;
  points: PolygonPoint[];
}

export interface UpdateBulkPolygonMetaBody {
  name: string;
}

export const bulkPolygonService = {
  list: () => request<{ response: BulkPolygon[] }>('/bulk-polygons'),
  get: (id: number) => request<{ response: BulkPolygon }>(`/bulk-polygons/${id}`),
  create: (body: CreateBulkPolygonBody) =>
    request<{ response: BulkPolygon }>('/bulk-polygons', {
      method: 'POST', body: JSON.stringify(body),
    }),
  updateShape: (id: number, body: UpdateBulkPolygonShapeBody) =>
    request<{ response: BulkPolygon }>(`/bulk-polygons/${id}/shape`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  updateMeta: (id: number, body: UpdateBulkPolygonMetaBody) =>
    request<{ response: BulkPolygon }>(`/bulk-polygons/${id}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  remove: (id: number) =>
    request<{ response: string }>(`/bulk-polygons/${id}`, { method: 'DELETE' }),
};
