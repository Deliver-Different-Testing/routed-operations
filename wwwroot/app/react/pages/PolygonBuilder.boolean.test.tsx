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

const bigPoly = {
  polygonId: 1,
  name: 'BoolPoly',
  centroidLatitude: -36.85,
  centroidLongitude: 174.76,
  sourceType: 0,
  sourceCode: null,
  points: [
    { ringIndex: 0, orderIndex: 0, lat: -36.86, lng: 174.75 },
    { ringIndex: 0, orderIndex: 1, lat: -36.86, lng: 174.78 },
    { ringIndex: 0, orderIndex: 2, lat: -36.83, lng: 174.78 },
    { ringIndex: 0, orderIndex: 3, lat: -36.83, lng: 174.75 },
  ],
  attachedRouteCount: 0,
  attachedRoutes: [],
  partiallyIncludedZips: null,
  createdBy: 'kevin',
  createdUtc: '2026-08-13T00:00:00',
  updatedBy: null,
  lastModifiedUtc: null,
};

describe('PolygonBuilder - boolean ops (Add / Cut / Clip / Split)', () => {
  it('Edit shape -> Cut -> lasso stroke cuts a piece and PUTs new shape', async () => {
    const putBody: any = { called: false };
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
      http.put('/api/bulk-polygons/:id/shape', async ({ request }) => {
        putBody.called = true;
        putBody.body = await request.json();
        return HttpResponse.json({
          response: {
            ...bigPoly,
            points: (putBody.body as any).points,
            lastModifiedUtc: '2026-08-13T02:00:00',
            partiallyIncludedZips: ',1010,',
          },
        });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag squares to reshape/),
    );
    // Click "Cut" - default input tool is freehand -> enters lassoing mode.
    fireEvent.click(screen.getByRole('button', { name: /^Cut$/ }));
    const g = (window as any).google;
    // Draw a stroke that cuts a rectangle out of the polygon (small overlap).
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.86, 174.76));
    });
    for (const [lat, lng] of [
      [-36.86, 174.77],
      [-36.85, 174.77],
      [-36.85, 174.76],
    ]) {
      act(() => {
        g.__fireOnMap('mousemove', makeLatLngEvent(lat, lng));
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    act(() => {
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.86, 174.76));
    });
    await waitFor(() => expect(putBody.called).toBe(true));
    // Toast should confirm the cut.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Cut from shape/),
    );
  });

  it('Cut with too-short stroke surfaces "Region too small" error', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag squares to reshape/),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Cut$/ }));
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.85, 174.76));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Region too small/i),
    );
  });

  it('Split with too-short line surfaces "Split line too short"', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Split$/ }));
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.85, 174.76));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Split line too short/),
    );
  });

  it('Shape input picker switches to Rectangle + Cut uses rectangling mode', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag squares to reshape/),
    );
    fireEvent.click(screen.getByRole('radio', { name: /Rectangle/ }));
    // Now Cut should switch to rectangling.
    fireEvent.click(screen.getByRole('button', { name: /^Cut$/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click and drag to draw a rectangle/),
    );
  });

  it('Shape input picker switches to Circle', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    fireEvent.click(await screen.findByRole('radio', { name: /Circle/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click the centre and drag out/),
    );
  });

  it('Cancel from edit-mode boolean op via Cancel button returns to edit mode', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Cut$/ }));
    // Now in lassoing mode.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Hold mouse and drag around an area/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    // Back to edit-mode toolbar.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag squares to reshape/),
    );
  });

  it('Edit-mode L/R/C keyboard shortcuts flip the shape picker', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag squares to reshape/),
    );
    fireEvent.keyDown(window, { key: 'r' });
    // Rectangle radio should now be aria-checked.
    await waitFor(() => {
      const rectRadio = screen.getByRole('radio', { name: /Rectangle/ }) as HTMLElement;
      expect(rectRadio.getAttribute('aria-checked')).toBe('true');
    });
    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(() => {
      const circleRadio = screen.getByRole('radio', { name: /Circle/ }) as HTMLElement;
      expect(circleRadio.getAttribute('aria-checked')).toBe('true');
    });
    fireEvent.keyDown(window, { key: 'l' });
    await waitFor(() => {
      const freehandRadio = screen.getByRole('radio', { name: /Freehand/ }) as HTMLElement;
      expect(freehandRadio.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('Done editing exits edit mode + resets undo stack', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    // Two "Done editing" buttons render (toolbar + sidebar); click the toolbar one.
    const doneBtns = await screen.findAllByRole('button', { name: 'Done editing' });
    fireEvent.click(doneBtns[0]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /View Zones/ })).toBeInTheDocument(),
    );
  });

  it('Escape while editing returns to view mode', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag squares to reshape/),
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /View Zones/ })).toBeInTheDocument(),
    );
  });

  it('Undo button disabled initially in edit mode (no snapshots yet)', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [bigPoly] })),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /Edit shape/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag squares to reshape/),
    );
    const undoBtn = screen.getByRole('button', { name: /^Undo$/ });
    expect(undoBtn).toBeDisabled();
  });
});
