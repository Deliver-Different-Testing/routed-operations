import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { GlobalSearchProvider } from './context/GlobalSearchContext';

// Mock the layout to a passthrough that renders <Outlet /> so we can
// verify page-level routing without pulling in Sidebar / Header (both
// fetch tenant metadata and would break the isolation of this test).
vi.mock('./components/Layout/AppLayout', async () => {
  const rr = await import('react-router-dom');
  return {
    AppLayout: () => (
      <div data-testid="app-layout">
        <rr.Outlet />
      </div>
    ),
  };
});

// Stub every page so the router-wiring test does not depend on any
// downstream fetches, useAuth branches, or heavy widgets.
vi.mock('./pages/Dashboard', () => ({ default: () => <div>PAGE:Dashboard</div> }));
vi.mock('./pages/RoutesPage', () => ({ default: () => <div>PAGE:Routes</div> }));
vi.mock('./pages/Quoting', () => ({ default: () => <div>PAGE:Quoting</div> }));
vi.mock('./pages/ScheduledRoutes', () => ({ default: () => <div>PAGE:ScheduledRoutes</div> }));
vi.mock('./pages/RecurringRoutes', () => ({ default: () => <div>PAGE:RecurringRoutes</div> }));
vi.mock('./pages/PolygonBuilder', () => ({ default: () => <div>PAGE:PolygonBuilder</div> }));
vi.mock('./pages/AutoAssignLog', () => ({ default: () => <div>PAGE:AutoAssignLog</div> }));
vi.mock('./pages/BulkImport', () => ({ default: () => <div>PAGE:BulkImport</div> }));
vi.mock('./pages/route-viewer/RunViewer', () => ({ default: () => <div>PAGE:RunViewer</div> }));
vi.mock('./pages/route-viewer/ScanManager', () => ({ default: () => <div>PAGE:ScanManager</div> }));
vi.mock('./pages/route-viewer/PrintManager', () => ({ default: () => <div>PAGE:PrintManager</div> }));
vi.mock('./pages/route-viewer/CustomerServices', () => ({ default: () => <div>PAGE:CustomerServices</div> }));
vi.mock('./pages/route-viewer/Linehaul', () => ({ default: () => <div>PAGE:Linehaul</div> }));
vi.mock('./pages/route-viewer/Mobile', () => ({ default: () => <div>PAGE:Mobile</div> }));

import App from './App';

function renderAt(route: string) {
  // Fresh QueryClient per render; AuthProvider now uses useQueryClient()
  // for its tenant-drift guard so must live inside a QueryClientProvider
  // (matches production tree in index.tsx).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              <GlobalSearchProvider>
                <App />
              </GlobalSearchProvider>
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App router wiring', () => {
  it('mounts AppLayout as the root shell', () => {
    renderAt('/dashboard');
    expect(screen.getByTestId('app-layout')).toBeInTheDocument();
  });

  it('redirects / to /dashboard and mounts Dashboard', () => {
    renderAt('/');
    expect(screen.getByText('PAGE:Dashboard')).toBeInTheDocument();
  });

  it('resolves /routes to RoutesPage', () => {
    renderAt('/routes');
    expect(screen.getByText('PAGE:Routes')).toBeInTheDocument();
  });

  it('resolves /bulk-import to BulkImport', () => {
    renderAt('/bulk-import');
    expect(screen.getByText('PAGE:BulkImport')).toBeInTheDocument();
  });

  it('resolves /quoting to Quoting', () => {
    renderAt('/quoting');
    expect(screen.getByText('PAGE:Quoting')).toBeInTheDocument();
  });

  it('resolves /recurring-routes to RecurringRoutes', () => {
    renderAt('/recurring-routes');
    expect(screen.getByText('PAGE:RecurringRoutes')).toBeInTheDocument();
  });

  it('resolves /polygon-builder to PolygonBuilder', () => {
    renderAt('/polygon-builder');
    expect(screen.getByText('PAGE:PolygonBuilder')).toBeInTheDocument();
  });

  it('resolves /auto-assign-log to AutoAssignLog', () => {
    renderAt('/auto-assign-log');
    expect(screen.getByText('PAGE:AutoAssignLog')).toBeInTheDocument();
  });

  it('resolves /route-viewer to RunViewer', () => {
    renderAt('/route-viewer');
    expect(screen.getByText('PAGE:RunViewer')).toBeInTheDocument();
  });

  it('resolves /route-viewer/scans to ScanManager', () => {
    renderAt('/route-viewer/scans');
    expect(screen.getByText('PAGE:ScanManager')).toBeInTheDocument();
  });

  it('resolves /route-viewer/print to PrintManager', () => {
    renderAt('/route-viewer/print');
    expect(screen.getByText('PAGE:PrintManager')).toBeInTheDocument();
  });

  it('resolves /route-viewer/cs to CustomerServices', () => {
    renderAt('/route-viewer/cs');
    expect(screen.getByText('PAGE:CustomerServices')).toBeInTheDocument();
  });

  it('resolves /route-viewer/linehaul to Linehaul', () => {
    renderAt('/route-viewer/linehaul');
    expect(screen.getByText('PAGE:Linehaul')).toBeInTheDocument();
  });

  it('resolves /route-viewer/mobile to Mobile', () => {
    renderAt('/route-viewer/mobile');
    expect(screen.getByText('PAGE:Mobile')).toBeInTheDocument();
  });

  it('unknown routes fall through to the /dashboard catch-all', () => {
    renderAt('/no-such-route');
    expect(screen.getByText('PAGE:Dashboard')).toBeInTheDocument();
  });
});
