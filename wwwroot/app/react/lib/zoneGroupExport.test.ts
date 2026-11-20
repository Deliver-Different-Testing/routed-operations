import { describe, expect, it } from 'vitest';
import { decodeCsvBytes, zoneGroupCsvFileName, zoneGroupCsvRows } from './zoneGroupExport';
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

// r1 (review 20 Nov): a US ZIP can be stored with no zone (ZoneNumber NULL),
// which the detail endpoint sends as 0. The export writes it blank, so the
// sheet does not claim a zone 0 that no schedule tick can reach, and the
// upload reads blank back as "no zone, unchanged".
describe('zoneGroupCsvRows - no zone', () => {
  it('writes a zone of 0 as a blank cell', () => {
    const rows = zoneGroupCsvRows([zone(0, [['00501', 'SMF']]), zone(1, [['00601', 'A']])]);
    expect(rows.slice(1)).toEqual([['', '00501', 'SMF'], ['1', '00601', 'A']]);
  });
});

// Nit 3 (review 20 Nov): Excel's plain "CSV (Comma delimited)" saves in the
// Windows code page, not UTF-8. Decoded as UTF-8, every accented byte came
// through as U+FFFD and an added row's suburb was written that way.
describe('decodeCsvBytes', () => {
  it('reads a UTF-8 file, macrons included, and drops the BOM', () => {
    const bytes = new TextEncoder().encode('\uFEFFZone,Postcode,Suburb\r\n1,2024,Māngere\r\n');
    expect(decodeCsvBytes(bytes)).toBe('Zone,Postcode,Suburb\r\n1,2024,Māngere\r\n');
  });

  it('falls back to Windows-1252 when the file is not valid UTF-8', () => {
    // "Mângere": 0xE2 is a lone lead byte in UTF-8, so the strict
    // decoder refuses it. Windows-1252 has no a-macron at all, so a file
    // saved that way carries a stand-in such as this circumflex.
    const bytes = new Uint8Array([...new TextEncoder().encode('1,2024,M'), 0xe2, ...new TextEncoder().encode('ngere')]);
    const text = decodeCsvBytes(bytes);
    expect(text).toBe('1,2024,Mângere');
    expect(text).not.toContain('�');
  });
});
