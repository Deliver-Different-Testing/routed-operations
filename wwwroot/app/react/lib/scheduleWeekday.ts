// Weekday helpers for the Schedules module. `dayOfWeek` on
// TblBulkRunSchedule is a small int used as a bitmask - bit 0 = Monday,
// bit 6 = Sunday. Same convention as TblBulkScheduleLinehaul.WeekDay
// ("1010100" string form, position 0 = Monday). Kept in one place so
// the tab, edit modal, and any future consumer stay in lockstep.

export const DAY_LABELS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;
export const DAY_LABELS_LONG = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** True if the schedule is active on the given day. */
export const isDayActive = (mask: number | null | undefined, dayIndex: number): boolean =>
  ((mask ?? 0) & (1 << dayIndex)) !== 0;

/** Set / unset the bit at `dayIndex` in `mask` and return the new mask. */
export const setDay = (mask: number, dayIndex: number, active: boolean): number =>
  active ? mask | (1 << dayIndex) : mask & ~(1 << dayIndex);

/** Convert a 7-slot 0/1 array (linehaul WeekDay) to a bitmask. */
export const weekdayArrayToMask = (arr: readonly number[]): number => {
  let mask = 0;
  for (let i = 0; i < 7 && i < arr.length; i++) {
    if (arr[i] === 1) mask |= 1 << i;
  }
  return mask;
};

/** Convert a bitmask to a 7-slot 0/1 array. */
export const maskToWeekdayArray = (mask: number): number[] => {
  const out = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 7; i++) {
    if ((mask & (1 << i)) !== 0) out[i] = 1;
  }
  return out;
};
