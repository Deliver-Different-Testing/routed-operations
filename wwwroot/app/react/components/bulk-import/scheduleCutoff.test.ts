import { describe, expect, it } from 'vitest';
import { cutoffMoment, formatCutoff, isPastCutoff, latestCutoff } from './scheduleCutoff';

// 2026-06-15 is a Monday. All Dates here are wall-clock values, which is
// what the rule compares; see scheduleCutoff.ts.
const MONDAY = new Date(2026, 5, 15);

describe('cutoffMoment', () => {
  it('subtracts cutoffHours from the start time on the book date', () => {
    const m = cutoffMoment({ startTime: '12:00:00', cutoffHours: 2 }, MONDAY);
    expect(m).toEqual(new Date(2026, 5, 15, 10, 0));
  });

  it('reaches back into the previous day when cutoffHours crosses midnight', () => {
    // The Urgent case: 12:00 start, 22 hours notice, so booking Monday
    // closes on Sunday afternoon.
    const m = cutoffMoment({ startTime: '12:00:00', cutoffHours: 22 }, MONDAY);
    expect(m).toEqual(new Date(2026, 5, 14, 14, 0));
  });

  it('treats a negative cutoffHours as the same amount of notice', () => {
    const positive = cutoffMoment({ startTime: '12:00:00', cutoffHours: 22 }, MONDAY);
    const negative = cutoffMoment({ startTime: '12:00:00', cutoffHours: -22 }, MONDAY);
    expect(negative).toEqual(positive);
  });

  it('returns null without a book date or a usable start time', () => {
    expect(cutoffMoment({ startTime: '12:00:00', cutoffHours: 1 }, null)).toBeNull();
    expect(cutoffMoment({ startTime: null, cutoffHours: 1 }, MONDAY)).toBeNull();
    expect(cutoffMoment({ startTime: 'not-a-time', cutoffHours: 1 }, MONDAY)).toBeNull();
  });
});

describe('isPastCutoff', () => {
  const schedule = { startTime: '12:00:00', cutoffHours: 22 };

  it('is open a minute before the cutoff', () => {
    expect(isPastCutoff(schedule, MONDAY, new Date(2026, 5, 14, 13, 59))).toBe(false);
  });

  it('is closed on the cutoff minute itself, matching the server >= test', () => {
    expect(isPastCutoff(schedule, MONDAY, new Date(2026, 5, 14, 14, 0))).toBe(true);
  });

  it('is closed a minute after the cutoff', () => {
    expect(isPastCutoff(schedule, MONDAY, new Date(2026, 5, 14, 14, 1))).toBe(true);
  });

  it('does not enforce a cutoff it cannot compute', () => {
    expect(isPastCutoff({ startTime: null, cutoffHours: 22 }, MONDAY, new Date())).toBe(false);
  });
});

describe('latestCutoff', () => {
  it('returns the last moment booking was still possible', () => {
    const rows = [
      { startTime: '08:00:00', cutoffHours: 2 },   // 06:00
      { startTime: '12:00:00', cutoffHours: 2 },   // 10:00
      { startTime: '09:00:00', cutoffHours: 2 },   // 07:00
    ];
    expect(latestCutoff(rows, MONDAY)).toEqual(new Date(2026, 5, 15, 10, 0));
  });

  it('is null when nothing has a computable cutoff', () => {
    expect(latestCutoff([{ startTime: null, cutoffHours: 2 }], MONDAY)).toBeNull();
  });
});

describe('formatCutoff', () => {
  it('uses day/month for an NZ tenant', () => {
    expect(formatCutoff(new Date(2026, 5, 14, 14, 0), false)).toBe('14/06 14:00');
  });

  it('uses month/day for a US tenant', () => {
    expect(formatCutoff(new Date(2026, 5, 14, 14, 0), true)).toBe('06/14 14:00');
  });

  it('pads single digits', () => {
    expect(formatCutoff(new Date(2026, 0, 2, 9, 5), false)).toBe('02/01 09:05');
  });
});
