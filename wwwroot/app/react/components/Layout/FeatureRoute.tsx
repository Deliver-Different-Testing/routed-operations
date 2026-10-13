import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useVisibleFeatures } from '../../hooks/queries/useVisibleFeatures';

interface Props {
  /** Every Access Control switch on the page's menu chain (group, then page).
   *  ALL must be visible, the same rule the sidebar applies. Empty = ungated. */
  requiredKeys: readonly string[];
  children: ReactNode;
}

/**
 * Route guard for a page behind Access Control switches (Routed Ops switches
 * spec section 3, ported from the configurator's FeatureRoute). The sidebar
 * already hides a switched-off page; this stops the URL opening it anyway, so
 * the user sees "not available" instead of a page that loads and then fails
 * on its first 403 from [RequireFeature].
 *
 * AppLayout mounts it once around the Outlet with the keys from routeGates()
 * over the same nav tree the sidebar renders.
 *
 * Unlike the menu it WAITS while loading rather than rendering optimistically:
 * mounting the page would fire the very requests the server may refuse. A
 * failed fetch fails closed. DF Admin bypasses, as on the server.
 */
export default function FeatureRoute({ requiredKeys, children }: Props) {
  const user = useAuth();
  const { visibleFeatures, status } = useVisibleFeatures();

  if (requiredKeys.length === 0 || user.bypassesFeatureSwitches) {
    return <>{children}</>;
  }

  if (status === 'loading') {
    return <div role="status" aria-label="Loading" className="p-6 text-sm text-text-muted">Loading...</div>;
  }

  if (status === 'ready' && visibleFeatures && requiredKeys.every((k) => visibleFeatures.has(k))) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <h1 className="text-xl font-semibold">This page isn't available</h1>
      <p className="text-sm text-text-muted">
        It's switched off for your organisation in Access Control. Ask your administrator if you need it.
      </p>
    </div>
  );
}
