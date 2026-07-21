import { request } from './api';

export interface RouteZipcode {
  zipPolygonId: number;
  zip: string;
}

export interface RecurringRoute {
  routeId: number;
  name: string;
  area: string;
  defaultTargetType: number | null;   // 1=Courier, 2=Agent, 3=NetworkPartner
  defaultTargetId: number | null;
  defaultTargetName: string;
  scheduleId: number | null;
  scheduleName: string;
  scheduleWindow: string;
  active: boolean;
  zipcodes: RouteZipcode[];
  rosterEntryCount: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface UpsertRouteBody {
  name: string;
  area: string;
  defaultTargetType: number | null;
  defaultTargetId: number | null;
  scheduleId: number | null;
  active: boolean;
  zipPolygonIds: number[];
}

export interface CopyRouteBody {
  name: string;
  defaultTargetType?: number | null;
  defaultTargetId?: number | null;
  scheduleId?: number | null;
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
  getPolygonShapes: (zipPolygonIds: number[]) =>
    request<{ response: ZipPolygonShape[] }>('/recurring-routes/zipcodes/shapes', {
      method: 'POST', body: JSON.stringify(zipPolygonIds),
    }),
  getAssignableTargets: () =>
    request<{ response: AssignableTargets }>('/recurring-routes/assignable-targets'),
  getSchedules: () =>
    request<{ response: ScheduleLookup[] }>('/recurring-routes/schedules/lookup'),
};
