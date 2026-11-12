import { describe, expect, it } from 'vitest';
import { zoneGroupCsvFileName, zoneGroupCsvRows } from './zoneGroupExport';
import { rowsToCsv } from './csvExport';
import type { PostcodeGroupZone } from '../services/territoryService';

// Z3: operators export a zone group to check or hand on its postcodes. The
// columns are the contract (people paste this into Excel and look things up
// by column), so the header and the order are pinned exactly.

const zone = (z: number, members: [string, string | null][]): PostcodeGroupZone => ({
  zone: z,
  label: null,
  memberCount: members.length,
  members: members.map(([code, suburb], i) => ({ id: z * 100 + i, code, value: Number(code), suburb })),
});

describe('zoneGroupCsvRows', () => {
  it('has exactly Zone,Postcode,Suburb and sorts by zone then postcode', () => {
    const rows = zoneGroupCsvRows([
      zone(2, [['0632', 'Albany'], ['0610', 'Henderson']]),
      zone(1, [['1010', 'Auckland Central'], ['0600', 'Avondale']]),
    ]);

    expect(rows).toEqual([
      ['Zone', 'Postcode', 'Suburb'],
      ['1', '0600', 'Avondale'],
      ['1', '1010', 'Auckland Central'],
      ['2', '0610', 'Henderson'],
      ['2', '0632', 'Albany'],
    ]);
  });

  it('keeps the leading zero on a D4 code and writes a blank suburb as empty', () => {
    const rows = zoneGroupCsvRows([zone(3, [['0110', null]])]);
    expect(rows[1]).toEqual(['3', '0110', '']);
  });

  it('quotes a suburb with a comma or a quote when written out', () => {
    const csv = rowsToCsv(zoneGroupCsvRows([zone(1, [['9016', 'St Clair, Dunedin'], ['9010', 'The "Octagon"']])]));
    expect(csv.split('\r\n')).toEqual([
      'Zone,Postcode,Suburb',
      '1,9010,"The ""Octagon"""',
      '1,9016,"St Clair, Dunedin"',
    ]);
  });
});

describe('zoneGroupCsvFileName', () => {
  it('is <group name>-postcodes-<yyyy-MM-dd>.csv', () => {
    expect(zoneGroupCsvFileName('Auckland Metro', 7, new Date(2026, 10, 3)))
      .toBe('Auckland Metro-postcodes-2026-11-03.csv');
  });

  it('replaces characters a file name cannot hold and falls back to the id', () => {
    expect(zoneGroupCsvFileName('AKL/HAM: zones', 7, new Date(2026, 0, 9)))
      .toBe('AKL-HAM- zones-postcodes-2026-01-09.csv');
    expect(zoneGroupCsvFileName(null, 42, new Date(2026, 0, 9)))
      .toBe('group-42-postcodes-2026-01-09.csv');
  });
});
