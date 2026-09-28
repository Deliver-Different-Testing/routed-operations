import { describe, expect, it } from 'vitest';
import type { BulkImportJobCreateDto, ParsedFile } from '../../services/bulkImportService';
import { dtoToSourceLayout, matchKmRatedToSourceRows, sourceRowsCsv } from './sourceRowExport';

const parsed: ParsedFile = {
  headers: ['Ref', 'Address', 'Postcode', 'Driver notes'],
  rows: [
    { Ref: 'A1', Address: '1 Queen St', Postcode: '0612', 'Driver notes': 'gate, "blue"' },
    { Ref: 'A2', Address: '2 King St', Postcode: '8011', 'Driver notes': '' },
    { Ref: 'A3', Address: '3 Main Rd', Postcode: '9999' },
  ],
};

const job = (over: Partial<BulkImportJobCreateDto>): BulkImportJobCreateDto =>
  ({ length: 0, width: 0, height: 0, weight: 0, ...over }) as BulkImportJobCreateDto;

describe('sourceRowsCsv', () => {
  it('exports every original column under the original headers', () => {
    expect(sourceRowsCsv(parsed, [2, 0])).toEqual([
      ['Ref', 'Address', 'Postcode', 'Driver notes'],
      ['A3', '3 Main Rd', '9999', ''],
      ['A1', '1 Queen St', '0612', 'gate, "blue"'],
    ]);
  });

  it('prepends Amount as column A when amounts are given', () => {
    const rows = sourceRowsCsv(parsed, [1], [42.5]);
    expect(rows[0][0]).toBe('Amount');
    expect(rows[1]).toEqual([42.5, 'A2', '2 King St', '8011', '']);
    expect(sourceRowsCsv(parsed, [1], [null])[1][0]).toBe('');
  });
});

describe('dtoToSourceLayout', () => {
  it('lays a server row out under the mapped headers, blanks elsewhere', () => {
    const mapping = { clientRefA: 'Ref', toAddress: 'Address', toPostCode: 'Postcode' };
    expect(
      dtoToSourceLayout(parsed, mapping, job({ clientRefA: 'A9', toAddress: '9 X St', toPostCode: '612' }))
    ).toEqual(['A9', '9 X St', '612', '']);
  });
});

describe('matchKmRatedToSourceRows', () => {
  const candidates = [
    { rowIndex: 4, job: job({ jobNumber: 'J1', toAddress: '1 Queen St', toPostCode: '0612' }) },
    { rowIndex: 7, job: job({ jobNumber: 'J2', toAddress: '2 King St', toPostCode: '8011' }) },
  ];

  it('matches on the round-tripped fields, tolerating the stripped leading zero', () => {
    const km = [
      job({ jobNumber: 'J2', toAddress: '2 King St', toPostCode: '8011' }),
      job({ jobNumber: 'J1', toAddress: ' 1  queen st ', toPostCode: '612' }),
    ];
    expect(matchKmRatedToSourceRows(km, candidates)).toEqual([7, 4]);
  });

  it('ignores AUTOGENERATE job numbers the server replaced', () => {
    const auto = [
      { rowIndex: 0, job: job({ jobNumber: 'AUTOGENERATE', toAddress: '1 Queen St', toPostCode: '0612' }) },
    ];
    const km = [job({ jobNumber: 'UC000123', toAddress: '1 Queen St', toPostCode: '612' })];
    expect(matchKmRatedToSourceRows(km, auto)).toEqual([0]);
  });

  it('claims each source row once so duplicate addresses pair up in order', () => {
    const dupes = [
      { rowIndex: 1, job: job({ toAddress: '5 Same St', toPostCode: '1010' }) },
      { rowIndex: 2, job: job({ toAddress: '5 Same St', toPostCode: '1010' }) },
    ];
    const km = [
      job({ toAddress: '5 Same St', toPostCode: '1010' }),
      job({ toAddress: '5 Same St', toPostCode: '1010' }),
    ];
    expect(matchKmRatedToSourceRows(km, dupes)).toEqual([1, 2]);
  });

  it('falls back to address + postcode, and returns null when nothing matches', () => {
    const km = [
      // Contact changed server-side: strict key misses, loose key hits.
      job({ jobNumber: 'J1', toAddress: '1 Queen St', toPostCode: '0612', toContact: 'Someone' }),
      job({ jobNumber: 'J9', toAddress: '9 Nowhere', toPostCode: '1111' }),
    ];
    expect(matchKmRatedToSourceRows(km, candidates)).toEqual([4, null]);
  });
});
