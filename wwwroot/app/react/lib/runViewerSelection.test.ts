import { describe, expect, it } from 'vitest';
import {
  buildRunFilterIdentity, pruneSelectedRunIds, runIdOfKey, runRowJobFilters, runRowJobScope, runRowKey, rowKeyForJob,
  type RunSelectionFilters,
} from './runViewerSelection';

const base: RunSelectionFilters = {
  runDate: '2026-11-04',
  regionIds: [3],
  speedIds: [423],
  clientIds: [],
  courierId: null,
};

// #1002: the selection must reset whenever a filter can drop the selected
// run out of the Run List. Before, only date + regions were in the key.
describe('buildRunFilterIdentity', () => {
  it.each([
    ['view mode', base, 'Inbound'],
    ['speeds', { ...base, speedIds: [423, 12] }, 'Combined'],
    ['clients', { ...base, clientIds: [85] }, 'Combined'],
    ['courier', { ...base, courierId: 20 }, 'Combined'],
    ['date', { ...base, runDate: '2026-11-05' }, 'Combined'],
    ['regions', { ...base, regionIds: [4] }, 'Combined'],
  ])('changes when %s changes', (_label, filters, viewMode) => {
    expect(buildRunFilterIdentity(filters, viewMode)).not.toBe(buildRunFilterIdentity(base, 'Combined'));
  });

  it('ignores the order ids were picked in', () => {
    const a = buildRunFilterIdentity({ ...base, speedIds: [12, 423], clientIds: [9, 2], regionIds: [4, 3] }, 'Combined');
    const b = buildRunFilterIdentity({ ...base, speedIds: [423, 12], clientIds: [2, 9], regionIds: [3, 4] }, 'Combined');
    expect(a).toBe(b);
  });

  it('does not mutate the caller arrays when sorting', () => {
    const speeds = [423, 12];
    buildRunFilterIdentity({ ...base, speedIds: speeds }, 'Combined');
    expect(speeds).toEqual([423, 12]);
  });
});

describe('pruneSelectedRunIds', () => {
  it('drops a selected run that is no longer visible (Inbound with no runs = nothing selected)', () => {
    expect(pruneSelectedRunIds([-15], [])).toEqual([]);
  });

  it('keeps visible runs and drops the rest, in selection order', () => {
    expect(pruneSelectedRunIds([-15, -5, 7], [7, -15])).toEqual([-15, 7]);
  });

  it('returns the same array when nothing changes, so the state setter can bail out', () => {
    const sel = [-15];
    expect(pruneSelectedRunIds(sel, [-15, -5])).toBe(sel);
  });
});

// #311 / #326: one run, two drivers = two rows with the same id. They must
// not share a key, and each row's jobs are its own courier's (or nobody's).
describe('runRowKey / runRowJobScope', () => {
  const held = { id: 41, courierId: 7, preAssigned: 0 };
  const unheld = { id: 41, courierId: null, preAssigned: 0 };
  const pre = { id: 41, courierId: 7, preAssigned: 1 };
  const missing = { id: 41, courierId: null, preAssigned: 0, isMissing: true };

  it('gives every half of a split run its own key', () => {
    const keys = [held, unheld, pre, missing].map(runRowKey);
    expect(new Set(keys).size).toBe(4);
    expect(keys.map(runIdOfKey)).toEqual([41, 41, 41, 41]);
  });

  it('scopes the courier row to its courier and the null row to unassigned jobs only', () => {
    expect(runRowJobScope(held)).toEqual({ courierId: 7, unassignedOnly: false, preAssigned: false });
    expect(runRowJobScope(unheld)).toEqual({ courierId: null, unassignedOnly: true, preAssigned: false });
  });

  it('asks for the status-18 jobs of a pre-assigned row', () => {
    expect(runRowJobScope(pre).preAssigned).toBe(true);
  });

  it('does not narrow a missing-scan row, whose courier the proc never reports', () => {
    expect(runRowJobScope(missing)).toEqual({ courierId: null, unassignedOnly: false, preAssigned: false });
  });
});

describe('runRowJobFilters / rowKeyForJob', () => {
  const grid = { group: 'Combined', regionIds: [3], courierId: null as number | null };

  it('fetches the NULL-courier half of a split run as unassigned only', () => {
    expect(runRowJobFilters({ id: 41, courierId: null, preAssigned: 0 }, grid))
      .toEqual({ group: 'Combined', regionIds: [3], courierId: null, unassignedOnly: true, preAssigned: false });
  });

  it("fetches a pre-assigned row as that driver's status-18 jobs", () => {
    expect(runRowJobFilters({ id: 41, courierId: 7, preAssigned: 1 }, grid))
      .toMatchObject({ courierId: 7, unassignedOnly: false, preAssigned: true });
  });

  it('keeps the grid courier filter for a missing-scan row (its courier is unknown)', () => {
    expect(runRowJobFilters({ id: 41, courierId: null, isMissing: true }, { ...grid, courierId: 20 }))
      .toMatchObject({ courierId: 20, unassignedOnly: false, preAssigned: false });
  });

  it("picks the row of the run whose courier holds the job, else the run's first row", () => {
    const rows = [
      { id: 41, courierId: 7, preAssigned: 0 },
      { id: 41, courierId: null, preAssigned: 0 },
      { id: 52, courierId: 9, preAssigned: 0 },
    ];
    expect(rowKeyForJob(rows, 41, null)).toBe(runRowKey(rows[1]));
    expect(rowKeyForJob(rows, 41, 7)).toBe(runRowKey(rows[0]));
    expect(rowKeyForJob(rows, 52, 3)).toBe(runRowKey(rows[2]));
    expect(rowKeyForJob(rows, 99, 7)).toBeNull();
  });
});
