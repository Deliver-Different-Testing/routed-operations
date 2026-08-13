import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

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

const gmaps = {
  maps: {
    Map: vi.fn(function (this: any) {
      this.setCenter = vi.fn();
      this.fitBounds = vi.fn();
      this.setZoom = vi.fn();
      this.getZoom = vi.fn(() => 11);
      this.getBounds = vi.fn(() => ({
        contains: () => true,
      }));
      this.getProjection = vi.fn(() => ({
        fromLatLngToContainerPixel: () => ({ x: 100, y: 100 }),
      }));
      this.addListener = vi.fn(() => ({ remove: vi.fn() }));
      this.setOptions = vi.fn();
    }),
    Marker: vi.fn(function (this: any, opts: any) {
      this._opts = opts;
      this.setMap = vi.fn();
      this.setPosition = vi.fn();
      this.setIcon = vi.fn();
      this.setZIndex = vi.fn();
      this.setClickable = vi.fn();
      this.addListener = vi.fn(() => ({ remove: vi.fn() }));
      this.getPosition = vi.fn(() => ({ lat: () => 0, lng: () => 0 }));
      this.getTitle = vi.fn(() => opts?.title ?? '');
    }),
    Polygon: vi.fn(function (this: any) {
      this.setMap = vi.fn();
      this.setPaths = vi.fn();
      this.setOptions = vi.fn();
      this.addListener = vi.fn(() => ({ remove: vi.fn() }));
    }),
    Polyline: vi.fn(function (this: any) {
      this.setMap = vi.fn();
      this.setPath = vi.fn();
    }),
    Rectangle: vi.fn(function (this: any) {
      this.setMap = vi.fn();
      this.setBounds = vi.fn();
      this.getBounds = vi.fn(() => null);
      this.addListener = vi.fn(() => ({ remove: vi.fn() }));
    }),
    Circle: vi.fn(function (this: any) {
      this.setMap = vi.fn();
      this.setRadius = vi.fn();
    }),
    OverlayView: class {
      setMap() {}
      onAdd() {}
      onRemove() {}
      draw() {}
      getProjection() {
        return {
          fromLatLngToContainerPixel: () => ({ x: 100, y: 100 }),
        };
      }
    },
    LatLngBounds: vi.fn(function (this: any) {
      this.extend = vi.fn();
      this.isEmpty = vi.fn(() => false);
      this.contains = vi.fn(() => true);
    }),
    LatLng: vi.fn(function (this: any, lat: number, lng: number) {
      this.lat = () => lat;
      this.lng = () => lng;
    }),
    InfoWindow: vi.fn(),
    MapTypeId: { ROADMAP: 'ROADMAP' },
    Size: vi.fn(function (this: any, w: number, h: number) {
      this.width = w; this.height = h;
    }),
    Point: vi.fn(function (this: any, x: number, y: number) {
      this.x = x; this.y = y;
    }),
    SymbolPath: { CIRCLE: 0 },
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
      HttpResponse.json({ response: { couriers: [], agents: [], nps: [], networkPartners: [] } })
    ),
    http.get('/api/recurring-routes/schedules/lookup', () =>
      HttpResponse.json({ response: [] })
    ),
  );
});

afterEach(() => {
  delete (window as any).google;
});

describe('PolygonBuilder - search + centroid loader', () => {
  it('clears search results when input goes blank', async () => {
    let hits = 0;
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () => {
        hits++;
        return HttpResponse.json({
          response: [{ zipPolygonId: 9, zip: '9000', latitude: 0, longitude: 0 }],
        });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '900' } });
    await screen.findByRole('button', { name: /9000/ });
    // Clearing should wipe the dropdown (early return `if (!zipSearch.trim())`).
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /9000/ })).not.toBeInTheDocument(),
    );
    expect(hits).toBeGreaterThanOrEqual(1);
  });

  it('search debounced fetch survives an error silently', async () => {
    // Return 500 to hit the silent-catch branch.
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: 'zzz' } });
    // No matches rendered + no crash.
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole('button', { name: /zzz/ })).not.toBeInTheDocument();
  });

  it('renders centroid coord suffix on search result rows', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [
            { zipPolygonId: 1, zip: '1010', latitude: -36.85, longitude: 174.76 },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '101' } });
    // Coordinate suffix ( -36.85, 174.76 ) truncated to 2 decimals.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/-36\.85.*174\.76/),
    );
  });

  it('reports the tenant-wide centroid total once resolved with data', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', () =>
        HttpResponse.json({
          response: [
            { zipPolygonId: 1, zip: '1000', latitude: -36.85, longitude: 174.76 },
            { zipPolygonId: 2, zip: '1001', latitude: -36.86, longitude: 174.77 },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    // With map default zoom 11 (>= INDIVIDUAL_PILL_MIN_ZOOM), the status
    // bar renders "N of M postcodes in view" once centroids arrive.
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/of 2 postal codes in view/),
    );
  });

  it('surfaces centroid fetch failures via toast', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', () =>
        HttpResponse.json({ error: 'centroid-boom' }, { status: 500 }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/centroid-boom/i),
    );
  });

  it('search input is cleared after a result is loaded', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 7, zip: '7070', latitude: -36.9, longitude: 174.7 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [
            {
              zipPolygonId: 7,
              zip: '7070',
              latitude: -36.9,
              longitude: 174.7,
              wkt: 'POLYGON((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9))',
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '7070' } });
    const btn = await screen.findByRole('button', { name: /7070/ });
    fireEvent.click(btn);
    await waitFor(() => expect(input.value).toBe(''));
  });
});
