import { describe, expect, it } from 'vitest';
import type { BulkJob, Run, RunJob } from '../../types';
import { applyCockpitPatch } from './cockpitPatch';

// #1018 C2: after a save the cockpit patches its job and run lists from what
// the server handed back, so the busy overlay can clear at commit while the
// full reload runs in the background. These pin that the patched lists say
// the same thing the reload will: which run each job is on.

const job = (id: number, bulkRunId: number | null = null, runName: string | null = null) =>
  ({ bulkJobId: id, bulkRunId, runName, runOrder: bulkRunId ? 0 : null } as BulkJob);
const runJob = (id: number, builderIndex: number) => ({ bulkJobId: id, builderIndex } as RunJob);
const run = (id: number, name: string, jobs: RunJob[]) => ({ id, name, jobs } as Run);

describe('applyCockpitPatch', () => {
  it('moves assigned jobs onto the returned run and out of the run they left', () => {
    const jobs = [job(1, 10, 'A'), job(2, 10, 'A'), job(3)];
    const runs = [run(10, 'A', [runJob(1, 0), runJob(2, 1)]), run(20, 'B', [])];

    // The server returns the target and the source as they now are.
    const out = applyCockpitPatch(jobs, runs, {
      upsertRuns: [run(20, 'B', [runJob(1, 0), runJob(3, 1)]), run(10, 'A', [runJob(2, 0)])],
    });

    expect(out.jobs.map((j) => [j.bulkJobId, j.bulkRunId, j.runName, j.runOrder])).toEqual([
      [1, 20, 'B', 0], [2, 10, 'A', 0], [3, 20, 'B', 1],
    ]);
    expect(out.runs.map((r) => [r.id, r.jobs.map((j) => j.bulkJobId)])).toEqual([[10, [2]], [20, [1, 3]]]);
  });

  it('takes a moved job out of a run the server did not return', () => {
    // A merge deletes the source; a stale source may not come back at all.
    const out = applyCockpitPatch([job(1, 10, 'A')], [run(10, 'A', [runJob(1, 0)]), run(20, 'B', [])], {
      upsertRuns: [run(20, 'B', [runJob(1, 0)])],
      removeRunIds: [10],
    });
    expect(out.runs.map((r) => r.id)).toEqual([20]);
    expect(out.jobs[0].bulkRunId).toBe(20);
  });

  it('adds a newly created run, at the end, and leaves the other jobs untouched', () => {
    const untouched = job(5);
    const out = applyCockpitPatch([job(1), untouched], [run(10, 'A', [])], {
      upsertRuns: [run(30, 'New', [runJob(1, 0)])],
    });
    expect(out.runs.map((r) => r.id)).toEqual([10, 30]);
    expect(out.jobs[0].bulkRunId).toBe(30);
    // Same object, so the memoised list and the map marker diff see no change.
    expect(out.jobs[1]).toBe(untouched);
  });

  it('deleting a run puts its jobs back to unassigned', () => {
    const out = applyCockpitPatch([job(1, 10, 'A'), job(2, 20, 'B')],
      [run(10, 'A', [runJob(1, 0)]), run(20, 'B', [runJob(2, 0)])], { removeRunIds: [10] });
    expect(out.runs.map((r) => r.id)).toEqual([20]);
    expect(out.jobs.map((j) => [j.bulkRunId, j.runName, j.runOrder])).toEqual([[null, null, null], [20, 'B', 0]]);
  });

  it('renaming a run renames it on its jobs too', () => {
    const out = applyCockpitPatch([job(1, 10, 'A'), job(2)], [run(10, 'A', [runJob(1, 0)])],
      { renameRun: { runId: 10, name: 'Renamed' } });
    expect(out.runs[0].name).toBe('Renamed');
    expect(out.jobs.map((j) => j.runName)).toEqual(['Renamed', null]);
  });

  it('voided jobs leave the job list and every run', () => {
    const out = applyCockpitPatch([job(1, 10, 'A'), job(2, 10, 'A'), job(3)],
      [run(10, 'A', [runJob(1, 0), runJob(2, 1)])], { removeJobIds: [1, 3] });
    expect(out.jobs.map((j) => j.bulkJobId)).toEqual([2]);
    expect(out.runs[0].jobs.map((j) => j.bulkJobId)).toEqual([2]);
  });
});
