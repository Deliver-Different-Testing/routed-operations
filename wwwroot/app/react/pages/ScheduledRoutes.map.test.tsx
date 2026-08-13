import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

// Stub the drilldown - map tests never open it.
vi.mock('./recurring-routes/MappedStopsDrilldown', () => ({
  MappedStopsDrilldown: () => <div data-testid="mapped-stops" />,
}));

// Rich enough Google Maps SDK stub that the RouteCoverageMap's init +
// bounds-changed + centroid-sync effects can execute without exploding
// under jsdom. Every ctor is a minimal fake with the members the SUT reads.
class FakeBounds {
  private pts: Array<{ lat: number; lng: number }> = [];
  extend(p: { lat: number; lng: number }) { this.pts.push(p); return this; }
  contains() { return true; }
}
class FakeLatLng {
  constructor(public lat: number, public lng: number) {}
  lat_ = this.lat; lng_ = this.lng;
}
class FakePoint { constructor(public x: number, public y: number) {} }
class FakeSize { constructor(public w: number, public h: number) {} }
class FakeMarker {
  private listeners: Record<string, Array<(e?: unknown) => void>> = {};
  private icon: unknown;
  private zIndex = 0;
  private title = '';
  constructor(opts: { title?: string; icon?: unknown }) {
    this.title = opts.title ?? '';
    this.icon = opts.icon;
  }
  addListener(evt: string, fn: (e?: unknown) => void) {
    (this.listeners[evt] ??= []).push(fn);
    return { remove: () => {} };
  }
  setMap() {}
  setIcon(i: unknown) { this.icon = i; }
  setZIndex(z: number) { this.zIndex = z; }
  getTitle() { return this.title; }
}
class FakePolygon {
  private listeners: Record<string, Array<() => void>> = {};
  constructor(private opts: any) {}
  addListener(evt: string, fn: () => void) {
    (this.listeners[evt] ??= []).push(fn);
    return { remove: () => {} };
  }
  setMap() {}
  setPath() {}
  setPaths() {}
}
class FakeMap {
  private listeners: Record<string, Array<() => void>> = {};
  addListener(evt: string, fn: () => void) {
    (this.listeners[evt] ??= []).push(fn);
    return { remove: () => {} };
  }
  fitBounds() {}
  getBounds() { return new FakeBounds(); }
  getZoom() { return 11; }
  getProjection() { return {}; }
}

beforeEach(() => {
  const stub: any = {
    maps: {
      Map: FakeMap,
      Marker: FakeMarker,
      Polygon: FakePolygon,
      LatLng: FakeLatLng,
      LatLngBounds: FakeBounds,
      Point: FakePoint,
      Size: FakeSize,
      MapTypeId: { ROADMAP: 'roadmap' },
      event: {
        addListenerOnce: (map: any, evt: string, fn: () => void) => {
          if (evt === 'idle') fn();
          return { remove: () => {} };
        },
        removeListener: () => {},
      },
    },
  };
  (window as any).google = stub;
  // MarkerClusterer's internal engine relies on Map + getProjection so
  // we keep the stub tight. Tests don't assert marker positions.
});

afterEach(() => {
  delete (window as any).google;
});

// Stub the MarkerClusterer import so we don't run its internal render logic
// against our jsdom shim.
vi.mock('@googlemaps/markerclusterer', () => {
  class MarkerClusterer {
    constructor() {}
    addMarkers() {}
    removeMarkers() {}
    clearMarkers() {}
    render() {}
    setMap() {}
  }
  class SuperClusterAlgorithm { constructor(_: unknown) {} }
  return { MarkerClusterer, SuperClusterAlgorithm };
});

import ScheduledRoutes from './ScheduledRoutes';

const stubTargets = () =>
  http.get('/api/recurring-routes/assignable-targets', () =>
    HttpResponse.json({ response: { couriers: [], agents: [], nps: [] } }));

const stubSchedules = () =>
  http.get('/api/recurring-routes/schedules/lookup', () =>
    HttpResponse.json({ response: [] }));

const stubZipcodeSearch = () =>
  http.get('/api/recurring-routes/zipcodes/search', () =>
    HttpResponse.json({ response: [] }));

const stubZipcodeShapes = (payload: unknown[] = []) =>
  http.post('/api/recurring-routes/zipcodes/shapes', () =>
    HttpResponse.json({ response: payload }));

const stubCentroids = (payload: unknown[] = []) =>
  http.get('/api/recurring-routes/zipcodes/centroids', () =>
    HttpResponse.json({ response: payload }));

const stubRoutes = (routes: unknown[]) =>
  http.get('/api/recurring-routes', () => HttpResponse.json({ response: routes }));

const route = (over: Partial<Record<string, unknown>> = {}) => ({
  routeId: 1, name: 'RNO200', area: 'Reno North',
  defaultTargetType: null, defaultTargetId: null, defaultTargetName: '',
  scheduleId: null, scheduleName: '', scheduleWindow: '',
  schedules: [], active: true, zipcodes: [], bulkPolygons: [],
  rosterEntryCount: 0, bookingCount: 0, mappedStopsCount: 0,
  createdAt: '2026-08-13T00:00:00Z', updatedAt: null,
  ...over,
});

