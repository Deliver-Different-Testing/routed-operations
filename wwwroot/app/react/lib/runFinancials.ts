import type { Run } from '../types';

/**
 * Live financial recalc for a run. Direct port of legacy $scope.calculateRunDetails:
 *
 *   dropExtra   = minutesPerStop * jobs.length
 *   totalMins   = travelMins + dropExtra
 *   hourlyRate  = 25          (hardcoded per legacy - tenant-configurable later)
 *   expPerKm    = 0.5         (hardcoded per legacy)
 *   revenue     = (totalMins / 60) * hourlyRate + kms * expPerKm
 *   payout      = revenue * courierPercentage
 *
 * The travel-minutes come from the run's existing `mins` value (set by the
 * optimise flow) minus the *previous* drop overhead. To keep the maths simple
 * and stable across recalcs, we treat `run.mins` as travel-only when the
 * caller passes it - i.e. the caller is expected to pass in the raw travel
 * minutes, not a running total.
 *
 * Returns the new mins (travel + dropExtra), revenue, payout. Callers can
 * feed these straight into a PUT /api/runs/{id} body.
 */
export interface RunFinancials {
  mins: number;
  revenue: number;
  payout: number;
}

export interface RecalcInput {
  travelMinutes: number;
  kms: number;
  jobCount: number;
  minutesPerStop: number;
  courierPercentage: number | null;
}

export const RUN_HOURLY_RATE = 25;
export const RUN_EXP_PER_KM = 0.5;

export function recalcRunFinancials(input: RecalcInput): RunFinancials {
  const dropExtra = input.minutesPerStop * input.jobCount;
  const totalMins = Math.round(input.travelMinutes + dropExtra);
  const revenue = (totalMins / 60) * RUN_HOURLY_RATE + (input.kms ?? 0) * RUN_EXP_PER_KM;
  const payout = revenue * (input.courierPercentage ?? 0);
  return {
    mins: totalMins,
    revenue: Math.round(revenue * 100) / 100,
    payout: Math.round(payout * 100) / 100,
  };
}

/**
 * Convenience wrapper: recalc from a Run object + minutesPerStop, taking the
 * current run.mins as travel-only + jobs.length as jobCount.
 */
export function recalcFromRun(run: Run, minutesPerStop: number, courierPercentage: number | null): RunFinancials {
  return recalcRunFinancials({
    travelMinutes: run.mins ?? 0,
    kms: run.kms ?? 0,
    jobCount: run.jobs.length,
    minutesPerStop,
    courierPercentage,
  });
}

export interface RunTotals {
  hourPct: number;
  revenue: number;
  exp: number;
  courierPct: number | null;
  payout: number;
}

/**
 * Display-side totals for the Run Builder calculator strip. Uses the run's
 * existing mins + kms (server-authoritative after optimise/dispatch) and its
 * per-job Amount to compute:
 *   Revenue = sum of job.amount (fallback: mins/60 * RATE if no amounts)
 *   Exp     = kms * RUN_EXP_PER_KM
 *   HourPct = (mins / 60) / 8 * 100  (8h working day)
 *   Payout  = (mins/60 * RATE) * courierPct
 *   CourPct = payout / revenue * 100
 * Matches the legacy $scope.calculateRunDetails output the Run Builder
 * calculator strip renders.
 */
export function runBuilderTotals(run: Run): RunTotals {
  const mins = run.mins ?? 0;
  const kms = run.kms ?? 0;
  const revenue = run.jobs.reduce((sum, j) => sum + (j.amount ?? 0), 0)
    || (mins / 60) * RUN_HOURLY_RATE;
  const exp = kms * RUN_EXP_PER_KM;
  const payout = (mins / 60) * RUN_HOURLY_RATE * (run.courierPercentage ?? 0);
  const courierPct = revenue > 0 ? (payout / revenue) * 100 : null;
  const hourPct = (mins / 60 / 8) * 100;
  return {
    hourPct: Math.max(0, hourPct),
    revenue,
    exp,
    courierPct,
    payout,
  };
}
