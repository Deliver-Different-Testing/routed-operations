import type { BuildConfig, BulkJob } from '../types';

const KEY = 'RoutedOps_buildConfig';

const DEFAULTS: BuildConfig = {
  buildParameter: 'maxBoxes',
  minutesPerStop: 2,
  vehicleCapacityEnabled: false,
  vehicleSizeId: 'custom',
  vehicleCubicCap: 15,
  routingMode: 'aToB',
  finishAtBulkJobId: null,
  noReroute: false,
  respectPickupCutoff: false,
};

export function loadBuildConfig(): BuildConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<BuildConfig>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveBuildConfig(cfg: BuildConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch { /* localStorage full or blocked - non-fatal */ }
}

export function buildModeLabel(cfg: BuildConfig): string {
  const base = cfg.buildParameter === 'deliveryWindow' ? 'Delivery Window' : 'Max Boxes';
  return cfg.vehicleCapacityEnabled ? `${base} + VC` : base;
}

/**
 * Minutes between two schedule-window timestamps. The SP returns them as
 * DateTime (US: 1900-01-01 HH:MM:SS from a TIME cast; NZ: real datetimes).
 * We only care about the delta, so any injected epoch date is fine.
 * Wraps overnight windows (end < start) forward by 24h.
 */
export function windowMinutes(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  let mins = (e - s) / 60000;
  if (mins <= 0) mins += 24 * 60;
  return Math.max(0, mins);
}

export interface SplitConstraints {
  minutesPerStop: number;
  maxBoxesCap?: number | null;
  legMinutes?: number[] | null;
  windowMins?: number | null;
  vehicleCubicCap?: number | null;
  // Pickup-cutoff cap (Plan §Phase 2 §6.5). Minutes from run start after which
  // no further pickup can happen - the courier must clear the last pickup
  // by then. When set alongside windowMins, whichever is tighter wins.
  pickupCutoffMins?: number | null;
}

/**
 * Unified constraint splitter - direct port of the legacy
 * splitOrderedJobsByConstraints. Closes the current run as soon as adding
 * the next job would violate any active cap.
 */
export function splitOrderedJobsByConstraints(
  orderedJobs: BulkJob[],
  opts: SplitConstraints
): BulkJob[][] {
  const runs: BulkJob[][] = [];
  if (orderedJobs.length === 0) return runs;

  const mps = opts.minutesPerStop || 0;
  const maxBoxesCap = opts.maxBoxesCap ?? null;
  // If both windowMins and pickupCutoffMins are set, honour whichever is
  // tighter - a run that misses the pickup cutoff is just as broken as one
  // that misses the delivery window.
  const rawWindow = opts.windowMins ?? null;
  const rawPickup = opts.pickupCutoffMins ?? null;
  const windowMins = rawWindow != null && rawPickup != null
    ? Math.min(rawWindow, rawPickup)
    : (rawWindow ?? rawPickup);
  const vcCap = opts.vehicleCubicCap ?? null;
  const legMinutes = opts.legMinutes ?? null;

  let cur: BulkJob[] = [];
  let curTravel = 0;
  let curCubic = 0;

  for (let i = 0; i < orderedJobs.length; i++) {
    const j = orderedJobs[i];
    const candLen = cur.length + 1;
    const thisLeg = legMinutes ? (legMinutes[i] || 0) : 0;
    const candTravel = curTravel + thisLeg;
    const candTotal = candTravel + candLen * mps;
    const jobCubic = Number(j.jobCubicM3) || 0;
    const candCubic = curCubic + jobCubic;

    let violated = false;
    if (maxBoxesCap && candLen > maxBoxesCap) violated = true;
    if (windowMins && candTotal > windowMins) violated = true;
    if (vcCap && candCubic > vcCap) violated = true;

    if (violated && cur.length > 0) {
      runs.push(cur);
      cur = [j];
      curTravel = 0;
      curCubic = jobCubic;
    } else {
      cur.push(j);
      curTravel = candTravel;
      curCubic = candCubic;
    }
  }
  if (cur.length > 0) runs.push(cur);
  return runs;
}

/**
 * Bucket ordered jobs into pre-runs. In Delivery Window mode we group by
 * ScheduleWindowStart (window-first per the 2026-07-13 rework); in Max Boxes
 * mode we group by ToPostCode. Jobs missing required fields are dropped -
 * the caller decides whether to warn the operator about them.
 */
export interface Bucket {
  key: string;
  hhmm: string | null; // for Delivery Window mode only, used in run names
  jobs: BulkJob[];
}

export function bucketJobs(jobs: BulkJob[], mode: 'maxBoxes' | 'deliveryWindow'): Bucket[] {
  if (mode === 'deliveryWindow') {
    const buckets = new Map<string, BulkJob[]>();
    for (const j of jobs) {
      if (!j.scheduleWindowStart || !j.scheduleWindowEnd) continue;
      const key = String(j.scheduleWindowStart);
      const list = buckets.get(key) ?? [];
      list.push(j);
      buckets.set(key, list);
    }
    return Array.from(buckets.entries()).map(([key, list]) => {
      list.sort((a, b) => (a.toPostCode || 0) - (b.toPostCode || 0));
      const d = new Date(list[0].scheduleWindowStart!);
      const hhmm =
        String(d.getUTCHours()).padStart(2, '0') +
        String(d.getUTCMinutes()).padStart(2, '0');
      return { key, hhmm, jobs: list };
    });
  }

  // maxBoxes: group by postcode
  const buckets = new Map<string, BulkJob[]>();
  for (const j of jobs) {
    if (!j.toPostCode) continue;
    const key = String(j.toPostCode);
    const list = buckets.get(key) ?? [];
    list.push(j);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries()).map(([key, list]) => ({ key, hhmm: null, jobs: list }));
}
