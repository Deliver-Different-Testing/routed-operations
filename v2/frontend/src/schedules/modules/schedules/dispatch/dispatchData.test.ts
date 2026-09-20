// Joins between schedules, recurring routes and linehaul runs, and roster resolution.
import { describe, it, expect } from 'vitest';
import { sampleSchedules } from '../data/sampleData';
import { resolveRoster, routesForSchedule, runIdsForSchedule, runsForSchedule, sampleLinehaulRuns, sampleRecurringRoutes, schedulesUsingRun } from './dispatchData';

describe('route ↔ schedule', () => {
  it('binds a route to a schedule by Routes.ScheduleId', () => {
    expect(routesForSchedule(sampleRecurringRoutes, 20).map((r) => r.id)).toEqual([301, 302]);
    expect(routesForSchedule(sampleRecurringRoutes, 40)).toEqual([]);
  });
});

describe('run ↔ schedule', () => {
  it('finds the run behind a linehaul leg via LinehaulRunId', () => {
    const linehaul = sampleSchedules.find((s) => s.id === 20)!;
    expect(runIdsForSchedule(linehaul)).toEqual([1]);
    expect(runsForSchedule(sampleLinehaulRuns, linehaul).map((r) => r.name)).toEqual(['DEN-ABQ Nightline']);
  });

  it('lists every schedule riding a run, overrides included', () => {
    expect(schedulesUsingRun(sampleSchedules, 1).map((s) => s.id).sort()).toEqual([20, 30]);
  });

  it('a schedule without a linehaul leg has no run', () => {
    expect(runsForSchedule(sampleLinehaulRuns, sampleSchedules.find((s) => s.id === 1)!)).toEqual([]);
  });
});

describe('roster resolution: date override › weekly pattern › default', () => {
  const monday = new Date('2026-09-07T00:00:00'); // a Monday
  const roster = { weekly: { 1: 'Weekly Mon', 3: 'Weekly Wed' } as Record<number, string>, dateOverrides: { '2026-09-09': 'Cover Wed' } };

  it('applies the date override over the weekly pattern', () => {
    const days = resolveRoster(roster, 'Default', { from: monday, count: 3 });
    expect(days.map((d) => d.who)).toEqual(['Weekly Mon', null, 'Cover Wed']);
    expect(days[2].isOverride).toBe(true);
    expect(days[0].isToday).toBe(true);
  });

  it('for a linehaul run, days it does not run resolve to nobody and run days fall back to the default target', () => {
    const days = resolveRoster({ weekly: {}, dateOverrides: {} }, 'Contractor', { from: monday, count: 7, runDays: [1, 2, 3, 4, 5] });
    expect(days.map((d) => d.who)).toEqual(['Contractor', 'Contractor', 'Contractor', 'Contractor', 'Contractor', null, null]);
  });
});

describe('master job', () => {
  it('a run either names its master job or is flagged', () => {
    const withMaster = sampleLinehaulRuns.filter((r) => r.masterJob);
    const without = sampleLinehaulRuns.filter((r) => !r.masterJob);
    expect(withMaster.map((r) => r.masterJob!.jobNumber)).toEqual(['P1075', 'P1088']);
    expect(without.map((r) => r.id)).toEqual([3]);
  });
});
