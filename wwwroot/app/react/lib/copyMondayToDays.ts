/**
 * M12 / R1 (2026-11-12): "Copy Monday to other days" in the Operating days
 * editor. Marcus (6 Nov): setting five to seven days by hand is time
 * consuming and finicky.
 *
 * Copies Monday's window and cut-off time onto every OTHER ticked day. The
 * cut-off day is an absolute weekday (1 = Mon .. 7 = Sun), so it is shifted
 * by the distance from Monday: a Monday run cut off on Sunday (the day
 * before) becomes a Wednesday run cut off on Tuesday, and Monday's same-day
 * cut-off stays same-day everywhere. Wraps round the week.
 *
 * Unticked days, and each day's own id and enabled flag, are left alone.
 * When Monday is not ticked there is nothing to copy and the input comes
 * back unchanged.
 */
export interface CopyableDay {
  enabled: boolean;
  startTime: string;
  endTime: string;
  cutoffDay: number | null;
  cutoffTime: string | null;
}

/** Index 0 = Monday, 6 = Sunday, the order the editor keeps its days in. */
export function copyMondayToOtherDays<T extends CopyableDay>(days: T[]): T[] {
  const monday = days[0];
  if (!monday?.enabled) return days;
  return days.map((d, i) => {
    if (i === 0 || !d.enabled) return d;
    return {
      ...d,
      startTime: monday.startTime,
      endTime: monday.endTime,
      cutoffTime: monday.cutoffTime,
      cutoffDay: monday.cutoffDay == null ? null : ((monday.cutoffDay - 1 + i) % 7) + 1,
    };
  });
}
