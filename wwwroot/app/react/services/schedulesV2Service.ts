import { request, buildQuery } from './api';
import type { ScheduleGroup, ScheduleGroupSummary } from './scheduleService';

// Client for /api/v2/schedules (Steve's 2026-09-08 id-keyed view).
// Reuses ScheduleGroupSummary from scheduleService.ts because the row
// shape is the same DTO; only the semantics of the listing differ
// (all-live + type/q filters here, IsDefault-only tuple-keyed there).
// When the BaseScheduleId + group tables land, override + group
// endpoints will live here too - the legacy /api/schedules controller
// stays frozen at its current surface.

export type SchedulesV2Type = 'all' | 'default' | 'shared' | 'override';

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
}

/** Bundle row for the Schedule Groups tab. Shape mirrors
 *  ScheduleGroupBundleDto on the backend. */
export interface ScheduleGroupBundle {
  groupId: number;
  name: string;
  description: string | null;
  isActive: boolean;
  scheduleCount: number;
  clientCount: number;
  scheduleIds: number[];
  scheduleNames: string[];
}

export const schedulesV2Service = {
  /** GET /api/v2/schedules?type=&q= - the Schedules tab list.
   *  `type=override` returns empty today; the BaseScheduleId column
   *  has not shipped yet and the controller short-circuits so the UI
   *  can render an empty state rather than a schema error. */
  list: (filters?: SchedulesV2Filters) =>
    request<{ response: ScheduleGroupSummary[] }>(
      `/v2/schedules${buildQuery({
        type: filters?.type ?? 'all',
        q: filters?.q,
        clientId: filters?.clientId ?? undefined,
        clientIds: filters?.clientIds && filters.clientIds.length > 0
          ? filters.clientIds.join(',')
          : undefined,
      })}`,
    ).then((r) => r.response),

  /** GET /api/v2/schedule-groups - Dane's bundle-of-schedules concept.
   *  Returns empty until the 20260914140000 migration applies (the
   *  underlying tables don't exist pre-migration). */
  listGroups: () =>
    request<{ response: ScheduleGroupBundle[] }>('/v2/schedule-groups')
      .then((r) => r.response),

  /** GET /api/v2/schedules/{id} - one schedule with day windows,
   *  linehauls, zones, junction client ids + codes. Reuses the same
   *  ScheduleGroup DTO the legacy /api/schedules/detail returns; the
   *  modal renders a read-only slice for Phase 1. */
  getById: (scheduleId: number) =>
    request<{ response: ScheduleGroup }>(
      `/v2/schedules/${scheduleId}`,
    ).then((r) => r.response),

  /** GET /api/v2/schedules/{id}/overrides - lightweight list of the
   *  overrides pointing at this base + the client each owns. Powers
   *  the AttachClientsModal's "has own override #<id>" hint. */
  listOverrides: (scheduleId: number) =>
    request<{ response: OverrideRef[] }>(
      `/v2/schedules/${scheduleId}/overrides`,
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

  /** POST /api/v2/schedules/{id}/overrides - create a client override. */
  createOverride: (scheduleId: number, clientId: number) =>
    request<{ response: { scheduleId: number } }>(
      `/v2/schedules/${scheduleId}/overrides`,
      { method: 'POST', body: JSON.stringify({ clientId }) },
    ).then((r) => r.response),

  /** POST /api/v2/schedules/{id}/retire - soft-delete the schedule. */
  retire: (scheduleId: number) =>
    request<{ response: string }>(
      `/v2/schedules/${scheduleId}/retire`,
      { method: 'POST' },
    ).then((r) => r.response),
};

/** Shape of one override reference returned by
 *  GET /v2/schedules/{id}/overrides. */
export interface OverrideRef {
  scheduleId: number;
  clientId: number;
  clientCode: string | null;
}
