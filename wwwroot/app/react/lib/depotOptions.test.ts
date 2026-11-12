import { describe, expect, it } from 'vitest';
import { depotFilterOptions, depotOptions, hasInactiveDepot, INACTIVE_DEPOT_MESSAGE } from './depotOptions';

// Depot 3 is retired. An edit select must not offer it for new picks, but a
// record already on it has to keep showing it (a blank select would read as
// "no depot" and a save would silently clear it). Save is then blocked until
// the operator moves it to an active depot.
const depots = [
  { id: 8, name: 'Auckland', active: true },
  { id: 3, name: 'Tauranga', active: false },
  { id: 4, name: 'Hamilton' }, // no flag: treated as active
];

describe('depotOptions', () => {
  it('hides inactive depots when none is the current value', () => {
    expect(depotOptions(depots, null).map((o) => o.id)).toEqual([8, 4]);
    expect(depotOptions(depots, 8).map((o) => o.id)).toEqual([8, 4]);
  });

  it('keeps the current inactive depot, with the suffix', () => {
    const opts = depotOptions(depots, 3);
    expect(opts.map((o) => o.id)).toEqual([8, 3, 4]);
    expect(opts.find((o) => o.id === 3)).toEqual({ id: 3, label: 'Tauranga (inactive)', inactive: true });
    expect(opts.find((o) => o.id === 8)?.label).toBe('Auckland');
  });
});

describe('depotFilterOptions', () => {
  it('shows every depot and marks the inactive ones', () => {
    expect(depotFilterOptions(depots).map((o) => o.label)).toEqual(['Auckland', 'Tauranga (inactive)', 'Hamilton']);
  });
});

describe('hasInactiveDepot', () => {
  it('blocks save when any depot field holds an inactive depot', () => {
    expect(hasInactiveDepot(depots, [8, 3])).toBe(true);
  });
  it('allows save with active depots, blanks and unknown ids', () => {
    expect(hasInactiveDepot(depots, [8, 4, null, undefined, 999])).toBe(false);
  });
  it('carries the operator message from the spec', () => {
    expect(INACTIVE_DEPOT_MESSAGE).toBe('This depot is inactive and cannot be saved. Pick an active depot.');
  });
});
