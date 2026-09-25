import { describe, expect, it } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('Sidebar', () => {
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
});
