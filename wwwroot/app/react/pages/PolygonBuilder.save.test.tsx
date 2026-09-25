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
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (h: any) => clearTimeout(h);
});

afterEach(() => {
  delete (window as any).google;
});

function makeLatLngEvent(lat: number, lng: number) {
  return { latLng: { lat: () => lat, lng: () => lng } };
}

describe('PolygonBuilder - save polygon to backend', () => {
  it('Save as Route modal opens with a selected zip, cancel closes it', async () => {
    const wkt = 'POLYGON((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9))';
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
    fireEvent.click(await screen.findByRole('button', { name: /Save as Route \(1\)/ }));
    // Modal appears with route name field.
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Save zip selection as recurring route/);
    });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await waitFor(() =>
      expect(document.body.textContent).not.toMatch(/Save zip selection as recurring route/),
    );
  });

  it('Save as Route validation blocks empty name', async () => {
    const wkt = 'POLYGON((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9))';
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 301, zip: '3001', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 301, zip: '3001', latitude: -36.9, longitude: 174.7, wkt }],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '3001' } });
    fireEvent.click(await screen.findByRole('button', { name: /3001/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Save as Route \(1\)/ }));
    // Empty name -> Create button should be disabled.
    const createBtn = await screen.findByRole('button', { name: /Create with 1 postcode/ });
    expect(createBtn).toBeDisabled();
  });

  it('Save as Route with valid name POSTs to /api/recurring-routes', async () => {
    const wkt = 'POLYGON((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9))';
    let posted: any = null;
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 302, zip: '3002', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 302, zip: '3002', latitude: -36.9, longitude: 174.7, wkt }],
        }),
      ),
      http.post('/api/recurring-routes', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({
          response: {
            routeId: 55,
            name: (posted as any).name,
            area: (posted as any).area,
            defaultTargetType: null,
            defaultTargetId: null,
            defaultTargetName: '',
            scheduleId: null,
            scheduleName: '',
            scheduleWindow: '',
            schedules: [],
            active: true,
            zipcodes: [],
            bulkPolygons: [],
            rosterEntryCount: 0,
            bookingCount: 0,
            mappedStopsCount: 0,
            createdAt: '2026-08-13T00:00:00',
            updatedAt: null,
          },
        });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '3002' } });
    fireEvent.click(await screen.findByRole('button', { name: /3002/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Save as Route \(1\)/ }));
    // Fill name.
    const nameInput = await screen.findByPlaceholderText(/Central Valley Pick up Route/);
    fireEvent.change(nameInput, { target: { value: 'Test Route' } });
    // Fire create.
    fireEvent.click(screen.getByRole('button', { name: /Create with 1 postcode/ }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect((posted as any).name).toBe('Test Route');
    expect((posted as any).zipPolygonIds).toContain(302);
    // Toast confirms.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Route saved/),
    );
  });

  it('Pending polygon save flow (lasso + Finish drawing + name + save)', async () => {
    let posted: any = null;
    server.use(
      http.post('/api/bulk-polygons', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({
          response: {
            polygonId: 900,
            name: (posted as any).name,
            centroidLatitude: (posted as any).centroidLatitude,
            centroidLongitude: (posted as any).centroidLongitude,
            sourceType: 0,
            sourceCode: null,
            points: (posted as any).points,
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
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'l' });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
    });
    for (let i = 0; i < 5; i++) {
      act(() => {
        g.__fireOnMap('mousemove', makeLatLngEvent(-36.85 + i * 0.01, 174.76 + i * 0.01));
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    act(() => {
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.90, 174.80));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag the purple squares to refine/),
    );
    // Click Finish drawing -> save modal opens.
    fireEvent.click(screen.getByRole('button', { name: /Finish drawing/ }));
    const nameInput = await screen.findByPlaceholderText(/Zimmer AM Med Auckland/);
    fireEvent.change(nameInput, { target: { value: 'FreshPolygon' } });
    // Save button (variant secondary, data-primary=true).
    const saveBtn = screen.getByRole('button', { name: /Save \(\d+ vertices\)/ });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(posted).not.toBeNull());
    expect((posted as any).name).toBe('FreshPolygon');
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Coverage polygon "FreshPolygon" saved/),
    );
  });

  it('SaveNewPolygonModal empty-name blocks save button (disabled)', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'l' });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
    });
    for (let i = 0; i < 5; i++) {
      act(() => {
        g.__fireOnMap('mousemove', makeLatLngEvent(-36.85 + i * 0.01, 174.76 + i * 0.01));
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    act(() => {
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.90, 174.80));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag the purple squares to refine/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Finish drawing/ }));
    // Save button starts disabled with empty name.
    const saveBtn = await screen.findByRole('button', { name: /Save \(\d+ vertices\)/ });
    expect(saveBtn).toBeDisabled();
  });

  it('SaveNewPolygon server failure surfaces via toast', async () => {
    server.use(
      http.post('/api/bulk-polygons', () =>
        HttpResponse.json({ error: 'save-blew-up' }, { status: 500 }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'l' });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
    });
    for (let i = 0; i < 5; i++) {
      act(() => {
        g.__fireOnMap('mousemove', makeLatLngEvent(-36.85 + i * 0.01, 174.76 + i * 0.01));
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    act(() => {
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.90, 174.80));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag the purple squares to refine/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Finish drawing/ }));
    const nameInput = await screen.findByPlaceholderText(/Zimmer AM Med Auckland/);
    fireEvent.change(nameInput, { target: { value: 'WillFail' } });
    fireEvent.click(screen.getByRole('button', { name: /Save \(\d+ vertices\)/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/save-blew-up/),
    );
  });

  it('Save Coverage as Route (0) is disabled with no polygon selection', async () => {
    renderWithProviders(<PolygonBuilder />);
    const btn = await screen.findByRole('button', { name: /Save coverage as Route \(0\)/ });
    expect(btn).toBeDisabled();
  });

  it('Combine 2 selected zips triggers combine flow', async () => {
    const wkt1 = 'POLYGON((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9))';
    const wkt2 = 'POLYGON((174.72 -36.9, 174.73 -36.9, 174.73 -36.91, 174.72 -36.9))';
    let posted: any = null;
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? '';
        if (q === '400') {
          return HttpResponse.json({
            response: [
              { zipPolygonId: 400, zip: '4000', latitude: -36.9, longitude: 174.7 },
              { zipPolygonId: 401, zip: '4001', latitude: -36.9, longitude: 174.72 },
            ],
          });
        }
        return HttpResponse.json({ response: [] });
      }),
      http.post('/api/recurring-routes/zipcodes/shapes', async ({ request }) => {
        const ids = (await request.json()) as number[];
        const all = [
          { zipPolygonId: 400, zip: '4000', latitude: -36.9, longitude: 174.7, wkt: wkt1 },
          { zipPolygonId: 401, zip: '4001', latitude: -36.9, longitude: 174.72, wkt: wkt2 },
        ];
        return HttpResponse.json({ response: all.filter((s) => ids.includes(s.zipPolygonId)) });
      }),
      http.post('/api/bulk-polygons', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({
          response: {
            polygonId: 999,
            name: (posted as any).name,
            centroidLatitude: (posted as any).centroidLatitude,
            centroidLongitude: (posted as any).centroidLongitude,
            sourceType: 0,
            sourceCode: null,
            points: (posted as any).points,
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
    fireEvent.change(input, { target: { value: '400' } });
    // Load both zips.
    fireEvent.click(await screen.findByRole('button', { name: /4000/ }));
    // Type again and load 4001.
    fireEvent.change(input, { target: { value: '400' } });
    fireEvent.click(await screen.findByRole('button', { name: /4001/ }));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(2\)/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Combine 2 as shape/ }));
    // Wait for the create call to fire.
    await waitFor(() => expect(posted).not.toBeNull());
  });
});
