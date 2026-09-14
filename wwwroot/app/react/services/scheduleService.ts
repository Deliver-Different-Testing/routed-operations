import { request, buildQuery } from './api';

// Wire shapes for /api/schedules (group-shaped). Mirror the C# DTOs in
// RoutedOperations.Core.Application.Dtos.Schedule.ScheduleDtos. A
// schedule "group" is identified by Name (plus a legacy nullable
// clientId for pre-junction rows). Each group holds N day-window rows
// plus three junction id-lists (clients / postcodes / polygons).

export interface DayWindow {
  /** Existing BulkRunScheduleId; null for a freshly-added window. */
  id: number | null;
  /** 1 = Monday, 7 = Sunday (ISO). */
  dayOfWeek: number;
  /** "HH:mm" e.g. "08:30". */
  startTime: string;
  endTime: string;
  cutoffHours: number;
}

export interface ScheduleZone {
  id: number;
  scheduleId: number | null;
  zone: number;
  active: boolean | null;
}

export interface ScheduleLinehaul {
  id: number;
  name: string | null;
  active: boolean | null;
  amount: number | null;
  amountPercentage: number | null;
  fromDepotId: number | null;
  toDepotId: number | null;
  minutes: number | null;
  linehaulRunId: number | null;
  insertToBulk: boolean | null;
  applyDiscount: boolean | null;
  applyAddOnPercentage: boolean | null;
  weekDay: number[];
  departureAdvanceDays: number | null;
  fromClientAddress: boolean | null;
  dropOffLocationId: number | null;
}

/** Slim projection returned by GET /schedules for the list table.
 *  Detail (full day-windows / zones / linehauls / junction ids) is
 *  fetched on demand via scheduleService.detail(scheduleId) when the
 *  operator opens the edit or copy modal. */
export interface ScheduleGroupSummary {
  /** Header PK (BulkRunScheduleHeader.BulkRunScheduleId). Introduced
   *  2026-09-08 alongside the header table. Use as the schedule
   *  identity everywhere in the frontend. */
  scheduleId: number;
  name: string | null;
  legacyClientId: number | null;
  legacyClientCode: string | null;
  regionId: number;
  regionName: string | null;
  speedId: number | null;
  speedName: string | null;
  /** Active DayOfWeek values (1=Mon..7=Sun), ordered ascending.
   *  Frontend renders the M-T-W-T-F-S-S chip strip from this. */
  activeDays: number[];
  activeZonesCount: number;
  clientCount: number;
  postcodeCount: number;
  polygonCount: number;
  autoBook: boolean | null;
  hasActiveLinehaul: boolean;
  /** Up to 3 currently-linked client codes (alphabetical) for the row
   *  chip strip. Full count is `clientCount`; row renders "+N more" if
   *  `clientCount > linkedClientCodes.length`. Empty on default
   *  schedules that no client has been explicitly bound to. */
  linkedClientCodes: string[];
  /** Self-FK from tblBulkRunScheduleHeader.BaseScheduleId. Non-null on
   *  override headers, pointing at the base they refine. NULL on base
   *  headers. The Schedules NEW view nests overrides under their base
   *  by grouping on this. Ships as null on every row until the
   *  20260914140000 migration applies. */
  baseScheduleId: number | null;
  // Steve's 2026-09-08 Schedules NEW view extras. Populated by
  // /api/v2/schedules. Legacy /api/schedules returns them nulled /
  // zero so existing consumers are unaffected.
  description: string | null;
  pickupDepotId: number | null;
  pickupDepotName: string | null;
  /** "HH:mm" - earliest StartTime across day rows. */
  windowStart: string | null;
  /** "HH:mm" - latest EndTime across day rows. */
  windowEnd: string | null;
  /** Monday cut-off hours. Null if the schedule doesn't run Mon. */
  monCutoffHours: number | null;
  /** Other-days cut-off. Null when identical to Monday's value. */
  otherCutoffHours: number | null;
  /** Overrides bound to this ScheduleId. Rendered as "+N" next to Name. */
  overrideCount: number;
  /** Recurring routes bound to any day row. Rendered as "N routes" blue chip. */
  routeCount: number;
  /** Compact linehaul chip, e.g. "LH AUC-CHR 21:30". Null when no
   *  active linehaul leg. */
  linehaulHint: string | null;
}

