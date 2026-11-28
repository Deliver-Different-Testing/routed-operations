// The home page counts for today, worked out from the same two responses
// Route Viewer already loads (the run list and the region overview), so the
// home page and Route Viewer cannot disagree and no new endpoint is needed.

/** The run-list fields the counts read (a subset of routeViewerService BulkRun). */
export interface SummaryRun {
  id: number;
  jobs: number;
  status: string | null;
  isMissing: boolean;
  courierId: number | null;
  agentName: string | null;
}

/** The region-overview fields the counts read. */
export interface SummaryRegion {
  total: number;
  pickedUp: number;
  toDo: number;
}

export interface TodaySummary {
  /** Runs on today, each counted once however many drivers it is split across. */
  runs: number;
  /** Jobs today, as the Route Viewer Overview totals them. */
  jobs: number;
  pickedUp: number;
  toDo: number;
  /** Runs with work on them that has neither a driver nor a partner. */
  unassignedRuns: number;
  /** Rows Route Viewer puts on its Exceptions list. */
  exceptions: number;
}

/** Same rule as the Route Viewer Exceptions list (RvRunListLite). */
function isException(run: SummaryRun): boolean {
  return run.isMissing || run.status === 'V';
}

export function summariseToday(runs: readonly SummaryRun[], regions: readonly SummaryRegion[]): TodaySummary {
  const working = runs.filter((run) => !isException(run));
  const waiting = working.filter((run) => run.jobs > 0 && run.courierId == null && !(run.agentName ?? '').trim());
  const sum = (pick: (region: SummaryRegion) => number) => regions.reduce((total, region) => total + (pick(region) || 0), 0);
  return {
    runs: new Set(working.map((run) => run.id)).size,
    jobs: sum((region) => region.total),
    pickedUp: sum((region) => region.pickedUp),
    toDo: sum((region) => region.toDo),
    unassignedRuns: new Set(waiting.map((run) => run.id)).size,
    exceptions: runs.length - working.length,
  };
}
