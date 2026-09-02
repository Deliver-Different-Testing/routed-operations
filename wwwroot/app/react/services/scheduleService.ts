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
 *  fetched on demand via scheduleService.detail(name, legacyClientId)
 *  when the operator opens the edit or copy modal. */
export interface ScheduleGroupSummary {
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
}

export interface ScheduleGroup {
  name: string | null;
  /** Populated for legacy per-client override rows only. Null for new
   *  schedules using the tblScheduleClient junction. */
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
  /** Legacy id-based path. Prefer clientCodes on write. */
  clientIds: number[];
  /** Preferred operator-facing path. Backend resolves each code -> id
   *  and merges with `clientIds`. Unknown codes throw. */
  clientCodes: string[];
  postcodeIds: number[];
  polygonIds: number[];
}

export interface ScheduleCopyBody {
  /** Group identity to copy from. */
  sourceName: string;
  /** Null for the default (junction) group; set for a legacy per-client override source. */
  sourceLegacyClientId: number | null;
  /** New group's name. Must differ from sourceName when the source is default. */
  newName: string;
  /** Client codes to bind on the copy (preferred). Empty = inherit source's clients. */
  clientCodes: string[];
}

export const scheduleService = {
  /** List schedule groups (slim summary shape). Pass clientCode
   *  (preferred - operators use codes like "ACME") or clientId. Omit
   *  both for the default view. Use detail(name, legacyClientId) to
   *  fetch the full group when opening an edit / copy modal. */
  list: (opts?: { clientCode?: string; clientId?: number }) =>
    request<{ response: ScheduleGroupSummary[] }>(
      `/schedules${buildQuery({ clientCode: opts?.clientCode, clientId: opts?.clientId })}`),
  /** Full detail for one group. Called on-demand from the table row
   *  click so the initial list load stays slim. */
  detail: (name: string, legacyClientId?: number | null) =>
    request<{ response: ScheduleGroup }>(
      `/schedules/detail${buildQuery({ name, legacyClientId: legacyClientId ?? undefined })}`),
  lookups: () => request<{ response: ScheduleLookups }>('/schedules/lookups'),
  upsert: (body: ScheduleGroupUpsertBody) =>
    request<{ response: ScheduleGroup }>('/schedules', {
      method: 'PUT', body: JSON.stringify(body),
    }),
  remove: (name: string, legacyClientId?: number | null) =>
    request<{ response: string }>(
      `/schedules${buildQuery({ name, legacyClientId: legacyClientId ?? undefined })}`,
      { method: 'DELETE' }),
  toggleAutoBook: (name: string, legacyClientId?: number | null) =>
    request<{ response: { autoBook: boolean } }>(
      `/schedules/auto-book${buildQuery({ name, legacyClientId: legacyClientId ?? undefined })}`,
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