export interface ScheduleGroup {
  /** Header PK (BulkRunScheduleHeader.BulkRunScheduleId). Introduced
   *  2026-09-08 alongside the header table. Use as the schedule
   *  identity for detail/update/delete/copy calls. */
  scheduleId: number;
  name: string | null;
  /** Populated for legacy per-client override rows only. Null for new
   *  schedules using the tblScheduleClient junction. Informational
   *  only from 2026-09-08 - the link table is the source of truth. */
  legacyClientId: number | null;
  /** Resolved client code (e.g. "ACME"). Null when legacyClientId is null.
   *  Prefer this over legacyClientId for any operator-visible label. */
  legacyClientCode: string | null;
  regionId: number;
  regionName: string | null;
  pickupDepotId: number | null;
  pickupDepotName: string | null;
  speedId: number | null;
  speedName: string | null;
  parentSpeedId: number | null;
  parentSpeedName: string | null;
  postcodeGroupId: number | null;
  postcodeGroupName: string | null;
  pickupPostcodeGroupId: number | null;
  pickupPostcodeGroupName: string | null;
  pickupRatingSpeed: number | null;
  autoBook: boolean | null;
  bookPickup: boolean | null;
  applyPickupCutoff: boolean | null;
  pickupCutoff: number | null;
  storageState: number | null;
  deliveryState: number | null;
  pickupBoxDiscount: number | null;
  dropOffLocationId: number | null;
  dropOffLocationName: string | null;
  description: string | null;
  dayWindows: DayWindow[];
  zones: ScheduleZone[];
  linehauls: ScheduleLinehaul[];
  clientIds: number[];
  /** Resolved client codes, same order as clientIds. Prefer these for display. */
  clientCodes: string[];
  postcodeIds: number[];
  polygonIds: number[];
}

export interface LookupItem {
  id: number;
  name: string;
}
export interface DropOffLocationLookup { id: number; name: string; depotId: number; }
export interface PostcodeGroupLookup { id: number; name: string; depotId: number | null; clientId: number | null; }
export interface LinehaulRunLookup {
  id: number;
  runName: string;
  fromDepotId: number | null;
  toDepotId: number | null;
  startTime: string | null;
  despatchTime: string | null;
  courierId: number | null;
}
export interface StateOption { id: number; label: string; }
export interface ScheduleLookups {
  depots: LookupItem[];
  speeds: LookupItem[];
  couriers: LookupItem[];
  /** Active clients for the multi-client picker (capped at 500 per tenant). */
  clients: LookupItem[];
  dropOffLocations: DropOffLocationLookup[];
  postcodeGroups: PostcodeGroupLookup[];
  linehaulRuns: LinehaulRunLookup[];
  zoneNumbers: number[];
  storageStates: StateOption[];
  deliveryStates: StateOption[];
  pickupBoxDiscounts: StateOption[];
}

