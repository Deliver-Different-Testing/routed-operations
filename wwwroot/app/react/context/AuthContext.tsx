import { createContext, useContext, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AppUser } from '../types';
import { request } from '../services/api';

const defaultUser: AppUser = {
  currentTenantId: null,
  fullName: null,
  email: null,
  timeZone: null,
  countryCode: null,
  isUsTenant: false,
  isInternal: false,
  hereMapsApiKey: null,
  googleMapsKey: null,
  // Route Viewer defaults - safe values that behave as "no NP scope, no
  // client scope" so an unauthenticated pre-bootstrap render never
  // surfaces cross-tenant data.
  isNetworkPartner: false,
  npAgentId: null,
  clientTypeId: null,
  contactId: null,
  clientId: null,
  clientCount: null,
  clientString: null,
  despatchWebBaseUrl: null,
};

const AuthContext = createContext<AppUser>(defaultUser);

interface SessionEcho { currentTenantId: number | null; email: string | null; }

/**
 * Purge every `rv-filters:*` localStorage entry that does NOT belong to
 * the tenant we're about to reload into. Keeps the intended tenant's saved
 * filters intact so operators don't lose their per-tenant filter set.
 *
 * We match on the prefix `rv-filters:<tenantId>:` (see RunViewer.tsx
 * filterStorageKey) so any legacy or foreign entry gets swept away.
 */
function purgeOtherTenantFilterKeys(keepTenantId: number | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const keepPrefix = `rv-filters:${keepTenantId ?? 0}:`;
  const toRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    if (key.startsWith('rv-filters:') && !key.startsWith(keepPrefix)) {
      toRemove.push(key);
    }
  }
  toRemove.forEach((k) => window.localStorage.removeItem(k));
}

/**
 * Tenant-drift watcher. The SPA's `window.__APP_USER__` bootstrap is
 * captured once at page load. If a user switches tenants on the hub while
 * this tab is still open, the shared auth cookie updates but the SPA does
 * not - so tenant-scoped surfaces (Overview, Runs) re-fetch against the
 * new tenant while per-tenant caches (React Query lookup responses,
 * localStorage filter selections) keep serving the old tenant's data.
 *
 * This hook echoes the current cookie's tenant id from a lightweight
 * server endpoint on mount + window focus. When it diverges from the
 * bootstrap id, we purge other-tenant filter keys, wipe the React Query
 * cache, and hard-reload the tab so the fresh bootstrap and every
 * downstream surface re-hydrate under the correct tenant.
 */
function useTenantDriftGuard(bootstrapTenantId: number | null): void {
  const queryClient = useQueryClient();
  const reloadingRef = useRef(false);

  useEffect(() => {
    // Skip when there's no bootstrap tenant to compare against (e.g. the
    // pre-auth default provider used in tests). Nothing to guard yet.
    if (bootstrapTenantId == null) return;

    const check = async () => {
      if (reloadingRef.current) return;
      try {
        const echo = await request<SessionEcho>('/session/current');
        const echoed = echo?.currentTenantId ?? null;
        if (echoed != null && echoed !== bootstrapTenantId) {
          reloadingRef.current = true;
          purgeOtherTenantFilterKeys(echoed);
          queryClient.clear();
          window.location.reload();
        }
      } catch {
        // Network / 401 / server error - stay on the current tenant and let
        // the next focus retry. Reloading blindly on any fetch failure would
        // trap the operator in a refresh loop while offline.
      }
    };

    check();
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [bootstrapTenantId, queryClient]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = (typeof window !== 'undefined' && window.__APP_USER__) || defaultUser;
  useTenantDriftGuard(bootstrap.currentTenantId ?? null);
  return <AuthContext.Provider value={bootstrap}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
