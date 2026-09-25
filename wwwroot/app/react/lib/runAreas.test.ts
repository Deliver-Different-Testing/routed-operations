import { describe, expect, it } from 'vitest';
import { runAreas } from './runAreas';
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

function makeRunJob(bulkJobId: number): RunJob {
  return {
    bulkJobId,
    builderIndex: null,
    jobNumber: null,
    isStart: false,
    isEnd: false,
    clientCode: null,
    deliveryDate: null,
    bookTime: null,
    toAddress: null,
    toSuburb: null,
    toPostCode: null,
    courierName: null,
    speedName: null,
    deliveryLatitude: null,
    amount: null,
  };
}

function makeRun(runJobs: RunJob[]): Run {
  return {
    id: 1,
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
    jobs: runJobs,
  };
}

describe('runAreas', () => {
  it('returns empty string when the run has no jobs', () => {
    expect(runAreas(makeRun([]), [])).toBe('');
  });

  it('joins distinct postcodes with commas', () => {
    const all = [
      makeJob({ bulkJobId: 1, toPostCode: 1010 }),
      makeJob({ bulkJobId: 2, toPostCode: 2020 }),
    ];
    const run = makeRun([makeRunJob(1), makeRunJob(2)]);
    expect(runAreas(run, all)).toBe('1010, 2020');
  });

  it('deduplicates repeat postcodes', () => {
    const all = [
      makeJob({ bulkJobId: 1, toPostCode: 1010 }),
      makeJob({ bulkJobId: 2, toPostCode: 1010 }),
    ];
    const run = makeRun([makeRunJob(1), makeRunJob(2)]);
    expect(runAreas(run, all)).toBe('1010');
  });

  it('falls back to toSuburb when postcode is null', () => {
    const all = [makeJob({ bulkJobId: 1, toPostCode: null, toSuburb: 'Ponsonby' })];
    const run = makeRun([makeRunJob(1)]);
    expect(runAreas(run, all)).toBe('Ponsonby');
  });

  it('falls back to toSuburb when postcode is 0', () => {
    const all = [makeJob({ bulkJobId: 1, toPostCode: 0, toSuburb: 'Grey Lynn' })];
    const run = makeRun([makeRunJob(1)]);
    expect(runAreas(run, all)).toBe('Grey Lynn');
  });

  it('skips jobs not in the allJobs list', () => {
    const all = [makeJob({ bulkJobId: 2, toPostCode: 2020 })];
    const run = makeRun([makeRunJob(1), makeRunJob(2)]);
    expect(runAreas(run, all)).toBe('2020');
  });

  it('skips items with blank label (no postcode and blank suburb)', () => {
    const all = [makeJob({ bulkJobId: 1, toPostCode: null, toSuburb: '   ' })];
    const run = makeRun([makeRunJob(1)]);
    expect(runAreas(run, all)).toBe('');
  });

  it('truncates at 4 distinct areas with ellipsis marker', () => {
    const all = [
      makeJob({ bulkJobId: 1, toPostCode: 1010 }),
      makeJob({ bulkJobId: 2, toPostCode: 2020 }),
      makeJob({ bulkJobId: 3, toPostCode: 3030 }),
      makeJob({ bulkJobId: 4, toPostCode: 4040 }),
      makeJob({ bulkJobId: 5, toPostCode: 5050 }),
      makeJob({ bulkJobId: 6, toPostCode: 6060 }),
    ];
    const run = makeRun([1, 2, 3, 4, 5, 6].map(makeRunJob));
    const out = runAreas(run, all);
    expect(out).toContain('1010, 2020, 3030, 4040');
    expect(out).toContain('+2');
  });
});
