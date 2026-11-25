import { describe, expect, it } from 'vitest';
import { buildExactSuburbMatcher, buildSuburbMatcher, findAlias, normalisePostCode, normaliseSuburb } from './suburbAliases';
import type { SuburbAliasDto } from '../../services/bulkImportService';

// #333: the wizard and the server (BulkSuburbAliases.cs) must fold a sheet
// suburb to the same key, or a fix remembered on one side is missed on the
// other and the operator is asked again.
describe('normaliseSuburb', () => {
  it.each([
    ['Ōtāhuhu', 'otahuhu'],
    ['  Mt  Eden ', 'mount eden'],
    ['MT. ALBERT', 'mount albert'],
    ['Mount Eden', 'mount eden'],
    ['St Heliers', 'saint heliers'],
    ['Stanley Point', 'stanley point'],
    // tucSuburb has 'Pt Chevalier' where sheets say 'Point Chevalier', and a
    // dot with no space ('Mt.Eden') is still an abbreviation.
    ['Pt Chevalier', 'point chevalier'],
    ['Point Chevalier', 'point chevalier'],
    ['PT.CHEVALIER', 'point chevalier'],
    ['Mt.Eden', 'mount eden'],
    ['St.Albans', 'saint albans'],
    ['', ''],
  ])('%s -> %s', (raw, expected) => {
    expect(normaliseSuburb(raw)).toBe(expected);
  });
});

describe('normalisePostCode', () => {
  it('pads an NZ postcode Excel shortened', () => {
    expect(normalisePostCode('624', true)).toBe('0624');
    expect(normalisePostCode(' 1011 ', true)).toBe('1011');
    expect(normalisePostCode('', true)).toBeNull();
    expect(normalisePostCode('02110', false)).toBe('02110');
  });
});

const row = (id: number, clientId: number | null, rawSuburb: string, rawPostCode: string | null, suburbId: number): SuburbAliasDto => ({
  id, clientId, rawSuburb, rawPostCode, suburbId, suburbName: `S${suburbId}`, postCode: null,
});

describe('findAlias', () => {
  // Same order as the server: client exact, client any postcode, tenant
  // exact, tenant any; another client's fix never applies.
  it('prefers the client fix, falls back to the tenant fix, never another client', () => {
    const rows = [
      row(1, null, 'otahuhu', '0624', 20),
      row(2, 5, 'otahuhu', '0624', 10),
      row(3, 9, 'otahuhu', '0624', 30),
      row(4, 5, 'mount eden', null, 40),
      row(5, null, 'mount eden', '1024', 50),
    ];
    expect(findAlias(rows, 5, 'Ōtāhuhu', '624', true)?.suburbId).toBe(10);
    expect(findAlias(rows, 6, 'otahuhu', '0624', true)?.suburbId).toBe(20);
    expect(findAlias(rows, 9, 'OTAHUHU', '0624', true)?.suburbId).toBe(30);
    expect(findAlias(rows, 5, 'otahuhu', '1062', true)).toBeUndefined();
    expect(findAlias(rows, 5, 'Mt Eden', '1024', true)?.suburbId).toBe(40);
    expect(findAlias(rows, 6, 'Mt Eden', '1024', true)?.suburbId).toBe(50);
  });
});

// The exact key ignores marks, case, spacing (tab, NBSP, runs) and trailing
// dots, but never expands an abbreviation and keeps an inner dot, so
// 'St.Albans' (an abbreviation) is not an exact hit.
// Same rule as BulkSuburbAliases.ExactSuburbMatcher.
describe('buildExactSuburbMatcher', () => {
  const exact = buildExactSuburbMatcher(['St Albans', 'Saint Albans', 'Mount Eden']);
  it.each([
    ['St Albans', 'St Albans'],
    ['St  Albans', 'St Albans'],
    ['St Albans.', 'St Albans'],
    ['St	Albans', 'St Albans'],
    ['St Albans', 'St Albans'],
    [' saint  albans ', 'Saint Albans'],
    ['St Albans. ', 'St Albans'],
    ['St.Albans', undefined],
    ['St. Albans', undefined],
    ['Mt Eden', undefined],
    ['Saint Albans East', undefined],
  ])('%j -> %s', (raw, expected) => {
    expect(exact(raw)).toBe(expected);
  });
});

// The main suburb match: exact spelling first, the normalised match only
// when it names one suburb, so 'St Albans' and 'Saint Albans' (both real)
// are never guessed between. Same rule as BulkSuburbAliases.SuburbMatcher.
describe('buildSuburbMatcher', () => {
  const match = buildSuburbMatcher(['Mount Eden', 'St Albans', 'Saint Albans', 'Otahuhu', 'Pt Chevalier']);
  it.each([
    ['Mt Eden', 'Mount Eden'],
    ['mount eden', 'Mount Eden'],
    ['Ōtāhuhu', 'Otahuhu'],
    ['St Albans', 'St Albans'],
    ['saint albans', 'Saint Albans'],
    ['St. Albans', undefined],
    ['Nowhere', undefined],
    ['Point Chevalier', 'Pt Chevalier'],
    ['Mt.Eden', 'Mount Eden'],
  ])('%s -> %s', (raw, expected) => {
    expect(match(raw)).toBe(expected);
  });
});
