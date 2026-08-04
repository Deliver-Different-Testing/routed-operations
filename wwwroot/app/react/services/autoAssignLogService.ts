import { buildQuery, request } from './api';

export interface AutoAssignLogEntry {
  logId: number;
  createdAtUtc: string;
  jobId: number | null;
  jobBookingId: number | null;
  speedId: number | null;
  pickupZip: string | null;
  pickupAtUtc: string | null;
  bookingKind: number | null;
  bookingKindName: string;
  resolvedRouteId: number | null;
  resolvedRouteName: string | null;
  resolvedCourierId: number | null;
  resolvedCourierName: string | null;
  resolvedAgentId: number | null;
  resolvedAgentName: string | null;
  resolvedNpAgentId: number | null;
  resolvedNpAgentName: string | null;
  outcome: string;
  triggerSource: string;
  priorRouteId: number | null;
  side: string;
}

export interface AutoAssignLogPage {
  total: number;
  page: number;
  pageSize: number;
  entries: AutoAssignLogEntry[];
}

export interface AutoAssignLogQuery {
  outcome?: string;
  side?: string;
  fromUtc?: string;
  toUtc?: string;
  routeId?: number;
  page?: number;
  pageSize?: number;
}

export interface UnresolvedBookingEntry {
  ucbkId: number;
  ucbkJobNumber: string | null;
  ucbkClientId: number | null;
  clientName: string | null;
  ucbkSpeed: number | null;
  speedName: string | null;
  scheduleId: number | null;
  scheduleName: string | null;
  pickupZip: string | null;
  deliveryZip: string | null;
  missingPickupCoords: boolean;
  missingDeliveryCoords: boolean;
  ucbkNextDue: string | null;
  createdTime: string | null;
}

export interface UnresolvedBookingPage {
  total: number;
  page: number;
  pageSize: number;
  entries: UnresolvedBookingEntry[];
}

export interface UnresolvedBookingQuery {
  clientId?: number;
  scheduleId?: number;
  speedId?: number;
  missingPickupCoords?: boolean;
  page?: number;
  pageSize?: number;
}

export const autoAssignLogService = {
  getLog: (q: AutoAssignLogQuery) =>
    request<{ response: AutoAssignLogPage }>(
      `/diagnostics/auto-assign-log${buildQuery({
        outcome: q.outcome,
        side: q.side,
        fromUtc: q.fromUtc,
        toUtc: q.toUtc,
        routeId: q.routeId,
        page: q.page,
        pageSize: q.pageSize,
      })}`,
    ),

  getUnresolvedRecurringBookings: (q: UnresolvedBookingQuery) =>
    request<{ response: UnresolvedBookingPage }>(
      `/diagnostics/auto-assign-log/unresolved-recurring-bookings${buildQuery({
        clientId: q.clientId,
        scheduleId: q.scheduleId,
        speedId: q.speedId,
        // ASP.NET model binder parses bool from 'true' / 'false'; only send
        // when true so the "no filter" case leaves the param off the query.
        missingPickupCoords: q.missingPickupCoords ? 'true' : undefined,
        page: q.page,
        pageSize: q.pageSize,
      })}`,
    ),
};
