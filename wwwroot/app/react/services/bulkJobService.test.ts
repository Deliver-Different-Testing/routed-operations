import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { bulkJobService } from './bulkJobService';

describe('bulkJobService', () => {
  it('listForLinehaulRun GETs a page of /recurring-linehaul-runs/:runId/jobs', async () => {
    const page = { total: 120, page: 1, pageSize: 50, entries: [{ id: 1, source: 'bulk', jobNumber: 'J1' }] };
    server.use(
      http.get('/api/recurring-linehaul-runs/:runId/jobs', ({ params, request }) => {
        expect(params.runId).toBe('42');
        const url = new URL(request.url);
        expect(url.searchParams.get('page')).toBe('1');
        expect(url.searchParams.get('pageSize')).toBe('50');
        // Absent rather than empty when nothing was typed.
        expect(url.searchParams.has('search')).toBe(false);
        return HttpResponse.json({ response: page });
      }),
    );
    const r = await bulkJobService.listForLinehaulRun(42);
    expect(r).toEqual(page);
  });

  it('listForLinehaulRun passes page, pageSize and a trimmed search to the server', async () => {
    // The search has to reach the server: it filters before the paging, so a
    // client-side filter would only ever search the loaded page.
    server.use(
      http.get('/api/recurring-linehaul-runs/:runId/jobs', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('page')).toBe('3');
        expect(url.searchParams.get('pageSize')).toBe('25');
        expect(url.searchParams.get('search')).toBe('KWH57');
        return HttpResponse.json({ response: { total: 0, page: 3, pageSize: 25, entries: [] } });
      }),
    );
    await bulkJobService.listForLinehaulRun(42, 3, 25, '  KWH57  ');
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
