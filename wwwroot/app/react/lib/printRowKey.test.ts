import { describe, expect, it } from 'vitest';
import { decodePrintRowKey, isOnDemandKey, printRowKey } from './printRowKey';

// #880: Print Manager lists tblBulkJob rows and, with the toggle on, on-demand
// tucJob rows (bulkJobId 0). A bulk row and an on-demand row can share the
// same number, so the selection key must say which table the id is from.
describe('printRowKey', () => {
  it('keys a bulk row by its bulkJobId', () => {
    expect(printRowKey({ bulkJobId: 42, jobId: 900 })).toBe('b:42');
  });

  it('keys an on-demand row by its tucJob id', () => {
    expect(printRowKey({ bulkJobId: 0, jobId: 42 })).toBe('j:42');
  });

  it('gives a bulk row and an on-demand row with the same id different keys', () => {
    expect(printRowKey({ bulkJobId: 42 })).not.toBe(printRowKey({ bulkJobId: 0, jobId: 42 }));
  });

  it('decodes a bulk key to the bulk label row, unchanged from before on-demand', () => {
    expect(decodePrintRowKey('b:42')).toEqual({ bulkJobId: 42 });
  });

  it('decodes an on-demand key to a tucJob label row', () => {
    expect(decodePrintRowKey('j:42')).toEqual({ bulkJobId: 0, jobId: 42 });
  });

  it('round-trips both kinds', () => {
    for (const row of [{ bulkJobId: 7 }, { bulkJobId: 0, jobId: 7 }]) {
      expect(decodePrintRowKey(printRowKey(row))).toEqual(row);
    }
  });

  it('tells on-demand keys apart, so Cancel / Edit qty only see bulk rows', () => {
    expect(isOnDemandKey('j:5')).toBe(true);
    expect(isOnDemandKey('b:5')).toBe(false);
  });
});
