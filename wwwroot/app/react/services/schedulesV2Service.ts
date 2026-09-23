import { request, buildQuery } from './api';
import type { ScheduleGroup, ScheduleGroupSummary, ScheduleGroupUpsertBody } from './scheduleService';

// Client for /api/v2/schedules (Steve's 2026-09-08 id-keyed view).
// Reuses ScheduleGroupSummary from scheduleService.ts because the row
// shape is the same DTO; only the semantics of the listing differ
// (all-live + type/q filters here, IsDefault-only tuple-keyed there).
// When the BaseScheduleId + group tables land, override + group
// endpoints will live here too - the legacy /api/schedules controller
// stays frozen at its current surface.

export type SchedulesV2Type = 'all' | 'default' | 'shared';

export interface SchedulesV2Filters {
  type?: SchedulesV2Type;
  q?: string;
  /** Legacy single view-as-client. Kept for back-compat; `clientIds`
   *  wins when both are set. */
  clientId?: number | null;
  /** Multi-client view-as. Backend UNIONs the per-client resolution
   *  set - a schedule is bookable if it's bookable for ANY of the
   *  selected clients. Sent as CSV. */
  clientIds?: number[];
  /** 0-indexed page number. Only applies when `pageSize > 0`. */
  page?: number;
  /** Server-side pagination window. `0` = return everything (back-
   *  compat pre-2026-09-15). Setting a positive number switches the
   *  backend to the paged envelope. */
  pageSize?: number;
}

