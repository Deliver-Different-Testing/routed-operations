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
//
// 2026-09-17 (audit): every key that Schedules NEW consumes now flows
// through the schedulesV2Keys factory below so tenant scope is
// impossible to forget. Consumers that manually built keys prior to
// centralisation (invalidateQueries call sites in ScheduleDetailModal
// / CreateOverrideModal / AttachClientsModal) silently no-op'd because
// the raw ['schedules-v2-detail', id] key never matched the hook's
// full ['schedules-v2-detail', tenantId, id] shape. Route every key
// through the factory below.

/**
 * Central query-key factory for the Schedules NEW module. Every
 * useQuery / invalidateQueries / setQueryData / getQueryData call in
 * this module MUST build keys through here so a tenant hub-switch
 * cannot leak data across tenants.
 *
 * Usage:
 *   const key = schedulesV2Keys.detail(tenantId, scheduleId);
 *   qc.invalidateQueries({ queryKey: key });
 *
 *   // For broad invalidation across all detail entries of a tenant:
 *   qc.invalidateQueries({ queryKey: schedulesV2Keys.detailAll(tenantId) });
 */
export const schedulesV2Keys = {
  // Root keys (broad-match targets for invalidateQueries).
  root: ['schedules-v2'] as const,
  listAll: (tenantId: string | number) => ['schedules-v2-list', tenantId] as const,
  detailAll: (tenantId: string | number) => ['schedules-v2-detail', tenantId] as const,
  overridesAll: (tenantId: string | number) => ['schedules-v2-overrides', tenantId] as const,

  // Specific entries.
  list: (
    tenantId: string | number,
    type: string,
    q: string,
    clientId: number,
    clientIds: string,
    page: number,
    pageSize: number,
  ) => ['schedules-v2-list', tenantId, type, q, clientId, clientIds, page, pageSize] as const,
  bundles: (tenantId: string | number) => ['schedules-v2-bundles', tenantId] as const,
  detail: (tenantId: string | number, scheduleId: number) =>
    ['schedules-v2-detail', tenantId, scheduleId] as const,
  overrides: (tenantId: string | number, baseScheduleId: number) =>
    ['schedules-v2-overrides', tenantId, baseScheduleId] as const,
  bulkPolygons: (tenantId: string | number) => ['bulk-polygons', tenantId] as const,
  lookups: (tenantId: string | number) => ['schedules-v2-lookups', tenantId] as const,
  clientScheduleSources: (tenantId: string | number, clientId: number) =>
    ['client-schedule-sources', tenantId, clientId] as const,
} as const;

export function useSchedulesV2List(filters?: SchedulesV2Filters) {
  const user = useAuth();
  return useQuery({
    queryKey: schedulesV2Keys.list(
      user.currentTenantId ?? 0,
      filters?.type ?? 'all',
      filters?.q ?? '',
      filters?.clientId ?? 0,
      (filters?.clientIds ?? []).join(','),
      // page + pageSize MUST be in the key. Two callers share this hook:
      // the tab-count badge asks for pageSize=1 to grab just the total,
      // the table itself asks for pageSize=50 to render rows. Without
      // these in the key both requests collide on the same cache slot,
      // so after any invalidation whichever queryFn wins the race
      // clobbers the other. Symptom: table renders 1 row + total 2059
      // right after an override create. Adding them here separates the
      // cache buckets and each caller gets its own data.
      filters?.page ?? 0,
      filters?.pageSize ?? 0,
    ),
    queryFn: () => schedulesV2Service.list(filters),
    // Schedule state changes at operator pace, not machine pace. 30s
    // stale is enough to keep the browse view fresh while a rebuild is
    // in progress without hammering the server on tab-switch.
    staleTime: 30_000,
  });
}

/** Schedule Bundles tab. Empty until 20260914140000 migration lands. */
export function useSchedulesV2Bundles() {
  const user = useAuth();
  return useQuery({
    queryKey: schedulesV2Keys.bundles(user.currentTenantId ?? 0),
    queryFn: () => schedulesV2Service.listBundles(),
    staleTime: 60_000,
  });
}

/** Full detail for one schedule, used by the read-only edit modal.
 *  Enabled only when scheduleId is a positive integer so opening the
 *  page without a row selected doesn't fire a bogus fetch. */
export function useSchedulesV2Detail(scheduleId: number | null) {
  const user = useAuth();
  return useQuery({
    queryKey: schedulesV2Keys.detail(user.currentTenantId ?? 0, scheduleId ?? 0),
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
