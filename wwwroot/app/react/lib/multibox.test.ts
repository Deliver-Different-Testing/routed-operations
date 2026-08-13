import { describe, expect, it } from 'vitest';
import { expandMultiboxSiblings } from './multibox';
import type { BulkJob } from '../types';

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

describe('expandMultiboxSiblings', () => {
  it('returns the selection unchanged when no jobs have a multibox parent', () => {
    const all = [
      makeJob({ bulkJobId: 1 }),
      makeJob({ bulkJobId: 2 }),
    ];
    expect(expandMultiboxSiblings([1], all).sort()).toEqual([1]);
  });

  it('adds sibling children sharing the same multiboxParentId', () => {
    const all = [
      makeJob({ bulkJobId: 1, multiboxParentId: 99 }),
      makeJob({ bulkJobId: 2, multiboxParentId: 99 }),
      makeJob({ bulkJobId: 3, multiboxParentId: 99 }),
      makeJob({ bulkJobId: 4, multiboxParentId: null }),
    ];
    const result = expandMultiboxSiblings([1], all).sort((a, b) => a - b);
    expect(result).toEqual([1, 2, 3]);
  });

  it('does not include jobs with a different multiboxParentId', () => {
    const all = [
      makeJob({ bulkJobId: 1, multiboxParentId: 100 }),
      makeJob({ bulkJobId: 2, multiboxParentId: 200 }),
    ];
    expect(expandMultiboxSiblings([1], all).sort()).toEqual([1]);
  });

  it('handles empty selection', () => {
    const all = [makeJob({ bulkJobId: 1 })];
    expect(expandMultiboxSiblings([], all)).toEqual([]);
  });

  it('ignores selected ids that are not in allJobs', () => {
    const all = [makeJob({ bulkJobId: 1 })];
    expect(expandMultiboxSiblings([999], all).sort()).toEqual([999]);
  });

  it('deduplicates when the same sibling would be added twice', () => {
    const all = [
      makeJob({ bulkJobId: 1, multiboxParentId: 99 }),
      makeJob({ bulkJobId: 2, multiboxParentId: 99 }),
    ];
    const result = expandMultiboxSiblings([1, 2], all).sort((a, b) => a - b);
    expect(result).toEqual([1, 2]);
  });
});
