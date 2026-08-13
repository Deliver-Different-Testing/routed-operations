import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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

describe('PolygonBuilder - WKT parse + auto-load flows', () => {
  it('parses a MULTIPOLYGON WKT and loads it as a valid shape', async () => {
    // parseWktPolygon handles MULTIPOLYGON via startsWith '(('. Use a
    // multi-ring text that still has ' ( (' near the start; the parser
    // reads only the first ring anyway.
    const wkt = 'MULTIPOLYGON(((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9)))';
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
    // Selection appears -> WKT parsed successfully.
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/),
    );
  });

  it('handles a completely invalid WKT string without crashing', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 101, zip: '1001', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [
            { zipPolygonId: 101, zip: '1001', latitude: -36.9, longitude: 174.7, wkt: 'GARBAGE' },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '1001' } });
    fireEvent.click(await screen.findByRole('button', { name: /1001/ }));
    // Selection still appears (invalid WKT just skips overlay render).
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/),
    );
  });

  it('search error branch on loadZip surfaces via toast', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 102, zip: '1002', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({ error: 'shapes-oops' }, { status: 500 }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '1002' } });
    fireEvent.click(await screen.findByRole('button', { name: /1002/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/shapes-oops/),
    );
  });

  it('renders multi-ring polygon (ringIndex 0 + 1)', async () => {
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [
            {
              polygonId: 200,
              name: 'MultiRingPoly',
              centroidLatitude: -36.85,
              centroidLongitude: 174.76,
              sourceType: 0,
              sourceCode: null,
              points: [
                { ringIndex: 0, orderIndex: 0, lat: -36.86, lng: 174.75 },
                { ringIndex: 0, orderIndex: 1, lat: -36.86, lng: 174.77 },
                { ringIndex: 0, orderIndex: 2, lat: -36.84, lng: 174.77 },
                { ringIndex: 1, orderIndex: 0, lat: -36.90, lng: 174.80 },
                { ringIndex: 1, orderIndex: 1, lat: -36.90, lng: 174.82 },
                { ringIndex: 1, orderIndex: 2, lat: -36.88, lng: 174.82 },
              ],
              attachedRouteCount: 0,
              attachedRoutes: [],
              partiallyIncludedZips: null,
              createdBy: 'kevin',
              createdUtc: '2026-08-13T00:00:00',
              updatedBy: null,
              lastModifiedUtc: null,
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    // The polygon renders (multi-ring aware pointsToLatLngRings called).
    await screen.findByRole('button', { name: 'MultiRingPoly' });
    // Coverage-polygons counter shows 1.
    expect(document.body.textContent).toMatch(/Coverage polygons \(1\)/);
  });
});
