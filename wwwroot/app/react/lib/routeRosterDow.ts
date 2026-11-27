// Route roster day of week (Dispatch_RouteRoster.DayOfWeek): 0-6, Sunday = 0.
// Every SQL reader uses this convention (uspPrebookSet, WS_stpJob_Insert,
// fnRouteCourierForDate). Not to be confused with schedule days
// (tblBulkRunSchedule), which are ISO 1-7 with Sunday = 7.

/** Labels indexed by route roster DayOfWeek (0 = Sun .. 6 = Sat). */
export const ROUTE_ROSTER_DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dropdown options in Mon-first order, values still 0-6 (Sun = 0). */
export const ROUTE_ROSTER_DOW_OPTIONS = [1, 2, 3, 4, 5, 6, 0].map((value) => ({
  value,
  label: ROUTE_ROSTER_DOW_LABELS[value],
}));
