// React Query wrappers for Driver Scheduling reads. Every query key
// includes `currentTenantId` per the tenant-drift-guard pattern shipped
// in the route-viewer MR (fix/route-viewer-cross-tenant-and-selection),
// so a hub tenant switch on the shared cookie can't leak one tenant's
// schedule totals into another.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { driverSchedulingService } from '../../services/driverSchedulingService';

const AUTO_POLL_MS = 30_000;

export function useDriverSchedulingSummaries(bookDate: string, enabled = true) {
  const user = useAuth();
  return useQuery({
    queryKey: ['ds-summaries', user.currentTenantId ?? 0, bookDate],
    queryFn: () => driverSchedulingService.getSummariesByBookDate(bookDate),
    enabled: enabled && !!bookDate,
    staleTime: 10_000,
    refetchInterval: AUTO_POLL_MS,
  });
}

export function useDriverSchedulingCouriers(scheduleId: number | null) {
  const user = useAuth();
  return useQuery({
    queryKey: ['ds-couriers', user.currentTenantId ?? 0, scheduleId ?? 0],
    queryFn: () => driverSchedulingService.getCouriersBySchedule(scheduleId!),
    enabled: scheduleId != null,
    staleTime: 10_000,
  });
}

export function useDriverSchedulingNotifications() {
  const user = useAuth();
  return useQuery({
    queryKey: ['ds-notifications', user.currentTenantId ?? 0],
    queryFn: () => driverSchedulingService.getNotifications(),
    staleTime: 15_000,
  });
}

/** Bulk-region lookup for the New Schedule modal. Cached long -
 *  region list barely changes during an operator session. */
export function useDriverSchedulingLocations() {
  const user = useAuth();
  return useQuery({
    queryKey: ['ds-locations', user.currentTenantId ?? 0],
    queryFn: () => driverSchedulingService.getLocations(),
    staleTime: 5 * 60_000,
  });
}

/** VehicleType lookup for the Add Time Slot modal. Cached long -
 *  taxonomy is basically static per tenant. */
export function useDriverSchedulingVehicleTypes() {
  const user = useAuth();
  return useQuery({
    queryKey: ['ds-vehicle-types', user.currentTenantId ?? 0],
    queryFn: () => driverSchedulingService.getVehicleTypes(),
    staleTime: 5 * 60_000,
  });
}

/** Convenience: invalidate every Driver Scheduling query after a
 *  write. Cheaper than tracking individual query keys at each
 *  mutation site. */
export function useInvalidateDriverScheduling() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['ds-summaries'] });
    queryClient.invalidateQueries({ queryKey: ['ds-couriers'] });
    queryClient.invalidateQueries({ queryKey: ['ds-notifications'] });
  };
}
