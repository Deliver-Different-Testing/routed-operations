import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { jobService } from './jobService';

describe('jobService', () => {
  it('getBulkJobs GETs /jobs with filters serialized as CSV', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/jobs', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ bulkJobs: [], maxJsonLength: 0 });
      }),
    );
    await jobService.getBulkJobs({
      date: '2026-08-13', clientIds: [1, 2], regionIds: [3], ourRefs: ['R1'], speeds: [10],
    });
    expect(seenUrl.searchParams.get('date')).toBe('2026-08-13');
    expect(seenUrl.searchParams.get('clientIds')).toBe('1,2');
    expect(seenUrl.searchParams.get('regionIds')).toBe('3');
    expect(seenUrl.searchParams.get('ourRefs')).toBe('R1');
    expect(seenUrl.searchParams.get('speeds')).toBe('10');
  });

  it('getClientFilters GETs /jobs/filters/clients', async () => {
    server.use(
      http.get('/api/jobs/filters/clients', () =>
        HttpResponse.json({ response: { clients: [{ id: 1, label: 'A' }] } })),
    );
    const r = await jobService.getClientFilters();
    expect(r.response.clients[0].id).toBe(1);
  });

  it('getOurRefs GETs /jobs/filters/refs?runDate=', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/jobs/filters/refs', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({ ourRefs: ['R1'] });
      }),
    );
    const r = await jobService.getOurRefs('2026-08-13');
    expect(seenUrl.searchParams.get('runDate')).toBe('2026-08-13');
    expect(r.ourRefs).toEqual(['R1']);
  });

  it('getMultiboxChildren GETs /jobs/:parentId/multibox-children', async () => {
    server.use(
      http.get('/api/jobs/:parentJobId/multibox-children', ({ params }) => {
        expect(params.parentJobId).toBe('99');
        return HttpResponse.json({ response: [100, 101] });
      }),
    );
    const r = await jobService.getMultiboxChildren(99);
    expect(r.response).toEqual([100, 101]);
  });

  it('getDetail GETs /jobs/:id/detail', async () => {
    server.use(
      http.get('/api/jobs/:id/detail', ({ params }) => {
        expect(params.id).toBe('7');
        return HttpResponse.json({
          bulkJobId: 7, notes: 'n', trackingEmail: null, trackingMobile: null,
          proofOfDeliveryEmail: null, proofOfDeliveryMobile: null,
        });
      }),
    );
    const r = await jobService.getDetail(7);
    expect(r.bulkJobId).toBe(7);
  });

  it('updateDetail PATCHes /jobs/:id with { jobId, field, value }', async () => {
    let seen: any; let method: string | null = null;
    server.use(
      http.patch('/api/jobs/:id', async ({ request }) => {
        method = request.method;
        seen = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    await jobService.updateDetail(3, 'notes', 'hello');
    expect(method).toBe('PATCH');
    expect(seen).toEqual({ jobId: 3, field: 'notes', value: 'hello' });
  });

  it('updateGps PATCHes /jobs/:id/gps with the coord payload', async () => {
    let seen: any;
    server.use(
      http.patch('/api/jobs/:id/gps', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    await jobService.updateGps(3, '10 Queen', '-36.8', '174.7', '1010');
    expect(seen).toEqual({ jobId: 3, address: '10 Queen', lat: '-36.8', lng: '174.7', postCode: '1010' });
  });

  it('bulkMove POSTs /jobs/bulk-move', async () => {
    let seen: any;
    server.use(
      http.post('/api/jobs/bulk-move', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    await jobService.bulkMove([1, 2], '2026-08-14', 'R1');
    expect(seen).toEqual({ jobIds: [1, 2], newDate: '2026-08-14', runName: 'R1' });
  });

  it('void POSTs /jobs/void', async () => {
    let seen: any;
    server.use(
      http.post('/api/jobs/void', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    await jobService.void([1], true, '2026-08-14');
    expect(seen).toEqual({ jobIds: [1], isVoid: true, runDate: '2026-08-14' });
  });

  it('syncHd POSTs /jobs/sync-hd?runDate=', async () => {
    let seenUrl!: URL; let method: string | null = null;
    server.use(
      http.post('/api/jobs/sync-hd', ({ request }) => {
        seenUrl = new URL(request.url);
        method = request.method;
        return HttpResponse.json({ response: { result: 'ok', message: null } });
      }),
    );
    await jobService.syncHd('2026-08-13');
    expect(method).toBe('POST');
    expect(seenUrl.searchParams.get('runDate')).toBe('2026-08-13');
  });
});
