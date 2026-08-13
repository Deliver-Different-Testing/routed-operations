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

/** Build a WKT ring with N vertices around a centre so the "use as
 *  starting shape" flow exercises Douglas-Peucker simplification. */
function bigWkt(n: number, cx: number, cy: number, r: number): string {
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const lng = cx + Math.cos(t) * r;
    const lat = cy + Math.sin(t) * r;
    parts.push(`${lng} ${lat}`);
  }
  parts.push(parts[0]); // Close the ring.
  return `POLYGON((${parts.join(', ')}))`;
}

describe('PolygonBuilder - Douglas-Peucker simplification', () => {
  it('use-as-starting-shape on a big-ring zip toasts a simplified vertex count', async () => {
    const wkt = bigWkt(300, 174.76, -36.85, 0.02);
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 42, zip: '4242', latitude: -36.85, longitude: 174.76 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 42, zip: '4242', latitude: -36.85, longitude: 174.76, wkt }],
        }),
      ),
      http.post('/api/bulk-polygons', async ({ request }) => {
        const body = (await request.json()) as any;
        return HttpResponse.json({
          response: {
            polygonId: 500,
            name: body.name,
            centroidLatitude: body.centroidLatitude,
            centroidLongitude: body.centroidLongitude,
            sourceType: body.sourceType,
            sourceCode: body.sourceCode,
            points: body.points,
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
    fireEvent.change(input, { target: { value: '4242' } });
    fireEvent.click(await screen.findByRole('button', { name: /4242/ }));
    // Wait for the selection to appear + the "Use as starting shape" button.
    const useBtn = await screen.findByRole('button', { name: /Use as starting shape/ });
    fireEvent.click(useBtn);
    // Simplification toast: "Simplified 300|301 -> N vertices for editability."
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Simplified 30[01] -> \d+ vertices for editability/),
    );
    // Server round-trip successful toast.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Coverage polygon created from postcode 4242/),
    );
  });

  it('use-as-starting-shape on a zip without a loaded shape errors', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 50, zip: '5050', latitude: -36.85, longitude: 174.76 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        // Return NO shapes so the selection has no WKT loaded.
        HttpResponse.json({ response: [] }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '5050' } });
    fireEvent.click(await screen.findByRole('button', { name: /5050/ }));
    const useBtn = await screen.findByRole('button', { name: /Use as starting shape/ });
    fireEvent.click(useBtn);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/No shape loaded/),
    );
  });

  it('use-as-starting-shape on a zip with invalid WKT surfaces "no usable boundary"', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 51, zip: '5051', latitude: -36.85, longitude: 174.76 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 51, zip: '5051', latitude: -36.85, longitude: 174.76, wkt: 'NOT_A_POLYGON' }],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '5051' } });
    fireEvent.click(await screen.findByRole('button', { name: /5051/ }));
    const useBtn = await screen.findByRole('button', { name: /Use as starting shape/ });
    fireEvent.click(useBtn);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/no usable boundary/i),
    );
  });

  it('use-as-starting-shape server error surfaces via toast', async () => {
    const smallWkt = 'POLYGON((174.7 -36.9, 174.71 -36.9, 174.71 -36.91, 174.7 -36.9))';
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 60, zip: '6060', latitude: -36.85, longitude: 174.76 }],
        }),
      ),
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [{ zipPolygonId: 60, zip: '6060', latitude: -36.85, longitude: 174.76, wkt: smallWkt }],
        }),
      ),
      http.post('/api/bulk-polygons', () =>
        HttpResponse.json({ error: 'create-blew-up' }, { status: 500 }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    const input = await screen.findByPlaceholderText(/Type a postcode prefix/);
    fireEvent.change(input, { target: { value: '6060' } });
    fireEvent.click(await screen.findByRole('button', { name: /6060/ }));
    const useBtn = await screen.findByRole('button', { name: /Use as starting shape/ });
    fireEvent.click(useBtn);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/create-blew-up/),
    );
  });
});
