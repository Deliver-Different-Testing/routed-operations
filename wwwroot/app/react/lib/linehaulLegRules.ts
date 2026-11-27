// UC #1115 M2. Labels, help text and validation for the pricing fields on a
// linehaul leg (tblBulkScheduleLinehaul), shared by the chain builder
// (schedules-new/ChainBuilder.tsx) and the older ScheduleEditModal so the two
// editors cannot drift. The server repeats the range check in
// ScheduleService.ValidateLinehauls, so an API caller cannot skip it.
//
// What the columns do, per the live booking procs and quote function:
//   ApplyDiscount        leg price divided by (1 + tucClient.Discount)
//   ApplyAddOnPercentage additional items charged at the client / speed
//                        additional item percentage instead of 100%
//   AmountPercentage     a fraction of the delivery zone base rate. How it
//                        combines with Amount differs today (the quote adds
//                        both, job creation uses Amount only, a run rate on
//                        the Linehaul tab replaces both on a quote), so the
//                        texts below stay neutral until decision D2.

export const LINEHAUL_LABELS = {
  applyDiscount: 'Apply client discount',
  applyDiscountHelp: 'Uses the Discount on the client.',
  applyAddOnPercentage: 'Discount additional items',
  // Static on purpose: the live figure comes from
  // UTL_fncJob_GetClientAvailableSpeed, which answers differently per SQL
  // login and time of day, so a value computed here could disagree with the
  // one the booking proc uses. See the UC #1115 M2 report.
  applyAddOnPercentageHelp:
    "Charges each additional item at the client's additional item percentage, else the speed's, else 80%.",
  amountPercentage: 'Plus % of delivery zone rate',
  amountPercentageHelp: 'Enter 0.5 for 50% of the delivery zone base rate.',
  // Spec v2 Part B 2: shown beside a read-only Amount when a Linehaul tab row prices the leg.
  amountFromLinehaulTab: 'Set on the Linehaul tab',
} as const;

/** Highest accepted zone %: 1 = 100% of the delivery zone base rate. */
export const ZONE_PERCENT_MAX = 1;

export const ZONE_PERCENT_TOO_HIGH_MESSAGE =
  'Enter a fraction: 0.5 means 50%. 50 would be fifty times the zone rate.';
export const ZONE_PERCENT_NEGATIVE_MESSAGE = 'The zone rate percentage cannot be negative.';
export const BOTH_CHARGED_WARNING =
  'Amount and % of zone rate are both set. Only one should be used; check with pricing before saving.';

/** Leg summary text: the stored fraction 0.5 reads as "+50% of zone rate". */
export function formatZonePercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '';
  const pct = Math.round(fraction * 100 * 100) / 100;
  return `${pct < 0 ? '' : '+'}${pct}% of zone rate`;
}

/** UC #1115 (spec 2.4 item 4b): a leg Amount as stored (money, up to 4 decimals), at least 2 shown. */
export function formatLegAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  return amount.toFixed(4).replace(/0{1,2}$/, '');
}

export function zonePercentError(value: number | null | undefined): string | null {
  if (value == null) return null;
  if (Number.isNaN(value)) return ZONE_PERCENT_TOO_HIGH_MESSAGE;
  if (value < 0) return ZONE_PERCENT_NEGATIVE_MESSAGE;
  if (value > ZONE_PERCENT_MAX) return ZONE_PERCENT_TOO_HIGH_MESSAGE;
  return null;
}

/** Non-blocking: three prod legs have both set and D2 is still open. */
export function bothChargedWarning(
  amount: number | null | undefined,
  amountPercentage: number | null | undefined,
): string | null {
  return (amount ?? 0) > 0 && (amountPercentage ?? 0) > 0 ? BOTH_CHARGED_WARNING : null;
}

/** Save-time check over every leg; returns the first blocking message. */
export function firstLinehaulPricingError(
  legs: ReadonlyArray<{ name?: string | null; amount?: number | null; amountPercentage?: number | null }>,
): string | null {
  for (let i = 0; i < legs.length; i++) {
    const err = zonePercentError(legs[i].amountPercentage);
    if (err) return `Linehaul ${legs[i].name?.trim() || `#${i + 1}`}: ${err}`;
  }
  return null;
}

/** The Linehaul tab rows the editor reads (linehaulRateService.runs / scheduleRates). */
export interface LinehaulTabRows {
  /** Run-level cells for one client (GET /api/linehaul-rates?clientId=), active rows only. */
  runs: ReadonlyArray<{ runId: number; anySpeed: { rateId: number | null }; speedCells: ReadonlyArray<{ speedId: number | null; rateId: number | null }> }>;
  /** Schedule rows on the leg's run for the same client (GET /api/linehaul-rates/runs/{runId}/schedules). */
  scheduleRates: ReadonlyArray<{ scheduleId: number; speedId: number | null; active: boolean }>;
}

/**
 * UC #1115 spec v2 Part B 2. True when a BulkLinehaulRate row prices this leg for EVERY
 * client in `perClient`, so the leg's own Amount and zone % are not used. Same match as
 * fncT_BulkZoneRate_WithLinehaul (20261126200000, OUTER APPLY on BulkLinehaulRate) and the
 * J2 cursor in 20261126200100: an active row on the leg's run, schedule = this one or NULL,
 * client = the booking's or NULL, speed = the booking's or NULL. Only existence matters
 * here, so the schedule, client, speed precedence does not. A client with no row is
 * priced from the leg, so one such client keeps the fields editable.
 */
export function legPricedFromLinehaulTab(
  linehaulRunId: number | null | undefined,
  scheduleId: number | null,
  speedId: number | null,
  perClient: ReadonlyArray<LinehaulTabRows>,
): boolean {
  if (linehaulRunId == null || perClient.length === 0) return false;
  const speedMatches = (rowSpeed: number | null) => rowSpeed == null || rowSpeed === speedId;
  return perClient.every(({ runs, scheduleRates }) => {
    const run = runs.find((r) => r.runId === linehaulRunId);
    const runLevel = run != null && (run.anySpeed.rateId != null
      || run.speedCells.some((c) => c.rateId != null && c.speedId != null && speedMatches(c.speedId)));
    const scheduleLevel = scheduleId != null
      && scheduleRates.some((r) => r.active && r.scheduleId === scheduleId && speedMatches(r.speedId));
    return runLevel || scheduleLevel;
  });
}
