import { describe, expect, it } from 'vitest';
import { legDepotIds, type Leg } from './ChainBuilder';

// The schedule save blocks on an inactive depot anywhere in the chain. A
// depot field the helper forgets is a field where a retired depot saves
// silently; a disabled field it includes blocks a save for a value not used.
describe('legDepotIds', () => {
  it('collects every depot field across the chain', () => {
    const legs = [
      { type: 'collection', speedId: null, postcodeGroupId: null, zones: [] },
      { type: 'depot', depotId: 8, clientAddress: false, directOrigin: false, originRegionId: null, storageState: null },
      { type: 'linehaul', fromDepotId: 8, toDepotId: 3, fromClientAddress: false },
      { type: 'delivery', regionId: 4, speedId: null, postcodeGroupId: null, zones: [] },
    ] as unknown as Leg[];
    expect(legDepotIds(legs).filter((x) => x != null)).toEqual([8, 8, 3, 4]);
  });

  it('includes the origin region on a client-address depot leg', () => {
    const legs = [
      { type: 'depot', depotId: null, clientAddress: true, directOrigin: false, originRegionId: 7, storageState: null },
    ] as unknown as Leg[];
    expect(legDepotIds(legs)).toContain(7);
  });

  it('skips a linehaul From depot while it books from the client address', () => {
    const legs = [
      { type: 'linehaul', fromDepotId: 3, toDepotId: 8, fromClientAddress: true },
    ] as unknown as Leg[];
    expect(legDepotIds(legs).filter((x) => x != null)).toEqual([8]);
  });
});
