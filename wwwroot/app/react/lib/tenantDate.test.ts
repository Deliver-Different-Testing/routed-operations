import { describe, expect, it } from 'vitest';
import {
  tenantDate,
  tenantDateFromSpString,
  tenantDateTime,
  tenantTime,
  tenantTimeFromSpString,
  tenantTodayYmd,
} from './tenantDate';

describe('tenantDate', () => {
  it('returns US ordering for a US tenant', () => {
    const out = tenantDate(new Date(Date.UTC(2026, 7, 13, 12, 0)), {
      isUsTenant: true,
      timeZone: 'UTC',
    });
    expect(out).toBe('08/13/2026');
  });

  it('returns NZ ordering for a non-US tenant', () => {
    const out = tenantDate(new Date(Date.UTC(2026, 7, 13, 12, 0)), {
      isUsTenant: false,
      timeZone: 'UTC',
    });
    expect(out).toBe('13/08/2026');
  });

  it('accepts an ISO string', () => {
    const out = tenantDate('2026-08-13T00:00:00Z', {
      isUsTenant: false,
      timeZone: 'UTC',
    });
    expect(out).toBe('13/08/2026');
  });

  it('normalises a Windows timezone to IANA', () => {
    const out = tenantDate(new Date(Date.UTC(2026, 7, 13, 12, 0)), {
      isUsTenant: false,
      timeZone: 'New Zealand Standard Time',
    });
    expect(out).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });

  it('returns empty string for null', () => {
    expect(tenantDate(null, { isUsTenant: true, timeZone: 'UTC' })).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(tenantDate(undefined, { isUsTenant: true, timeZone: 'UTC' })).toBe('');
  });

  it('returns empty string for empty string input', () => {
    expect(tenantDate('', { isUsTenant: true, timeZone: 'UTC' })).toBe('');
  });

  it('returns empty string for invalid date', () => {
    expect(tenantDate('not-a-date', { isUsTenant: true, timeZone: 'UTC' })).toBe('');
  });

  it('accepts a null timeZone (falls back to browser)', () => {
    const out = tenantDate(new Date(2026, 7, 13), {
      isUsTenant: false,
      timeZone: null,
    });
    expect(out).toMatch(/\d{2}\/\d{2}\/2026/);
  });
});

describe('tenantDateTime', () => {
  it('renders 12h format for US tenants', () => {
    const out = tenantDateTime(new Date(Date.UTC(2026, 7, 13, 14, 30)), {
      isUsTenant: true,
      timeZone: 'UTC',
    });
    expect(out).toMatch(/PM|AM/);
  });

  it('renders 24h format for non-US tenants', () => {
    const out = tenantDateTime(new Date(Date.UTC(2026, 7, 13, 14, 30)), {
      isUsTenant: false,
      timeZone: 'UTC',
    });
    expect(out).not.toMatch(/PM|AM/);
  });

  it('returns empty string for null', () => {
    expect(tenantDateTime(null, { isUsTenant: false, timeZone: 'UTC' })).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(tenantDateTime(undefined, { isUsTenant: false, timeZone: 'UTC' })).toBe('');
  });
});

describe('tenantTime', () => {
  it('renders 24h HH:mm for NZ tenants', () => {
    const out = tenantTime(new Date(Date.UTC(2026, 7, 13, 14, 30)), {
      isUsTenant: false,
      timeZone: 'UTC',
    });
    expect(out).toBe('14:30');
  });

  it('renders 12h format for US tenants', () => {
    const out = tenantTime(new Date(Date.UTC(2026, 7, 13, 14, 30)), {
      isUsTenant: true,
      timeZone: 'UTC',
    });
    expect(out).toMatch(/PM/);
  });

  it('returns empty string for null', () => {
    expect(tenantTime(null, { isUsTenant: false, timeZone: 'UTC' })).toBe('');
  });
});

describe('tenantDateFromSpString', () => {
  it('swaps to US ordering for a US tenant', () => {
    expect(tenantDateFromSpString('13/08/2026', true)).toBe('08/13/2026');
  });

  it('keeps NZ ordering for a non-US tenant', () => {
    expect(tenantDateFromSpString('13/08/2026', false)).toBe('13/08/2026');
  });

  it('pads single-digit day and month with zeros', () => {
    expect(tenantDateFromSpString('5/8/2026', false)).toBe('05/08/2026');
  });

  it('returns empty string for null', () => {
    expect(tenantDateFromSpString(null, true)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(tenantDateFromSpString(undefined, true)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(tenantDateFromSpString('', true)).toBe('');
  });

  it('returns the raw string when it does not match dd/MM/yyyy', () => {
    expect(tenantDateFromSpString('2026-08-13', true)).toBe('2026-08-13');
  });

  it('trims whitespace before matching', () => {
    expect(tenantDateFromSpString('  13/08/2026  ', false)).toBe('13/08/2026');
  });
});

describe('tenantTimeFromSpString', () => {
  it('renders 24h HH:mm for NZ tenants', () => {
    expect(tenantTimeFromSpString('14:30', false)).toBe('14:30');
  });

  it('strips seconds and keeps 24h for NZ tenants', () => {
    expect(tenantTimeFromSpString('14:30:45', false)).toBe('14:30');
  });

  it('renders 12h PM for US tenants past noon', () => {
    expect(tenantTimeFromSpString('14:30', true)).toBe('2:30 PM');
  });

  it('renders 12h AM for US tenants before noon', () => {
    expect(tenantTimeFromSpString('09:15', true)).toBe('9:15 AM');
  });

  it('renders midnight as 12:mm AM for US tenants', () => {
    expect(tenantTimeFromSpString('00:05', true)).toBe('12:05 AM');
  });

  it('renders noon as 12:mm PM for US tenants', () => {
    expect(tenantTimeFromSpString('12:00', true)).toBe('12:00 PM');
  });

  it('pads single-digit hour for NZ output', () => {
    expect(tenantTimeFromSpString('9:15', false)).toBe('09:15');
  });

  it('returns empty string for null', () => {
    expect(tenantTimeFromSpString(null, true)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(tenantTimeFromSpString(undefined, true)).toBe('');
  });

  it('returns the raw string when it does not match HH:mm', () => {
    expect(tenantTimeFromSpString('gibberish', true)).toBe('gibberish');
  });
});

describe('tenantTodayYmd', () => {
  it('returns todays date in yyyy-MM-dd form', () => {
    const out = tenantTodayYmd({ isUsTenant: false, timeZone: 'UTC' });
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('honours a Windows timezone', () => {
    const out = tenantTodayYmd({ isUsTenant: false, timeZone: 'New Zealand Standard Time' });
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts a null timeZone', () => {
    const out = tenantTodayYmd({ isUsTenant: false, timeZone: null });
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
