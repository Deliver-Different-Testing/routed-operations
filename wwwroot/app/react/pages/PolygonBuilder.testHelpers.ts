import { vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';

// Shared Google Maps SDK stub used by every PolygonBuilder split test file.
// Rich enough to satisfy the SUT's map-init effect (Map + OverlayView +
// LatLngBounds + Polygon + Marker + Rectangle + Circle + Polyline + event
// helpers). Every method is a no-op or returns a stable value.

export function buildGoogleMapsStub() {
  const listeners: Record<string, Array<{ type: string; cb: (e: any) => void; owner: any }>> = {};
  const registerListener = (owner: any, type: string, cb: (e: any) => void) => {
    listeners[type] = listeners[type] || [];
    const entry = { type, cb, owner };
    listeners[type].push(entry);
    return { remove: () => {
      const arr = listeners[type];
      if (arr) {
        const idx = arr.indexOf(entry);
        if (idx >= 0) arr.splice(idx, 1);
      }
    }};
  };

  const gmaps: any = {
    __listeners: listeners,
    __fireOnMap: (type: string, evt: any) => {
      (listeners[type] || []).slice().forEach((l) => l.cb(evt));
    },
    maps: {
      Map: vi.fn(function (this: any) {
        this.setCenter = vi.fn();
        this.fitBounds = vi.fn();
        this.setZoom = vi.fn();
        this.getZoom = vi.fn(() => 11);
        this.getBounds = vi.fn(() => ({ contains: () => true }));
        this.getProjection = vi.fn(() => ({
          fromLatLngToContainerPixel: () => ({ x: 100, y: 100 }),
        }));
        this.addListener = vi.fn((type: string, cb: any) => registerListener(this, type, cb));
        this.setOptions = vi.fn();
      }),
      Marker: vi.fn(function (this: any, opts: any) {
        this._opts = opts;
        this.setMap = vi.fn();
        this.setPosition = vi.fn();
        this.setIcon = vi.fn();
        this.setZIndex = vi.fn();
        this.setClickable = vi.fn();
        this.addListener = vi.fn((type: string, cb: any) => registerListener(this, type, cb));
        this.getPosition = vi.fn(() => ({ lat: () => 0, lng: () => 0 }));
        this.getTitle = vi.fn(() => opts?.title ?? '');
      }),
      Polygon: vi.fn(function (this: any) {
        this.setMap = vi.fn();
        this.setPaths = vi.fn();
        this.setOptions = vi.fn();
        this.addListener = vi.fn((type: string, cb: any) => registerListener(this, type, cb));
      }),
      Polyline: vi.fn(function (this: any) {
        this.setMap = vi.fn();
        this.setPath = vi.fn();
      }),
      Rectangle: vi.fn(function (this: any) {
        this.setMap = vi.fn();
        this.setBounds = vi.fn();
        this.getBounds = vi.fn(() => null);
        this.addListener = vi.fn((type: string, cb: any) => registerListener(this, type, cb));
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
  return gmaps;
}

/** Install the standard base MSW handlers PolygonBuilder needs on mount. */
export function installBaseHandlers() {
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
}
