import { describe, expect, it } from 'vitest';
import { usZipFormFrom } from './ZonesTab';
import type { UsZipZone } from '../../services/territoryService';

/**
 * The US zip form lost its zip-group picker on 23 Oct, so the group id
 * now travels from the row to the payload with nothing in the UI able
 * to set or clear it.
 *
 * That is only safe while it is genuinely carried. Every zip on the US
 * tenant has a null group id today (0 of 4,428 on DFRNT_SEED_CR), which
 * means a regression here would be invisible on the tenant and would
 * only show up the first time someone put a value in that column.
 */
function zip(over: Partial<UsZipZone> = {}): UsZipZone {
  return {
    id: 1,
    zip: '94999',
    zoneNumber: 7,
    zoneNameId: 9002,
    zoneName: 'RT-CHECK',
    zoneGroupId: 2018,
    zoneGroupName: 'Nevada',
    postcodeGroupId: null,
    postcodeGroupName: null,
    applyCongestion: null,
    ...over,
  };
}

describe('usZipFormFrom', () => {
  it('carries an existing zip-group id into the payload although no input shows it', () => {
    expect(usZipFormFrom(zip({ postcodeGroupId: 41 })).zoneZipGroupId).toBe(41);
  });

  it('leaves the zip-group id null on a new zip', () => {
    // Matches the payload measured on the wire on 23 Oct:
    // {"zip":"94999","zoneNumber":7,"zoneNameId":9002,"zoneZipGroupId":null,...}
    expect(usZipFormFrom(null).zoneZipGroupId).toBeNull();
  });

  it('keeps the rest of an existing row intact', () => {
    expect(usZipFormFrom(zip())).toEqual({
      zip: '94999',
      zoneNumber: 7,
      zoneNameId: 9002,
      zoneZipGroupId: null,
      applyCongestion: null,
      clientId: null,
    });
  });

  it('starts a new zip empty rather than undefined, so the inputs stay controlled', () => {
    expect(usZipFormFrom(null)).toEqual({
      zip: '',
      zoneNumber: null,
      zoneNameId: null,
      zoneZipGroupId: null,
      applyCongestion: null,
      clientId: null,
    });
  });

  it('does not send a client id, because the grid is tenant-wide', () => {
    expect(usZipFormFrom(zip({ postcodeGroupId: 41 })).clientId).toBeNull();
  });
});
