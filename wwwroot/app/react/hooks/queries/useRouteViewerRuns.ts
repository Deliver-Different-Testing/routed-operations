import { useQuery } from '@tanstack/react-query';
import { routeViewerService, type RunFilters, type BulkRun } from '../../services/routeViewerService';

// Home-module run list, keyed on the full filter tuple. The 25s auto-poll is
// handled at the page level (see useAutoPoll) rather than TanStack's
// refetchInterval so the poll cadence stays in one place and Section 6
// stakeholder decisions on cadence-per-module remain localised.
//
// 2026-10-09: `placeholderData: keepPreviousData` removed. Its comment said it
// avoided a mid-poll flash of an empty grid, but it never did that: the poll
// calls runsQuery.refetch() on the SAME query key, and a same-key refetch
// already serves the cached rows from that key. placeholderData only applies
// when the key CHANGES, i.e. only when the operator changes date, client,
// region, speed or view mode - exactly the case where showing the previous
// filter's rows is wrong. On Medical that surfaced as a depot region listing
// the previous date's pickup runs next to a "0 runs" counter until Refresh was
// pressed. See KEVIN-ROUTE-VIEWER-REGION-FILTERING-2026-10-08.md, the
// front-end item in the acceptance section.
export function useRouteViewerRuns(filters: RunFilters, enabled: boolean = true) {
  return useQuery<BulkRun[]>({
    queryKey: [
      'rv-runs',
      filters.runDate,
      filters.clientIds ?? [],
      filters.regionIds ?? [],
      filters.speedIds ?? [],
      filters.group ?? 'Combined',
      filters.clientId ?? null,
    ],
    queryFn: () => routeViewerService.getRuns(filters),
    enabled: enabled && !!filters.runDate,
    staleTime: 5_000,
  });
}
