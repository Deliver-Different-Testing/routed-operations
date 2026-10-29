// Schedule booking cutoff, shared by the Service and Schedule pickers.
//
// A schedule closes for booking `cutoffHours` before it starts on the
// chosen book date, so the cutoff is BookDate + StartTime - CutoffHours.
// The server applies exactly this in BulkImportJobFactory.cs and refuses a
// late import with "Schedule cutoff exceeded.", so anything the server will
// refuse must not be offered in the wizard at all.
//
// Keep this the single implementation. It previously lived inline in
// SchedulePickerModal with a "cutoff only applies to today" shortcut, which
// hid the whole rule whenever cutoffHours reached back past midnight (a
// 12:00 schedule with cutoffHours 22 closes at 14:00 the PREVIOUS day).

/** The fields of a schedule row the cutoff rule needs. */
export interface CutoffSchedule {
  startTime: string | null;
  cutoffHours: number;
}

/**
 * The moment this schedule stops accepting bookings for `bookDate`, as a
 * Date carrying tenant wall-clock fields (compare only against
 * `tenantNowWallClock`). Null when the row has no usable start time, which
 * the callers treat as "no cutoff to enforce".
 */
export function cutoffMoment(
  schedule: CutoffSchedule,
  bookDate: Date | null,
): Date | null {
  if (bookDate == null || !schedule.startTime) return null;
  const [hh, mm] = schedule.startTime.split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const start = new Date(
    bookDate.getFullYear(),
    bookDate.getMonth(),
    bookDate.getDate(),
    hh,
    mm,
  );
  // CutoffHours is stored positive on some rows and negative on others;
  // both mean "this many hours before the start". Mirrors the server's
  // `CutoffHours >= 0 ? CutoffHours * -1 : CutoffHours`.
  const hours = schedule.cutoffHours >= 0 ? schedule.cutoffHours : -schedule.cutoffHours;
  return new Date(start.getTime() - hours * 3600 * 1000);
}

/** True when `now` is at or past this schedule's cutoff for `bookDate`. */
export function isPastCutoff(
  schedule: CutoffSchedule,
  bookDate: Date | null,
  now: Date,
): boolean {
  const cutoff = cutoffMoment(schedule, bookDate);
  if (cutoff == null) return false;
  // Server rejects on `tenantNow >= cutoffTime`, so the cutoff minute itself
  // is already closed.
  return now.getTime() >= cutoff.getTime();
}

/** Latest of a set of cutoff moments, i.e. the last chance that was missed. */
export function latestCutoff(
  schedules: CutoffSchedule[],
  bookDate: Date | null,
): Date | null {
  let latest: Date | null = null;
  for (const s of schedules) {
    const c = cutoffMoment(s, bookDate);
    if (c != null && (latest == null || c.getTime() > latest.getTime())) latest = c;
  }
  return latest;
}

/**
 * Operator-facing rendering of a cutoff moment. The Date already carries
 * tenant wall-clock fields, so this formats the parts directly rather than
 * going through Intl, which would shift them again.
 */
export function formatCutoff(moment: Date, isUsTenant: boolean): string {
  const p2 = (n: number) => String(n).padStart(2, '0');
  const day = p2(moment.getDate());
  const month = p2(moment.getMonth() + 1);
  const date = isUsTenant ? `${month}/${day}` : `${day}/${month}`;
  return `${date} ${p2(moment.getHours())}:${p2(moment.getMinutes())}`;
}
