import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

// Mock the marker clusterer module BEFORE importing the SUT so its
// constructor doesn't try to call OverlayView methods on itself.
vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: class {
    constructor(_: any) {}
    setMap() {}
    clearMarkers() {}
    addMarker() {}
    addMarkers() {}
    removeMarker() {}
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

// Fake Google Maps SDK. Rich enough for PolygonBuilder's map init effect
// (Map + OverlayView subclass + LatLngBounds + event helpers) so the page
// renders end-to-end. Every method is a no-op; the polygon-clipping code
// paths are tested elsewhere.
const gmaps = {
  maps: {
    Map: vi.fn(function (this: any) {
      this.setCenter = vi.fn();
      this.fitBounds = vi.fn();
      this.setZoom = vi.fn();
      this.getZoom = vi.fn(() => 11);
      this.getBounds = vi.fn(() => null);
      this.getProjection = vi.fn(() => ({}));
      this.addListener = vi.fn(() => ({ remove: vi.fn() }));
    }),
    Marker: vi.fn(function (this: any) {
      this.setMap = vi.fn();
      this.setPosition = vi.fn();
      this.setIcon = vi.fn();
      this.addListener = vi.fn(() => ({ remove: vi.fn() }));
      this.getPosition = vi.fn(() => ({ lat: () => 0, lng: () => 0 }));
    }),
    Polygon: vi.fn(function (this: any) {
      this.setMap = vi.fn();
      this.setPaths = vi.fn();
      this.setOptions = vi.fn();
      this.addListener = vi.fn(() => ({ remove: vi.fn() }));
    }),
    Polyline: vi.fn(function (this: any) {
      this.setMap = vi.fn();
    }),
    OverlayView: class {
      setMap() {}
      onAdd() {}
      onRemove() {}
      draw() {}
    },
    LatLngBounds: vi.fn(function (this: any) {
      this.extend = vi.fn();
      this.isEmpty = vi.fn(() => false);
    }),
    LatLng: vi.fn(function (this: any, _lat: number, _lng: number) {}),
    InfoWindow: vi.fn(),
    MapTypeId: { ROADMAP: 'ROADMAP' },
    Size: vi.fn(),
    Point: vi.fn(),
    event: {
      addListener: vi.fn(() => ({ remove: vi.fn() })),
      addListenerOnce: vi.fn((_map: any, _e: string, cb: any) => setTimeout(cb, 0)),
      removeListener: vi.fn(),
      trigger: vi.fn(),
    },
    Animation: { BOUNCE: 'BOUNCE' },
  },
};

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: 'fake-key',
    isUsTenant: false,
  };
  (window as any).google = gmaps;
  vi.clearAllMocks();
  // Bootstrap MSW handlers for every endpoint PolygonBuilder hits on mount.
  server.use(
    http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [] })),
    http.get('/api/zones/rating-postcodes', () => HttpResponse.json({ response: [] })),
    http.get('/api/recurring-routes/zipcodes/centroids', () =>
      HttpResponse.json({ response: [] })
    ),
    http.get('/api/recurring-routes/zipcodes/search', () =>
      HttpResponse.json({ response: [] })
    ),
    http.post('/api/recurring-routes/zipcodes/shapes', () =>
      HttpResponse.json({ response: [] })
    ),
    http.get('/api/recurring-routes/assignable-targets', () =>
      HttpResponse.json({ response: { couriers: [], agents: [], networkPartners: [] } })
    ),
    http.get('/api/recurring-routes/schedules/lookup', () =>
      HttpResponse.json({ response: [] })
    ),
  );
});
afterEach(() => {
  delete (window as any).google;
});

describe('PolygonBuilder', () => {
  it('renders the "Google Maps API key not set" fallback when key is missing', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: null };
    renderWithProviders(<PolygonBuilder />);
    expect(screen.getByText(/Google Maps API key is not set/)).toBeInTheDocument();
  });

  it('renders the top toolbar and side panel headings', async () => {
    const { container } = renderWithProviders(<PolygonBuilder />);
    // Toolbar buttons.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /View Zones/ })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /Save as Route/ })).toBeInTheDocument();
    // Side panel headings - the sidebar uses the zipLongLower ("postal codes"
    // on NZ). Search the aggregate DOM text.
    const body = (container.textContent ?? '').toLowerCase();
    expect(body).toContain('selected postal codes');
    expect(body).toContain('coverage polygons');
  });

  it('renders the zip search input with placeholder', async () => {
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Type a postcode prefix/)).toBeInTheDocument()
    );
  });

  it('typing in the search input fires the zipcodes search endpoint', async () => {
    let searchQ = '';
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', ({ request }) => {
        searchQ = new URL(request.url).searchParams.get('q') ?? '';
        return HttpResponse.json({
          response: [
            { zipPolygonId: 1, zip: '1010', latitude: -36.85, longitude: 174.76 },
            { zipPolygonId: 2, zip: '1011', latitude: -36.86, longitude: 174.77 },
          ],
        });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '101' } });
    await waitFor(() => expect(searchQ).toBe('101'));
    // Results dropdown renders both matches.
    await waitFor(() => expect(screen.getByRole('button', { name: /1010/ })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /1011/ })).toBeInTheDocument();
  });

  it('renders coverage polygons returned from /api/bulk-polygons', async () => {
    server.use(
      http.get('/api/bulk-polygons', () =>
        HttpResponse.json({
          response: [
            {
              polygonId: 999,
              name: 'Downtown Coverage',
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Downtown Coverage' })).toBeInTheDocument()
    );
    expect(screen.getByText(/Coverage polygons \(1\)/)).toBeInTheDocument();
  });

  it('View Zones button opens the ZonesDrawer', async () => {
    server.use(
      http.get('/api/zones/rating-postcodes', () =>
        HttpResponse.json({
          response: [
            {
              countryCode: 'NZ',
              depotId: 1,
              depotName: 'Auckland Depot',
              postcodeCount: 2,
              groups: [
                {
                  groupId: 100,
                  groupName: 'Metro',
                  zoneName: null,
                  postcodeCount: 2,
                  zones: [{ zone: 1, postcodes: ['1010', '1011'] }],
                },
              ],
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /View Zones/ }));
    // The drawer's dialog role becomes present + shows the depot.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });

  it('Save as Route button is disabled with no selection', async () => {
    renderWithProviders(<PolygonBuilder />);
    const btn = await screen.findByRole('button', { name: /Save as Route \(0\)/ });
    expect(btn).toBeDisabled();
  });

  it('clicking a search result loads its zip shape', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 5, zip: '1050', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [
            {
              zipPolygonId: 5,
              zip: '1050',
              latitude: -36.9,
              longitude: 174.7,
              wkt: 'POLYGON((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9))',
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '1050' } });
    const btn = await screen.findByRole('button', { name: /1050/ });
    fireEvent.click(btn);
    // Sidebar heading turns to "Selected postal codes (1)"; match against the
    // whole document aggregate text since the count is a nested span.
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(1\)/)
    );
  });

  it('renders the status bar loading text before zip centroids resolve', () => {
    // Delay the centroid response so the "loading" branch renders.
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', async () => {
        await new Promise((r) => setTimeout(r, 300));
        return HttpResponse.json({ response: [] });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    expect((document.body.textContent ?? '').toLowerCase()).toContain('loading postal codes');
  });

  it('after zip centroids resolve with none, shows "no postal codes on this tenant"', async () => {
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toContain('no postal codes on this tenant')
    );
  });
});
