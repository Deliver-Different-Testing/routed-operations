// Route Viewer drag-and-drop of job rows onto a run (#1004).
//
// The Run List mixes two kinds of row:
//   - synthetic route runs, whose id is -RouteId (RVW_stpBulkRuns_2 emits
//     `-r.RouteId AS ID`; BulkRunDto.Id documents the same), and
//   - real bulk runs (tblBulkRun.ID, positive).
//
// Transfer Route moves jobs onto a ROUTE (dbo.Routes.RouteId). Before this
// helper the drop handler sent the run id as the route id, so:
//   - a drop on a route run sent a negative NewRouteId and got a 400, and
//   - a drop on a real bulk run sent tblBulkRun.ID as a RouteId, which on
//     Medical overlaps the active route ids (runs 1-15 vs routes 1-15) and
//     would silently move the jobs to whatever route shares that number.
//
// Rule: only a synthetic route run is a valid drop target, and its route
// id is the run id negated. A real bulk run is refused with a message.

export type RunDropResolution =
  | { kind: 'route'; routeId: number }
  | { kind: 'same-run' }
  | { kind: 'not-a-route'; message: string };

export function resolveRunDropRoute(
  toRunId: number,
  fromRunId: number,
  toRunName?: string | null,
): RunDropResolution {
  if (toRunId === fromRunId) return { kind: 'same-run' };
  if (Number.isInteger(toRunId) && toRunId < 0) return { kind: 'route', routeId: -toRunId };
  const label = toRunName?.trim() ? toRunName.trim() : `run ${toRunId}`;
  return {
    kind: 'not-a-route',
    message: `Cannot move jobs onto ${label}: it is a bulk run, not a route. Drop onto a route run, or use Transfer Route.`,
  };
}
