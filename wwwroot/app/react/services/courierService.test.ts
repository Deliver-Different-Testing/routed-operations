import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { courierService } from './courierService';

describe('courierService', () => {
  it('getActive GETs /couriers and returns { potentialCouriers }', async () => {
    server.use(
      http.get('/api/couriers', () =>
        HttpResponse.json({ potentialCouriers: [{ courierId: 1, code: 'C1', name: 'Alpha' }] })),
    );
    const r = await courierService.getActive();
    expect(r.potentialCouriers[0].code).toBe('C1');
  });

  it('getFleets GETs /fleets and returns { fleets }', async () => {
    server.use(
      http.get('/api/fleets', () => HttpResponse.json({ fleets: [{ fleet: 'F3', couriers: [] }] })),
    );
    const r = await courierService.getFleets();
    expect(r.fleets[0].fleet).toBe('F3');
  });

  it('surfaces server errors', async () => {
    server.use(
      http.get('/api/couriers', () => new HttpResponse('bad', { status: 500 })),
    );
    await expect(courierService.getActive()).rejects.toThrow();
  });
});
