// UC #1115 M2. The "Plus % of delivery zone rate" field (tblBulkScheduleLinehaul
// .AmountPercentage) is a fraction of the delivery zone base rate. Both booking
// procs and the quote function multiply by it directly, so 50 means fifty times
// the zone rate, not 50%. These tests pin that rule, and that the both-set case
// is only a warning (three prod legs have both and D2 is still open).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  zonePercentError,
  bothChargedWarning,
  firstLinehaulPricingError,
  legPricedFromLinehaulTab,
  type LinehaulTabRows,
  ZONE_PERCENT_TOO_HIGH_MESSAGE,
  ZONE_PERCENT_NEGATIVE_MESSAGE,
  BOTH_CHARGED_WARNING,
  LINEHAUL_LABELS,
  formatZonePercent,
  formatLegAmount,
} from './linehaulLegRules';

// How Amount and the zone % combine differs today: the quote adds them, job
// creation uses Amount only, and a run rate on the Linehaul tab replaces both
// on a quote (decision D2 is open). The texts must not promise either rule.
describe('neutral wording while D2 is open', () => {
  it('the both-set warning does not say the % is charged or added', () => {
    expect(BOTH_CHARGED_WARNING).toBe(
      'Amount and % of zone rate are both set. Only one should be used; check with pricing before saving.',
    );
  });

  it('the zone % help only explains the format', () => {
    expect(LINEHAUL_LABELS.amountPercentageHelp).toBe('Enter 0.5 for 50% of the delivery zone base rate.');
  });
});

// The add-on lookup falls back client, then speed, then 80% (SPEC section 4),
// so the help must not tell a user a client without a % gets 80% when the
// speed has its own.
describe('"Discount additional items" help', () => {
  it('names the full fallback order', () => {
    expect(LINEHAUL_LABELS.applyAddOnPercentageHelp).toBe(
      "Charges each additional item at the client's additional item percentage, else the speed's, else 80%.",
    );
  });
});

// The same text is shown by the editor and returned by the server, so a user
// sees one message whichever side catches the value. Pinned literally so a
// wording change cannot pass by editing the constant alone.
describe('zone % messages', () => {
  it('too-high and negative messages are exactly these', () => {
    expect(ZONE_PERCENT_TOO_HIGH_MESSAGE).toBe(
      'Enter a fraction: 0.5 means 50%. 50 would be fifty times the zone rate.',
    );
    expect(ZONE_PERCENT_NEGATIVE_MESSAGE).toBe('The zone rate percentage cannot be negative.');
  });

  it('ScheduleService.cs carries both messages verbatim', () => {
    const cs = readFileSync(
      resolve(__dirname, '../../../../Core/Application/Services/Schedule/ScheduleService.cs'), 'utf8');
    expect(cs).toContain(ZONE_PERCENT_TOO_HIGH_MESSAGE);
    expect(cs).toContain(ZONE_PERCENT_NEGATIVE_MESSAGE);
  });
});

describe('formatZonePercent', () => {
  it('shows the stored fraction as a percentage of the zone rate', () => {
    expect(formatZonePercent(0.5)).toBe('+50% of zone rate');
    expect(formatZonePercent(0.125)).toBe('+12.5% of zone rate');
    expect(formatZonePercent(1)).toBe('+100% of zone rate');
    expect(formatZonePercent(50)).toBe('+5000% of zone rate');
    expect(formatZonePercent(0.1 + 0.2)).toBe('+30% of zone rate');
  });

  it('prints a negative with one sign, not "+-"', () => {
    expect(formatZonePercent(-0.1)).toBe('-10% of zone rate');
  });

  it('prints nothing for a non-finite value rather than "+NaN%"', () => {
    expect(formatZonePercent(Number.NaN)).toBe('');
    expect(formatZonePercent(Number.POSITIVE_INFINITY)).toBe('');
    expect(formatZonePercent(Number.NEGATIVE_INFINITY)).toBe('');
  });
});

// UC #1115 spec 2.4 item 4b: the leg summary showed $2.84 for a stored 2.8365, so the
// screen hid the 4 decimals money keeps. Show what is stored, never fewer than 2.
describe('formatLegAmount', () => {
  it('shows all 4 stored decimals (#332)', () => {
    expect(formatLegAmount(2.8365)).toBe('2.8365');
    expect(formatLegAmount(11.5094)).toBe('11.5094');
  });
  it('keeps at least 2 decimals and drops trailing zeros past them', () => {
    expect(formatLegAmount(30)).toBe('30.00');
    expect(formatLegAmount(2.84)).toBe('2.84');
    expect(formatLegAmount(2.836)).toBe('2.836');
  });
});

