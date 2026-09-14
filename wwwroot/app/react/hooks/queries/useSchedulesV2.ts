import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import {
  schedulesV2Service,
  type SchedulesV2Filters,
} from '../../services/schedulesV2Service';

// React Query wrappers for the Schedules NEW page (Steve's 2026-09-08
// id-keyed view). Every query key includes currentTenantId so a hub
// tenant switch on the shared cookie can't leak one tenant's schedule
// list into another (same pattern as useDriverScheduling +
// useRouteViewerLookups).

export function useSchedulesV2List(filters?: SchedulesV2Filters) {
  const user = useAuth();
  return useQuery({
    queryKey: [
      'schedules-v2-list',
      user.currentTenantId ?? 0,
      filters?.type ?? 'all',
      filters?.q ?? '',
      filters?.clientId ?? 0,
      (filters?.clientIds ?? []).join(','),
    ],
    queryFn: () => schedulesV2Service.list(filters),
    // Schedule state changes at operator pace, not machine pace. 30s
    // stale is enough to keep the browse view fresh while a rebuild is
    // in progress without hammering the server on tab-switch.
    staleTime: 30_000,
  });
}

/** Schedule Groups tab. Empty until 20260914140000 migration lands. */
export function useSchedulesV2Groups() {
  const user = useAuth();
  return useQuery({
    queryKey: ['schedules-v2-groups', user.currentTenantId ?? 0],
    queryFn: () => schedulesV2Service.listGroups(),
    staleTime: 60_000,
  });
}

/** Full detail for one schedule, used by the read-only edit modal.
 *  Enabled only when scheduleId is a positive integer so opening the
 *  page without a row selected doesn't fire a bogus fetch. */
export function useSchedulesV2Detail(scheduleId: number | null) {
  const user = useAuth();
  return useQuery({
    queryKey: ['schedules-v2-detail', user.currentTenantId ?? 0, scheduleId ?? 0],
    queryFn: () => schedulesV2Service.getById(scheduleId!),
    enabled: scheduleId != null && scheduleId > 0,
    // Detail is opened on demand and modal is short-lived; keep the
    // cache long enough to survive a close+reopen loop without a
    // spinner but not long enough to hide a genuine backend change.
    staleTime: 60_000,
    // Disable retry so a slow or 500-ing endpoint surfaces the error
    // to the modal immediately rather than trapping the operator
    // behind the loading spinner for the full 3-retry backoff.
    // Kevin observed the modal "loading forever" - almost always a
    // silent server-side failure that RQ was retrying quietly.
    retry: false,
  });
}
