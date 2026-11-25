import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { buildGoogleMapsStub, installBaseHandlers } from './PolygonBuilder.testHelpers';
import { FILTERS_STORAGE_KEY } from '../lib/polygonFilters';

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

const square = (lat: number, lng: number) => [
  { ringIndex: 0, orderIndex: 0, lat, lng },
  { ringIndex: 0, orderIndex: 1, lat, lng: lng + 0.01 },
  { ringIndex: 0, orderIndex: 2, lat: lat - 0.01, lng: lng + 0.01 },
  { ringIndex: 0, orderIndex: 3, lat: lat - 0.01, lng },
];

const polygon = (polygonId: number, name: string, layer: string | null) => ({
  polygonId, name, layer,
  colorHex: null,
  centroidLatitude: -36.85, centroidLongitude: 174.76,
  sourceType: 0, sourceCode: null, active: true,
  points: square(-36.85, 174.76),
  attachedRouteCount: 0, attachedRoutes: [], zoneMemberships: [],
  partiallyIncludedZips: null,
  createdUtc: '2026-11-11T02:00:00Z', createdBy: 'steve@urgent.co.nz',
  lastModifiedUtc: null, updatedBy: null,
  zoneNameId: null, postcodeGroupId: null, attachedScheduleNames: [],
  zoneNameName: null, postcodeGroupName: null,
});

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: 'fake-key',
    isUsTenant: false,
  };
  (window as any).google = buildGoogleMapsStub();
  vi.clearAllMocks();
  window.localStorage.removeItem(FILTERS_STORAGE_KEY);
  installBaseHandlers();
  server.use(
    http.get('/api/bulk-polygons', () => HttpResponse.json({
      response: [
        polygon(1, 'AD Deep East', 'AD'),
        polygon(2, 'AD Deep Mid', 'AD'),
        polygon(3, 'MC6', 'MC'),
        polygon(4, 'Zip 0604 copy', null),
      ],
    })),
  );
});

afterEach(() => {
  delete (window as any).google;
  window.localStorage.removeItem(FILTERS_STORAGE_KEY);
});

const rowsIn = (layer: string) => {
  const group = screen.getAllByTestId('pb-layer-group').find((g) => g.getAttribute('data-layer') === layer)!;
  return Array.from(group.querySelectorAll('[data-testid="pb-polygon-row"]'));
};

describe('PolygonBuilder - layers', () => {
  it('groups the sidebar by layer, named layers first and "No layer" last', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const groups = screen.getAllByTestId('pb-layer-group').map((g) => g.getAttribute('data-layer'));
    expect(groups).toEqual(['AD', 'MC', '']);
    expect(rowsIn('AD')).toHaveLength(2);
    expect(screen.getByText('No layer')).toBeInTheDocument();
  });

  it('moves a polygon to a layer through the meta endpoint', async () => {
    let sentBody: any = null;
    server.use(
      http.put('/api/bulk-polygons/3', async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json({ response: polygon(3, 'MC6', sentBody.layer) });
      }),
    );
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('MC6');

    fireEvent.click(screen.getByText('Layer: MC'));
    const input = await screen.findByLabelText('Layer for MC6');
    fireEvent.change(input, { target: { value: ' AD ' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(sentBody).toEqual({ name: 'MC6', layer: 'AD' }));
    await waitFor(() => expect(rowsIn('AD')).toHaveLength(3));
  });

  it('Postcode lines in the filter bar switches postcode boundaries off and on', async () => {
    renderWithProviders(<PolygonBuilder />);
    const btn = await screen.findByRole('button', { name: /Postcode lines/ });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: /Hide postcode boundaries/ })).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'));
    expect(JSON.parse(window.localStorage.getItem(FILTERS_STORAGE_KEY) ?? '{}').showPostcodes).toBe(false);
  });
});

describe('PolygonBuilder - draw by points', () => {
  it('New Drawing -> Draw by points enters point mode; clicks add points and Del undoes a click', async () => {
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /New Drawing/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Draw by points/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Click to add points \(0\)/));

    const g = (window as any).google;
    const latLng = (lat: number, lng: number) => ({ lat: () => lat, lng: () => lng });
    await act(async () => {
      g.__fireOnMap('click', { latLng: latLng(-36.85, 174.76), domEvent: { altKey: false } });
    });
    await waitFor(() => expect(document.body.textContent).toMatch(/Click to add points \(1\)/));
    await act(async () => {
      g.__fireOnMap('click', { latLng: latLng(-36.86, 174.77), domEvent: { altKey: false } });
    });
    await waitFor(() => expect(document.body.textContent).toMatch(/Click to add points \(2\)/));

    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(document.body.textContent).toMatch(/Click to add points \(1\)/));

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: /View Zones/ })).toBeInTheDocument());
  });

  it('clicking the first point again finishes the drawing (no Finish press needed)', async () => {
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /New Drawing/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Draw by points/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Click to add points \(0\)/));

    const g = (window as any).google;
    const latLng = (lat: number, lng: number) => ({ lat: () => lat, lng: () => lng });
    const pts: [number, number][] = [[-36.85, 174.76], [-36.85, 174.80], [-36.89, 174.80]];
    for (let i = 0; i < pts.length; i++) {
      await act(async () => {
        g.__fireOnMap('click', { latLng: latLng(pts[i][0], pts[i][1]), domEvent: { altKey: false } });
      });
      await waitFor(() => expect(document.body.textContent).toContain(`Click to add points (${i + 1})`));
    }
    await act(async () => {
      g.__fireOnMap('click', { latLng: latLng(pts[0][0], pts[0][1]), domEvent: { altKey: false } });
    });
    await waitFor(() => expect(document.body.textContent).toMatch(/Drag the purple squares/));
    expect(document.body.textContent).toContain('(3 vertices');
  });

  it('P in view mode starts point drawing', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'p' });
    await waitFor(() => expect(document.body.textContent).toMatch(/Click to add points/));
  });
});
