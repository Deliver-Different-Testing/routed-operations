// src/modules/schedules/api/v2.ts
//
// Typed client for the Routed Operations schedules API that Kevin is building on the
// ScheduleId-keyed tables (tblBulkRunScheduleHeader / tblBulkRunScheduleClient).
// The legacy `/api/Schedules/{clientId}` endpoints in ../api.ts stay for the old screen.
//
// Nothing here is called in the sample-data build (VITE_SCHEDULES_API unset); the DTOs are the
// contract the view expects. Field names follow docs/KEVIN-NEW-SCHEDULES-VIEW-MULTI-CLIENT-2026-09-08.md §6.

import type { BulkRunScheduleRow, BulkScheduleLinehaulRow } from '../types';
import type { LinehaulRun, RecurringRoute, RosterDay } from '../dispatch/types';

const BASE = (import.meta.env.VITE_SCHEDULES_API as string | undefined) ?? '';

export const apiAvailable = BASE.length > 0;

// ---------- DTOs ----------

export interface ScheduleClientLinkDto {
  clientId: number;
  clientCode: string;
  clientName: string;
  createdUtc: string;
  createdBy: string;
}

/** One schedule = header + its day rows + link rows. */
export interface ScheduleDto {
  scheduleId: number;
  name: string;
  description: string | null;
  isDefault: boolean;
  baseScheduleId: number | null;
  legacyClientId: number | null;
  retiredUtc: string | null;
  clients: ScheduleClientLinkDto[];
  rows: BulkRunScheduleRow[];
  linehauls: BulkScheduleLinehaulRow[];
  /** Fields where an override differs from its base; computed server-side. */
  overriddenFields: string[];
}

export interface EffectiveScheduleDto {
  scheduleId: number;
  source: 'override' | 'shared' | 'default';
}

export interface DispatchDto {
  routes: (RecurringRoute & { week: RosterDay[] })[];
  runs: (LinehaulRun & { week: RosterDay[] })[];
}

export interface ScheduleGroupDto {
  groupId: number;
  name: string;
  description: string | null;
  isActive: boolean;
  scheduleIds: number[];
}

// ---------- calls ----------

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

const opts: RequestInit = { credentials: 'include', headers: { 'Content-Type': 'application/json' } };

export const schedulesApi = {
  list: (params: { type?: 'all' | 'default' | 'shared' | 'override'; q?: string; includeRetired?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.q) qs.set('q', params.q);
    if (params.includeRetired) qs.set('includeRetired', 'true');
    return fetch(`${BASE}/api/v2/schedules?${qs}`, opts).then(json<ScheduleDto[]>);
  },
  get: (id: number) => fetch(`${BASE}/api/v2/schedules/${id}`, opts).then(json<ScheduleDto>),
  create: (body: Omit<ScheduleDto, 'scheduleId' | 'retiredUtc' | 'overriddenFields'>) =>
    fetch(`${BASE}/api/v2/schedules`, { ...opts, method: 'POST', body: JSON.stringify(body) }).then(json<ScheduleDto>),
  update: (id: number, body: Partial<ScheduleDto>) =>
    fetch(`${BASE}/api/v2/schedules/${id}`, { ...opts, method: 'PUT', body: JSON.stringify(body) }).then(json<ScheduleDto>),
  retire: (id: number) => fetch(`${BASE}/api/v2/schedules/${id}/retire`, { ...opts, method: 'POST' }).then(json<ScheduleDto>),
  copy: (id: number) => fetch(`${BASE}/api/v2/schedules/${id}/copy`, { ...opts, method: 'POST' }).then(json<ScheduleDto>),
  /** Full replace of the link rows. 409 when a client is on an override of this base. */
  setClients: (id: number, clientIds: number[]) =>
    fetch(`${BASE}/api/v2/schedules/${id}/clients`, { ...opts, method: 'PUT', body: JSON.stringify({ clientIds }) }).then(json<ScheduleDto>),
  removeClient: (id: number, clientId: number) =>
    fetch(`${BASE}/api/v2/schedules/${id}/clients/${clientId}`, { ...opts, method: 'DELETE' }).then(json<ScheduleDto>),
  /** Creates the override, moves the client's link row, returns the new schedule. */
  createOverride: (id: number, clientId: number) =>
    fetch(`${BASE}/api/v2/schedules/${id}/overrides`, { ...opts, method: 'POST', body: JSON.stringify({ clientId }) }).then(json<ScheduleDto>),
  dispatch: (id: number) => fetch(`${BASE}/api/v2/schedules/${id}/dispatch`, opts).then(json<DispatchDto>),
  forClient: (clientId: number) => fetch(`${BASE}/api/v2/clients/${clientId}/schedules`, opts).then(json<EffectiveScheduleDto[]>),
  groups: {
    list: () => fetch(`${BASE}/api/v2/schedule-groups`, opts).then(json<ScheduleGroupDto[]>),
    attachClients: (groupId: number, clientIds: number[]) =>
      fetch(`${BASE}/api/v2/schedule-groups/${groupId}/clients`, { ...opts, method: 'POST', body: JSON.stringify({ clientIds }) }).then(json<{ linkRowsWritten: number }>),
  },
  recurringRoutes: (params: { type?: 'first' | 'middle' | 'final'; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.type) qs.set('type', params.type);
    if (params.q) qs.set('q', params.q);
    return fetch(`${BASE}/api/v2/recurring-routes?${qs}`, opts).then(json<{ routes: RecurringRoute[]; runs: LinehaulRun[] }>);
  },
};