function renderWithGoogleKey() {
  const original = (window as any).__APP_USER__;
  (window as any).__APP_USER__ = { ...original, googleMapsKey: 'FAKE-KEY' };
  const result = renderWithProviders(<ScheduledRoutes />);
  // Restore in a teardown ref
  return {
    ...result,
    restore: () => { (window as any).__APP_USER__ = original; },
  };
}

describe('ScheduledRoutes - RouteCoverageMap', () => {
  it('renders the map container div when googleMapsKey is set', async () => {
    server.use(
      stubTargets(), stubSchedules(), stubZipcodeSearch(),
      stubZipcodeShapes(), stubCentroids(),
      stubRoutes([route()]),
    );
    const { restore } = renderWithGoogleKey();
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByText('RNO200'));
      await screen.findByRole('heading', { name: /Edit "RNO200"/ });
      // The placeholder "Google Maps API key is not set" should NOT render
      expect(screen.queryByText(/Google Maps API key is not set/))
        .not.toBeInTheDocument();
      // A div with the map container class exists
      const container = document.querySelector('[class*="min-h-\\[400px\\] rounded-lg"]');
      expect(container).toBeTruthy();
    } finally { restore(); }
  });

  it('renders + auto-fits when the route has bound zip shapes', async () => {
    server.use(
      stubTargets(), stubSchedules(), stubZipcodeSearch(),
      stubZipcodeShapes([
        {
          zipPolygonId: 501, zip: '89501', latitude: 39.5, longitude: -119.8,
          wkt: 'POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))',
        },
      ]),
      stubCentroids([
        { zipPolygonId: 501, zip: '89501', latitude: 39.5, longitude: -119.8 },
      ]),
      stubRoutes([route({
        zipcodes: [{ zipPolygonId: 501, zip: '89501' }],
      })]),
    );
    const { restore } = renderWithGoogleKey();
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByText('RNO200'));
      await screen.findByRole('heading', { name: /Edit "RNO200"/ });
      // Give effects time to run
      await waitFor(() => {
        const container = document.querySelector('[class*="min-h-\\[400px\\] rounded-lg"]');
        expect(container).toBeTruthy();
      });
    } finally { restore(); }
  });

  it('coverage polygons load via GET when the route has any attached', async () => {
    let polyHit = 0;
    server.use(
      stubTargets(), stubSchedules(), stubZipcodeSearch(),
      stubZipcodeShapes(), stubCentroids(),
      stubRoutes([route({
        bulkPolygons: [{ polygonId: 42, name: 'ZoneA', centroidLatitude: 0, centroidLongitude: 0 }],
      })]),
      http.get('/api/bulk-polygons/42', () => {
        polyHit++;
        return HttpResponse.json({
          response: { polygonId: 42, name: 'ZoneA', points: [
            { lat: 39.5, lng: -119.8, ringIndex: 0, orderIndex: 0 },
            { lat: 39.51, lng: -119.8, ringIndex: 0, orderIndex: 1 },
            { lat: 39.51, lng: -119.79, ringIndex: 0, orderIndex: 2 },
          ] },
        });
      }),
    );
    const { restore } = renderWithGoogleKey();
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByText('RNO200'));
      await screen.findByRole('heading', { name: /Edit "RNO200"/ });
      await waitFor(() => expect(polyHit).toBeGreaterThan(0));
    } finally { restore(); }
  });

  it('detaching a coverage polygon via the pill × removes it from the sidebar', async () => {
    server.use(
      stubTargets(), stubSchedules(), stubZipcodeSearch(),
      stubZipcodeShapes(), stubCentroids(),
      stubRoutes([route({
        bulkPolygons: [{ polygonId: 42, name: 'ZoneA', centroidLatitude: 0, centroidLongitude: 0 }],
      })]),
      http.get('/api/bulk-polygons/42', () =>
        HttpResponse.json({
          response: { polygonId: 42, name: 'ZoneA', points: [] },
        })),
    );
    const { restore } = renderWithGoogleKey();
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByText('RNO200'));
      await screen.findByRole('heading', { name: /Edit "RNO200"/ });
      const removeBtn = await screen.findByTitle(/Detach "ZoneA" from route/);
      await user.click(removeBtn);
      await waitFor(() =>
        expect(screen.queryByTitle(/Detach "ZoneA" from route/)).not.toBeInTheDocument(),
      );
    } finally { restore(); }
  });

  it('clicking a zip pill label triggers focus request (no throw)', async () => {
    server.use(
      stubTargets(), stubSchedules(), stubZipcodeSearch(),
      stubZipcodeShapes([
        {
          zipPolygonId: 501, zip: '89501', latitude: 39.5, longitude: -119.8,
          wkt: 'POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))',
        },
      ]),
      stubCentroids(),
      stubRoutes([route({ zipcodes: [{ zipPolygonId: 501, zip: '89501' }] })]),
    );
    const { restore } = renderWithGoogleKey();
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByText('RNO200'));
      await screen.findByRole('heading', { name: /Edit "RNO200"/ });
      const label = await screen.findByTitle(/Zoom map to 89501/);
      // Fire the click - should call focusZip which updates focusRequest.
      await user.click(label);
      // Assert the pill still renders after the click
      expect(screen.getByTitle(/Zoom map to 89501/)).toBeInTheDocument();
    } finally { restore(); }
  });
});
