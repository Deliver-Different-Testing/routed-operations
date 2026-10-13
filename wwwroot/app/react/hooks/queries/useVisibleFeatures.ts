import { useQuery } from '@tanstack/react-query';
import { request } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import type { FeaturesStatus } from '../../lib/accessSwitches';

// The caller's visible Access Control switches, from
// GET /api/me/visible-features. One fetch per page load: the sidebar and the
// route guard share it through the query cache, keyed per tenant so a hub
// tenant switch never serves the previous tenant's set.
//
// FAIL CLOSED. `status` is 'loading' | 'ready' | 'error' and a failed fetch
// leaves `visibleFeatures` null, so gated surfaces stay hidden rather than
// defaulting open (same posture as the configurator).
//
// Not fetched at all for a caller who bypasses the switches (DF Admin): the
// server lets them through every [RequireFeature], and they see everything.

export interface VisibleFeatures {
  visibleFeatures: Set<string> | null;
  status: FeaturesStatus;
}

export function useVisibleFeatures(): VisibleFeatures {
  const user = useAuth();
  const bypass = !!user.bypassesFeatureSwitches;

  const q = useQuery({
    queryKey: ['me', 'visible-features', user.currentTenantId ?? 0],
    queryFn: async () => {
      const keys = await request<unknown>('/me/visible-features');
      if (!Array.isArray(keys)) throw new Error('visible-features: expected an array of keys');
      return new Set(keys as string[]);
    },
    enabled: !bypass,
    staleTime: Infinity,
  });

  if (bypass) return { visibleFeatures: null, status: 'ready' };
  if (q.isError) return { visibleFeatures: null, status: 'error' };
  if (q.isSuccess) return { visibleFeatures: q.data, status: 'ready' };
  return { visibleFeatures: null, status: 'loading' };
}
