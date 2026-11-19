import { describe, expect, it } from 'vitest';
import type { CoverageMatchResponse, ScheduleLookup } from '../services/recurringRouteService';
import { buildScheduleList, overlapLabel, tickedHeaderIds } from './scheduleCoverageFilter';

// Final-mile route setup spec 4.3 / section 6 tests 5, 6, 7, 9. The editor
// renders exactly what buildScheduleList returns, so these pin the list an
// operator sees: which schedules, in what order, with what label.

const sched = (headerId: number, name: string, clientCodes: string[] = []): ScheduleLookup => ({
  id: headerId * 10, headerId, name, startTime: '08:00', endTime: '17:00', days: [1, 2, 3, 4, 5],
  isActive: true, clientCodes,
});

const LOOKUP: ScheduleLookup[] = [
  sched(1, 'Alpha'),
  sched(2, 'Bravo', ['NEO']),
  sched(3, 'Charlie'),
  sched(4, 'Delta depot'),
  sched(5, 'Echo'),
];

const MATCH: CoverageMatchResponse = {
  routePostcodeCount: 40,
  rows: [
    { scheduleId: 30, headerId: 3, matchedCount: 12, depotWide: false },
    { scheduleId: 10, headerId: 1, matchedCount: 1, depotWide: false },
    { scheduleId: 40, headerId: 4, matchedCount: 40, depotWide: true },
    { scheduleId: 20, headerId: 2, matchedCount: 12, depotWide: false },
  ],
};

const names = (items: { schedule: ScheduleLookup }[]) => items.map((i) => i.schedule.name);

describe('buildScheduleList', () => {
  it('test 5: lists only schedules sharing a postcode, largest overlap first, then by name, each with its count', () => {
    const items = buildScheduleList(LOOKUP, '', MATCH, new Set());

    expect(names(items)).toEqual(['Delta depot', 'Bravo', 'Charlie', 'Alpha']);
    expect(items.map((i) => i.overlapLabel)).toEqual(
      ['Whole depot', '12 of 40 postcodes', '12 of 40 postcodes', '1 of 40 postcodes']);
    // A schedule sharing exactly one postcode is still listed.
    expect(names(items)).toContain('Alpha');
    expect(names(items)).not.toContain('Echo');
  });

  it('test 6: a ticked schedule with no overlap stays listed with the amber tag, after the matches', () => {
    const items = buildScheduleList(LOOKUP, '', MATCH, new Set([5]));

    expect(names(items)[items.length - 1]).toBe('Echo');
    const echo = items.find((i) => i.schedule.name === 'Echo')!;
    expect(echo.noOverlap).toBe(true);
    expect(echo.overlapLabel).toBeNull();
    expect(items.filter((i) => i.noOverlap)).toHaveLength(1);
  });

  it('test 7 / 9: with the filter not applied the list is the lookup row for row, no labels', () => {
    const items = buildScheduleList(LOOKUP, '', null, new Set([5]));

    expect(items.map((i) => i.schedule)).toEqual(LOOKUP);
    expect(items.every((i) => i.overlapLabel === null && !i.noOverlap)).toBe(true);
  });

  it('the text filter still applies on top of the coverage filter (name or client code)', () => {
    expect(names(buildScheduleList(LOOKUP, 'neo', MATCH, new Set()))).toEqual(['Bravo']);
    expect(names(buildScheduleList(LOOKUP, 'ech', MATCH, new Set([5])))).toEqual(['Echo']);
    expect(names(buildScheduleList(LOOKUP, 'ech', MATCH, new Set()))).toEqual([]);
  });

  it('an applied filter with no matches and nothing ticked shows an empty list, not the full one', () => {
    expect(buildScheduleList(LOOKUP, '', { routePostcodeCount: 3, rows: [] }, new Set())).toEqual([]);
  });
});

describe('tickedHeaderIds', () => {
  it('finds the header from the route\'s own day row when the lookup lists a different one', () => {
    // Route bound day row 51 of header 5; the lookup lists header 5 as day row 50.
    const ticked = tickedHeaderIds(new Set([51, 10]), LOOKUP, [{ scheduleId: 51, headerId: 5 }]);

    expect([...ticked].sort()).toEqual([1, 5]);
  });

  it('drops a header once its day row is unticked', () => {
    expect(tickedHeaderIds(new Set(), LOOKUP, [{ scheduleId: 51, headerId: 5 }]).size).toBe(0);
  });
});

describe('overlapLabel', () => {
  it('says whole depot for a depot-wide schedule whatever the count', () => {
    expect(overlapLabel(3, true, 40)).toBe('Whole depot');
  });
  it('singular for a one-postcode route', () => {
    expect(overlapLabel(1, false, 1)).toBe('1 of 1 postcode');
  });
});

describe('buildScheduleList, edge cases', () => {
  const s = (id: number, headerId: number, name: string, clientCodes: string[] = []): ScheduleLookup =>
    ({ id, headerId, name, startTime: '08:00', endTime: '12:00', days: [1], isActive: true, clientCodes });
  const lookup = [s(10, 1, 'Alpha'), s(20, 2, 'Bravo', ['NEO']), s(40, 4, 'Delta')];
  const match: CoverageMatchResponse = { routePostcodeCount: 40, rows: [{ scheduleId: 20, headerId: 2, matchedCount: 12, depotWide: false }] };

  it('the text filter hides a ticked schedule with no overlap (4.3.4 "always shown" yields to 4.3.5)', () => {
    const items = buildScheduleList(lookup, 'neo', match, new Set([4]));
    expect(names(items)).toEqual(['Bravo']);
  });

  it('a ticked schedule that DOES overlap shows its count and no amber tag', () => {
    const items = buildScheduleList(lookup, '', match, new Set([2]));
    expect(items).toEqual([{ schedule: lookup[1], overlapLabel: '12 of 40 postcodes', noOverlap: false }]);
  });

  it('matches by header id even when the response day-row id differs from the lookup id', () => {
    const odd: CoverageMatchResponse = { routePostcodeCount: 5, rows: [{ scheduleId: 999, headerId: 1, matchedCount: 2, depotWide: true }] };
    const items = buildScheduleList(lookup, '', odd, new Set());
    expect(items.map((i) => [i.schedule.id, i.overlapLabel])).toEqual([[10, 'Whole depot']]);
  });

  it('filter not applied: exactly the lookup, same order, same objects (spec test 9)', () => {
    const items = buildScheduleList(lookup, '', null, new Set([4]));
    expect(items.map((i) => i.schedule)).toEqual(lookup);
    expect(items.every((i) => i.overlapLabel === null && !i.noOverlap)).toBe(true);
  });
});