/** Server-paginated envelope returned by /api/v2/schedules?pageSize=. */
export interface SchedulesV2Page {
  rows: ScheduleGroupSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Bundle row for the Schedule Bundles tab. Shape mirrors
 *  ScheduleBundleDto on the backend. */
export interface ScheduleBundle {
  bundleId: number;
  name: string;
  description: string | null;
  isActive: boolean;
  scheduleCount: number;
  clientCount: number;
  scheduleIds: number[];
  scheduleNames: string[];
}

export const schedulesV2Service = {
  /** GET /api/v2/schedules?type=&q= - the Schedules tab list. */
  list: (filters?: SchedulesV2Filters) =>
    request<{ response: SchedulesV2Page }>(
      `/v2/schedules${buildQuery({
        type: filters?.type ?? 'all',
        q: filters?.q,
        clientId: filters?.clientId ?? undefined,
        clientIds: filters?.clientIds && filters.clientIds.length > 0
          ? filters.clientIds.join(',')
          : undefined,
        page: filters?.page ?? undefined,
        pageSize: filters?.pageSize ?? undefined,
      })}`,
    ).then((r) => r.response),

  /** GET /api/v2/schedule-bundles - Dane's bundle-of-schedules concept.
   *  Returns empty until the 20260914140000 migration applies (the
   *  underlying tables don't exist pre-migration). Renamed 2026-09-22
   *  from /schedule-groups per Steve F18. */
  listBundles: () =>
    request<{ response: ScheduleBundle[] }>('/v2/schedule-bundles')
      .then((r) => r.response),

  /** GET /api/v2/schedules/{id} - one schedule with day windows,
   *  linehauls, zones, junction client ids + codes. Reuses the same
   *  ScheduleGroup DTO the legacy /api/schedules/detail returns; the
   *  modal renders a read-only slice for Phase 1. */
  getById: (scheduleId: number) =>
    request<{ response: ScheduleGroup }>(
      `/v2/schedules/${scheduleId}`,
    ).then((r) => r.response),

  /** GET /api/v2/schedules/{id}/overrides - every client's delta on
   *  this schedule. One entry per client with schedule / collection /
   *  delivery scope blocks. Clients with no delta rows are excluded.
   *  Backed by tblBulkRunScheduleOverride (Steve F1 2026-09-22). */
  listOverrides: (scheduleId: number) =>
    request<{ response: ScheduleOverride[] }>(
      `/v2/schedules/${scheduleId}/overrides`,
    ).then((r) => r.response),

  /** GET /api/v2/clients/{clientId}/overrides - every schedule this
   *  client owns a delta on. Compact list; the details are on the
   *  schedule's Client Overrides tab. */
  clientOverrides: (clientId: number) =>
    request<{ response: ClientOverrideRef[] }>(
      `/v2/clients/${clientId}/overrides`,
    ).then((r) => r.response),

  /** POST /api/v2/schedules/{id}/clients - attach one or more clients. */
  attachClients: (scheduleId: number, clientIds: number[]) =>
    request<{ response: { added: number } }>(
      `/v2/schedules/${scheduleId}/clients`,
      { method: 'POST', body: JSON.stringify({ clientIds }) },
    ).then((r) => r.response),

  /** DELETE /api/v2/schedules/{id}/clients/{clientId} - detach one client. */
  detachClient: (scheduleId: number, clientId: number) =>
    request<{ response: { removed: number } }>(
      `/v2/schedules/${scheduleId}/clients/${clientId}`,
      { method: 'DELETE' },
    ).then((r) => r.response),

  /** PUT /api/v2/schedules/{id}/overrides/{clientId} - full replace of
   *  one client's delta on this schedule. An empty body deletes every
   *  scope for the client (returns to base schedule). Steve F1. */
  putOverride: (scheduleId: number, clientId: number, body: ScheduleOverridePutBody) =>
    request<{ response: ScheduleOverride | null }>(
      `/v2/schedules/${scheduleId}/overrides/${clientId}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ).then((r) => r.response),

  /** DELETE /api/v2/schedules/{id}/overrides/{clientId} - remove every
   *  delta row for this client on this schedule. Client returns to the
   *  base. Steve F1. */
  deleteOverride: (scheduleId: number, clientId: number) =>
    request<{ response: { deleted: boolean } }>(
      `/v2/schedules/${scheduleId}/overrides/${clientId}`,
      { method: 'DELETE' },
    ).then((r) => r.response),

  /** POST /api/v2/schedules - create a fresh schedule (header + day rows + junctions). */
  create: (body: ScheduleGroupUpsertBody) =>
    request<{ response: ScheduleGroup }>(
      '/v2/schedules',
      { method: 'POST', body: JSON.stringify({ ...body, scheduleId: undefined }) },
    ).then((r) => r.response),

  /** PUT /api/v2/schedules/{id} - update existing schedule (path id wins). */
  update: (scheduleId: number, body: ScheduleGroupUpsertBody) =>
    request<{ response: ScheduleGroup }>(
      `/v2/schedules/${scheduleId}`,
      { method: 'PUT', body: JSON.stringify({ ...body, scheduleId }) },
    ).then((r) => r.response),

  /** PUT /api/v2/schedules/{id}/clients - full replace of link rows. */
  replaceClients: (scheduleId: number, clientIds: number[]) =>
    request<{ response: { added: number; removed: number } }>(
      `/v2/schedules/${scheduleId}/clients`,
      { method: 'PUT', body: JSON.stringify({ clientIds }) },
    ).then((r) => r.response),

  /** POST /api/v2/schedules/{id}/retire - soft-delete the schedule. */
  retire: (scheduleId: number) =>
    request<{ response: string }>(
      `/v2/schedules/${scheduleId}/retire`,
      { method: 'POST' },
    ).then((r) => r.response),

  /** POST /api/v2/schedules/{id}/is-active - set the header IsActive
   *  flag directly (not a toggle - caller sends the desired state).
   *  Independent of `autoBook`. Steve F21 (2026-09-22). */
  toggleIsActive: (scheduleId: number, isActive: boolean) =>
    request<{ response: { isActive: boolean } }>(
      `/v2/schedules/${scheduleId}/is-active`,
      { method: 'POST', body: JSON.stringify({ isActive }) },
    ).then((r) => r.response),

  /** POST /api/v2/schedule-bundles - create a Schedule Bundle. */
  createBundle: (body: { name: string; description?: string; scheduleIds: number[] }) =>
    request<{ response: { bundleId: number } }>(
      '/v2/schedule-bundles',
      { method: 'POST', body: JSON.stringify(body) },
    ).then((r) => r.response),

  /** DELETE /api/v2/schedule-bundles/{id} - hard-delete. */
  deleteBundle: (bundleId: number) =>
    request<{ response: string }>(
      `/v2/schedule-bundles/${bundleId}`,
      { method: 'DELETE' },
    ).then((r) => r.response),

  /** POST /api/v2/schedule-bundles/{id}/clients - attach clients to
   *  every non-default member schedule of the bundle. */
  attachClientsToBundle: (bundleId: number, clientIds: number[]) =>
    request<{ response: { added: number } }>(
      `/v2/schedule-bundles/${bundleId}/clients`,
      { method: 'POST', body: JSON.stringify({ clientIds }) },
    ).then((r) => r.response),

  /** POST /api/v2/schedules/{id}/copy - clone a schedule. */
  copy: (scheduleId: number, newName: string, clientIds: number[] = []) =>
    request<{ response: { scheduleId: number } }>(
      `/v2/schedules/${scheduleId}/copy`,
      { method: 'POST', body: JSON.stringify({ newName, clientIds }) },
    ).then((r) => r.response),

  /** PUT /api/v2/schedule-bundles/{id} - rename / redescribe. */
  updateBundle: (bundleId: number, body: { name: string; description?: string }) =>
    request<{ response: string }>(
      `/v2/schedule-bundles/${bundleId}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ).then((r) => r.response),

  /** GET /api/v2/clients/{clientId}/schedules - what can this client
   *  actually book, per Steve's §5 resolution rule. Each row is tagged
   *  "override" / "shared" / "default". */
  clientSchedules: (clientId: number) =>
    request<{ response: ClientSchedule[] }>(
      `/v2/clients/${clientId}/schedules`,
    ).then((r) => r.response),

  /** POST /api/v2/schedule-bundles/{id}/members - add schedules. */
  addBundleMembers: (bundleId: number, scheduleIds: number[]) =>
    request<{ response: { added: number } }>(
      `/v2/schedule-bundles/${bundleId}/members`,
      { method: 'POST', body: JSON.stringify({ scheduleIds }) },
    ).then((r) => r.response),

  /** DELETE /api/v2/schedule-bundles/{id}/members/{scheduleId}. */
  removeBundleMember: (bundleId: number, scheduleId: number) =>
    request<{ response: { removed: number } }>(
      `/v2/schedule-bundles/${bundleId}/members/${scheduleId}`,
      { method: 'DELETE' },
    ).then((r) => r.response),
};

/** Schedule-scope delta fields (cut-off + weekdays + display copy).
 *  Every field is nullable: NULL means "inherit from base". */
export interface ScheduleScopeOverride {
  cutoffHours: number | null;
  cutoffDay: number | null;
  cutoffTime: string | null;
  weekDays: string | null;
  isActive: boolean | null;
  displayName: string | null;
  displayDescription: string | null;
}

/** Leg-scope delta fields (used for both collection and delivery). */
export interface LegScopeOverride {
  speedId: number | null;
  zoneGroupId: number | null;
  pickupTimeMode: string | null;
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  additionalItemChargingLogic: string | null;
}

/** One client's full delta on one schedule (Steve F1 2026-09-22).
 *  Rendered as a per-client card in the schedule's Client Overrides
 *  tab. Any of the three scope blocks may be null. */
export interface ScheduleOverride {
  scheduleId: number;
  clientId: number;
  clientCode: string | null;
  clientName: string | null;
  schedule: ScheduleScopeOverride | null;
  collection: LegScopeOverride | null;
  delivery: LegScopeOverride | null;
  updatedUtc: string;
  updatedBy: string | null;
}

/** PUT body for /v2/schedules/{id}/overrides/{clientId}. Every scope
 *  block may be null (removes that scope's row); an empty body deletes
 *  the client's override entirely. */
export interface ScheduleOverridePutBody {
  schedule: ScheduleScopeOverride | null;
  collection: LegScopeOverride | null;
  delivery: LegScopeOverride | null;
}

/** One row from GET /v2/clients/{clientId}/overrides. Feeds the
 *  client-first "differs from N schedules" view. */
export interface ClientOverrideRef {
  scheduleId: number;
  scheduleName: string;
  scopes: string[];
  updatedUtc: string;
}

/** One row from GET /v2/clients/{clientId}/schedules. Tags each
 *  bookable schedule with why per Steve's §5 resolution rule. */
export interface ClientSchedule {
  scheduleId: number;
  name: string;
  source: 'override' | 'shared' | 'default';
}
