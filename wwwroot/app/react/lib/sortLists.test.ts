import { describe, expect, it } from 'vitest';
import { nextSortDirection, sortIndicator, sortJobs, sortRuns } from './sortLists';
import type { BulkJob, Run, RunJob } from '../types';

function makeJob(overrides: Partial<BulkJob>): BulkJob {
  return {
    bulkJobId: 0,
    jobNumber: null,
    bookDate: '',
    bookTime: '',
    jobStatus: 0,
    clientId: 0,
    clientCode: null,
    amount: null,
    speed: 0,
    speedName: null,
    fromCompany: null,
    fromAddress: null,
    fromSuburb: null,
    fromPostCode: null,
    toCompany: null,
    toAddress: null,
    toSuburb: null,
    toPostCode: null,
    size: null,
    qty: null,
    weight: null,
    courierId: null,
    courierName: null,
    clientRefa: null,
    clientRefb: null,
    ourRef: null,
    notes: null,
    pickUpLatitude: null,
    pickUpLongitude: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    prebookJob: null,
    onHold: false,
    void: false,
    done: false,
    bulkRunId: null,
    runName: null,
    runOrder: null,
    multiboxParentId: null,
    parentId: null,
    regionId: null,
    barcode: null,
    okToLeave: null,
    contact: null,
    deliverToContact: null,
    deliverToPhone: null,
    trackingEmail: null,
    trackingMobile: null,
    proofOfDeliveryEmail: null,
    proofOfDeliveryMobile: null,
    scheduleId: null,
    scheduleName: null,
    scheduleWindowStart: null,
    scheduleWindowEnd: null,
    jobCubicM3: null,
    maxJobsPerRun: null,
    applyPickupCutoff: null,
    pickupCutoffHours: null,
    prefixRunName: null,
    postCodeMergeTo: null,
    runSequence: 0,
    bulkJobRunId: 0,
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run>, jobs: RunJob[] = []): Run {
  return {
    id: 0,
    name: null,
    mins: null,
    kms: null,
    courierId: null,
    courierName: null,
    status: null,
    revenue: null,
    payout: null,
    courierPercentage: null,
    googleRouteResponse: null,
    despatchDateTime: null,
    noReroute: false,
    routingMode: 0,
    finishAtBulkJobId: null,
    isVoidRun: false,
    fleet: null,
    jobs,
    ...overrides,
  };
}

describe('nextSortDirection', () => {
  it('starts a new field at asc', () => {
    expect(nextSortDirection(null, 'clientCode')).toEqual({ field: 'clientCode', direction: 'asc' });
  });

  it('starts a different field at asc', () => {
    expect(nextSortDirection({ field: 'jobNumber', direction: 'asc' }, 'clientCode'))
      .toEqual({ field: 'clientCode', direction: 'asc' });
  });

  it('flips asc to desc for the same field', () => {
    expect(nextSortDirection({ field: 'clientCode', direction: 'asc' }, 'clientCode'))
      .toEqual({ field: 'clientCode', direction: 'desc' });
  });

  it('clears sort when cycling from desc for the same field', () => {
    expect(nextSortDirection({ field: 'clientCode', direction: 'desc' }, 'clientCode')).toBe(null);
  });
});

describe('sortIndicator', () => {
  it('returns empty string when no sort', () => {
    expect(sortIndicator(null, 'clientCode')).toBe('');
  });

  it('returns empty string for a non-matching field', () => {
    expect(sortIndicator({ field: 'jobNumber', direction: 'asc' }, 'clientCode')).toBe('');
  });

  it('returns up arrow for asc', () => {
    expect(sortIndicator({ field: 'clientCode', direction: 'asc' }, 'clientCode')).toContain('▲');
  });

  it('returns down arrow for desc', () => {
    expect(sortIndicator({ field: 'clientCode', direction: 'desc' }, 'clientCode')).toContain('▼');
  });
});

describe('sortJobs', () => {
  it('returns the input unchanged when sort is null', () => {
    const jobs = [makeJob({ bulkJobId: 2 }), makeJob({ bulkJobId: 1 })];
    expect(sortJobs(jobs, null)).toBe(jobs);
  });

  it('sorts by clientCode asc', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, clientCode: 'B' }),
      makeJob({ bulkJobId: 2, clientCode: 'A' }),
    ];
    const out = sortJobs(jobs, { field: 'clientCode', direction: 'asc' });
    expect(out.map((j) => j.clientCode)).toEqual(['A', 'B']);
  });

  it('sorts by clientCode desc', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, clientCode: 'A' }),
      makeJob({ bulkJobId: 2, clientCode: 'B' }),
    ];
    const out = sortJobs(jobs, { field: 'clientCode', direction: 'desc' });
    expect(out.map((j) => j.clientCode)).toEqual(['B', 'A']);
  });

  it('sorts numerically by toPostCode', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, toPostCode: 3030 }),
      makeJob({ bulkJobId: 2, toPostCode: 1010 }),
      makeJob({ bulkJobId: 3, toPostCode: 2020 }),
    ];
    const out = sortJobs(jobs, { field: 'toPostCode', direction: 'asc' });
    expect(out.map((j) => j.toPostCode)).toEqual([1010, 2020, 3030]);
  });

  it('sorts by bookTime numerically', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, bookTime: '2026-08-13T12:00:00Z' }),
      makeJob({ bulkJobId: 2, bookTime: '2026-08-13T09:00:00Z' }),
    ];
    const out = sortJobs(jobs, { field: 'bookTime', direction: 'asc' });
    expect(out[0].bulkJobId).toBe(2);
  });

  it('handles null values without throwing', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, clientCode: null }),
      makeJob({ bulkJobId: 2, clientCode: 'A' }),
    ];
    const out = sortJobs(jobs, { field: 'clientCode', direction: 'asc' });
    expect(out).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const jobs = [makeJob({ bulkJobId: 1, clientCode: 'B' }), makeJob({ bulkJobId: 2, clientCode: 'A' })];
    sortJobs(jobs, { field: 'clientCode', direction: 'asc' });
    expect(jobs[0].clientCode).toBe('B');
  });

  it('returns input order for an unknown field', () => {
    const jobs = [makeJob({ bulkJobId: 1 }), makeJob({ bulkJobId: 2 })];
    const out = sortJobs(jobs, { field: 'nonExistent', direction: 'asc' });
    expect(out).toHaveLength(2);
  });

  it('falls back to speed when speedName is null', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, speedName: null, speed: 2 }),
      makeJob({ bulkJobId: 2, speedName: null, speed: 1 }),
    ];
    const out = sortJobs(jobs, { field: 'speedName', direction: 'asc' });
    expect(out[0].bulkJobId).toBe(2);
  });
});