export interface ScheduleGroupUpsertBody {
  /** Present = update existing header; absent = create fresh header +
   *  day rows. Populate from ScheduleGroup.scheduleId on edit. */
  scheduleId?: number | null;
  name: string;
  description: string | null;
  regionId: number;
  pickupDepotId: number | null;
  speedId: number | null;
  parentSpeedId: number | null;
  autoBook: boolean | null;
  bookPickup: boolean | null;
  applyPickupCutoff: boolean | null;
  pickupCutoff: number | null;
  postcodeGroupId: number | null;
  pickupPostcodeGroupId: number | null;
  pickupRatingSpeed: number | null;
  storageState: number | null;
  deliveryState: number | null;
  pickupBoxDiscount: number | null;
  dropOffLocationId: number | null;
  dayWindows: Array<{
    id: number | null;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    cutoffHours: number;
  }>;
  zones: Array<{ zone: number; active: boolean | null }>;
  linehauls: Array<{
    name: string | null;
    active: boolean | null;
    amount: number | null;
    amountPercentage: number | null;
    fromDepotId: number | null;
    toDepotId: number | null;
    minutes: number | null;
    linehaulRunId: number | null;
    insertToBulk: boolean | null;
    applyDiscount: boolean | null;
    applyAddOnPercentage: boolean | null;
    weekDay: number[];
    departureAdvanceDays: number | null;
    fromClientAddress: boolean | null;
    dropOffLocationId: number | null;
  }>;
  /** Legacy id-based fallback. Only used when `clientCodes` is absent
   *  from the request body (e.g. API callers that don't have code
   *  strings). Operator writes always send `clientCodes` and this
   *  array is ignored. */
  clientIds: number[];
  /** Operator-facing path AND authoritative desired set. When present
   *  (even as an empty array) it REPLACES the client link set wholesale
   *  - anything not in this array is unbound. Chip picker toggles by
   *  code. Unknown codes throw. */
  clientCodes: string[];
  postcodeIds: number[];
  polygonIds: number[];
}

export interface ScheduleCopyBody {
  /** Source header id. Preferred (matches the ScheduleGroup.scheduleId
   *  the operator just clicked). Backend still accepts sourceName +
   *  sourceLegacyClientId as a legacy fallback for one release. */
  sourceScheduleId: number;
  /** New group's name. Must differ from source's name when the source
   *  is a default group. */
  newName: string;
  /** Client codes to bind on the copy (preferred). Empty = inherit
   *  source's link rows. */
  clientCodes: string[];
}

export const scheduleService = {
  /** List schedule groups (slim summary shape). Pass clientCode
   *  (preferred - operators use codes like "ACME") or clientId. Omit
   *  both for the default view. `includeClientSpecific=true` widens
   *  the default view to also include groups with a client binding
   *  (legacy or junction) so the Schedules tab search can find any
   *  group by name; ignored when either client filter is set. Use
   *  detail(name, legacyClientId) to fetch the full group when opening
   *  an edit / copy modal. */
  list: (opts?: { clientCode?: string; clientId?: number; includeClientSpecific?: boolean }) =>
    request<{ response: ScheduleGroupSummary[] }>(
      `/schedules${buildQuery({
        clientCode: opts?.clientCode,
        clientId: opts?.clientId,
        includeClientSpecific: opts?.includeClientSpecific ? 'true' : undefined,
      })}`),
  /** Full detail for one group. Called on-demand from the table row
   *  click so the initial list load stays slim. */
  detail: (scheduleId: number) =>
    request<{ response: ScheduleGroup }>(
      `/schedules/detail${buildQuery({ scheduleId })}`),
  lookups: () => request<{ response: ScheduleLookups }>('/schedules/lookups'),
  upsert: (body: ScheduleGroupUpsertBody) =>
    request<{ response: ScheduleGroup }>('/schedules', {
      method: 'PUT', body: JSON.stringify(body),
    }),
  remove: (scheduleId: number) =>
    request<{ response: string }>(
      `/schedules${buildQuery({ scheduleId })}`,
      { method: 'DELETE' }),
  toggleAutoBook: (scheduleId: number) =>
    request<{ response: { autoBook: boolean } }>(
      `/schedules/auto-book${buildQuery({ scheduleId })}`,
      { method: 'POST' }),
  copy: (body: ScheduleCopyBody) =>
    request<{ response: ScheduleGroup }>('/schedules/copy', {
      method: 'POST', body: JSON.stringify(body),
    }),
  /** Server-side client type-ahead. Substring LIKE on code + name.
   *  Use this instead of filtering `lookups.clients` client-side -
   *  the lookups payload is capped and can miss codes that fall
   *  outside the alphabetic cutoff on large tenants. */
  searchClients: (q: string, limit = 50) =>
    request<{ response: LookupItem[] }>(
      `/schedules/clients${buildQuery({ q: q || undefined, limit })}`),
};
