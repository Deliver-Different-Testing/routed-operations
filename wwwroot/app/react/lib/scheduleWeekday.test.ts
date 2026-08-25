import { describe, expect, it } from 'vitest';
import {
  isDayActive,
  setDay,
  weekdayArrayToMask,
  maskToWeekdayArray,
  DAY_LABELS_SHORT,
} from './scheduleWeekday';

// The weekday bit convention is load-bearing: legacy prebook cron
// interprets dayOfWeek as bit 0 = Monday. Regressing this would silently
// shift every schedule by N days. These tests pin the mapping.

describe('scheduleWeekday', () => {
  it('has seven day labels starting Monday', () => {
    expect(DAY_LABELS_SHORT).toHaveLength(7);
    expect(DAY_LABELS_SHORT[0]).toBe('M');
    expect(DAY_LABELS_SHORT[6]).toBe('S');
  });

  it('isDayActive: bit 0 = Monday, bit 6 = Sunday', () => {
    // 0b0000001 = Monday only
    expect(isDayActive(1, 0)).toBe(true);
    expect(isDayActive(1, 1)).toBe(false);
    // 0b1000000 = Sunday only
    expect(isDayActive(64, 6)).toBe(true);
    expect(isDayActive(64, 0)).toBe(false);
    // 0b1111111 = every day
    expect(isDayActive(127, 3)).toBe(true);
  });

  it('isDayActive: null / undefined mask means all-off', () => {
    expect(isDayActive(null, 0)).toBe(false);
    expect(isDayActive(undefined, 6)).toBe(false);
  });

  it('setDay: toggling a bit and back yields the original mask', () => {
    const start = 0b0101010;
    const stepped = setDay(start, 0, true);
    expect(isDayActive(stepped, 0)).toBe(true);
    const restored = setDay(stepped, 0, false);
    expect(restored).toBe(start);
  });

  it('weekdayArrayToMask + maskToWeekdayArray round-trip', () => {
    // Mon+Wed+Fri
    const arr = [1, 0, 1, 0, 1, 0, 0];
    const mask = weekdayArrayToMask(arr);
    expect(mask).toBe(0b0010101);
    expect(maskToWeekdayArray(mask)).toEqual(arr);
  });

  it('weekdayArrayToMask ignores >7 slots (defensive)', () => {
    const arr = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    expect(weekdayArrayToMask(arr)).toBe(127);
  });

  it('maskToWeekdayArray always returns a fresh 7-slot array', () => {
    const a = maskToWeekdayArray(0);
    const b = maskToWeekdayArray(0);
    expect(a).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(a).not.toBe(b);
  });
});
