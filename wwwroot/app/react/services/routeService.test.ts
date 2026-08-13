import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { routeService } from './routeService';

const stop = { name: 'A', lat: 1, lng: 2 };

describe('routeService', () => {
  it('optimize POSTs /routes/optimize with the waypoints', async () => {
    let seen: any;
    server.use(
      http.post('/api/routes/optimize', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ routes: [] });
      }),
    );
    await routeService.optimize([{ name: 'A', latitude: 1, longitude: 2, visitDurationInMinutes: 5 }]);
    expect(seen).toEqual([{ name: 'A', latitude: 1, longitude: 2, visitDurationInMinutes: 5 }]);
  });

  it('optimizeWithName POSTs /routes/optimize-with-name', async () => {
    let method: string | null = null;
    server.use(
      http.post('/api/routes/optimize-with-name', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ routes: [] });
      }),
    );
    await routeService.optimizeWithName([]);
    expect(method).toBe('POST');
  });

  it('hereSequence POSTs /routes/here-sequence with { requestData }', async () => {
    let seen: any;
    server.use(
      http.post('/api/routes/here-sequence', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({});
      }),
    );
    await routeService.hereSequence('raw-body');
    expect(seen).toEqual({ requestData: 'raw-body' });
  });

  it('hereSequenceTyped POSTs typed body with defaults', async () => {
    let seen: any;
    server.use(
      http.post('/api/routes/here-sequence-typed', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ orderedWaypointIds: [], orderedNames: [], totalMinutes: 0, legMinutes: [] });
      }),
    );
    await routeService.hereSequenceTyped(stop, [stop]);
    expect(seen).toEqual({ start: stop, destinations: [stop], returnToStart: false, finishAtName: null });
  });

  it('hereSequenceTyped honours opts.returnToStart + finishAtName', async () => {
    let seen: any;
    server.use(
      http.post('/api/routes/here-sequence-typed', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ orderedWaypointIds: [], orderedNames: [], totalMinutes: 0, legMinutes: [] });
      }),
    );
    await routeService.hereSequenceTyped(stop, [stop], { returnToStart: true, finishAtName: 'B' });
    expect(seen.returnToStart).toBe(true);
    expect(seen.finishAtName).toBe('B');
  });

  it('polyline POSTs /routes/polyline with { stops }', async () => {
    let seen: any;
    server.use(
      http.post('/api/routes/polyline', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ points: [] });
      }),
    );
    await routeService.polyline([stop, stop]);
    expect(seen).toEqual({ stops: [stop, stop] });
  });
});
