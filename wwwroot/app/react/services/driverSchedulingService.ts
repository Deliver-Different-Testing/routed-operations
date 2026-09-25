// Driver Scheduling API client. Backend contract lives at
// /api/driver-scheduling/* under DriverSchedulingController.cs. Every
// response is wrapped in the `{ response: T }` envelope the rest of
// the RoutedOperations frontend uses.
//
// DTO shapes deliberately mirror the CourierManager mock the
// Configurator scheduling shell was already wired against
// (services/np_schedulingMockData.ts) so a follow-up "port the
// Configurator shell" pass can drop this service in place of the mock
// with zero shape drift.

import { buildQuery, request } from './api';

// ─── Shared DTOs ────────────────────────────────────────────────────

export interface VehicleSummary {
  vehicle: string;
  available: number;
  total: number;
}

export interface ScheduleSummary {
  id: number;
  created: string;
  bookDate: string;
  location: string;
  name: string;
  notificationSent: string | null;
  startTime: string;         // "HH:mm:ss"
  endTime: string;           // "HH:mm:ss"
  wanted: number;
  available: number;
  vehicleSummaries: VehicleSummary[];
}

export interface TimeSlotVehicle {
  id: number;
  location: string;
  bookDateTime: string;
  wanted: number | null;
  vehicleTypes: string[];
}

export interface LocationSummary {
  location: string;
  totalCouriers: number;
  totalAvailable: number;
  scheduleSummaries: ScheduleSummary[];
  timeSlots: TimeSlotVehicle[];
}

export interface CourierDetails {
  id: number;
  code: string | null;
  firstName: string | null;
  surname: string | null;
  mobile: string | null;
  vehicleType: string | null;
  region: string | null;
  active: boolean;
}

export interface TimeSlot {
  id: number;
  location: string;
  bookDateTime: string;
  wanted: number | null;
}

export interface ScheduleResponse {
  id: number;
  created: string;
  updated: string;
  statusId: number;
  status: string;
  timeSlot: TimeSlot | null;
}

export interface CourierBySchedule {
  courier: CourierDetails;
  scheduleResponse: ScheduleResponse | null;
}

export interface Schedule {
  id: number;
  created: string;
  bookDate: string;
  location: string;
  name: string;
  notificationSent: string | null;
  startTime: string;
  endTime: string;
  wanted: number;
}

/** Lookup row for the location + vehicle-type dropdowns. Same shape
 *  covers both endpoints (`GET /locations`, `GET /vehicle-types`). */
export interface LookupItem {
  id: number;
  name: string;
}

// ─── Request payloads ───────────────────────────────────────────────

export interface SchedulesCreateItem {
  bookDate: string;
  location: string;
  name: string;
  startTime: string;
  endTime: string;
  wanted: number;
}

export interface TimeSlotCreatePayload {
  bookDateTime: string;
  location: string;
  wanted: number | null;
  vehicleTypes: string[];
}

export interface TimeSlotUpdatePayload {
  bookDateTime: string;
  wanted: number | null;
}

export interface ScheduleCopyPayload {
  sourceDate: string;
  destinationDate: string;
  locations: string[];
}

// ─── Service ────────────────────────────────────────────────────────

async function unwrap<T>(url: string, init?: RequestInit): Promise<T> {
  const wrapped = await request<{ response: T }>(url, init);
  return wrapped.response;
}

async function unwrapPost<T>(url: string, body: unknown): Promise<T> {
  return unwrap<T>(url, { method: 'POST', body: JSON.stringify(body) });
}

const BASE = '/driver-scheduling';

export const driverSchedulingService = {
  // Reads
  getSummariesByBookDate: (bookDate: string) =>
    unwrap<LocationSummary[]>(`${BASE}/summaries/${encodeURIComponent(bookDate)}`),

  getCouriersBySchedule: (scheduleId: number) =>
    unwrap<CourierBySchedule[]>(`${BASE}/${scheduleId}/couriers`),

  getNotifications: () =>
    unwrap<Schedule[]>(`${BASE}/notifications`),

  getCouriersByResponseStatus: (statusId: number) =>
    unwrap<CourierDetails[]>(`${BASE}/responses/statuses/${statusId}/couriers`),

  /** Active bulk regions. Populates the New Schedule modal's location
   *  dropdown so operators pick a valid region up-front rather than
   *  typing a name and finding out at save time. */
  getLocations: () =>
    unwrap<LookupItem[]>(`${BASE}/locations`),

  /** VehicleType lookup. Populates the Add Time Slot modal's
   *  multi-select so a picked list survives the backend's exact-name
   *  match against `tblVehicleType.Name`. */
  getVehicleTypes: () =>
    unwrap<LookupItem[]>(`${BASE}/vehicle-types`),

  // Writes: schedules
  createSchedules: (schedules: SchedulesCreateItem[]) =>
    unwrapPost<Schedule[]>(BASE, { schedules }),

  deleteSchedule: (id: number) =>
    unwrap<string>(`${BASE}/${id}`, { method: 'DELETE' }),

  sendNotifications: (ids: number[]) =>
    unwrapPost<string>(`${BASE}/send-notifications`, { ids }),

  sendReminders: (id: number) =>
    unwrapPost<string>(`${BASE}/${id}/send-reminders`, {}),

  copySchedules: (payload: ScheduleCopyPayload) =>
    unwrapPost<string>(`${BASE}/copy`, payload),

  // Writes: time slots
  createTimeSlot: (payload: TimeSlotCreatePayload) =>
    unwrapPost<TimeSlotVehicle>(`${BASE}/time-slots`, payload),

  updateTimeSlot: (id: number, payload: TimeSlotUpdatePayload) =>
    unwrapPost<TimeSlotVehicle>(`${BASE}/time-slots/${id}`, payload),

  deleteTimeSlot: (id: number) =>
    unwrap<string>(`${BASE}/time-slots/${id}`, { method: 'DELETE' }),

  // Writes: responses
  updateResponseStatuses: (ids: number[], statusId: number) =>
    unwrapPost<string>(`${BASE}/responses/statuses`, { ids, statusId }),

  assignResponseTimeSlot: (id: number, timeSlotId: number | null) =>
    unwrapPost<string>(`${BASE}/responses/${id}/time-slot`, { timeSlotId }),

  // Note: buildQuery is imported so any future query-string variants
  // slot in without a fresh import churn. Referencing it here keeps
  // the import valid even before those callers land.
  _buildQuery: buildQuery,
};
