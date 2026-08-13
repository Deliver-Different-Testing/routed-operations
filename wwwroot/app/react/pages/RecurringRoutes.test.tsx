import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

// Delegated tab bodies are covered by their own tests; stub them here so
// this shell-level test focuses on tab switching + shared state boot.
vi.mock('./ScheduledRoutes', () => ({
  default: () => <div data-testid="tab-routes">routes-tab</div>,
}));
vi.mock('./recurring-routes/LinehaulTab', () => ({
  LinehaulTab: () => <div data-testid="tab-linehaul">linehaul-tab</div>,
}));
vi.mock('./recurring-routes/RouteRosterTab', () => ({
  RouteRosterTab: () => <div data-testid="tab-roster">roster-tab</div>,
}));
vi.mock('./recurring-routes/LinehaulRosterTab', () => ({
  LinehaulRosterTab: () => <div data-testid="tab-linehaul-roster">linehaul-roster-tab</div>,
}));

import RecurringRoutes from './RecurringRoutes';

const stubTargets = () =>
  http.get('/api/recurring-routes/assignable-targets', () =>
    HttpResponse.json({ response: { couriers: [], agents: [], nps: [] } }));

describe('RecurringRoutes shell', () => {
  it('renders the page title + subtitle + all four tab buttons', () => {
    server.use(stubTargets());
    renderWithProviders(<RecurringRoutes />);
    expect(screen.getByRole('heading', { name: 'Recurring Routes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Routes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Linehaul' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Route Roster' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Linehaul Roster' })).toBeInTheDocument();
  });

  it('defaults to the Routes tab mounted and hides other tabs from mounting', () => {
    server.use(stubTargets());
    renderWithProviders(<RecurringRoutes />);
    expect(screen.getByTestId('tab-routes')).toBeInTheDocument();
    // Other tabs not mounted on initial render
    expect(screen.queryByTestId('tab-linehaul')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-roster')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tab-linehaul-roster')).not.toBeInTheDocument();
  });

  it('visited tabs stay mounted after switching back', async () => {
    server.use(stubTargets());
    renderWithProviders(<RecurringRoutes />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Linehaul' }));
    // Both Routes + Linehaul mounted; Linehaul active, Routes hidden.
    expect(screen.getByTestId('tab-routes')).toBeInTheDocument();
    expect(screen.getByTestId('tab-linehaul')).toBeInTheDocument();
    // Wrapper class 'hidden' on the inactive tab
    expect(screen.getByTestId('tab-routes').parentElement).toHaveClass('hidden');
    expect(screen.getByTestId('tab-linehaul').parentElement).not.toHaveClass('hidden');
    // Switch to Route Roster
    await user.click(screen.getByRole('button', { name: 'Route Roster' }));
    expect(screen.getByTestId('tab-roster')).toBeInTheDocument();
    // All three visited tabs remain in the DOM
    expect(screen.getByTestId('tab-routes')).toBeInTheDocument();
    expect(screen.getByTestId('tab-linehaul')).toBeInTheDocument();
  });

  it('mounts Linehaul Roster on click', async () => {
    server.use(stubTargets());
    renderWithProviders(<RecurringRoutes />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Linehaul Roster' }));
    expect(screen.getByTestId('tab-linehaul-roster')).toBeInTheDocument();
  });

  it('shows the Recurring Jobs link when despatchWebBaseUrl is set', () => {
    const original = (window as any).__APP_USER__;
    (window as any).__APP_USER__ = {
      ...original,
      despatchWebBaseUrl: 'https://despatch.example.com',
    };
    try {
      server.use(stubTargets());
      renderWithProviders(<RecurringRoutes />);
      const link = screen.getByRole('button', { name: /Recurring Jobs/ });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('title',
        'Opens the Recurring Jobs view in DespatchWeb (new tab)');
    } finally {
      (window as any).__APP_USER__ = original;
    }
  });

  it('hides the Recurring Jobs link when despatchWebBaseUrl is null', () => {
    server.use(stubTargets());
    renderWithProviders(<RecurringRoutes />);
    expect(screen.queryByRole('button', { name: /Recurring Jobs/ })).not.toBeInTheDocument();
  });

  it('opens the Recurring Jobs link in a new tab', async () => {
    const original = (window as any).__APP_USER__;
    (window as any).__APP_USER__ = {
      ...original,
      despatchWebBaseUrl: 'https://despatch.example.com',
    };
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      server.use(stubTargets());
      renderWithProviders(<RecurringRoutes />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Recurring Jobs/ }));
      expect(openSpy).toHaveBeenCalledWith(
        'https://despatch.example.com/#!/recurringJobs',
        '_blank',
        'noopener,noreferrer',
      );
    } finally {
      (window as any).__APP_USER__ = original;
      openSpy.mockRestore();
    }
  });

  it('applies the active-tab styling class only to the selected tab', async () => {
    server.use(stubTargets());
    renderWithProviders(<RecurringRoutes />);
    const routesBtn = screen.getByRole('button', { name: 'Routes' });
    const linehaulBtn = screen.getByRole('button', { name: 'Linehaul' });
    expect(routesBtn.className).toContain('bg-[#0d0c2c]');
    expect(linehaulBtn.className).not.toContain('bg-[#0d0c2c]');
    const user = userEvent.setup();
    await user.click(linehaulBtn);
    await waitFor(() => expect(linehaulBtn.className).toContain('bg-[#0d0c2c]'));
    expect(routesBtn.className).not.toContain('bg-[#0d0c2c]');
  });
});
