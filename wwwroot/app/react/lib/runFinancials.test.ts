import { describe, expect, it } from 'vitest';
import {
  RUN_EXP_PER_KM,
  RUN_HOURLY_RATE,
  recalcFromRun,
  recalcRunFinancials,
  runBuilderTotals,
} from './runFinancials';
import type { Run, RunJob } from '../types';

function makeRunJob(overrides: Partial<RunJob>): RunJob {
  return {
    bulkJobId: 0,
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
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run>): Run {
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
    jobs: [],
    ...overrides,
  };
}

describe('constants', () => {
  it('RUN_HOURLY_RATE is 25', () => {
    expect(RUN_HOURLY_RATE).toBe(25);
  });

  it('RUN_EXP_PER_KM is 0.5', () => {
    expect(RUN_EXP_PER_KM).toBe(0.5);
  });
});

describe('recalcRunFinancials', () => {
  it('computes mins, revenue, and payout from a full input', () => {
    const out = recalcRunFinancials({
      travelMinutes: 60,
      kms: 10,
      jobCount: 5,
      minutesPerStop: 2,
      courierPercentage: 0.5,
    });
    expect(out.mins).toBe(70);
    expect(out.revenue).toBe(34.17);
    expect(out.payout).toBe(17.08);
  });

  it('treats null courierPercentage as zero', () => {
    const out = recalcRunFinancials({
      travelMinutes: 60,
      kms: 0,
      jobCount: 0,
      minutesPerStop: 0,
      courierPercentage: null,
    });
    expect(out.payout).toBe(0);
  });

  it('handles zero jobs and zero travel', () => {
    const out = recalcRunFinancials({
      travelMinutes: 0,
      kms: 0,
      jobCount: 0,
      minutesPerStop: 2,
      courierPercentage: 0,
    });
    expect(out).toEqual({ mins: 0, revenue: 0, payout: 0 });
  });

  it('rounds revenue and payout to two decimals', () => {
    const out = recalcRunFinancials({
      travelMinutes: 33,
      kms: 7,
      jobCount: 3,
      minutesPerStop: 2,
      courierPercentage: 0.4,
    });
    expect(Math.round(out.revenue * 100)).toBe(out.revenue * 100);
    expect(Math.round(out.payout * 100)).toBe(out.payout * 100);
  });

  it('rounds mins to nearest integer', () => {
    const out = recalcRunFinancials({
      travelMinutes: 30.4,
      kms: 0,
      jobCount: 1,
      minutesPerStop: 2,
      courierPercentage: 0,
    });
    expect(out.mins).toBe(32);
  });
});

describe('recalcFromRun', () => {
  it('reads mins, kms, and jobs.length from the Run', () => {
    const run = makeRun({ mins: 60, kms: 10, jobs: [makeRunJob({}), makeRunJob({})], courierPercentage: 0.5 });
    const out = recalcFromRun(run, 2, 0.5);
    expect(out.mins).toBe(64);
  });

  it('treats null mins and kms as zero', () => {
    const run = makeRun({ mins: null, kms: null, jobs: [], courierPercentage: null });
    const out = recalcFromRun(run, 2, null);
    expect(out).toEqual({ mins: 0, revenue: 0, payout: 0 });
  });
});

describe('runBuilderTotals', () => {
  it('sums job amounts for revenue when present', () => {
    const run = makeRun({
      mins: 60,
      kms: 10,
      jobs: [makeRunJob({ amount: 10 }), makeRunJob({ amount: 20 })],
      courierPercentage: 0.5,
    });
    const out = runBuilderTotals(run);
    expect(out.revenue).toBe(30);
  });

  it('falls back to mins-based revenue when jobs have no amounts', () => {
    const run = makeRun({
      mins: 120,
      kms: 10,
      jobs: [makeRunJob({}), makeRunJob({})],
      courierPercentage: 0.5,
    });
    const out = runBuilderTotals(run);
    expect(out.revenue).toBe(50);
  });

  it('computes exp as kms * RUN_EXP_PER_KM', () => {
    const run = makeRun({ mins: 60, kms: 20, jobs: [], courierPercentage: null });
    const out = runBuilderTotals(run);
    expect(out.exp).toBe(10);
  });

  it('computes hourPct as fraction of 8-hour day', () => {
    const run = makeRun({ mins: 240, kms: 0, jobs: [], courierPercentage: null });
    const out = runBuilderTotals(run);
    expect(out.hourPct).toBe(50);
  });

  it('returns hourPct 0 when mins is negative or zero', () => {
    const run = makeRun({ mins: 0, kms: 0, jobs: [], courierPercentage: null });
    const out = runBuilderTotals(run);
    expect(out.hourPct).toBe(0);
  });

  it('returns null courierPct when revenue is zero', () => {
    const run = makeRun({ mins: 0, kms: 0, jobs: [], courierPercentage: 0.5 });
    const out = runBuilderTotals(run);
    expect(out.courierPct).toBe(null);
  });

  it('treats null mins and kms as zero', () => {
    const run = makeRun({ mins: null, kms: null, jobs: [], courierPercentage: null });
    const out = runBuilderTotals(run);
    expect(out.exp).toBe(0);
    expect(out.payout).toBe(0);
  });

  it('treats null courierPercentage as zero', () => {
    const run = makeRun({ mins: 60, kms: 0, jobs: [makeRunJob({ amount: 100 })], courierPercentage: null });
    const out = runBuilderTotals(run);
    expect(out.payout).toBe(0);
  });
});