describe('sortRuns', () => {
  it('returns the input unchanged when sort is null', () => {
    const runs = [makeRun({ id: 1 })];
    expect(sortRuns(runs, null)).toBe(runs);
  });

  it('sorts by name asc', () => {
    const runs = [makeRun({ id: 1, name: 'Zebra' }), makeRun({ id: 2, name: 'Alpha' })];
    const out = sortRuns(runs, { field: 'name', direction: 'asc' });
    expect(out.map((r) => r.name)).toEqual(['Alpha', 'Zebra']);
  });

  it('sorts by jobs length', () => {
    const jobA: RunJob = {
      bulkJobId: 1, builderIndex: null, jobNumber: null, isStart: false, isEnd: false,
      clientCode: null, deliveryDate: null, bookTime: null, toAddress: null, toSuburb: null,
      toPostCode: null, courierName: null, speedName: null, deliveryLatitude: null, amount: null,
    };
    const runs = [makeRun({ id: 1 }, [jobA, jobA]), makeRun({ id: 2 }, [jobA])];
    const out = sortRuns(runs, { field: 'jobs', direction: 'asc' });
    expect(out[0].id).toBe(2);
  });

  it('sorts by mins numerically', () => {
    const runs = [makeRun({ id: 1, mins: 90 }), makeRun({ id: 2, mins: 30 })];
    const out = sortRuns(runs, { field: 'mins', direction: 'desc' });
    expect(out[0].id).toBe(1);
  });

  it('treats null numeric fields as zero', () => {
    const runs = [makeRun({ id: 1, kms: null }), makeRun({ id: 2, kms: 10 })];
    const out = sortRuns(runs, { field: 'kms', direction: 'asc' });
    expect(out[0].id).toBe(1);
  });

  it('sorts by courierName as string', () => {
    const runs = [makeRun({ id: 1, courierName: 'Bob' }), makeRun({ id: 2, courierName: 'Alice' })];
    const out = sortRuns(runs, { field: 'courierName', direction: 'asc' });
    expect(out[0].id).toBe(2);
  });

  it('returns input order for an unknown field', () => {
    const runs = [makeRun({ id: 1 }), makeRun({ id: 2 })];
    const out = sortRuns(runs, { field: 'nope', direction: 'asc' });
    expect(out).toHaveLength(2);
  });
});
