import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { Header } from './Header';
import { renderWithProviders } from '@/test/renderWithProviders';

describe('Header', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      currentTenantId: 42,
      fullName: 'Kevin Tester',
      email: 'kevin@example.com',
      timeZone: 'Pacific/Auckland',
      countryCode: 'NZ',
      isUsTenant: false,
      isInternal: false,
      hereMapsApiKey: null,
      googleMapsKey: null,
      isNetworkPartner: false,
      npAgentId: null,
      clientTypeId: null,
      contactId: null,
      clientId: null,
      clientCount: null,
      clientString: null,
      despatchWebBaseUrl: null,
    };
  });

  it('renders the resolved page name for the current path', () => {
    renderWithProviders(<Header />, { initialRoute: '/dashboard' });
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders the tenant + user identity strip', () => {
    renderWithProviders(<Header />, { initialRoute: '/dashboard' });
    expect(screen.getByText(/Tenant 42/)).toBeInTheDocument();
    expect(screen.getByText('Kevin Tester')).toBeInTheDocument();
  });

  it('does NOT render the search box on non-cockpit routes', () => {
    renderWithProviders(<Header />, { initialRoute: '/dashboard' });
    expect(screen.queryByPlaceholderText(/Search jobs/i)).not.toBeInTheDocument();
  });

  it('renders the Route Builder search placeholder on /routes', () => {
    renderWithProviders(<Header />, { initialRoute: '/routes' });
    expect(screen.getByPlaceholderText(/Search jobs \(job #, ref, client, suburb, run name\)/)).toBeInTheDocument();
  });

  it('renders the Route Viewer search placeholder on /route-viewer', () => {
    renderWithProviders(<Header />, { initialRoute: '/route-viewer' });
    expect(screen.getByPlaceholderText('Search jobs (job #)...')).toBeInTheDocument();
  });

  it('resolves the deep child page name for /route-viewer/scans', () => {
    renderWithProviders(<Header />, { initialRoute: '/route-viewer/scans' });
    expect(screen.getByText('Scan Manager')).toBeInTheDocument();
  });

  it('shows an X clear button once the RV search box has text', async () => {
    renderWithProviders(<Header />, { initialRoute: '/route-viewer' });
    const input = screen.getByPlaceholderText('Search jobs (job #)...');
    fireEvent.change(input, { target: { value: 'ABC' } });
    expect(await screen.findByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });

  it('triggers the routeViewerService searchByJobNumber on typed input (debounced)', async () => {
    let called = false;
    server.use(
      http.get('/api/runviewer/jobs/search', () => {
        called = true;
        return HttpResponse.json({ data: [] });
      }),
    );
    renderWithProviders(<Header />, { initialRoute: '/route-viewer' });
    const input = screen.getByPlaceholderText('Search jobs (job #)...');
    fireEvent.change(input, { target: { value: 'JOB123' } });
    fireEvent.focus(input);
    await waitFor(() => expect(called).toBe(true), { timeout: 2000 });
  });

  it('falls back to "Not signed in" when currentTenantId is null', () => {
    (window as any).__APP_USER__ = {
      currentTenantId: null,
      fullName: null,
      email: null,
      timeZone: null,
      countryCode: null,
      isUsTenant: false,
      isInternal: false,
      hereMapsApiKey: null,
      googleMapsKey: null,
      isNetworkPartner: false,
      npAgentId: null,
      clientTypeId: null,
      contactId: null,
      clientId: null,
      clientCount: null,
      clientString: null,
      despatchWebBaseUrl: null,
    };
    renderWithProviders(<Header />, { initialRoute: '/dashboard' });
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
  });
});
