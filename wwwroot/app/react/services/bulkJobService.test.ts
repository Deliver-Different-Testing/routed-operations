import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { bulkJobService } from './bulkJobService';

describe('bulkJobService', () => {
  it('listForLinehaulRun GETs /recurring-linehaul-runs/:runId/jobs and unwraps', async () => {
    server.use(
      http.get('/api/recurring-linehaul-runs/:runId/jobs', ({ params }) => {
        expect(params.runId).toBe('42');
        return HttpResponse.json({ response: [{ id: 1, jobNumber: 'J1' }] });
      }),
    );
    const r = await bulkJobService.listForLinehaulRun(42);
    expect(r).toEqual([{ id: 1, jobNumber: 'J1' }]);
  });

  it('listForRoute GETs /recurring-routes/:routeId/jobs', async () => {
    server.use(
      http.get('/api/recurring-routes/:routeId/jobs', ({ params }) => {
        expect(params.routeId).toBe('7');
        return HttpResponse.json({ response: [] });
      }),
    );
    const r = await bulkJobService.listForRoute(7);
    expect(r).toEqual([]);
  });

  it('getDetail GETs /recurring-jobs/:jobId', async () => {
    server.use(
      http.get('/api/recurring-jobs/:jobId', ({ params }) => {
        expect(params.jobId).toBe('9');
        return HttpResponse.json({ response: { id: 9, jobNumber: 'X', customer: 'Y', statusName: '', pickupAddress: '', dropAddress: '', bookDate: null, bookTime: null, linehaulRunName: null, speedId: 1, speedShortName: '', speedName: '', speedGroupingId: null, speedGroupingName: null, speedEditable: true, notes: null } });
      }),
    );
    const r = await bulkJobService.getDetail(9);
    expect(r.id).toBe(9);
  });

  it('updateSpeed PATCHes /recurring-jobs/:jobId/speed with { speedId }', async () => {
    let seen: any;
    let method: string | null = null;
    server.use(
      http.patch('/api/recurring-jobs/:jobId/speed', async ({ request, params }) => {
        method = request.method;
        expect(params.jobId).toBe('9');
        seen = await request.json();
        return HttpResponse.json({ response: { id: 9, jobNumber: 'X', customer: 'Y', statusName: '', pickupAddress: '', dropAddress: '', bookDate: null, bookTime: null, linehaulRunName: null, speedId: 12, speedShortName: '', speedName: '', speedGroupingId: null, speedGroupingName: null, speedEditable: true, notes: null } });
      }),
    );
    const r = await bulkJobService.updateSpeed(9, 12);
    expect(method).toBe('PATCH');
    expect(seen).toEqual({ speedId: 12 });
    expect(r.speedId).toBe(12);
  });
});
