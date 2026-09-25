import { describe, expect, it, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RouteViewerPlaceholder } from './RouteViewerPlaceholder';

const baseProps = {
  title: 'Scan Manager',
  buildPhase: 'P3',
  summary: 'Scan grid + bulk actions land here.',
  endpointsReady: ['GET /api/runviewer/scans', 'POST /api/runviewer/scans'],
};

describe('RouteViewerPlaceholder', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      currentTenantId: 42,
      countryCode: 'NZ',
      contactId: 99,
      clientId: 5,
      clientTypeId: 'client-type-1',
      isNetworkPartner: false,
      npAgentId: null,
    };
  });

  it('renders the "coming soon" phase line with the buildPhase', () => {
    renderWithProviders(<RouteViewerPlaceholder {...baseProps} />);
    expect(
      screen.getByText(/frontend build pending \(P3\)/),
    ).toBeInTheDocument();
  });

  it('renders the summary text passed via props', () => {
    renderWithProviders(<RouteViewerPlaceholder {...baseProps} />);
    expect(
      screen.getByText(/Scan grid \+ bulk actions land here\./),
    ).toBeInTheDocument();
  });

  it('renders one list item per endpoint in the endpointsReady array', () => {
    renderWithProviders(<RouteViewerPlaceholder {...baseProps} />);
    expect(screen.getByText('GET /api/runviewer/scans')).toBeInTheDocument();
    expect(screen.getByText('POST /api/runviewer/scans')).toBeInTheDocument();
  });

  it('renders the endpoints-live section with its caption', () => {
    renderWithProviders(<RouteViewerPlaceholder {...baseProps} />);
    expect(
      screen.getByText('Backend endpoints already live'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Hit any of these authenticated/),
    ).toBeInTheDocument();
  });

  it('shows admin NP-scope line when user is not a network partner', () => {
    renderWithProviders(<RouteViewerPlaceholder {...baseProps} />);
    expect(screen.getByText(/admin \(tenant staff\)/)).toBeInTheDocument();
  });

  it('shows agent NP-scope line with agent id when user is NP', () => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: true,
      npAgentId: 17,
    };
    renderWithProviders(<RouteViewerPlaceholder {...baseProps} />);
    expect(screen.getByText(/agent 17/)).toBeInTheDocument();
  });

  it('falls back to "unresolved" agent id when NP but npAgentId is null', () => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: true,
      npAgentId: null,
    };
    renderWithProviders(<RouteViewerPlaceholder {...baseProps} />);
    expect(screen.getByText(/agent unresolved/)).toBeInTheDocument();
  });

  it('renders session-context values from AuthContext', () => {
    renderWithProviders(<RouteViewerPlaceholder {...baseProps} />);
    expect(screen.getByText(/Tenant: 42 \(NZ\)/)).toBeInTheDocument();
    expect(screen.getByText(/Contact: 99/)).toBeInTheDocument();
    expect(screen.getByText(/Client: 5/)).toBeInTheDocument();
    expect(screen.getByText(/Client type: client-type-1/)).toBeInTheDocument();
  });

  it('shows "Unknown" tenant and "?" country when session fields missing', () => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      currentTenantId: null,
      countryCode: null,
      contactId: null,
      clientId: null,
      clientTypeId: null,
    };
    renderWithProviders(<RouteViewerPlaceholder {...baseProps} />);
    expect(screen.getByText(/Tenant: Unknown \(\?\)/)).toBeInTheDocument();
    expect(screen.getByText(/Contact: null/)).toBeInTheDocument();
    expect(screen.getByText(/Client: null/)).toBeInTheDocument();
    expect(screen.getByText(/Client type: null/)).toBeInTheDocument();
  });

  it('renders no endpoint list items when endpointsReady is empty', () => {
    renderWithProviders(
      <RouteViewerPlaceholder {...baseProps} endpointsReady={[]} />,
    );
    // Section header still present; ensure no list items rendered.
    expect(
      screen.getByText('Backend endpoints already live'),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('ul li').length).toBe(0);
  });
});
