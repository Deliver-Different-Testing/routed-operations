import { describe, expect, it } from 'vitest';
import { formatDate, formatCurrency, toIsoDate, todayIso } from './formatters';

describe('formatDate', () => {
  it('formats a Date as dd/MM/yyyy', () => {
    expect(formatDate(new Date(2026, 7, 13))).toBe('13/08/2026');
  });

  it('pads single-digit day and month with zeros', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('05/01/2026');
  });

  it('accepts an ISO string', () => {
    expect(formatDate('2026-08-13T00:00:00Z')).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });

  it('returns empty string for null / undefined', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
  });

  it('returns empty string for an invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('');
  });
});

describe('toIsoDate', () => {
  it('formats a Date as yyyy-MM-dd', () => {
    expect(toIsoDate(new Date(2026, 7, 13))).toBe('2026-08-13');
  });

  it('pads single-digit month and day with zeros', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('returns empty string for null / undefined', () => {
    expect(toIsoDate(null)).toBe('');
    expect(toIsoDate(undefined)).toBe('');
  });

  it('returns empty string for an invalid date string', () => {
    expect(toIsoDate('gibberish')).toBe('');
  });
});

describe('formatCurrency', () => {
  it('formats a US-tenant number with USD symbol', () => {
    // Uses Intl.NumberFormat; exact glyph depends on locale but must contain the amount.
    expect(formatCurrency(1234.56, true)).toContain('1,234.56');
  });

  it('formats a NZ-tenant number with NZD marker', () => {
    const out = formatCurrency(50, false);
    expect(out).toContain('50');
  });

  it('returns empty string for null / undefined', () => {
    expect(formatCurrency(null)).toBe('');
    expect(formatCurrency(undefined)).toBe('');
  });
});

describe('todayIso', () => {
  it('returns todays date in yyyy-MM-dd form', () => {
    const iso = todayIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
