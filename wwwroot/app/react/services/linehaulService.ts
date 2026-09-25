import { request, ApiError } from './api';
import type { AssignTargetType } from './recurringRouteService';

// Recurring Routes Linehaul port. Backs the Linehaul + Linehaul Roster tabs.
// Endpoints under /api/recurring-linehaul-runs and /api/recurring-linehaul-rosters.

export const LinehaulMode = { Road: 1, Flight: 2 } as const;
export type LinehaulModeValue = (typeof LinehaulMode)[keyof typeof LinehaulMode];

export interface TenantLinehaulRun {
  id: number;
  runName: string;
  fromDepotId: number;
  toDepotId: number;
  fromDepotName: string;
  toDepotName: string;
  startTime: string | null;
  despatchTime: string | null;
  courierId: number | null;
  defaultDriverName: string | null;
  defaultAgentId: number | null;
  defaultTargetType: AssignTargetType | null;
  defaultTargetId: number | null;
  defaultTargetName: string | null;
  defaultTargetHint: string | null;
  speedId: number | null;
  mode: LinehaulModeValue;
  masterBookingId: number | null;
  masterBookingLabel: string | null;
  mappedStopsCount: number;
  usedBySchedulesCount: number;
  active: boolean;
}

export interface TenantLinehaulRunUpsert {
  runName: string;
  fromDepotId: number;
  toDepotId: number;
  startTime: string | null;
  despatchTime: string | null;
  defaultTargetType: AssignTargetType | null;
  defaultTargetId: number | null;
  speedId: number | null;
  mode: LinehaulModeValue;
  masterBookingId: number | null;
}

export interface TenantLinehaulBookingLookup {
  bookingId: number;
  jobNumber: string;
  jobName: string | null;
  clientName: string | null;
  pickupSummary: string | null;
  deliverySummary: string | null;
  linkedRunId: number | null;
  isMaster: boolean;
  linkedToThisRun: boolean;
}

export interface DepotLookup {
  id: number;
  name: string;
}

export interface LinehaulCourierLookup {
  id: number;
  name: string;
  code: string;
}

export interface LinehaulLookups {
  depots: DepotLookup[];
  couriers: LinehaulCourierLookup[];
}

export interface LinehaulScheduleBinding {
  scheduleId: number | null;
  name: string;
  active: boolean;
  weekDay: string | null;
}

// Surfaces the API's `{ message }` body (validation 400 / blocked-delete 409)
// so the UI can show the server's reason instead of a generic failure.
export function extractLinehaulError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    const body = e.body as { message?: string } | undefined;
    return body?.message ?? e.message ?? fallback;
  }
  return (e as Error)?.message ?? fallback;
}

export interface LinehaulRosterCell {
  rosterId: number;
  dayOfWeek: number;
  courierId: number | null;
  courierName: string | null;
  targetType: AssignTargetType | null;
  targetId: number | null;
  targetName: string | null;
  targetHint: string | null;
}

export interface LinehaulRosterRow {
  runId: number;
  runName: string;
  fromDepotName: string;
  toDepotName: string;
  defaultCourierId: number | null;
  defaultDriverName: string | null;
  defaultTargetType: AssignTargetType | null;
  defaultTargetId: number | null;
  defaultTargetName: string | null;
  defaultTargetHint: string | null;
  active: boolean;
  cells: LinehaulRosterCell[];
}

export interface LinehaulRosterGrid {
  rows: LinehaulRosterRow[];
  couriers: LinehaulCourierLookup[];
}

export interface LinehaulRosterUpsert {
  linehaulRunId: number;
  dayOfWeek: number;
  targetType: AssignTargetType;
  targetId: number;
}

const unwrap = <T>(p: Promise<{ response: T }>): Promise<T> => p.then((r) => r.response);

export const linehaulService = {
  list: () => unwrap(request<{ response: TenantLinehaulRun[] }>('/recurring-linehaul-runs')),

  lookups: () => unwrap(request<{ response: LinehaulLookups }>('/recurring-linehaul-runs/lookups')),

  get: (id: number) => unwrap(request<{ response: TenantLinehaulRun }>(`/recurring-linehaul-runs/${id}`)),

  create: (payload: TenantLinehaulRunUpsert) =>
    unwrap(request<{ response: TenantLinehaulRun }>('/recurring-linehaul-runs', {
      method: 'POST', body: JSON.stringify(payload),
    })),

  update: (id: number, payload: TenantLinehaulRunUpsert) =>
    unwrap(request<{ response: TenantLinehaulRun }>(`/recurring-linehaul-runs/${id}`, {
      method: 'PUT', body: JSON.stringify(payload),
    })),

  remove: (id: number) =>
    request<{ response: unknown }>(`/recurring-linehaul-runs/${id}`, { method: 'DELETE' }),

  copy: (id: number) =>
    unwrap(request<{ response: TenantLinehaulRun }>(`/recurring-linehaul-runs/${id}/copy`, {
      method: 'POST', body: '{}',
    })),

  schedulesForRun: (id: number) =>
    unwrap(request<{ response: LinehaulScheduleBinding[] }>(`/recurring-linehaul-runs/${id}/schedules`)),

  searchLinkableBookings: (runId: number, q: string) =>
    unwrap(request<{ response: TenantLinehaulBookingLookup[] }>(
      `/recurring-linehaul-runs/${runId}/linkable-bookings?q=${encodeURIComponent(q)}`)),

  rosterGrid: () => unwrap(request<{ response: LinehaulRosterGrid }>('/recurring-linehaul-rosters')),

  upsertRosterCell: (payload: LinehaulRosterUpsert) =>
    unwrap(request<{ response: LinehaulRosterCell }>('/recurring-linehaul-rosters', {
      method: 'PUT', body: JSON.stringify(payload),
    })),

  deleteRosterCell: (rosterId: number) =>
    request<{ response: unknown }>(`/recurring-linehaul-rosters/${rosterId}`, { method: 'DELETE' }),
};
