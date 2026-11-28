import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { tenantTodayYmd } from '../../lib/tenantDate';
import { summariseToday, type TodaySummary } from '../../lib/todaySummary';
import { routeViewerService } from '../../services/routeViewerService';
import { useRouteViewerRuns } from './useRouteViewerRuns';

export interface TodaySummaryState {
  /** null while loading, when it could not be loaded, or when not asked for. */
  summary: TodaySummary | null;
  status: 'loading' | 'ready' | 'error' | 'off';
}

/**
 * Today's counts for the home page. Reads the tenant's own today with no
 * filters and the Combined view, exactly what Route Viewer shows on opening.
 * The run list shares Route Viewer's query key, so opening Route Viewer next
 * reuses it. Pass enabled=false for a person who cannot open Route Viewer:
 * nothing is requested for them.
 */
export function useTodaySummary(enabled: boolean): TodaySummaryState {
  const user = useAuth();
  const runDate = tenantTodayYmd({ isUsTenant: user.isUsTenant, timeZone: user.timeZone });

  const runs = useRouteViewerRuns({ runDate, clientIds: [], regionIds: [], speedIds: [], group: 'Combined' }, enabled);
  const regions = useQuery({
    queryKey: ['home-overview', user.currentTenantId ?? 0, runDate],
    queryFn: () => routeViewerService.getRegionOverview(runDate, { group: 'Combined' }),
    enabled,
    staleTime: 15_000,
  });

  if (!enabled) return { summary: null, status: 'off' };
  if (runs.isError || regions.isError) return { summary: null, status: 'error' };
  if (!runs.isSuccess || !regions.isSuccess) return { summary: null, status: 'loading' };
  return { summary: summariseToday(runs.data, regions.data), status: 'ready' };
}
