import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { zoneService } from './zoneService';

describe('zoneService', () => {
  it('getRatingZones GETs /zones/rating-postcodes and returns { response }', async () => {
    server.use(
      http.get('/api/zones/rating-postcodes', () =>
        HttpResponse.json({ response: [{
          countryCode: 'NZ', depotId: 1, depotName: 'AKL', postcodeCount: 3,
          groups: [{ groupId: null, groupName: 'g', zoneName: null, postcodeCount: 3, zones: [] }],
        }] })),
    );
    const r = await zoneService.getRatingZones();
    expect(r.response[0].countryCode).toBe('NZ');
  });

  it('propagates server errors', async () => {
    server.use(
      http.get('/api/zones/rating-postcodes', () => new HttpResponse('bad', { status: 500 })),
    );
    await expect(zoneService.getRatingZones()).rejects.toThrow();
  });
});
