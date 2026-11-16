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

// #311 / #326 split runs. RVW_stpBulkRuns_2 returns one row per run +
// courier + pre-assign flag, so a run whose jobs sit with two drivers (or
// with a driver and nobody) shows as several rows sharing one run id. Every
// place that selects, tints, menus or fetches a run row keys on the whole
// identity, never the bare id.
//
// RVW_stpGetMissingJobRuns rows always carry CourierID NULL whoever holds the
// jobs, so a missing row is its own identity and is not narrowed to
// unassigned jobs.

export interface RunRowIdentity {
  id: number;
  courierId?: number | null;
  preAssigned?: number | null;
  isMissing?: boolean;
}

/** Stable key for one Run List row. */
export function runRowKey(r: RunRowIdentity): string {
  return `${r.id}|${r.courierId ?? ''}|${r.preAssigned === 1 ? 1 : 0}${r.isMissing ? '|M' : ''}`;
}

/** The run id a row key stands for. */
export function runIdOfKey(key: string): number {
  return Number(key.split('|')[0]);
}

export interface RunRowJobScope {
  /** The row's courier; null = no courier restriction or unassigned only. */
  courierId: number | null;
  /** The NULL-courier row of a run: only jobs nobody holds. */
  unassignedOnly: boolean;
  /** Pre-assigned row: status-18 jobs; otherwise everything else. */
  preAssigned: boolean;
}

/** What a run row's jobs are: the row's own courier (or unassigned only for
 *  the NULL-courier row) and the row's pre-assign flag. Used by the Run Jobs
 *  grid fetch, the run menu and Assign Route alike. */
export function runRowJobScope(r: RunRowIdentity): RunRowJobScope {
  if (r.isMissing) return { courierId: null, unassignedOnly: false, preAssigned: false };
  return {
    courierId: r.courierId ?? null,
    unassignedOnly: r.courierId == null,
    preAssigned: r.preAssigned === 1,
  };
}

/** The Run Jobs grid filters narrowed to one row's scope. The row's own
 *  courier wins; a missing-scan row (no courier of its own) keeps the
 *  grid's courier filter. */
export function runRowJobFilters<F extends { courierId?: number | null }>(
  r: RunRowIdentity,
  filters: F,
): F & { courierId: number | null; unassignedOnly: boolean; preAssigned: boolean } {
  const s = runRowJobScope(r);
  return {
    ...filters,
    courierId: s.courierId ?? filters.courierId ?? null,
    unassignedOnly: s.unassignedOnly,
    preAssigned: s.preAssigned,
  };
}

/** The Run List row a job sits on: same run, same courier (an unassigned
 *  job is on the NULL-courier row), else the run's first row. Null when
 *  the run is not listed. */
export function rowKeyForJob(rows: RunRowIdentity[], runId: number, courierId: number | null | undefined): string | null {
  const ofRun = rows.filter((r) => r.id === runId && !r.isMissing);
  if (ofRun.length === 0) return null;
  const hit = ofRun.find((r) => (r.courierId ?? null) === (courierId ?? null)) ?? ofRun[0];
  return runRowKey(hit);
}

/** Drop any selected run id that is not in the list the operator can see.
 *  Returns the SAME array when nothing changes so a React state setter can
 *  bail out without a re-render. Works on row keys as well as bare ids. */
export function pruneSelectedRunIds<T extends number | string>(selected: T[], visibleRunIds: Iterable<T>): T[] {
  if (selected.length === 0) return selected;
  const visible = new Set(visibleRunIds);
  const next = selected.filter((id) => visible.has(id));
  return next.length === selected.length ? selected : next;
}
