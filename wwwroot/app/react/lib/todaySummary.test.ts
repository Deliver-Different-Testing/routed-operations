import { describe, expect, it } from 'vitest';
import { summariseToday, type SummaryRegion, type SummaryRun } from './todaySummary';

const run = (over: Partial<SummaryRun>): SummaryRun => ({
  id: 1, jobs: 10, status: 'R', isMissing: false, courierId: 7, agentName: null, ...over,
});
const region = (over: Partial<SummaryRegion>): SummaryRegion => ({ total: 0, pickedUp: 0, toDo: 0, ...over });

describe('summariseToday', () => {
  it('is all zero when there is nothing on today', () => {
    expect(summariseToday([], [])).toEqual({ runs: 0, jobs: 0, pickedUp: 0, toDo: 0, unassignedRuns: 0, exceptions: 0 });
  });

  it('counts a run once however many drivers it is split across', () => {
    const runs = [run({ id: 5, courierId: 1 }), run({ id: 5, courierId: 2 }), run({ id: 6, courierId: 3 })];
    expect(summariseToday(runs, []).runs).toBe(2);
  });

  it('takes jobs, picked up and still to do from the region overview, summed over regions', () => {
    const regions = [region({ total: 63, pickedUp: 20, toDo: 43 }), region({ total: 40, pickedUp: 40, toDo: 0 })];
    expect(summariseToday([], regions)).toMatchObject({ jobs: 103, pickedUp: 60, toDo: 43 });
  });

  it('counts a run as having no driver or partner when work on it has neither', () => {
    const runs = [
      run({ id: 1, courierId: null, agentName: null }),
      run({ id: 2, courierId: 9 }),
      run({ id: 3, courierId: null, agentName: 'Sample Partner' }),
    ];
    expect(summariseToday(runs, []).unassignedRuns).toBe(1);
  });

  it('counts a split run with unassigned jobs left on it as having no driver or partner', () => {
    const runs = [run({ id: 4, courierId: 9, jobs: 12 }), run({ id: 4, courierId: null, jobs: 3 })];
    expect(summariseToday(runs, [])).toMatchObject({ runs: 1, unassignedRuns: 1 });
  });

  it('ignores an empty unassigned row, which is not work waiting for anyone', () => {
    const runs = [run({ id: 4, courierId: 9, jobs: 12 }), run({ id: 4, courierId: null, jobs: 0 })];
    expect(summariseToday(runs, []).unassignedRuns).toBe(0);
  });

  it('treats a blank partner name as no partner', () => {
    expect(summariseToday([run({ courierId: null, agentName: '  ' })], []).unassignedRuns).toBe(1);
  });

  it('puts missing and void rows on the exceptions count, as the Route Viewer exceptions list does', () => {
    const runs = [run({ id: 1 }), run({ id: 2, isMissing: true }), run({ id: 3, status: 'V' })];
    expect(summariseToday(runs, [])).toMatchObject({ exceptions: 2, runs: 1 });
  });

  it('does not count an exception row as a run with no driver', () => {
    const runs = [run({ id: 2, isMissing: true, courierId: null })];
    expect(summariseToday(runs, [])).toMatchObject({ exceptions: 1, unassignedRuns: 0, runs: 0 });
  });
});
