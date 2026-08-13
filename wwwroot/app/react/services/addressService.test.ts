import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { addressService } from './addressService';

describe('addressService', () => {
  it('getSuburbs GETs /address/suburbs and wraps as { response }', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [], suburbs: [
          { id: 1, name: 'Ponsonby', city: 'AKL', postCode: '1011', alias: null },
        ]}),
      ),
    );
    const r = await addressService.getSuburbs();
    expect(r.response.suburbs[0].name).toBe('Ponsonby');
    expect(r.response.success).toBe(true);
  });

  it('getZipCodes GETs /address/zipcodes', async () => {
    server.use(
      http.get('/api/address/zipcodes', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [], zipCodes: [] })),
    );
    const r = await addressService.getZipCodes();
    expect(r.response.zipCodes).toEqual([]);
  });

  it('getRegions GETs /address/regions', async () => {
    server.use(
      http.get('/api/address/regions', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [], regions: [] })),
    );
    const r = await addressService.getRegions();
    expect(r.response.regions).toEqual([]);
  });

  it('getDepots GETs /address/depots/postcodes', async () => {
    server.use(
      http.get('/api/address/depots/postcodes', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [], depots: [] })),
    );
    const r = await addressService.getDepots();
    expect(r.response.depots).toEqual([]);
  });

  it('getZipPolygons GETs /address/zip-polygons', async () => {
    server.use(
      http.get('/api/address/zip-polygons', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [], zones: [] })),
    );
    const r = await addressService.getZipPolygons();
    expect(r.response.zones).toEqual([]);
  });

  it('getLocationsZipCodes GETs /address/locations/zipcodes', async () => {
    server.use(
      http.get('/api/address/locations/zipcodes', () =>
        HttpResponse.json({ messageId: 'x', success: true, messages: [], locations: [] })),
    );
    const r = await addressService.getLocationsZipCodes();
    expect(r.response.locations).toEqual([]);
  });

  it('geocode POSTs /address/geocode with the caller payload', async () => {
    let seenBody: unknown;
    server.use(
      http.post('/api/address/geocode', async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ messageId: 'x', success: true, messages: [], addresses: [] });
      }),
    );
    const r = await addressService.geocode({ addresses: [{ address: '10 Queen St' }] });
    expect(seenBody).toEqual({ addresses: [{ address: '10 Queen St' }] });
    expect(r.response.addresses).toEqual([]);
  });

  it('reverseGeocode GETs /address/reverse-geocode with lat/lng and optional country', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/address/reverse-geocode', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ found: true, lat: -36.8, lng: 174.7 });
      }),
    );
    const r = await addressService.reverseGeocode(-36.8, 174.7, 'NZL');
    expect(seenUrl.searchParams.get('lat')).toBe('-36.8');
    expect(seenUrl.searchParams.get('lng')).toBe('174.7');
    expect(seenUrl.searchParams.get('country')).toBe('NZL');
    expect(r.found).toBe(true);
  });

  it('reverseGeocode omits country when not supplied', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/address/reverse-geocode', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ found: false });
      }),
    );
    await addressService.reverseGeocode(1, 2);
    expect(seenUrl.searchParams.get('country')).toBeNull();
  });

  it('forwardGeocode GETs /address/forward-geocode with address + country', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/address/forward-geocode', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ found: true });
      }),
    );
    const r = await addressService.forwardGeocode('10 Queen St', 'NZL');
    expect(seenUrl.searchParams.get('address')).toBe('10 Queen St');
    expect(seenUrl.searchParams.get('country')).toBe('NZL');
    expect(r.found).toBe(true);
  });

  it('surfaces server error bodies via the fetch wrapper', async () => {
    server.use(
      http.get('/api/address/suburbs', () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 })),
    );
    await expect(addressService.getSuburbs()).rejects.toThrow(/nope/);
  });
});
