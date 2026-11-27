import { useQueries } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { linehaulRateService } from '../../services/linehaulRateService';
import { legPricedFromLinehaulTab, type LinehaulTabRows } from '../../lib/linehaulLegRules';

export interface LinehaulTabPricingInput {
  linehaulRunId: number | null | undefined;
  /** Saved schedule id; null for a new schedule (client / speed rows only). */
  scheduleId: number | null;
  /** Clients on the schedule. Empty = "All clients", only rows with no client count. */
  clientIds: number[];
  /** The schedule (delivery) speed, the one the quote and job creation price at. */
  speedId: number | null;
}

/**
 * UC #1115 spec v2 Part B 2. Whether the Linehaul tab prices this leg, from the endpoints
 * the Linehaul tab already uses (GET /api/linehaul-rates and
 * GET /api/linehaul-rates/runs/{runId}/schedules). False while loading or on an error,
 * so the editor falls back to today's editable fields.
 */
export function useLegPricedFromLinehaulTab({ linehaulRunId, scheduleId, clientIds, speedId }: LinehaulTabPricingInput): boolean {
  const user = useAuth();
  const tenant = user.currentTenantId ?? 0;
  const targets: (number | null)[] = clientIds.length > 0 ? [...new Set(clientIds)] : [null];
  const enabled = linehaulRunId != null;

  const runs = useQueries({
    queries: targets.map((clientId) => ({
      queryKey: ['linehaul-rates-runs', tenant, clientId] as const,
      queryFn: () => linehaulRateService.runs({ clientId }).then((r) => r.response),
      enabled,
      staleTime: 30_000,
      retry: false,
    })),
  });
  const scheduleRates = useQueries({
    queries: targets.map((clientId) => ({
      queryKey: ['linehaul-rates-schedules', tenant, linehaulRunId ?? 0, clientId] as const,
      queryFn: () => linehaulRateService.scheduleRates(linehaulRunId as number, clientId).then((r) => r.response),
      enabled: enabled && scheduleId != null,
      staleTime: 30_000,
      retry: false,
    })),
  });

  if (!enabled || runs.some((q) => !q.isSuccess)) return false;
  if (scheduleId != null && scheduleRates.some((q) => !q.isSuccess)) return false;
  const perClient: LinehaulTabRows[] = targets.map((_, i) => ({
    runs: runs[i].data ?? [],
    scheduleRates: scheduleId != null ? scheduleRates[i].data ?? [] : [],
  }));
  return legPricedFromLinehaulTab(linehaulRunId, scheduleId, speedId, perClient);
}
