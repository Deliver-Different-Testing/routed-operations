// Route Viewer run selection helpers (#1002).
//
// Kenneth's report: switching Inbound / Outbound (or speed, client, courier)
// emptied the Run List but the job grid kept the previous run's jobs under
// a "Run - (select a run)" header. Two causes:
//   1. the reset key only covered run date + regions, so the other filters
//      never cleared the selection, and
//   2. the job query stayed enabled on the selected id even when that run
//      was no longer in the list.
// These pure helpers carry the rules so they can be unit-tested.

export interface RunSelectionFilters {
  runDate: string;
  regionIds: number[];
  speedIds: number[];
  clientIds: number[];
  courierId: number | null;
}

const sortedCsv = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');

/** Every filter that changes which runs (or which jobs on a run) the
 *  operator sees. A change to any of them resets the selection. Id lists
 *  are sorted so picking the same set in a different order is not a change. */
export function buildRunFilterIdentity(filters: RunSelectionFilters, viewMode: string): string {
  return [
    filters.runDate,
    sortedCsv(filters.regionIds),
    viewMode,
    sortedCsv(filters.speedIds),
    sortedCsv(filters.clientIds),
    filters.courierId ?? '',
  ].join('|');
}

/** Drop any selected run id that is not in the list the operator can see.
 *  Returns the SAME array when nothing changes so a React state setter can
 *  bail out without a re-render. */
export function pruneSelectedRunIds(selected: number[], visibleRunIds: Iterable<number>): number[] {
  if (selected.length === 0) return selected;
  const visible = new Set(visibleRunIds);
  const next = selected.filter((id) => visible.has(id));
  return next.length === selected.length ? selected : next;
}
