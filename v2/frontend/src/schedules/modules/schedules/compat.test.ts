// Compatibility with the existing (old) schedules view.
//
// The old screen reads tblBulkRunSchedule day rows and resolves a client's schedules as
//   rows.ClientId = @client  OR  rows.ClientId IS NULL (defaults).
// The new view keeps writing those rows through Dane's multiDayToPerDay mapping and adds the
// link table on top. These tests pin down that (a) the day rows are unchanged in shape and count,
// (b) the new view never writes the one-to-one ClientId column — clients live only in the link table,
// and (c) reading legacy rows (ClientId set) still yields the same answer the old rule gives.

import { describe, it, expect } from 'vitest';
import {
  buildScheduleTableData,
  createEmptySchedule,
  getClientIds,
  getVisibility,
  multiDayToPerDay,
  perDayToMultiDay,
  type BulkRunScheduleRow,
  type Schedule,
} from './types';
import { sampleClients, sampleDepots, sampleSchedules, sampleSpeeds } from './data/sampleData';
import { effectiveSchedulesForClient, withClientsAttached } from './utils/clientLinks';

/** The old view's rule, per day row. */
function oldViewCanSee(rows: BulkRunScheduleRow[], clientId: number): boolean {
  return rows.some((r) => r.clientId == null || r.clientId === clientId);
}

function enabledDayCount(s: Schedule): number {
  return Object.values(s.operatingSchedule.days).filter((d) => d.enabled).length;
}

describe('day rows are unchanged by the link model', () => {
  it('writes one tblBulkRunSchedule row per enabled day, same as before', () => {
    for (const s of sampleSchedules) {
      const rows = multiDayToPerDay(s);
      expect(rows.length).toBe(enabledDayCount(s));
      // every row carries the schedule name and a real day-of-week 1..7
      rows.forEach((r) => {
        expect(r.name).toBe(s.name);
        expect(r.dayOfWeek).toBeGreaterThanOrEqual(1);
        expect(r.dayOfWeek).toBeLessThanOrEqual(7);
      });
    }
  });

  it('a default schedule still writes ClientId NULL on every day row', () => {
    const def = sampleSchedules.find((s) => s.id === 1)!;
    expect(getVisibility(def)).toBe('all');
    multiDayToPerDay(def).forEach((r) => expect(r.clientId).toBeUndefined());
  });

  it('never writes the one-to-one ClientId: every day row goes out with no ClientId', () => {
    for (const s of sampleSchedules) {
      multiDayToPerDay(s).forEach((r) => expect(r.clientId).toBeUndefined());
    }
    // …so the client reference is only in the link rows
    const shared = sampleSchedules.find((s) => s.id === 10)!;
    expect(getClientIds(shared).length).toBeGreaterThan(1);
  });

  it('attaching more clients does not change the day rows the old screen reads', () => {
    const before = multiDayToPerDay(sampleSchedules.find((s) => s.id === 10)!);
    const after = multiDayToPerDay(withClientsAttached(sampleSchedules.find((s) => s.id === 10)!, [1009, 1010]));
    expect(after).toEqual(before);
  });
});

describe('reading old day rows into the new model', () => {
  const base = { ...createEmptySchedule(), id: 500, rowIds: [], name: 'Legacy' } as Schedule;
  const mkRows = (clientId: number | undefined): BulkRunScheduleRow[] =>
    [1, 2, 3].map((d, i) => ({
      bulkRunScheduleId: 900 + i, name: 'Legacy', dayOfWeek: d, startTime: '08:00', endTime: '10:00', maxJobs: 10000,
      region: 1, speedId: 1, cutoffHours: 17, autoBook: true, bookPickup: false, clientId,
    }));

  it('rows with ClientId NULL read as a default (all clients)', () => {
    const s = perDayToMultiDay(mkRows(undefined));
    expect(getVisibility(s)).toBe('all');
    expect(getClientIds(s)).toEqual([]);
    expect(s.name).toBe(base.name);
  });

  it('rows with a ClientId read as a specific schedule linked to that client', () => {
    const s = perDayToMultiDay(mkRows(1001));
    expect(getVisibility(s)).toBe('specific');
    expect(getClientIds(s)).toEqual([1001]);
  });
});

describe('resolution rule equals the old rule on legacy 1:1 data', () => {
  // Legacy data: every client-specific schedule has exactly one client and no link rows / base ids.
  const legacy: Schedule[] = sampleSchedules.map((s) => ({
    ...s,
    visibility: undefined,
    clientIds: undefined,
    baseScheduleId: undefined,
    clientId: s.isOverride || getVisibility(s) === 'specific' ? getClientIds(s)[0] ?? null : null,
  }));

  it.each([1001, 1002, 1004, 1005, 4242])('client %s sees the same schedules under both rules', (clientId) => {
    // The legacy database holds ClientId on the day rows; stamp it the way the old writer did.
    const legacyRows = (s: Schedule): BulkRunScheduleRow[] =>
      multiDayToPerDay(s).map((r) => ({ ...r, clientId: s.clientId ?? undefined })) as unknown as BulkRunScheduleRow[];
    const oldRule = legacy
      .filter((s) => oldViewCanSee(legacyRows(s), clientId))
      .map((s) => s.id)
      .sort();
    const newRule = effectiveSchedulesForClient(legacy, clientId)
      .map((e) => e.schedule.id)
      .sort();
    // The one deliberate difference: the new rule hides a base that the client has an override of.
    const overriddenBases = legacy
      .filter((s) => s.isOverride && s.clientId === clientId)
      .map((o) => legacy.find((b) => !b.isOverride && b.name === o.baseScheduleName)?.id)
      .filter((id): id is number => id != null);
    expect(newRule).toEqual(oldRule.filter((id) => !overriddenBases.includes(id)));
  });
});

describe('table rows', () => {
  it('nests an override under its base by id and shows linked client codes', () => {
    const rows = buildScheduleTableData(sampleSchedules, sampleDepots, sampleClients, sampleSpeeds);
    const base = rows.find((r) => r.id === 20)!;
    const idx = rows.indexOf(base);
    expect(base.overrideCount).toBe(1);
    expect(rows[idx + 1].id).toBe(30);
    expect(rows[idx + 1].isOverride).toBe(true);
    expect(rows[idx + 1].depth).toBe(1);
    expect(base.clientDisplay).toContain('GLOBEX');
    expect(rows.find((r) => r.id === 1)!.clientDisplay).toBe('All');
  });
});
