/**
 * @module schedules/api
 *
 * API service for Schedules module — talks to ClientManager's /api/Schedules endpoints.
 *
 * ⚠️ IMPORTANT: Schedules live in ClientManager (separate .NET app from AdminManager).
 * The base URL may differ from other modules. Configure CLIENT_MANAGER_BASE_URL.
 *
 * Production model: 1 row per day-of-week in tblBulkRunSchedule.
 * This service handles the mapping layer between our multi-day UI Schedule
 * and production's per-day rows.
 */

import type {
  Schedule,
  BulkRunScheduleRow,
  BulkRunScheduleCreateRequest,
  BulkRunScheduleUpdateRequest,
  LinehaulRunReference,
  DropoffLocation,
} from './types';
import {
  multiDayToPerDay,
  perDayToMultiDay,
  groupRowsByName,
} from './types';

// ============================================
// CONFIGURATION
// ============================================

/**
 * ClientManager base URL. In production this is a separate .NET app.
 * Override via environment variable or build config.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CLIENT_MANAGER_BASE_URL = (typeof (globalThis as any).__CLIENT_MANAGER_URL === 'string'
  ? (globalThis as any).__CLIENT_MANAGER_URL
  : '/api') as string;

const SCHEDULES_BASE = `${CLIENT_MANAGER_BASE_URL}/Schedules`;

// ============================================
// HTTP HELPERS
// ============================================

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include', // cross-app cookie sharing
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`API ${options.method ?? 'GET'} ${url} failed (${response.status}): ${errorText}`);
  }

  // Handle 204 No Content
  if (response.status === 204) return undefined as T;

  return response.json();
}

// ============================================
// RAW API CALLS (match production endpoints exactly)
// ============================================

/**
 * GET /api/Schedules/{clientId}
 * Returns all schedule rows for a given client.
 * ⚠️ No "list all" endpoint exists — must call per-client.
 */
export async function fetchScheduleRowsByClient(clientId: number): Promise<BulkRunScheduleRow[]> {
  return request<BulkRunScheduleRow[]>(`${SCHEDULES_BASE}/${clientId}`);
}

/**
 * POST /api/Schedules
 * Creates a new schedule row with zones and linehauls.
 */
export async function createScheduleRow(data: BulkRunScheduleCreateRequest): Promise<BulkRunScheduleRow> {
  return request<BulkRunScheduleRow>(SCHEDULES_BASE, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/**
 * PUT /api/Schedules
 * Updates an existing schedule row. Zones are upserted, linehauls replaced.
 * ⚠️ ClientManager uses PUT (not POST) for updates.
 */
export async function updateScheduleRow(data: BulkRunScheduleUpdateRequest): Promise<BulkRunScheduleRow> {
  return request<BulkRunScheduleRow>(SCHEDULES_BASE, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/**
 * DELETE /api/Schedules/{id}
 * Deletes a schedule row. Cascades zones + linehauls.
 */
export async function deleteScheduleRow(id: number): Promise<void> {
  return request<void>(`${SCHEDULES_BASE}/${id}`, { method: 'DELETE' });
}

/**
 * POST /api/Schedules/AutoBook/{id}
 * Toggle autobook for a schedule row.
 */
export async function toggleAutoBook(id: number): Promise<void> {
  return request<void>(`${SCHEDULES_BASE}/AutoBook/${id}`, { method: 'POST' });
}

/**
 * GET /api/Schedules/LinehaulRuns
 * Get available linehaul runs for schedule configuration.
 */
export async function fetchLinehaulRuns(): Promise<LinehaulRunReference[]> {
  return request<LinehaulRunReference[]>(`${SCHEDULES_BASE}/LinehaulRuns`);
}

/**
 * GET /api/Schedules/DropOffLocations
 * Get available drop-off locations.
 */
export async function fetchDropOffLocations(): Promise<DropoffLocation[]> {
  return request<DropoffLocation[]>(`${SCHEDULES_BASE}/DropOffLocations`);
}

// ============================================
// HIGH-LEVEL API (uses mapping layer)
// ============================================

/**
 * Fetch all schedules for a client, grouped by Name into UI Schedule objects.
 */
export async function fetchSchedulesForClient(clientId: number): Promise<Schedule[]> {
  const rows = await fetchScheduleRowsByClient(clientId);
  const grouped = groupRowsByName(rows);

  const schedules: Schedule[] = [];
  grouped.forEach((dayRows) => {
    // Current limitation: fetch linehauls and zones per row for full mapping
    // For now, pass empty arrays — will be populated when backend includes them
    schedules.push(perDayToMultiDay(dayRows));
  });

  return schedules;
}

/**
 * Fetch schedules for multiple clients (since there's no "list all" endpoint).
 */
export async function fetchSchedulesForClients(clientIds: number[]): Promise<Schedule[]> {
  const results = await Promise.all(
    clientIds.map(id => fetchSchedulesForClient(id).catch(() => [] as Schedule[]))
  );
  return results.flat();
}

/**
 * Save a UI Schedule — fans out to N production rows (one per enabled day).
 * For new schedules: creates all rows.
 * For existing: deletes old rows, creates new ones (simplest approach).
 */
export async function saveSchedule(schedule: Schedule): Promise<Schedule> {
  const rows = multiDayToPerDay(schedule);

  // If updating, delete existing rows first
  if (schedule.rowIds.length > 0) {
    await Promise.all(schedule.rowIds.map(id => deleteScheduleRow(id)));
  }

  // Create all new rows
  const created = await Promise.all(rows.map(row => createScheduleRow(row)));

  // Return updated schedule with new row IDs
  return perDayToMultiDay(created);
}

/**
 * Delete all production rows for a UI Schedule.
 */
export async function deleteSchedule(schedule: Schedule): Promise<void> {
  await Promise.all(schedule.rowIds.map(id => deleteScheduleRow(id)));
}

/**
 * Toggle autobook on all rows of a schedule.
 */
export async function toggleScheduleAutoBook(schedule: Schedule): Promise<void> {
  await Promise.all(schedule.rowIds.map(id => toggleAutoBook(id)));
}
