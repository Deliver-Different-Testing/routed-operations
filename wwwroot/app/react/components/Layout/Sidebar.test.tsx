import { describe, expect, it, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('Sidebar', () => {
  beforeEach(() => {
    // window persists across tests in a file, so pin the role explicitly or
    // the network-partner cases at the bottom leak into everything after them.
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
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

  it('keeps Quoting and Auto-Assign Log, which still work for a partner', () => {
    // RouteBuilder.Quote and .Polygon kept no NP check under D1 = B.
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__, isNetworkPartner: true,
    };
    renderWithProviders(<Sidebar />);
    expect(screen.getByText('Quoting')).toBeInTheDocument();
    expect(screen.getByText('Auto-Assign Log')).toBeInTheDocument();
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
});
