import { describe, it, expect } from 'vitest';
import { deriveOriginFromLegs, type Leg, type DepotLeg } from './ChainBuilder';

// Pure-logic test (repo testing policy: vitest for pure modules, Playwright
// for the user flow). What is under test is the THREE-WAY origin resolution
// both schedule modals save through: get it wrong and a schedule silently
// changes origin on the next save, which is invisible until a job books from
// the wrong address.

function depotLeg(patch: Partial<DepotLeg> = {}): DepotLeg {
  return {
    type: 'depot',
    depotId: null,
    clientAddress: false,
    directOrigin: false,
    originRegionId: null,
    storageState: null,
    ...patch,
  };
}

const delivery: Leg = { type: 'delivery', regionId: 3, speedId: null, postcodeGroupId: null, zones: [] };

describe('deriveOriginFromLegs', () => {
  it('reads a real depot on the first Depot leg as depot origin', () => {
    const legs: Leg[] = [depotLeg({ depotId: 1 }), delivery];
    expect(deriveOriginFromLegs(legs)).toEqual({ originType: 'depot', originRegionId: null });
  });

  it('carries the origin region through for client origin', () => {
    // The region is the whole point of client origin: it is the branch that
    // owns the start of the chain, and the server rejects the save without it.
    const legs: Leg[] = [depotLeg({ clientAddress: true, originRegionId: 1 }), delivery];
    expect(deriveOriginFromLegs(legs)).toEqual({ originType: 'client', originRegionId: 1 });
  });

  it('forces the origin region to null for direct origin', () => {
    // A Direct schedule has no origin branch: the pickup address arrives with
    // the booking and the dispatch region is the Delivery leg's. Leaking a
    // stale originRegionId here would violate the header's own rule that
    // only client origin carries one.
    const legs: Leg[] = [depotLeg({ directOrigin: true, originRegionId: 1 }), delivery];
    expect(deriveOriginFromLegs(legs)).toEqual({ originType: 'direct', originRegionId: null });
  });

  it('resolves direct ahead of client when a leg somehow carries both flags', () => {
    // The dropdown makes the two mutually exclusive, so this is defence in
    // depth. Direct wins because it is the more restrictive of the two (it
    // also forbids linehauls), so a confused row degrades safely rather than
    // being saved as a client-origin schedule that keeps its linehaul legs.
    const legs: Leg[] = [
      depotLeg({ directOrigin: true, clientAddress: true, originRegionId: 1 }),
      delivery,
    ];
    expect(deriveOriginFromLegs(legs)).toEqual({ originType: 'direct', originRegionId: null });
  });

  it('only reads the FIRST Depot leg, not a later one', () => {
    // A depot after a linehaul is somewhere we actually land, so it can never
    // express the origin. If this ever read the last match instead, every
    // multi-hop schedule would be re-pointed on save.
    const legs: Leg[] = [
      depotLeg({ directOrigin: true }),
      depotLeg({ depotId: 16 }),
      delivery,
    ];
    expect(deriveOriginFromLegs(legs).originType).toBe('direct');
  });

  it('falls back to depot origin when the chain has no Depot leg at all', () => {
    expect(deriveOriginFromLegs([delivery])).toEqual({ originType: 'depot', originRegionId: null });
  });
});
