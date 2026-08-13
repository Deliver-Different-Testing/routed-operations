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

const wkt = 'POLYGON((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9))';

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

describe('PolygonBuilder - coverage polygons + viewport', () => {
  it('shows attached-routes chip with link when polygon is attached', async () => {
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [
            {
              polygonId: 1,
              name: 'North Shore',
              centroidLatitude: -36.85,
              centroidLongitude: 174.76,
              sourceType: 0,
              sourceCode: null,
              points: [
                { ringIndex: 0, orderIndex: 0, lat: -36.86, lng: 174.75 },
                { ringIndex: 0, orderIndex: 1, lat: -36.86, lng: 174.77 },
                { ringIndex: 0, orderIndex: 2, lat: -36.84, lng: 174.77 },
              ],
              attachedRouteCount: 1,
              attachedRoutes: [{ routeId: 42, routeName: 'Northern Route' }],
              partiallyIncludedZips: ',1010,1011,1012,',
              createdBy: 'kevin',
              createdUtc: '2026-08-13T00:00:00',
              updatedBy: 'kevin',
              lastModifiedUtc: '2026-08-13T01:00:00',
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'North Shore' });
    // Attached-route link renders.
    expect(screen.getByRole('link', { name: /Northern Route/ })).toBeInTheDocument();
    // The "Covers N postcodes" trailer renders + Show on map button appears.
    expect(document.body.textContent).toMatch(/Covers 3 postcodes/);
    expect(screen.getByRole('button', { name: /Show on map/ })).toBeInTheDocument();
  });

  it('renders fallback attached-count chip for pre-2026-08-06 payloads', async () => {
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [
            {
              polygonId: 5,
              name: 'Legacy Poly',
              centroidLatitude: -36.85,
              centroidLongitude: 174.76,
              sourceType: 0,
              sourceCode: null,
              points: [
                { ringIndex: 0, orderIndex: 0, lat: -36.86, lng: 174.75 },
                { ringIndex: 0, orderIndex: 1, lat: -36.86, lng: 174.77 },
                { ringIndex: 0, orderIndex: 2, lat: -36.84, lng: 174.77 },
              ],
              attachedRouteCount: 3,
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
    await screen.findByRole('button', { name: 'Legacy Poly' });
    expect(document.body.textContent).toMatch(/attached to 3 route\(s\)/);
  });

  it('renders "from ZIP" badge when polygon was seeded from a zip', async () => {
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [
            {
              polygonId: 10,
              name: 'Zip 1010 copy',
              centroidLatitude: -36.85,
              centroidLongitude: 174.76,
              sourceType: 1,
              sourceCode: '1010',
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
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'Zip 1010 copy' });
    expect(document.body.textContent).toMatch(/from ZIP 1010/);
  });

  it('renders warn line + disables Edit shape when polygon has too many vertices', async () => {
    const bigPoints = [];
    for (let i = 0; i < 210; i++) {
      bigPoints.push({ ringIndex: 0, orderIndex: i, lat: -36.86 + i * 0.001, lng: 174.75 + i * 0.001 });
    }
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [
            {
              polygonId: 55,
              name: 'Huge Poly',
              centroidLatitude: -36.85,
              centroidLongitude: 174.76,
              sourceType: 0,
              sourceCode: null,
              points: bigPoints,
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
    await screen.findByRole('button', { name: 'Huge Poly' });
    expect(document.body.textContent).toMatch(/210 vertices - too many/);
    const editBtn = screen.getByRole('button', { name: /Edit shape/ });
    expect(editBtn).toBeDisabled();
  });

  it('clicking a polygon name selects + zooms', async () => {
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [
            {
              polygonId: 3,
              name: 'ZoomPoly',
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
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const nameBtn = await screen.findByRole('button', { name: 'ZoomPoly' });
    fireEvent.click(nameBtn);
    // Sidebar's Save-as-Route counter for coverage should turn to 1.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save coverage as Route \(1\)/ })).toBeInTheDocument(),
    );
  });

  it('checkbox toggle selects / deselects', async () => {
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [
            {
              polygonId: 4,
              name: 'ChkPoly',
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
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: 'ChkPoly' });
    const chk = screen.getByRole('checkbox');
    fireEvent.click(chk);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save coverage as Route \(1\)/ })).toBeInTheDocument(),
    );
    fireEvent.click(chk);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save coverage as Route \(0\)/ })).toBeInTheDocument(),
    );
  });

  it('Show on map on a polygon with only unresolvable zips surfaces error', async () => {
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [
            {
              polygonId: 7,
              name: 'CoveragePoly',
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
              partiallyIncludedZips: ',ZZZZZ,YYYYY,',
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
    await screen.findByRole('button', { name: 'CoveragePoly' });
    const showBtn = screen.getByRole('button', { name: /Show on map/ });
    fireEvent.click(showBtn);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Could not resolve/i),
    );
  });

  it('surfaces bulk-polygons list load failure via toast', async () => {
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({ error: 'list-boom' }, { status: 500 }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/list-boom/i),
    );
  });

  it('clear button wipes selected zips + loaded shapes', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 20, zip: '2020', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [
            {
              zipPolygonId: 20,
              zip: '2020',
              latitude: -36.9,
              longitude: 174.7,
              wkt,
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '2020' } });
    fireEvent.click(await screen.findByRole('button', { name: /2020/ }));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Clear postcodes/ }));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(0\)/),
    );
  });

  it('removes an individual selected zip from the sidebar via the x button', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 21, zip: '2121', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [
            { zipPolygonId: 21, zip: '2121', latitude: -36.9, longitude: 174.7, wkt },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '2121' } });
    fireEvent.click(await screen.findByRole('button', { name: /2121/ }));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/),
    );
    fireEvent.click(screen.getByTitle('Remove'));
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(0\)/),
    );
  });
});
