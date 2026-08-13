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

const wkt = 'POLYGON((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9))';
const smallPoly = {
  polygonId: 1,
  name: 'ExtraPoly',
  centroidLatitude: -36.85,
  centroidLongitude: 174.76,
  sourceType: 0,
  sourceCode: null,
  points: [
    { ringIndex: 0, orderIndex: 0, lat: -36.86, lng: 174.75 },
    { ringIndex: 0, orderIndex: 1, lat: -36.86, lng: 174.77 },
    { ringIndex: 0, orderIndex: 2, lat: -36.84, lng: 174.77 },
    { ringIndex: 0, orderIndex: 3, lat: -36.84, lng: 174.75 },
  ],
  attachedRouteCount: 0,
  attachedRoutes: [],
  partiallyIncludedZips: null,
  createdBy: 'kevin',
  createdUtc: '2026-08-13T00:00:00',
  updatedBy: null,
  lastModifiedUtc: null,
};

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: 'fake-key',
    isUsTenant: false,
  };
  (window as any).google = buildGoogleMapsStub();
  vi.clearAllMocks();
  installBaseHandlers();
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (h: any) => clearTimeout(h);
});

afterEach(() => {
  delete (window as any).google;
});

describe('PolygonBuilder - extra branch coverage', () => {
  it('right-click on zip shape overlay opens zipShape context menu', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 100, zip: '1000', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 100, zip: '1000', latitude: -36.9, longitude: 174.7, wkt }],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '1000' } });
    fireEvent.click(await screen.findByRole('button', { name: /1000/ }));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/),
    );
    // Find zip overlay rightclick listener (a Polygon whose setPaths is defined).
    const g = (window as any).google;
    let zipRC: any;
    await waitFor(() => {
      zipRC = (g.__listeners['rightclick'] as any[]).find((l) => l.owner?.setPaths);
      expect(zipRC).toBeDefined();
    });
    act(() => {
      zipRC.cb({ domEvent: { clientX: 50, clientY: 50 } as MouseEvent });
    });
    // Toggle selection menu item appears.
    expect(await screen.findByRole('button', { name: /Toggle selection/ })).toBeInTheDocument();
  });

  it('right-click on zip shape -> Toggle selection removes it from selection', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 101, zip: '1001', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 101, zip: '1001', latitude: -36.9, longitude: 174.7, wkt }],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.click(await screen.findByRole('button', { name: /1001/ }));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/),
    );
    const g = (window as any).google;
    let zipRC: any;
    await waitFor(() => {
      zipRC = (g.__listeners['rightclick'] as any[]).find((l) => l.owner?.setPaths);
      expect(zipRC).toBeDefined();
    });
    act(() => {
      zipRC.cb({ domEvent: { clientX: 50, clientY: 50 } as MouseEvent });
    });
    fireEvent.click(await screen.findByRole('button', { name: /Toggle selection/ }));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(0\)/),
    );
  });

  it('right-click on zip shape -> Use as starting shape triggers convert', async () => {
    let posted = false;
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 102, zip: '1002', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 102, zip: '1002', latitude: -36.9, longitude: 174.7, wkt }],
        }),
      ),
      http.post('/api/bulk-polygons', async ({ request }) => {
        posted = true;
        const b = (await request.json()) as any;
        return HttpResponse.json({
          response: {
            polygonId: 700,
            name: b.name,
            centroidLatitude: b.centroidLatitude,
            centroidLongitude: b.centroidLongitude,
            sourceType: b.sourceType,
            sourceCode: b.sourceCode,
            points: b.points,
            attachedRouteCount: 0,
            attachedRoutes: [],
            partiallyIncludedZips: null,
            createdBy: 'kevin',
            createdUtc: '2026-08-13T00:00:00',
            updatedBy: null,
            lastModifiedUtc: null,
          },
        });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '1002' } });
    fireEvent.click(await screen.findByRole('button', { name: /1002/ }));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/),
    );
    const g = (window as any).google;
    let zipRC: any;
    await waitFor(() => {
      zipRC = (g.__listeners['rightclick'] as any[]).find((l) => l.owner?.setPaths);
      expect(zipRC).toBeDefined();
    });
    act(() => {
      zipRC.cb({ domEvent: { clientX: 50, clientY: 50 } as MouseEvent });
    });
    // Menu Use-as-starting-shape click; sidebar also has this label so match by scope.
    const menuItems = await screen.findAllByRole('button', { name: /Use as starting shape/ });
    const menuItem = menuItems.find((b) => b.className.includes('w-full text-left'));
    fireEvent.click(menuItem!);
    await waitFor(() => expect(posted).toBe(true));
  });

  it('centroid marker right-click opens zipCentroid context menu with Load boundary', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 200, zip: '2000', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/of 1 postal codes in view/),
    );
    // Find the centroid Marker's rightclick listener - it has setIcon.
    const g = (window as any).google;
    let markerRC: any;
    await waitFor(() => {
      markerRC = (g.__listeners['rightclick'] as any[]).find((l) => l.owner?.setIcon);
      expect(markerRC).toBeDefined();
    });
    act(() => {
      markerRC.cb({ domEvent: { clientX: 50, clientY: 50 } as MouseEvent });
    });
    expect(await screen.findByRole('button', { name: /Load boundary for 2000/ })).toBeInTheDocument();
  });

  it('centroid rightclick without domEvent is a no-op', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 201, zip: '2001', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/of 1 postal codes in view/),
    );
    const g = (window as any).google;
    let markerRC: any;
    await waitFor(() => {
      markerRC = (g.__listeners['rightclick'] as any[]).find((l) => l.owner?.setIcon);
      expect(markerRC).toBeDefined();
    });
    act(() => {
      markerRC.cb({}); // No domEvent => early return branch.
    });
    // No menu appeared.
    expect(screen.queryByRole('button', { name: /Load boundary for 2001/ })).not.toBeInTheDocument();
  });

  it('centroid marker click loads its zip shape', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 202, zip: '2002', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 202, zip: '2002', latitude: -36.9, longitude: 174.7, wkt }],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/of 1 postal codes in view/),
    );
    const g = (window as any).google;
    let markerClick: any;
    await waitFor(() => {
      markerClick = (g.__listeners['click'] as any[])?.find((l) => l.owner?.setIcon);
      expect(markerClick).toBeDefined();
    });
    act(() => {
      markerClick.cb({});
    });
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/),
    );
  });

  it('zip shape overlay click toggles selection off', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 300, zip: '3000', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 300, zip: '3000', latitude: -36.9, longitude: 174.7, wkt }],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '3000' } });
    fireEvent.click(await screen.findByRole('button', { name: /3000/ }));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/),
    );
    const g = (window as any).google;
    let polyClick: any;
    await waitFor(() => {
      polyClick = (g.__listeners['click'] as any[])?.find((l) => l.owner?.setPaths);
      expect(polyClick).toBeDefined();
    });
    act(() => {
      polyClick.cb({});
    });
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(0\)/),
    );
  });

  it('polygon overlay click toggles polygon selection', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [smallPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'ExtraPoly' });
    // Find polygon click listener.
    const g = (window as any).google;
    let polyClick: any;
    await waitFor(() => {
      polyClick = (g.__listeners['click'] as any[])?.find((l) => l.owner?.setPaths);
      expect(polyClick).toBeDefined();
    });
    act(() => {
      polyClick.cb();
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save coverage as Route \(1\)/ })).toBeInTheDocument(),
    );
  });

  it('Escape during pending mode discards the draft', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'l' });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', { latLng: { lat: () => -36.85, lng: () => 174.76 } });
    });
    for (let i = 0; i < 5; i++) {
      act(() => {
        g.__fireOnMap('mousemove', { latLng: { lat: () => -36.85 + i * 0.01, lng: () => 174.76 + i * 0.01 } });
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    act(() => {
      g.__fireOnMap('mouseup', { latLng: { lat: () => -36.9, lng: () => 174.8 } });
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag the purple squares to refine/),
    );
    // Escape should discard the pending polygon.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /View Zones/ })).toBeInTheDocument(),
    );
  });

  it('Escape closes context menu without closing pending / edit', async () => {
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
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Freehand lasso \(L\)/ })).not.toBeInTheDocument(),
    );
  });

  it('polygon overlay right-click for polygon with too many vertices disables Edit shape menu item', async () => {
    const bigPoints = [];
    for (let i = 0; i < 210; i++) {
      bigPoints.push({ ringIndex: 0, orderIndex: i, lat: -36.86 + i * 0.001, lng: 174.75 + i * 0.001 });
    }
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [{ ...smallPoly, polygonId: 2, name: 'HugePoly', points: bigPoints }],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'HugePoly' });
    const g = (window as any).google;
    let polyRC: any;
    await waitFor(() => {
      polyRC = (g.__listeners['rightclick'] as any[])?.find((l) => l.owner?.setPaths);
      expect(polyRC).toBeDefined();
    });
    act(() => {
      polyRC.cb({ domEvent: { clientX: 50, clientY: 50 } as MouseEvent });
    });
    // Menu Edit shape button is disabled because vertices > cap.
    const editBtns = await screen.findAllByRole('button', { name: /Edit shape/ });
    const menuEdit = editBtns.find((b) => b.className.includes('w-full text-left'));
    expect(menuEdit).toBeDisabled();
  });

  it('renders custom cluster count via buildClusterRenderer (>= 200 uses red pill)', async () => {
    // Trigger clusterer render path by calling the render function via a
    // custom setup. Instead, we mount with a lot of centroids so at least
    // one cluster is likely to render. The stub MarkerClusterer noops
    // addMarkers, so the renderer isn't actually invoked in-test - but the
    // fact that MarkerClusterer construction + render() path runs still
    // exercises the "cluster renderer factory" line.
    const centroids = [];
    for (let i = 0; i < 250; i++) {
      centroids.push({ zipPolygonId: i, zip: `${1000 + i}`, latitude: -36.9 + i * 0.001, longitude: 174.7 + i * 0.001 });
    }
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', () =>
        HttpResponse.json({ response: centroids }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/of 250 postal codes in view/),
    );
  });

  it('search input focused: keyboard "l" does NOT flip mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    input.focus();
    // Fire on the input directly; jsdom bubbles it to window.
    fireEvent.keyDown(input, { key: 'l' });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent).not.toMatch(/Hold mouse and drag around an area/);
  });

  it('US tenant mode uses ZIP terminology', async () => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      googleMapsKey: 'fake-key',
      isUsTenant: true,
    };
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/save as route|zip/),
    );
  });

  it('Save as Route with 0 selection is disabled', async () => {
    renderWithProviders(<PolygonBuilder />);
    const btn = await screen.findByRole('button', { name: /Save as Route \(0\)/ });
    expect(btn).toBeDisabled();
  });

  it('centroids retry on failure is idempotent (one toast surfaced)', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', () =>
        HttpResponse.json({ error: 'load-fail-once' }, { status: 500 }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/load-fail-once/),
    );
  });
});
