import { request } from './api';

/** Feature 5.1 `Routes.Direction`. Numbers, not a string union, because the
 *  column is tinyint and `CK_Routes_Direction` is the authority on what is
 *  valid. */
export const RouteDirection = {
  /** Collect from the customer. Every route that existed before Feature 5. */
  FirstMile: 1,
  /** Fan out from one origin to the drop. */
  FinalMile: 2,
} as const;
export type RouteDirectionValue = (typeof RouteDirection)[keyof typeof RouteDirection];

/** Where a final-mile route fans out from when the origin is an ADDRESS
 *  rather than a depot. Grouped because the six fields move together:
 *  a final-mile route needs a depot OR a complete coordinate pair, so
 *  "has an address origin" is one decision rather than six.
 *
 *  `radiusM` is METRES. Null means the resolver applies its own 5000 m
 *  default. */
export interface RouteOrigin {
  name: string | null;
  address: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  radiusM: number | null;
}

/** K6: one suggestion for the final-mile origin address box, built from
 *  pickup addresses this tenant has actually used in the last 180 days.
 *
 *  Coordinates are from the most recent job at that address, not an average:
 *  the same company + zip carries several distinct points in the data because
 *  a linehaul child leg stores its own leg's pickup point. Picking a
 *  suggestion therefore fills the origin AND locates it, with no geocode
 *  round-trip. */
export interface PickupAddressSuggestion {
  label: string;
  company: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  usageCount: number;
  lastUsedUtc: string | null;
}

export interface RouteZipcode {
  zipPolygonId: number;
  zip: string;
}

export interface RouteScheduleRef {
  scheduleId: number;
  name: string;
  window: string;
  days: number[];
}

export interface RecurringRoute {
  routeId: number;
  name: string;
  area: string;
  defaultTargetType: number | null;   // 1=Courier, 2=Agent, 3=NetworkPartner
  defaultTargetId: number | null;
  defaultTargetName: string;
  /** @deprecated Legacy 1:1 pointer. Use `schedules` for the full bound list.
   *  Retained for readback of the primary (first) schedule. */
  scheduleId: number | null;
  /** @deprecated Legacy display; falls back to the primary schedule's name. */
  scheduleName: string;
  /** @deprecated Legacy display; falls back to the primary schedule's window. */
  scheduleWindow: string;
  /** Full M:N list of bound schedules (may be empty). */
  schedules: RouteScheduleRef[];
  active: boolean;
  zipcodes: RouteZipcode[];
  bulkPolygons: RouteBulkPolygonRef[];
  rosterEntryCount: number;
  /** Live recurring bookings currently bound to this route. */
  bookingCount: number;
  /** Materialised jobs currently bound to this route (Mapped Stops count). */
  mappedStopsCount: number;
  createdAt: string;
  updatedAt: string | null;
  /** Feature 5.1. 1 = first mile, 2 = final mile. Every pre-existing route
   *  reads 1 because the column defaults to it. */
  direction: RouteDirectionValue;
  /** Depot a final-mile route fans out from (tblBulkRegion.BulkRegionId).
   *  Null on a first-mile route and on a final-mile route with an address
   *  origin. */
  depotId: number | null;
  /** Resolved depot name, empty string when depotId is null. */
  depotName: string;
  /** Null when the route carries no address origin at all. */
  origin: RouteOrigin | null;
}

/** One live recurring booking bound to a route. Populated by
 *  `recurringRouteService.getBookings(routeId)` — lazy-loaded on
 *  expand of the "Bookings on this route" section in the edit modal. */
export interface RouteBooking {
  id: number;
  clientName: string;
  pickupWindow: string;
  days: string;
  nextDue: string | null;
}

export interface UpsertRouteBody {
  name: string;
  area: string;
  defaultTargetType: number | null;
  defaultTargetId: number | null;
  /** M:N bound schedules. Empty array clears every binding. */
  scheduleIds: number[];
  active: boolean;
  zipPolygonIds: number[];
  /** Optional. Omit to keep existing bulk polygons untouched; empty array clears them. */
  bulkPolygonIds?: number[];
  /** Feature 5.1. Omit to create a first-mile route, which is what every
   *  caller did before this existed. */
  direction?: RouteDirectionValue;
  /** Only meaningful with direction = FinalMile. */
  depotId?: number | null;
  /** Only meaningful with direction = FinalMile. The server clears every
   *  origin field when direction is FirstMile, so a route flipped back to
   *  first mile cannot silently inherit an old address later. */
  origin?: RouteOrigin | null;
}

