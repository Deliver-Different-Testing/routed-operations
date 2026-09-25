import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
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
  // rAF used by lasso move-throttling: run inline so buffer flushes.
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
  (globalThis as any).cancelAnimationFrame = (h: any) => clearTimeout(h);
});

afterEach(() => {
  delete (window as any).google;
});

function makeLatLngEvent(lat: number, lng: number) {
  return { latLng: { lat: () => lat, lng: () => lng } };
}

describe('PolygonBuilder - lasso stroke -> pending polygon', () => {
  it('mousedown+move+mouseup with too-few points surfaces "too short" toast', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    // Enter lasso mode.
    fireEvent.keyDown(window, { key: 'l' });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Hold mouse and drag around an area/),
    );
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.85, 174.76));
    });
    // Should surface "too short" toast + drop back to view mode.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Lasso stroke too short/),
    );
  });

  it('completing a lasso stroke opens pending mode with the drawn polygon', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'l' });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
    });
    // Fire a bunch of move events (rAF flushes them inline in this test).
    for (let i = 0; i < 5; i++) {
      act(() => {
        g.__fireOnMap('mousemove', makeLatLngEvent(-36.85 + i * 0.01, 174.76 + i * 0.01));
      });
      await new Promise((r) => setTimeout(r, 5));
    }
    act(() => {
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.9, 174.8));
    });
    // Pending mode toolbar should show up.
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag the purple squares to refine/),
    );
    // Discard drops back to view.
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /View Zones/ })).toBeInTheDocument(),
    );
  });

  it('rectangle mousedown + mousedown-only (no drag) surfaces "needs width and height"', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click and drag to draw a rectangle/),
    );
    const g = (window as any).google;
    // Start + release at same coords -> zero area -> error.
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.85, 174.76));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Rectangle needs some width and height/),
    );
  });

  it('rectangle drag opens pending mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'r' });
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
      g.__fireOnMap('mousemove', makeLatLngEvent(-36.86, 174.77));
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.86, 174.77));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag the purple squares to refine/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }));
  });

  it('circle mousedown + mouseup with tiny radius surfaces "too small"', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Click the centre and drag out/),
    );
    const g = (window as any).google;
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.85, 174.76));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Circle radius too small/),
    );
  });

  it('circle drag opens pending mode', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'c' });
    const g = (window as any).google;
    // Move ~1000m from centre.
    act(() => {
      g.__fireOnMap('mousedown', makeLatLngEvent(-36.85, 174.76));
      g.__fireOnMap('mousemove', makeLatLngEvent(-36.86, 174.77));
      g.__fireOnMap('mouseup', makeLatLngEvent(-36.86, 174.77));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag the purple squares to refine/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }));
  });

  it('document mouseup falls back to finishStroke when released outside map', async () => {
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
    // Simulate document-level mouseup (release outside the map).
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Drag the purple squares to refine/),
    );
    fireEvent.click(screen.getByRole('button', { name: /Discard/ }));
  });
});
