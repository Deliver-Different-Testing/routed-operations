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

describe('PolygonBuilder - ZonesDrawer', () => {
  it('opens and closes the drawer', async () => {
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
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    // Close via the "X" close button in the drawer header.
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clicking a zone row focuses those zips (loads shapes + selects)', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', () =>
        HttpResponse.json({
          response: [
            { zipPolygonId: 10, zip: '1010', latitude: -36.85, longitude: 174.76 },
            { zipPolygonId: 11, zip: '1011', latitude: -36.86, longitude: 174.77 },
          ],
        }),
      ),
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
      http.post('/api/recurring-routes/zipcodes/shapes', () =>
        HttpResponse.json({
          response: [
            {
              zipPolygonId: 10, zip: '1010', latitude: -36.85, longitude: 174.76,
              wkt: 'POLYGON((174.76 -36.85, 174.77 -36.85, 174.77 -36.86, 174.76 -36.85))',
            },
            {
              zipPolygonId: 11, zip: '1011', latitude: -36.86, longitude: 174.77,
              wkt: 'POLYGON((174.77 -36.86, 174.78 -36.86, 174.78 -36.87, 174.77 -36.86))',
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    // Wait for centroids to be ready so the zip-to-lookup map can resolve.
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/of 2 postal codes in view/),
    );
    fireEvent.click(await screen.findByRole('button', { name: /View Zones/ }));
    // Click the zone row div directly (role=button but accessible name uses
    // the title attr; multiple queries fight it, so we grab by title).
    const zoneRow = await screen.findByTitle(/Focus the 2 postcodes in this zone on the map/);
    fireEvent.click(zoneRow);
    await waitFor(() =>
      expect((document.body.textContent ?? '').toLowerCase()).toMatch(/selected postal codes\s*\(2\)/),
    );
  });

  it('drawer surfaces empty-payload message when tenant has no zones', async () => {
    // Base handler returns [], so no depots. Opening the drawer surfaces the
    // "No rating geography configured" branch.
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /View Zones/ }));
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/No rating geography configured/i),
    );
  });

  it('drawer surfaces show-map error when clicked with no resolvable zips', async () => {
    server.use(
      http.get('/api/zones/rating-postcodes', () =>
        HttpResponse.json({
          response: [
            {
              countryCode: 'NZ',
              depotId: 1,
              depotName: 'Auckland Depot',
              postcodeCount: 1,
              groups: [
                {
                  groupId: 100,
                  groupName: 'Metro',
                  zoneName: null,
                  postcodeCount: 1,
                  zones: [{ zone: 1, postcodes: ['99999'] }],
                },
              ],
            },
          ],
        }),
      ),
    );
    renderWithProviders(<PolygonBuilder />);
    fireEvent.click(await screen.findByRole('button', { name: /View Zones/ }));
    const zoneRow = await screen.findByTitle(/Focus the 1 postcode in this zone on the map/);
    fireEvent.click(zoneRow);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Could not resolve/i),
    );
  });
});
