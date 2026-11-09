import { describe, expect, it } from 'vitest';
import { resolveRunDropRoute } from './runDropTarget';

// #1004: drag-and-drop of jobs onto a run. A synthetic route run's id is
// -RouteId (RVW_stpBulkRuns_2 `-r.RouteId as ID`), so the route id sent to
// Transfer Route is the negated run id. A real bulk run is not a route.
describe('resolveRunDropRoute', () => {
  it('maps a synthetic route run to its route id (Burbank to Lab = route 15 = run -15)', () => {
    expect(resolveRunDropRoute(-15, -5)).toEqual({ kind: 'route', routeId: 15 });
  });

  it('never sends a negative route id (it used to, and the controller 400d)', () => {
    const r = resolveRunDropRoute(-1, 0);
    expect(r.kind === 'route' && r.routeId).toBe(1);
  });

  it('refuses a real bulk run: tblBulkRun.ID 5 must not become RouteId 5 (RNO200)', () => {
    const r = resolveRunDropRoute(5, -15, 'Reno AM');
    expect(r.kind).toBe('not-a-route');
    expect(r.kind === 'not-a-route' && r.message).toMatch(/Reno AM: it is a bulk run, not a route/);
  });

  it('refuses run id 0 and names the run by id when it has no name', () => {
    const r = resolveRunDropRoute(0, -15, null);
    expect(r.kind === 'not-a-route' && r.message).toMatch(/run 0/);
  });

  it('a drop on the source run is a no-op', () => {
    expect(resolveRunDropRoute(-15, -15)).toEqual({ kind: 'same-run' });
  });
});
