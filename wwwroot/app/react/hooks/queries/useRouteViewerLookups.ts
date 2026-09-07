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
//
// Every query key ALSO includes `currentTenantId` (2026-09-04). The lookup
// SPs (RVW_stpBulkClients / RVW_stpBulkRegions / RVW_stpBulkSpeeds) are
// tenant-scoped server-side via DynamicDespatchDbContextFactory, so two
// tenants can return different rows for the same runDate. Without the
// tenant id in the cache key, React Query serves the first tenant's
// response to the second tenant on the same origin (e.g. after a hub
// tenant switch on the shared cookie), which is how Steve saw NZ regions
// on a US medical URL. Keying per tenant localises the cache and forces
// a fresh fetch on tenant change.
export function useRouteViewerLookups(runDate: string, enabled: boolean = true) {
  const user = useAuth();
  const clientInternal = user.clientTypeId === 'Internal';
  const multipleClients = (user.clientCount ?? 0) > 1;
  const tenantKey = user.currentTenantId ?? 0;

  const results = useQueries({
    queries: [
      {
        // contactId comes from the auth claim and narrows the SP result
        // to what this operator's contact scope allows. Legacy passes
        // it; dropping it exposes the full tenant client list.
        queryKey: ['rv-lookups', 'clients', tenantKey, runDate, multipleClients, user.contactId ?? 0],
        queryFn: () => routeViewerService.getClients(runDate, multipleClients, user.contactId),
        enabled: enabled && !!runDate,
      },
      {
        queryKey: ['rv-lookups', 'regions', tenantKey, runDate],
        queryFn: () => routeViewerService.getRegions(runDate),
        enabled: enabled && !!runDate,
      },
      {
        queryKey: ['rv-lookups', 'speeds', tenantKey, runDate],
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
