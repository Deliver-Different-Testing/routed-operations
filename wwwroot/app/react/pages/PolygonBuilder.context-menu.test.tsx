import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { buildGoogleMapsStub, installBaseHandlers } from './PolygonBuilder.testHelpers';

vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: class {
    constructor(_: any) {}
    setMap() {}
    clearMarkers() {}
    addMarker() {}
    addMarkers() {}
    removeMarker() {}
    removeMarkers() {}
    render() {}
    onAdd() {}
    onRemove() {}
    draw() {}
  },
  SuperClusterAlgorithm: class {
    constructor(_: any) {}
  },
}));

import PolygonBuilder from './PolygonBuilder';

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: 'fake-key',
    isUsTenant: false,
  };
  (window as any).google = buildGoogleMapsStub();
  vi.clearAllMocks();
  installBaseHandlers();
});

afterEach(() => {
  delete (window as any).google;
});

const smallPoly = {
  polygonId: 1,
  name: 'CtxPoly',
  centroidLatitude: -36.85,
  centroidLongitude: 174.76,
  sourceType: 0,
  sourceCode: null,
  points: [
    { ringIndex: 0, orderIndex: 0, lat: -36.86, lng: 174.75 },
    { ringIndex: 0, orderIndex: 1, lat: -36.86, lng: 174.77 },
    { ringIndex: 0, orderIndex: 2, lat: -36.84, lng: 174.77 },
  ],
  attachedRouteCount: 0,
  attachedRoutes: [],
  partiallyIncludedZips: null,
  createdBy: 'kevin',
  createdUtc: '2026-08-13T00:00:00',
  updatedBy: null,
  lastModifiedUtc: null,
};

