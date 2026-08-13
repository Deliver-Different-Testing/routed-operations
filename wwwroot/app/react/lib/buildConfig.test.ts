import { beforeEach, describe, expect, it } from 'vitest';
import {
  bucketJobs,
  buildModeLabel,
  loadBuildConfig,
  saveBuildConfig,
  splitOrderedJobsByConstraints,
  windowMinutes,
} from './buildConfig';
import type { BulkJob, BuildConfig } from '../types';

const KEY = 'RoutedOps_buildConfig';

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

beforeEach(() => {
  localStorage.clear();
});

describe('loadBuildConfig', () => {
  it('returns defaults when nothing stored', () => {
    const cfg = loadBuildConfig();
    expect(cfg.buildParameter).toBe('maxBoxes');
    expect(cfg.minutesPerStop).toBe(2);
    expect(cfg.vehicleCapacityEnabled).toBe(false);
    expect(cfg.routingMode).toBe('aToB');
  });

  it('merges stored partial over defaults', () => {
    localStorage.setItem(KEY, JSON.stringify({ minutesPerStop: 5, buildParameter: 'deliveryWindow' }));
    const cfg = loadBuildConfig();
    expect(cfg.minutesPerStop).toBe(5);
    expect(cfg.buildParameter).toBe('deliveryWindow');
    expect(cfg.routingMode).toBe('aToB');
  });

  it('returns defaults when stored JSON is corrupt', () => {
    localStorage.setItem(KEY, 'not json {');
    const cfg = loadBuildConfig();
    expect(cfg.buildParameter).toBe('maxBoxes');
  });
});

describe('saveBuildConfig', () => {
  it('writes the config as JSON', () => {
    const cfg: BuildConfig = {
      buildParameter: 'deliveryWindow',
      minutesPerStop: 4,
      vehicleCapacityEnabled: true,
      vehicleSizeId: 'custom',
      vehicleCubicCap: 20,
      routingMode: 'aToA',
      finishAtBulkJobId: null,
      noReroute: true,
      respectPickupCutoff: false,
    };
    saveBuildConfig(cfg);
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(raw.buildParameter).toBe('deliveryWindow');
    expect(raw.noReroute).toBe(true);
  });
});

describe('buildModeLabel', () => {
  it('returns Max Boxes for maxBoxes mode without VC', () => {
    const cfg = { ...loadBuildConfig(), buildParameter: 'maxBoxes' as const, vehicleCapacityEnabled: false };
    expect(buildModeLabel(cfg)).toBe('Max Boxes');
  });

  it('returns Delivery Window for deliveryWindow mode without VC', () => {
    const cfg = { ...loadBuildConfig(), buildParameter: 'deliveryWindow' as const, vehicleCapacityEnabled: false };
    expect(buildModeLabel(cfg)).toBe('Delivery Window');
  });

  it('appends + VC when vehicleCapacityEnabled', () => {
    const cfg = { ...loadBuildConfig(), buildParameter: 'maxBoxes' as const, vehicleCapacityEnabled: true };
    expect(buildModeLabel(cfg)).toBe('Max Boxes + VC');
  });
});

describe('windowMinutes', () => {
  it('returns positive delta in minutes', () => {
    expect(windowMinutes('2026-08-13T09:00:00Z', '2026-08-13T11:30:00Z')).toBe(150);
  });

  it('wraps overnight windows forward by 24h', () => {
    expect(windowMinutes('2026-08-13T22:00:00Z', '2026-08-13T02:00:00Z')).toBe(4 * 60);
  });

  it('returns 0 for null start', () => {
    expect(windowMinutes(null, '2026-08-13T02:00:00Z')).toBe(0);
  });

  it('returns 0 for null end', () => {
    expect(windowMinutes('2026-08-13T02:00:00Z', null)).toBe(0);
  });

  it('returns 0 when both are null', () => {
    expect(windowMinutes(null, null)).toBe(0);
  });
});