describe('zonePercentError', () => {
  it('accepts empty, 0, a fraction and exactly 1 (100% of the zone rate)', () => {
    expect(zonePercentError(null)).toBeNull();
    expect(zonePercentError(undefined)).toBeNull();
    expect(zonePercentError(0)).toBeNull();
    expect(zonePercentError(0.5)).toBeNull();
    expect(zonePercentError(1)).toBeNull();
    expect(zonePercentError(-0)).toBeNull();
  });

  it('the upper bound is inclusive: 1.0000001 is rejected', () => {
    expect(zonePercentError(1.0000001)).toBe(ZONE_PERCENT_TOO_HIGH_MESSAGE);
  });

  it('rejects NaN, so a garbled value cannot pass as valid and block nothing', () => {
    expect(zonePercentError(Number.NaN)).toBe(ZONE_PERCENT_TOO_HIGH_MESSAGE);
    expect(firstLinehaulPricingError([{ name: 'A', amountPercentage: Number.NaN }])).toContain(
      ZONE_PERCENT_TOO_HIGH_MESSAGE,
    );
  });

  it('rejects 50, because the pricing code would charge fifty times the zone rate', () => {
    expect(zonePercentError(50)).toBe(ZONE_PERCENT_TOO_HIGH_MESSAGE);
    expect(zonePercentError(1.01)).toBe(ZONE_PERCENT_TOO_HIGH_MESSAGE);
  });

  it('rejects a negative value', () => {
    expect(zonePercentError(-0.1)).toMatch(/negative/i);
  });
});

describe('bothChargedWarning', () => {
  it('warns when Amount and the zone % are both above 0', () => {
    expect(bothChargedWarning(30, 0.5)).toBe(BOTH_CHARGED_WARNING);
  });

  it('is silent when only one of them is set', () => {
    expect(bothChargedWarning(30, 0)).toBeNull();
    expect(bothChargedWarning(30, null)).toBeNull();
    expect(bothChargedWarning(0, 0.5)).toBeNull();
    expect(bothChargedWarning(null, 0.5)).toBeNull();
  });
});

describe('firstLinehaulPricingError', () => {
  it('names the first bad leg so the save message points at it', () => {
    const msg = firstLinehaulPricingError([
      { name: 'Good', amountPercentage: 0.5 },
      { name: 'WLG to AKL', amountPercentage: 50 },
    ]);
    expect(msg).toContain('WLG to AKL');
    expect(msg).toContain(ZONE_PERCENT_TOO_HIGH_MESSAGE);
  });

  it('does not block a save for the both-set warning', () => {
    expect(firstLinehaulPricingError([{ name: 'A', amount: 30, amountPercentage: 0.5 }])).toBeNull();
  });
});

// UC #1115 spec v2 Part B 2 / test 8. A Linehaul tab row (BulkLinehaulRate) prices the leg
// on the quote and on job creation (fncT 20261126200000, J2 in 20261126200100), so the leg's
// own Amount and zone % do nothing there and the editor must not offer them as if they did.
// The match is the SQL's: run, schedule or NULL, client or NULL, speed or NULL.
describe('legPricedFromLinehaulTab', () => {
  const RUN = 43;
  const noRows: LinehaulTabRows = { runs: [], scheduleRates: [] };
  const runCell = (anyRateId: number | null, speedCells: { speedId: number | null; rateId: number | null }[] = []): LinehaulTabRows['runs'][number] =>
    ({ runId: RUN, anySpeed: { rateId: anyRateId }, speedCells });

  it('schedule-level row for this schedule prices the leg', () => {
    const rows = { runs: [], scheduleRates: [{ scheduleId: 2736, speedId: null, active: true }] };
    expect(legPricedFromLinehaulTab(RUN, 2736, 160, [rows])).toBe(true);
  });

  it('a row for another schedule, or an inactive one, does not', () => {
    expect(legPricedFromLinehaulTab(RUN, 2736, 160, [{ runs: [], scheduleRates: [{ scheduleId: 2894, speedId: null, active: true }] }])).toBe(false);
    expect(legPricedFromLinehaulTab(RUN, 2736, 160, [{ runs: [], scheduleRates: [{ scheduleId: 2736, speedId: null, active: false }] }])).toBe(false);
  });

  it('client-level or default any-speed row prices the leg, new schedule included', () => {
    expect(legPricedFromLinehaulTab(RUN, null, 160, [{ runs: [runCell(7)], scheduleRates: [] }])).toBe(true);
  });

  it('speed-level row prices the leg only at that speed', () => {
    const rows = { runs: [runCell(null, [{ speedId: 160, rateId: 9 }])], scheduleRates: [] };
    expect(legPricedFromLinehaulTab(RUN, 2736, 160, [rows])).toBe(true);
    expect(legPricedFromLinehaulTab(RUN, 2736, 161, [rows])).toBe(false);
    expect(legPricedFromLinehaulTab(RUN, 2736, null, [rows])).toBe(false);
  });

  it('a row on another run, or a leg with no run, does not', () => {
    expect(legPricedFromLinehaulTab(44, 2736, 160, [{ runs: [runCell(7)], scheduleRates: [] }])).toBe(false);
    expect(legPricedFromLinehaulTab(null, 2736, 160, [{ runs: [runCell(7)], scheduleRates: [] }])).toBe(false);
  });

  it('every client must have a row: one client priced from the leg keeps the fields', () => {
    expect(legPricedFromLinehaulTab(RUN, null, 160, [{ runs: [runCell(7)], scheduleRates: [] }, noRows])).toBe(false);
  });
});
