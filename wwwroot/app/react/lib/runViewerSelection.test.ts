import { describe, expect, it } from 'vitest';
import { buildRunFilterIdentity, pruneSelectedRunIds, type RunSelectionFilters } from './runViewerSelection';

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
