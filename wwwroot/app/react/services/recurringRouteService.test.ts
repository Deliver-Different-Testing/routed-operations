import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { recurringRouteService } from './recurringRouteService';

const routeStub = {
  routeId: 1, name: 'R1', area: 'AKL', defaultTargetType: null, defaultTargetId: null,
  defaultTargetName: '', scheduleId: null, scheduleName: '', scheduleWindow: '',
  schedules: [], active: true, zipcodes: [], bulkPolygons: [], rosterEntryCount: 0,
  bookingCount: 0, mappedStopsCount: 0, createdAt: '2026-08-13', updatedAt: null,
};

describe('recurringRouteService', () => {
  it('list GETs /recurring-routes', async () => {
    server.use(
      http.get('/api/recurring-routes', () => HttpResponse.json({ response: [routeStub] })),
    );
    const r = await recurringRouteService.list();
    expect(r.response[0].routeId).toBe(1);
  });

  it('get GETs /recurring-routes/:id', async () => {
    server.use(
      http.get('/api/recurring-routes/:id', ({ params }) => {
        expect(params.id).toBe('7');
        return HttpResponse.json({ response: routeStub });
      }),
    );
    await recurringRouteService.get(7);
  });

  it('create POSTs /recurring-routes', async () => {
    let seen: any;
    server.use(
      http.post('/api/recurring-routes', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: routeStub });
      }),
    );
    await recurringRouteService.create({
      name: 'R1', area: 'AKL', defaultTargetType: null, defaultTargetId: null,
      scheduleIds: [], active: true, zipPolygonIds: [],
    });
    expect(seen.name).toBe('R1');
  });

  it('update PUTs /recurring-routes/:id', async () => {
    let method: string | null = null;
    server.use(
      http.put('/api/recurring-routes/:id', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: routeStub });
      }),
    );
    await recurringRouteService.update(1, {
      name: 'R1', area: 'AKL', defaultTargetType: null, defaultTargetId: null,
      scheduleIds: [], active: true, zipPolygonIds: [],
    });
    expect(method).toBe('PUT');
  });

  it('copy POSTs /recurring-routes/:sourceId/copy', async () => {
    server.use(
      http.post('/api/recurring-routes/:sourceId/copy', ({ params }) => {
        expect(params.sourceId).toBe('4');
        return HttpResponse.json({ response: routeStub });
      }),
    );
    await recurringRouteService.copy(4, { name: 'R2', copyZipcodes: true });
  });

  it('remove DELETEs /recurring-routes/:id', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/recurring-routes/:id', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    await recurringRouteService.remove(1);
    expect(method).toBe('DELETE');
  });

  it('getBookings GETs /recurring-routes/:id/bookings', async () => {
    server.use(
      http.get('/api/recurring-routes/:id/bookings', () => HttpResponse.json({ response: [] })),
    );
    const r = await recurringRouteService.getBookings(1);
    expect(r.response).toEqual([]);
  });

  it('getRoster GETs /recurring-routes/:id/roster', async () => {
    server.use(
      http.get('/api/recurring-routes/:id/roster', () => HttpResponse.json({ response: [] })),
    );
    await recurringRouteService.getRoster(1);
  });

  it('addRoster POSTs /recurring-routes/:id/roster', async () => {
    let seen: any;
    server.use(
      http.post('/api/recurring-routes/:id/roster', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: { routeRosterId: 1, routeId: 1, targetType: 1, targetId: 2, targetName: 'x', rosterDate: null, dayOfWeek: 1, isActive: true, createdAt: '2026-08-13' } });
      }),
    );
    await recurringRouteService.addRoster(1, { targetType: 1, targetId: 2, dayOfWeek: 1 });
    expect(seen).toEqual({ targetType: 1, targetId: 2, dayOfWeek: 1 });
  });

  it('removeRoster DELETEs /recurring-routes/:id/roster/:rosterId', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/recurring-routes/:id/roster/:rosterId', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    await recurringRouteService.removeRoster(1, 2);
    expect(method).toBe('DELETE');
  });

  it('searchZipcodes GETs /recurring-routes/zipcodes/search with q + max', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ response: [] });
      }),
    );
    await recurringRouteService.searchZipcodes('1010', 10);
    expect(seenUrl.searchParams.get('q')).toBe('1010');
    expect(seenUrl.searchParams.get('max')).toBe('10');
  });

  it('searchZipcodes defaults max to 25', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/recurring-routes/zipcodes/search', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ response: [] });
      }),
    );
    await recurringRouteService.searchZipcodes('101');
    expect(seenUrl.searchParams.get('max')).toBe('25');
  });

  it('getAllZipcodeCentroids GETs /recurring-routes/zipcodes/centroids', async () => {
    server.use(
      http.get('/api/recurring-routes/zipcodes/centroids', () => HttpResponse.json({ response: [] })),
    );
    await recurringRouteService.getAllZipcodeCentroids();
  });

  it('getPolygonShapes POSTs /recurring-routes/zipcodes/shapes with the id array', async () => {
    let seen: any;
    server.use(
      http.post('/api/recurring-routes/zipcodes/shapes', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: [] });
      }),
    );
    await recurringRouteService.getPolygonShapes([1, 2, 3]);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('getAssignableTargets GETs /recurring-routes/assignable-targets', async () => {
    server.use(
      http.get('/api/recurring-routes/assignable-targets', () =>
        HttpResponse.json({ response: { couriers: [], agents: [], nps: [] } })),
    );
    const r = await recurringRouteService.getAssignableTargets();
    expect(r.response).toEqual({ couriers: [], agents: [], nps: [] });
  });

  it('getSchedules GETs /recurring-routes/schedules/lookup', async () => {
    server.use(
      http.get('/api/recurring-routes/schedules/lookup', () => HttpResponse.json({ response: [] })),
    );
    await recurringRouteService.getSchedules();
  });
});
