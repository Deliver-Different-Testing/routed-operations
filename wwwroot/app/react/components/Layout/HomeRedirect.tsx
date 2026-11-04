import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useVisibleFeatures } from '../../hooks/queries/useVisibleFeatures';
import { firstAllowedPath, makeFeatureAllowed } from '../../lib/accessSwitches';
import { isPartnerDeniedPath } from '../../lib/partnerAccess';
import { navItems } from './navItems';

/**
 * Landing for "/" and any unknown URL (ro-bulk-import-customer-scope M3).
 *
 * Used to be a fixed Navigate to /dashboard, so a caller without the Dashboard
 * switch (a customer who only has Bulk Import) landed on "This page isn't
 * available" with an empty-looking menu. Now it goes to the first page the
 * caller can open, in sidebar order, using the same switch and partner rules
 * as the Sidebar. DF Admin bypasses the switches and keeps /dashboard.
 *
 * Waits while the switches load rather than guessing, and a failed fetch
 * fails closed to the empty state, the same posture as FeatureRoute.
 */
export function HomeRedirect() {
  const auth = useAuth();
  const { visibleFeatures, status } = useVisibleFeatures();

  if (auth.bypassesFeatureSwitches && !auth.isNetworkPartner) {
    return <Navigate to="/dashboard" replace />;
  }
  if (status === 'loading') {
    return <div role="status" aria-label="Loading" className="p-6 text-sm text-text-muted">Loading...</div>;
  }

  const allowed = auth.bypassesFeatureSwitches ? () => true : makeFeatureAllowed(status, visibleFeatures);
  const denied = auth.isNetworkPartner ? isPartnerDeniedPath : undefined;
  const target = status === 'error' && !auth.bypassesFeatureSwitches
    ? null
    : firstAllowedPath(navItems, allowed, denied);

  return target ? <Navigate to={target} replace /> : <NothingSwitchedOn />;
}

/** Shown when the caller can open no Routed Operations page at all. */
export function NothingSwitchedOn() {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <h1 className="text-xl font-semibold">Nothing is switched on for your account yet</h1>
      <p className="text-sm text-text-muted">
        None of the Routed Operations pages are turned on for your organisation. Ask your administrator
        to switch on the pages you need in Access Control.
      </p>
    </div>
  );
}
