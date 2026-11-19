// Book Date / Book Time cell parsing for bulk import (UC #881).
//
// Moved out of SchedulePickerModal's normalizeDateForInput so the defaults
// step and buildJobs read a row's date the same way. The server has its own
// copy (BulkImportDateParser.cs) with the same rules, because Staff Import
// never goes through this code.
//
// Rules:
//   - ISO yyyy-M-d, with or without a time part ('T' or space), any tenant.
//   - Slash or dash dates: the tenant picks the order. NZ reads dd/MM,
//     US reads MM/dd. When the tenant's order cannot be a real date because
//     its month field is over 12, the other order is tried. US behaviour is
//     exactly what normalizeDateForInput did before for every real date.
//   - Two-digit years are 20yy.
//   - English month names, which cannot be misread in either tenant order:
//     13 Nov 2026, 13-Nov-2026, 13-Nov-26, 13 November 2026, Nov 13, 2026.
//     A month-first date needs a four-digit year. A trailing time is ignored.
//   - Impossible dates (31/02, month 13) and anything else give null.

const pad = (n: number) => String(n).padStart(2, '0');

function realDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function monthNumber(raw: string): number {
  const name = raw.toLowerCase();
  if (name === 'sept') return 9;
  return MONTH_NAMES.findIndex((m) => m === name || (name.length === 3 && m.startsWith(name))) + 1;
}

function namedDate(year: string, monthName: string, day: string): string | null {
  const month = monthNumber(monthName);
  if (month < 1) return null;
  let y = Number(year);
  if (y < 100) y += 2000;
  return realDate(y, month, Number(day));
}

/** Excel stores a time-only cell on 1899-12-31 (or 1899-12-30). It is a
 *  time, never a booking date. */
const EXCEL_TIME_EPOCH = /^1899-12-3[01]/;

/** yyyy-MM-dd, or null when the cell cannot be read as a date. */
export function parseBookDate(raw: string | null | undefined, isUsTenant: boolean): string | null {
  const s = String(raw ?? '').trim();
  if (!s || EXCEL_TIME_EPOCH.test(s)) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (iso) return realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dayFirst = s.match(/^([0-9]{1,2})(?:\s+|-)([A-Za-z]{3,9})\.?(?:\s+|-)([0-9]{4}|[0-9]{2})(?:\s.*)?$/);
  if (dayFirst) return namedDate(dayFirst[3], dayFirst[2], dayFirst[1]);
  const monthFirst = s.match(/^([A-Za-z]{3,9})\.?\s+([0-9]{1,2}),?\s+([0-9]{4})(?:\s.*)?$/);
  if (monthFirst) return namedDate(monthFirst[3], monthFirst[1], monthFirst[2]);

  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?:\s+.*)?$/);
  if (!slash) return null;
  const first = Number(slash[1]);
  const second = Number(slash[2]);
  let year = Number(slash[3]);
  if (year < 100) year += 2000;

  let day: number;
  let month: number;
  if (isUsTenant) {
    // Unchanged US rule: first > 12 must be a day, otherwise MM/dd.
    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
  } else if (second > 12 && first <= 12) {
    // dd/MM cannot hold a month over 12, so this file is MM/dd.
    month = first;
    day = second;
  } else {
    day = first;
    month = second;
  }
  return realDate(year, month, day);
}

/** HH:mm (24h), or null when the cell cannot be read as a time. */
export function parseBookTime(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // Time carried on an ISO datetime, including Excel's 1899-12-31T08:30:00.
  const isoTime = s.match(/^\d{4}-\d{1,2}-\d{1,2}[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (isoTime) return hm(Number(isoTime[1]), Number(isoTime[2]));

  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([aApP])\.?[mM]\.?$/);
  if (ampm) {
    const h12 = Number(ampm[1]);
    if (h12 < 1 || h12 > 12) return null;
    const pm = ampm[3].toLowerCase() === 'p';
    return hm((h12 % 12) + (pm ? 12 : 0), Number(ampm[2]));
  }

  const plain = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (plain) return hm(Number(plain[1]), Number(plain[2]));
  return null;
}

function hm(h: number, m: number): string | null {
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}