describe('PolygonBuilder - context menu', () => {
  it('right-click on polygon overlay opens polygon menu with Edit + Remove', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [smallPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'CtxPoly' });
    // Find the polygon-overlay listener registered via addListener.
    // Iterate through captured listeners to find the one attached to a Polygon.
    const g = (window as any).google;
    // Wait for the polygon overlay to have registered its rightclick listener.
    let polygonRC: any;
    await waitFor(() => {
      const rcListeners = g.__listeners['rightclick'] as any[];
      polygonRC = rcListeners.find((l) => l.owner?.setPaths);
      expect(polygonRC).toBeDefined();
    });
    act(() => {
      polygonRC.cb({ domEvent: { clientX: 50, clientY: 50 } as MouseEvent });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Zoom to fit' })).toBeInTheDocument();
    });
    // Two "Edit shape" buttons exist (sidebar + context menu); at least one is the menu.
    expect(screen.getAllByRole('button', { name: 'Edit shape' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBeGreaterThanOrEqual(1);
  });

  it('polygon context menu -> Zoom to fit dismisses menu', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [smallPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'CtxPoly' });
    const g = (window as any).google;
    const rcListeners = g.__listeners['rightclick'] as any[];
    const polygonRC = rcListeners.find((l) => l.owner?.setPaths);
    act(() => {
      polygonRC.cb({ domEvent: { clientX: 50, clientY: 50 } as MouseEvent });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Zoom to fit' }));
    // 3s timeout - the default 1s waitFor is too tight on the CI runner
    // after the Phase-8 binding chips added per-polygon render weight to
    // the sidebar. Local runs settle in <100ms; shared-runner CI can
    // take 2-3s to flush the state update that removes the menu.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Zoom to fit' })).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('context menu closes on outside click', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [] })),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('rightclick', { domEvent: { clientX: 50, clientY: 50 } as MouseEvent });
    });
    await screen.findByRole('button', { name: /Freehand lasso \(L\)/ });
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    // 3s timeout - same reason as the Zoom to fit test above. Flaky on
    // slow shared CI runner after the Phase-8 chip additions increased
    // sidebar re-render cost.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Freehand lasso \(L\)/ })).not.toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('polygon context menu -> Remove triggers confirm dialog + accept removes', async () => {
    let deleted = false;
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [smallPoly] })),
      http.delete('/api/bulk-polygons/:id', () => {
        deleted = true;
        return HttpResponse.json({ response: 'deleted' });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'CtxPoly' });
    const g = (window as any).google;
    const rcListeners = g.__listeners['rightclick'] as any[];
    const polygonRC = rcListeners.find((l) => l.owner?.setPaths);
    act(() => {
      polygonRC.cb({ domEvent: { clientX: 50, clientY: 50 } as MouseEvent });
    });
    // Click the context-menu Remove (has class w-full text-left ...).
    const removes = await screen.findAllByRole('button', { name: 'Remove' });
    const menuRemove = removes.find((b) => b.className.includes('w-full text-left'));
    fireEvent.click(menuRemove!);
    // Confirm dialog appears - find the modal's Remove (data-primary="true").
    await waitFor(() =>
      expect(screen.getByText(/Remove coverage polygon/)).toBeInTheDocument(),
    );
    const modalRemove = screen.getAllByRole('button', { name: 'Remove' })
      .find((b) => b.hasAttribute('data-primary'));
    fireEvent.click(modalRemove!);
    await waitFor(() => expect(deleted).toBe(true));
    // Polygon removed from sidebar.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'CtxPoly' })).not.toBeInTheDocument(),
    );
  });

  it('Remove polygon via sidebar action + confirm', async () => {
    let deleted = false;
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [smallPoly] })),
      http.delete('/api/bulk-polygons/:id', () => {
        deleted = true;
        return HttpResponse.json({ response: 'deleted' });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'CtxPoly' });
    // Sidebar Remove button - only one on screen.
    const sidebarRemove = screen.getAllByRole('button', { name: 'Remove' })
      .find((b) => b.className.includes('text-[10px]'));
    fireEvent.click(sidebarRemove!);
    // Confirm modal appears.
    await waitFor(() =>
      expect(screen.getByText(/Remove coverage polygon/)).toBeInTheDocument(),
    );
    const modalRemove = screen.getAllByRole('button', { name: 'Remove' })
      .find((b) => b.hasAttribute('data-primary'));
    fireEvent.click(modalRemove!);
    await waitFor(() => expect(deleted).toBe(true));
  });

  it('Remove polygon via sidebar + cancel confirm keeps polygon', async () => {
    let deleted = false;
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [smallPoly] })),
      http.delete('/api/bulk-polygons/:id', () => {
        deleted = true;
        return HttpResponse.json({ response: 'deleted' });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'CtxPoly' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    // Cancel.
    const cancelBtn = await screen.findByRole('button', { name: /Cancel/ });
    fireEvent.click(cancelBtn);
    await new Promise((r) => setTimeout(r, 50));
    expect(deleted).toBe(false);
    expect(screen.getByRole('button', { name: 'CtxPoly' })).toBeInTheDocument();
  });

  it('remove server failure surfaces via toast', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [smallPoly] })),
      http.delete('/api/bulk-polygons/:id', () =>
        HttpResponse.json({ error: 'remove-blew-up' }, { status: 500 }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'CtxPoly' });
    const sidebarRemove = screen.getAllByRole('button', { name: 'Remove' })
      .find((b) => b.className.includes('text-[10px]'));
    fireEvent.click(sidebarRemove!);
    await waitFor(() =>
      expect(screen.getByText(/Remove coverage polygon/)).toBeInTheDocument(),
    );
    const modalRemove = screen.getAllByRole('button', { name: 'Remove' })
      .find((b) => b.hasAttribute('data-primary'));
    fireEvent.click(modalRemove!);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/remove-blew-up/),
    );
  });

  it('confirm dialog for polygon with attached routes includes the warning', async () => {
    const attachedPoly = { ...smallPoly, attachedRouteCount: 2, attachedRoutes: [] };
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [attachedPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'CtxPoly' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/attached to 2 active route/),
    );
  });
});
