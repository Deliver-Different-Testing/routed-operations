import { useQueries } from '@tanstack/react-query';
import { regionService } from '../../services/regionService';
import { speedService } from '../../services/speedService';
import { courierService } from '../../services/courierService';
import { jobService } from '../../services/jobService';
import { vehicleSizeService } from '../../services/vehicleSizeService';

/**
 * Phase 4 perf: unified TanStack Query hook for the 7 cockpit lookup calls
 * that used to fire in a single `Promise.all` inside `loadLookups` on every
 * date change. Each call becomes its own useQuery entry, so:
 *
 *   - Rapidly toggling the operating date twice within `staleTime` returns
 *     the cached lookups instantly (no round-trip).
 *   - Window focus revalidates in the background while the cockpit stays
 *     interactive with the last-good values.
 *   - Independent failure: if one lookup service is down (e.g. couriers),
 *     the other 6 still succeed and only the failed one shows an error.
 *
 * Query keys are date-scoped where the underlying endpoint depends on the
 * operating date (`speeds`, `refs`), and date-agnostic for the rest
 * (`regions`, `couriers`, `fleets`, `clients`, `vehicle-sizes`).
 *
 * TenantScopedCache on the backend already scopes cache values per tenant;
 * TanStack Query keys on the frontend are naturally scoped per browser
 * session (per authenticated user), so no explicit tenant key is needed
 * here.
 */
export function useCockpitLookups(operatingDate: string) {
  const results = useQueries({
    queries: [
      {
        queryKey: ['cockpit', 'regions', operatingDate],
        queryFn: () => regionService.getForRunDate(operatingDate),
      },
      {
        queryKey: ['cockpit', 'speeds', operatingDate],
        queryFn: () => speedService.getForRunDate(operatingDate),
      },
      {
        queryKey: ['cockpit', 'fleets'],
        queryFn: () => courierService.getFleets(),
      },
      {
        queryKey: ['cockpit', 'couriers', 'active'],
        queryFn: () => courierService.getActive(),
      },
      {
        queryKey: ['cockpit', 'clients'],
        queryFn: () => jobService.getClientFilters(),
      },
      {
        queryKey: ['cockpit', 'refs', operatingDate],
        queryFn: () => jobService.getOurRefs(operatingDate),
      },
      {
        queryKey: ['cockpit', 'vehicle-sizes'],
        queryFn: () => vehicleSizeService.getAll(),
      },
    ],
  });

  const [regionsQ, speedsQ, fleetsQ, couriersQ, clientsQ, refsQ, vehSizesQ] = results;

  return {
    regions: regionsQ.data,
    speeds: speedsQ.data,
    fleets: fleetsQ.data,
    couriers: couriersQ.data,
    clients: clientsQ.data,
    ourRefs: refsQ.data,
    vehicleSizes: vehSizesQ.data,
    isLoading: results.some((q) => q.isLoading),
    isFetching: results.some((q) => q.isFetching),
    errors: results.map((q) => q.error).filter(Boolean) as Error[],
  };
}
