import { describe, expect, it, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { RO_FEATURE_KEYS } from '@/lib/accessSwitches';
import { Sidebar } from './Sidebar';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('Sidebar', () => {
  beforeEach(() => {
    // window persists across tests in a file, so pin the role explicitly or
    // the network-partner cases at the bottom leak into everything after them.
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
      bypassesFeatureSwitches: false,
    };
  });

  it('renders the brand header and every top-level nav item', () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByText('Routed Operations')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Bulk Import')).toBeInTheDocument();
    expect(screen.getByText('Route Builder')).toBeInTheDocument();
    // Route Viewer appears twice (group header + child of same name).
    expect(screen.getAllByText('Route Viewer').length).toBeGreaterThan(0);
    expect(screen.getByText('Quoting')).toBeInTheDocument();
    expect(screen.getByText('Recurring Routes')).toBeInTheDocument();
    expect(screen.getByText('Polygon Builder')).toBeInTheDocument();
    expect(screen.getByText('Auto-Assign Log')).toBeInTheDocument();
  });

  it('renders the stage footer text', () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByText('Stage 1 - Route Builder')).toBeInTheDocument();
  });

  it('auto-expands the Route Viewer group when the current route is under /route-viewer', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/route-viewer/scans' });
    // Child link "Scan Manager" is visible when the group is expanded.
    expect(screen.getByText('Scan Manager')).toBeInTheDocument();
    expect(screen.getByText('Print Manager')).toBeInTheDocument();
  });

  it('toggles the Route Viewer group open when the group header is clicked from an unrelated route', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/dashboard' });
    // On /dashboard the group starts closed; children are in the DOM but the
    // grid template is 0fr, so aria-expanded on the button drives state.
    const groupBtn = screen.getByRole('button', { name: /Route Viewer/i });
    expect(groupBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(groupBtn);
    expect(groupBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('highlights the active top-level route via NavLink', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/dashboard' });
    const dashboard = screen.getByRole('link', { name: 'Dashboard' });
    expect(dashboard.className).toContain('bg-brand-cyan');
  });

  // ── Network partner ──────────────────────────────────────────────
  // Scope is strictly Steve's spec (D15): Route Builder / cockpit and Bulk
  // Import only. The list itself lives in lib/partnerAccess and is covered by
  // partnerAccess.test.ts; these two check the Sidebar actually applies it.

  it('hides every surface a network partner would be refused', () => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__, isNetworkPartner: true,
    };
    renderWithProviders(<Sidebar />);
    for (const label of [
      'Route Builder', 'Bulk Import', 'Recurring Routes', 'Client Overrides',
      'Driver Rostering', 'Polygon Builder',
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // Two entries share the label "Schedules" (legacy + NEW); both go.
    expect(screen.queryAllByText('Schedules')).toHaveLength(0);
  });

  it('hides Quoting and Auto-Assign Log from a partner', () => {
    // Flipped 2026-10-07. These two stayed visible under D1 = B because
    // RouteBuilder.Quote and .Polygon kept no NP check and the pages worked.
    // Steve ruled on 2026-10-06 that a partner is denied both; the policy
    // refuses them now, so the nav must not offer them.
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__, isNetworkPartner: true,
    };
    renderWithProviders(<Sidebar />);
    expect(screen.queryByText('Quoting')).not.toBeInTheDocument();
    expect(screen.queryByText('Auto-Assign Log')).not.toBeInTheDocument();
  });

  it('keeps Dashboard and the Route Viewer group for a network partner', () => {
    // The partner's own lane must survive the hide. Scoping inside Route
    // Viewer is row-level (INpScopeGuard + @NpAgentId), not a nav hide.
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__, isNetworkPartner: true,
    };
    renderWithProviders(<Sidebar />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getAllByText('Route Viewer').length).toBeGreaterThan(0);
  });

  // ── Access Control switches ──────────────────────────────────────
  // Every entry is behind its ro-* switch. The default MSW handler grants
  // all of them; these override it.

  const grant = (keys: readonly string[]) =>
    server.use(http.get('/api/me/visible-features', () => HttpResponse.json([...keys])));

  it('hides an entry whose switch is off', async () => {
    grant(RO_FEATURE_KEYS.filter((k) => k !== 'ro-quoting'));
    renderWithProviders(<Sidebar />);
    await waitFor(() => expect(screen.queryByText('Quoting')).not.toBeInTheDocument());
    expect(screen.getByText('Route Builder')).toBeInTheDocument();
  });

  it('hides the whole Route Viewer group when the group switch is off', async () => {
    grant(RO_FEATURE_KEYS.filter((k) => k !== 'ro-route-viewer'));
    renderWithProviders(<Sidebar />, { initialRoute: '/dashboard' });
    await waitFor(() => expect(screen.queryByText('Scan Manager')).not.toBeInTheDocument());
    expect(screen.queryAllByText('Route Viewer')).toHaveLength(0);
  });

  it('drops a group left with no visible pages', async () => {
    grant(RO_FEATURE_KEYS.filter((k) => !['ro-route-viewer-runs', 'ro-linehaul', 'ro-scan-manager',
      'ro-print-manager', 'ro-customer-services'].includes(k)));
    renderWithProviders(<Sidebar />);
    await waitFor(() => expect(screen.queryAllByText('Route Viewer')).toHaveLength(0));
  });

  it('fails closed when the switches cannot be loaded', async () => {
    server.use(http.get('/api/me/visible-features', () => new HttpResponse(null, { status: 500 })));
    renderWithProviders(<Sidebar />);
    await waitFor(() => expect(screen.queryByText('Dashboard')).not.toBeInTheDocument());
    expect(screen.queryByText('Route Builder')).not.toBeInTheDocument();
  });

  it('shows everything to a caller who bypasses the switches, without asking', () => {
    // DF Admin. No handler call is needed: an unhandled request would fail the test.
    server.use(http.get('/api/me/visible-features', () => { throw new Error('should not be fetched'); }));
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, bypassesFeatureSwitches: true };
    renderWithProviders(<Sidebar />);
    expect(screen.getByText('Historic Archive Upload')).toBeInTheDocument();
    expect(screen.getByText('Quoting')).toBeInTheDocument();
  });

  it('never renders Mobile, which has a switch but no menu entry', () => {
    renderWithProviders(<Sidebar />, { initialRoute: '/route-viewer' });
    expect(screen.queryByText('Mobile')).not.toBeInTheDocument();
  });
});
