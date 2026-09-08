// src/modules/schedules/dispatch/dispatchData.ts
//
// Sample recurring routes and linehaul runs, and the helpers that join them to schedules.
// In production these come from Kevin's Recurring Routes API (see api/v2.ts); the joins are the same:
//   route  → schedule : Routes.ScheduleId
//   run    → schedule : TblBulkScheduleLinehaul.LinehaulRunId (the schedule's linehaul leg)

import type { Schedule } from '../types';
import type { IsoWeekday, LinehaulRun, RecurringRoute, RosterDay, RosterPattern } from './types';

export const WEEKDAY_LABEL: Record<IsoWeekday, string> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun' };

export const sampleRecurringRoutes: RecurringRoute[] = [
  {
    id: 301, name: 'DEN Medical AM – North', type: 'first', area: 'Denver North', scheduleIds: [20, 10], zipCount: 31, mappedStops: 38,
    defaultTarget: { name: 'V. Patel', type: 'Courier', hint: 'Van 14' },
    roster: { weekly: { 1: 'V. Patel', 2: 'V. Patel', 3: 'R. Singh', 4: 'V. Patel', 5: 'V. Patel' }, dateOverrides: {} },
    active: true,
  },
  {
    id: 302, name: 'DEN Medical AM – Central', type: 'first', area: 'Denver Central', scheduleIds: [20], zipCount: 47, mappedStops: 52,
    defaultTarget: { name: 'M. Ortega', type: 'Courier', hint: 'Van 3' },
    roster: { weekly: { 1: 'M. Ortega', 2: 'M. Ortega', 3: 'M. Ortega', 4: 'M. Ortega', 5: 'T. Wong' }, dateOverrides: {} },
    active: true,
  },
  {
    id: 304, name: 'ABQ home delivery loop', type: 'final', area: 'Albuquerque metro', scheduleIds: [10], zipCount: 19, mappedStops: 41,
    defaultTarget: { name: 'ABQ Couriers', type: 'NP', hint: 'Network partner' },
    roster: { weekly: { 1: 'ABQ Couriers', 2: 'ABQ Couriers', 3: 'ABQ Couriers', 4: 'ABQ Couriers', 5: 'ABQ Couriers' }, dateOverrides: {} },
    active: true,
  },
  {
    id: 305, name: 'DEN 1-hour zone', type: 'final', area: 'Denver inner city', scheduleIds: [1], zipCount: 22, mappedStops: 26,
    defaultTarget: { name: 'K. Nakamura', type: 'Courier', hint: 'Car 21' },
    roster: { weekly: { 1: 'K. Nakamura', 2: 'K. Nakamura', 3: 'K. Nakamura', 4: 'K. Nakamura', 5: 'K. Nakamura', 6: 'K. Nakamura' }, dateOverrides: {} },
    active: true,
  },
  {
    id: 307, name: 'Airport express zone', type: 'final', area: 'DEN airport', scheduleIds: [], zipCount: 9, mappedStops: 12,
    defaultTarget: { name: 'S. Ahmed', type: 'Courier', hint: 'Van 8' },
    roster: { weekly: { 1: 'S. Ahmed', 2: 'S. Ahmed', 3: 'S. Ahmed', 4: 'S. Ahmed', 5: 'S. Ahmed' }, dateOverrides: {} },
    active: false,
  },
];

export const sampleLinehaulRuns: LinehaulRun[] = [
  {
    id: 1, name: 'DEN-ABQ Nightline', fromDepot: 'Denver Main Depot', toDepot: 'Albuquerque Depot', days: [1, 2, 3, 4, 5],
    despatchTime: '20:45', departTime: '21:30', mode: 'Road',
    defaultTarget: { name: 'Interstate Freight (contract)', type: 'Agent' }, speed: 'Use schedule default',
    roster: { weekly: {}, dateOverrides: {} },
    masterJob: { jobNumber: 'P1075', todayState: 'Materialised 04:10 · 38 items linked' },
    mappedStops: 485, active: true,
  },
  {
    id: 2, name: 'DEN-PHX Dayline', fromDepot: 'Denver Main Depot', toDepot: 'Phoenix Hub', days: [1, 2, 3, 4, 5],
    despatchTime: '10:30', departTime: '11:00', mode: 'Flight',
    defaultTarget: { name: 'Air Cargo (contract)', type: 'NP' }, speed: 'Use schedule default',
    roster: { weekly: { 3: 'Overflow carrier' }, dateOverrides: {} },
    masterJob: { jobNumber: 'P1088', todayState: 'Materialised 04:10 · 12 items linked' },
    mappedStops: 61, active: true,
  },
  {
    id: 3, name: 'PHX-ABQ Shuttle', fromDepot: 'Phoenix Hub', toDepot: 'Albuquerque Depot', days: [1, 2, 3, 4, 5],
    despatchTime: '13:30', departTime: '14:00', mode: 'Road',
    defaultTarget: { name: 'J. Marsh', type: 'Courier' }, speed: 'Express',
    roster: { weekly: { 5: 'P. Reyes' }, dateOverrides: {} },
    masterJob: null,
    mappedStops: 41, active: true,
  },
];

// ---------- joins ----------

/** Recurring routes bound to a schedule (Routes.ScheduleId). */
export function routesForSchedule(routes: RecurringRoute[], scheduleId: number): RecurringRoute[] {
  return routes.filter((r) => r.scheduleIds.includes(scheduleId));
}

/** Linehaul run ids referenced by a schedule's linehaul legs. */
export function runIdsForSchedule(schedule: Schedule): number[] {
  return schedule.legs
    .map((leg) => (leg.config.type === 'linehaul' ? leg.config.runId : undefined))
    .filter((id): id is number => id != null);
}

export function runsForSchedule(runs: LinehaulRun[], schedule: Schedule): LinehaulRun[] {
  const ids = runIdsForSchedule(schedule);
  return runs.filter((r) => ids.includes(r.id));
}

/** Schedules whose linehaul leg rides a run. */
export function schedulesUsingRun(schedules: Schedule[], runId: number): Schedule[] {
  return schedules.filter((s) => runIdsForSchedule(s).includes(runId));
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Resolve the next `count` days of a roster: date override › weekly pattern › default target.
 * `runDays` (linehaul) limits which weekdays run at all.
 */
export function resolveRoster(
  roster: RosterPattern,
  defaultWho: string,
  opts: { from?: Date; count?: number; runDays?: IsoWeekday[] } = {},
): RosterDay[] {
  const from = opts.from ?? new Date();
  const count = opts.count ?? 7;
  const out: RosterDay[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    const weekday = (((d.getDay() + 6) % 7) + 1) as IsoWeekday;
    const date = isoDate(d);
    const override = roster.dateOverrides[date];
    let who: string | null = null;
    let isOverride = false;
    if (override) {
      who = override;
      isOverride = true;
    } else if (opts.runDays) {
      who = opts.runDays.includes(weekday) ? roster.weekly[weekday] ?? defaultWho : null;
    } else {
      who = roster.weekly[weekday] ?? null;
    }
    out.push({ date, weekday, label: WEEKDAY_LABEL[weekday], who, isOverride, isToday: i === 0 });
  }
  return out;
}
