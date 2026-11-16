import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { buildGoogleMapsStub, installBaseHandlers } from './PolygonBuilder.testHelpers';
import { VISIBILITY_STORAGE_KEY } from '../lib/polygonLayers';

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
  window.localStorage.removeItem(VISIBILITY_STORAGE_KEY);
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
  window.localStorage.removeItem(VISIBILITY_STORAGE_KEY);
});

const rowsIn = (layer: string) => {
  const group = screen.getAllByTestId('pb-layer-group').find((g) => g.getAttribute('data-layer') === layer)!;
  return Array.from(group.querySelectorAll('[data-testid="pb-polygon-row"]'));
};

describe('PolygonBuilder - layers and visibility', () => {
  it('groups the sidebar by layer, named layers first and "No layer" last', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');
    const groups = screen.getAllByTestId('pb-layer-group').map((g) => g.getAttribute('data-layer'));
    expect(groups).toEqual(['AD', 'MC', '']);
    expect(rowsIn('AD')).toHaveLength(2);
    expect(screen.getByText('No layer')).toBeInTheDocument();
  });

  it('hiding a layer greys its rows, "Only" hides every other layer, and the choice persists', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');

    fireEvent.click(screen.getByRole('button', { name: 'Hide layer AD' }));
    await waitFor(() => {
      expect(rowsIn('AD').every((r) => r.getAttribute('data-hidden') === 'true')).toBe(true);
    });
    expect(rowsIn('MC')[0].getAttribute('data-hidden')).toBe('false');
    expect(screen.getByRole('button', { name: 'Show layer AD' })).toBeInTheDocument();

    // "Only" on MC: AD stays hidden, No layer becomes hidden, MC shows.
    fireEvent.click(screen.getByTitle('Show only "MC" and hide every other layer'));
    await waitFor(() => {
      expect(rowsIn('')[0].getAttribute('data-hidden')).toBe('true');
    });
    expect(rowsIn('MC')[0].getAttribute('data-hidden')).toBe('false');

    const saved = JSON.parse(window.localStorage.getItem(VISIBILITY_STORAGE_KEY) ?? '{}');
    expect(saved.hiddenLayers.sort()).toEqual(['', 'AD']);

    // Show all clears every hide.
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => {
      expect(rowsIn('AD').every((r) => r.getAttribute('data-hidden') === 'false')).toBe(true);
    });
  });

  it('hiding one polygon only affects that polygon and clicking its name reveals it again', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByText('AD Deep East');

    fireEvent.click(screen.getByRole('button', { name: 'Hide polygon AD Deep East' }));
    await waitFor(() => {
      expect(rowsIn('AD')[0].getAttribute('data-hidden')).toBe('true');
    });
    expect(rowsIn('AD')[1].getAttribute('data-hidden')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'AD Deep East' }));
    await waitFor(() => {
      expect(rowsIn('AD')[0].getAttribute('data-hidden')).toBe('false');
    });
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

  it('postcode boundaries can be switched off and on from the toolbar', async () => {
    renderWithProviders(<PolygonBuilder />);
    const btn = await screen.findByRole('button', { name: /Hide postcode boundaries/ });
    fireEvent.click(btn);
    await screen.findByRole('button', { name: /Show postcode boundaries/ });
    expect(JSON.parse(window.localStorage.getItem(VISIBILITY_STORAGE_KEY) ?? '{}').showPostcodes).toBe(false);
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

  it('P in view mode starts point drawing', async () => {
    renderWithProviders(<PolygonBuilder />);
    await screen.findByRole('button', { name: /View Zones/ });
    fireEvent.keyDown(window, { key: 'p' });
    await waitFor(() => expect(document.body.textContent).toMatch(/Click to add points/));
  });
});