describe('splitOrderedJobsByConstraints', () => {
  it('returns empty array when input is empty', () => {
    expect(splitOrderedJobsByConstraints([], { minutesPerStop: 2 })).toEqual([]);
  });

  it('keeps all jobs in one run when no caps are set', () => {
    const jobs = [makeJob({ bulkJobId: 1 }), makeJob({ bulkJobId: 2 })];
    const runs = splitOrderedJobsByConstraints(jobs, { minutesPerStop: 2 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(2);
  });

  it('splits when maxBoxesCap is exceeded', () => {
    const jobs = [
      makeJob({ bulkJobId: 1 }),
      makeJob({ bulkJobId: 2 }),
      makeJob({ bulkJobId: 3 }),
    ];
    const runs = splitOrderedJobsByConstraints(jobs, { minutesPerStop: 2, maxBoxesCap: 2 });
    expect(runs).toHaveLength(2);
    expect(runs[0]).toHaveLength(2);
    expect(runs[1]).toHaveLength(1);
  });

  it('splits when windowMins is exceeded', () => {
    const jobs = [
      makeJob({ bulkJobId: 1 }),
      makeJob({ bulkJobId: 2 }),
      makeJob({ bulkJobId: 3 }),
    ];
    const runs = splitOrderedJobsByConstraints(jobs, {
      minutesPerStop: 10,
      windowMins: 25,
      legMinutes: [0, 0, 0],
    });
    expect(runs).toHaveLength(2);
  });

  it('uses the tighter of windowMins and pickupCutoffMins', () => {
    const jobs = [makeJob({ bulkJobId: 1 }), makeJob({ bulkJobId: 2 }), makeJob({ bulkJobId: 3 })];
    const runs = splitOrderedJobsByConstraints(jobs, {
      minutesPerStop: 10,
      windowMins: 60,
      pickupCutoffMins: 25,
      legMinutes: [0, 0, 0],
    });
    expect(runs).toHaveLength(2);
  });

  it('splits when vehicle cubic cap is exceeded', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, jobCubicM3: 6 }),
      makeJob({ bulkJobId: 2, jobCubicM3: 6 }),
      makeJob({ bulkJobId: 3, jobCubicM3: 6 }),
    ];
    const runs = splitOrderedJobsByConstraints(jobs, { minutesPerStop: 0, vehicleCubicCap: 10 });
    expect(runs).toHaveLength(3);
  });

  it('honours legMinutes when computing travel', () => {
    const jobs = [makeJob({ bulkJobId: 1 }), makeJob({ bulkJobId: 2 })];
    const runs = splitOrderedJobsByConstraints(jobs, {
      minutesPerStop: 0,
      windowMins: 10,
      legMinutes: [0, 20],
    });
    expect(runs).toHaveLength(2);
  });
});

describe('bucketJobs', () => {
  it('returns empty array for empty input in maxBoxes mode', () => {
    expect(bucketJobs([], 'maxBoxes')).toEqual([]);
  });

  it('returns empty array for empty input in deliveryWindow mode', () => {
    expect(bucketJobs([], 'deliveryWindow')).toEqual([]);
  });

  it('groups jobs by postcode in maxBoxes mode', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, toPostCode: 1010 }),
      makeJob({ bulkJobId: 2, toPostCode: 1010 }),
      makeJob({ bulkJobId: 3, toPostCode: 2020 }),
    ];
    const buckets = bucketJobs(jobs, 'maxBoxes');
    expect(buckets).toHaveLength(2);
    const p1010 = buckets.find((b) => b.key === '1010');
    expect(p1010?.jobs).toHaveLength(2);
    expect(p1010?.hhmm).toBe(null);
  });

  it('skips jobs missing toPostCode in maxBoxes mode', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, toPostCode: null }),
      makeJob({ bulkJobId: 2, toPostCode: 1010 }),
    ];
    const buckets = bucketJobs(jobs, 'maxBoxes');
    expect(buckets).toHaveLength(1);
  });

  it('groups jobs by scheduleWindowStart in deliveryWindow mode', () => {
    const jobs = [
      makeJob({
        bulkJobId: 1,
        toPostCode: 2020,
        scheduleWindowStart: '2026-08-13T09:00:00Z',
        scheduleWindowEnd: '2026-08-13T11:00:00Z',
      }),
      makeJob({
        bulkJobId: 2,
        toPostCode: 1010,
        scheduleWindowStart: '2026-08-13T09:00:00Z',
        scheduleWindowEnd: '2026-08-13T11:00:00Z',
      }),
      makeJob({
        bulkJobId: 3,
        toPostCode: 3030,
        scheduleWindowStart: '2026-08-13T13:00:00Z',
        scheduleWindowEnd: '2026-08-13T15:00:00Z',
      }),
    ];
    const buckets = bucketJobs(jobs, 'deliveryWindow');
    expect(buckets).toHaveLength(2);
    const nine = buckets.find((b) => b.hhmm === '0900');
    expect(nine?.jobs).toHaveLength(2);
    expect(nine?.jobs[0].toPostCode).toBe(1010);
  });

  it('skips jobs missing window fields in deliveryWindow mode', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, scheduleWindowStart: null, scheduleWindowEnd: null }),
    ];
    expect(bucketJobs(jobs, 'deliveryWindow')).toEqual([]);
  });
});
