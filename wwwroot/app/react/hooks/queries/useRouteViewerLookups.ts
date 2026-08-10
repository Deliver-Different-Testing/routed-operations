import { useQueries } from '@tanstack/react-query';
import { routeViewerService } from '../../services/routeViewerService';
import { useAuth } from '../../context/AuthContext';

// Filter-dropdown lookups for the Route Viewer Home module: Clients,
// Regions, Speeds. All three are `runDate`-scoped inside the SP (some
// clients/regions/speeds are only active on certain dates), so the
// TanStack query key must include the date. TopUpServices is date-agnostic
// and only needed by the TopUp dialog, so lives on its own hook.
//
// `clientInternal` + `multipleClients` are derived from the auth claims
// so the run-list SP branches to the correct row scope without the
// component needing to pass them explicitly.
export function useRouteViewerLookups(runDate: string, enabled: boolean = true) {
  const user = useAuth();
  const clientInternal = user.clientTypeId === 'Internal';
  const multipleClients = (user.clientCount ?? 0) > 1;

  const results = useQueries({
    queries: [
      {
        queryKey: ['rv-lookups', 'clients', runDate, clientInternal, multipleClients],
        queryFn: () => routeViewerService.getClients(runDate, clientInternal, multipleClients),
        enabled: enabled && !!runDate,
      },
      {
        queryKey: ['rv-lookups', 'regions', runDate],
        queryFn: () => routeViewerService.getRegions(runDate),
        enabled: enabled && !!runDate,
      },
      {
        queryKey: ['rv-lookups', 'speeds', runDate],
        queryFn: () => routeViewerService.getSpeeds(runDate),
        enabled: enabled && !!runDate,
      },
    ],
  });

  const [clientsQ, regionsQ, speedsQ] = results;
  return {
    clients: clientsQ.data ?? [],
    regions: regionsQ.data ?? [],
    speeds: speedsQ.data ?? [],
    isLoading: results.some((q) => q.isLoading),
    isFetching: results.some((q) => q.isFetching),
    errors: results.map((q) => q.error).filter(Boolean) as Error[],
    clientInternal,
    multipleClients,
  };
}
