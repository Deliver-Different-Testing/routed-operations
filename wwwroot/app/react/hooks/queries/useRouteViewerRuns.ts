import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { routeViewerService, type RunFilters, type BulkRun } from '../../services/routeViewerService';

// Home-module run list, keyed on the full filter tuple. `keepPreviousData`
// keeps the previous rows visible while the poll re-fetches, avoiding the
// mid-poll flash of an empty grid. The 25s auto-poll is handled at the
// page level (see useAutoPoll) rather than TanStack's refetchInterval so
// the poll cadence stays in one place and Section 6 stakeholder decisions
// on cadence-per-module remain localised.
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
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}
