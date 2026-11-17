import { describe, expect, it } from 'vitest';
import { parseBookDate, parseBookTime } from './bookDateParse';

// UC #881. The file's own Book Date / Book Time columns decide each row's
// booking. The tenant decides how an ambiguous slash date reads: NZ is
// dd/MM, US is MM/dd. A value that cannot be read gives null, and the row
// is refused later rather than silently booked on some other day.
describe('parseBookDate', () => {
  describe('NZ reads dd/MM', () => {
    it.each([
      ['13/11/2026', '2026-11-13'],
      ['12/11/2026', '2026-11-12'], // ambiguous: NZ says 12 Nov
      ['1/2/2026', '2026-02-01'],
      ['01-02-2026', '2026-02-01'],
      ['12/11/26', '2026-11-12'],
      ['12/11/2026 08:30', '2026-11-12'],
    ])('%s -> %s', (raw, want) => {
      expect(parseBookDate(raw, false)).toBe(want);
    });

    it('falls back to MM/dd only when the first field cannot be a month... the second must be the day', () => {
      // 11/13/2026 cannot be dd/MM (no month 13), so it reads as 13 Nov.
      expect(parseBookDate('11/13/2026', false)).toBe('2026-11-13');
    });
  });

  // These rows are exactly what normalizeDateForInput returned before the
  // move. A US operator must see no change.
  describe('US reads MM/dd, unchanged from before', () => {
    it.each([
      ['12/11/2026', '2026-12-11'],
      ['11/13/2026', '2026-11-13'],
      ['13/11/2026', '2026-11-13'], // first > 12 -> must be a day
      ['1/2/2026', '2026-01-02'],
      ['01-02-26', '2026-01-02'],
      ['2026-11-13', '2026-11-13'],
      ['2026-1-3', '2026-01-03'],
    ])('%s -> %s', (raw, want) => {
      expect(parseBookDate(raw, true)).toBe(want);
    });
  });

  it.each([
    ['2026-11-13T00:00:00', '2026-11-13'],
    ['2026-11-13T08:30:00.000Z', '2026-11-13'],
    ['2026-11-13 08:30', '2026-11-13'],
  ])('ISO with a time part %s -> %s for both tenants', (raw, want) => {
    expect(parseBookDate(raw, false)).toBe(want);
    expect(parseBookDate(raw, true)).toBe(want);
  });

  it.each(['', '   ', 'tomorrow', '31/02/2026', '2026-02-30', '13/13/2026', '00/01/2026', '1899-12-31T08:30:00'])(
    'unreadable or impossible %j -> null',
    (raw) => {
      expect(parseBookDate(raw, false)).toBeNull();
    }
  );

  it('null and undefined -> null', () => {
    expect(parseBookDate(null, false)).toBeNull();
    expect(parseBookDate(undefined, true)).toBeNull();
  });
});

describe('parseBookTime', () => {
  it.each([
    ['08:30', '08:30'],
    ['8:30', '08:30'],
    ['14:00', '14:00'],
    ['14:00:59', '14:00'],
    ['8:30 am', '08:30'],
    ['8:30 PM', '20:30'],
    ['12:05 am', '00:05'],
    ['12:05 pm', '12:05'],
    ['1899-12-31T08:30:00', '08:30'], // Excel time-only cell
    ['2026-11-13T14:00:00', '14:00'],
    ['2026-11-13 14:00', '14:00'],
  ])('%s -> %s', (raw, want) => {
    expect(parseBookTime(raw)).toBe(want);
  });

  it.each(['', 'noon', '24:00', '8:60', '13:00 pm', '0:30 am', '2026-11-13'])('unreadable %j -> null', (raw) => {
    expect(parseBookTime(raw)).toBeNull();
  });
});

// Verbatim copy of SchedulePickerModal's normalizeDateForInput as it stood
// before UC #881, kept here as the oracle for "US is unchanged".
function legacyNormalize(raw: string): string | null {
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    let day: number, month: number;
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

describe('US oracle sweep', () => {
  it('matches the old parser for every real calendar date it accepted', () => {
    let compared = 0;
    for (const sep of ['/', '-']) {
      for (let a = 1; a <= 31; a++) {
        for (let b = 1; b <= 31; b++) {
          const raw = `${a}${sep}${b}${sep}2028`; // leap year, so 29 Feb counts
          const before = legacyNormalize(raw);
          if (before == null) continue;
          const [y, m, d] = before.split('-').map(Number);
          const real = new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
          // The old parser let 31/02 through; the new one refuses it. That is
          // the only intended difference.
          expect(parseBookDate(raw, true)).toBe(real ? before : null);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(700);
  });
});