export interface RouteBulkPolygonRef {
  polygonId: number;
  name: string;
  centroidLatitude: number;
  centroidLongitude: number;
}

export interface CopyRouteBody {
  name: string;
  defaultTargetType?: number | null;
  defaultTargetId?: number | null;
  /** Null = inherit source's schedules; empty array = start with none;
   *  non-empty = start with those. */
  scheduleIds?: number[] | null;
  copyZipcodes: boolean;
}

export interface ZipcodeLookup {
  zipPolygonId: number;
  zip: string;
  latitude: number | null;
  longitude: number | null;
}

export interface ZipPolygonShape {
  zipPolygonId: number;
  zip: string;
  latitude: number | null;
  longitude: number | null;
  wkt: string;
}

export type AssignTargetType = 'Courier' | 'Agent' | 'NetworkPartner';

export interface AssignableTarget {
  id: number;
  name: string;
  hint: string;
}

export interface AssignableTargets {
  couriers: AssignableTarget[];
  agents: AssignableTarget[];
  nps: AssignableTarget[];
}

export interface RouteRosterEntry {
  routeRosterId: number;
  routeId: number;
  targetType: number | null;
  targetId: number | null;
  targetName: string;
  rosterDate: string | null;
  dayOfWeek: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface UpsertRosterBody {
  targetType: number;
  targetId: number;
  rosterDate?: string | null;
  dayOfWeek?: number | null;
}

export interface ScheduleLookup {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  days: number[];
}

export const recurringRouteService = {
  list: () => request<{ response: RecurringRoute[] }>('/recurring-routes'),
  get: (id: number) => request<{ response: RecurringRoute }>(`/recurring-routes/${id}`),
  create: (body: UpsertRouteBody) =>
    request<{ response: RecurringRoute }>('/recurring-routes', {
      method: 'POST', body: JSON.stringify(body),
    }),
  update: (id: number, body: UpsertRouteBody) =>
    request<{ response: RecurringRoute }>(`/recurring-routes/${id}`, {
      method: 'PUT', body: JSON.stringify(body),
    }),
  copy: (sourceId: number, body: CopyRouteBody) =>
    request<{ response: RecurringRoute }>(`/recurring-routes/${sourceId}/copy`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  remove: (id: number) =>
    request<{ response: string }>(`/recurring-routes/${id}`, { method: 'DELETE' }),

  getBookings: (routeId: number) =>
    request<{ response: RouteBooking[] }>(`/recurring-routes/${routeId}/bookings`),

  getRoster: (routeId: number) =>
    request<{ response: RouteRosterEntry[] }>(`/recurring-routes/${routeId}/roster`),
  addRoster: (routeId: number, body: UpsertRosterBody) =>
    request<{ response: RouteRosterEntry }>(`/recurring-routes/${routeId}/roster`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  removeRoster: (routeId: number, rosterId: number) =>
    request<{ response: string }>(`/recurring-routes/${routeId}/roster/${rosterId}`, {
      method: 'DELETE',
    }),

  searchZipcodes: (q: string, max = 25) =>
    request<{ response: ZipcodeLookup[] }>(`/recurring-routes/zipcodes/search?q=${encodeURIComponent(q)}&max=${max}`),
  /** Every zip's id + code + centroid, no shape data. Used to seed the
   *  on-map marker layer at Polygon Builder load. Cache client-side; the
   *  per-zip WKT still comes on demand from getPolygonShapes. */
  getAllZipcodeCentroids: () =>
    request<{ response: ZipcodeLookup[] }>('/recurring-routes/zipcodes/centroids'),
  getPolygonShapes: (zipPolygonIds: number[]) =>
    request<{ response: ZipPolygonShape[] }>('/recurring-routes/zipcodes/shapes', {
      method: 'POST', body: JSON.stringify(zipPolygonIds),
    }),
  getAssignableTargets: () =>
    request<{ response: AssignableTargets }>('/recurring-routes/assignable-targets'),
  /** K6 autocomplete for the final-mile origin address. `q` filters on
   *  company / city / zip; empty returns the most-used recent addresses. */
  getPickupAddressSuggestions: (q?: string, max = 15) =>
    request<{ response: PickupAddressSuggestion[] }>(
      `/recurring-routes/pickup-address-suggestions?q=${encodeURIComponent(q ?? '')}&max=${max}`,
    ),

  getSchedules: () =>
    request<{ response: ScheduleLookup[] }>('/recurring-routes/schedules/lookup'),
};
