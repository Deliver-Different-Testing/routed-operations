import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { runService, type InsertOrUpdateRunBody } from './runService';

const runStub: InsertOrUpdateRunBody = {
  id: null, name: 'R1', mins: 0, kms: 0, status: 1, revenue: 0, payout: 0,
  courier: null, courierPercent: null, googleRouteResponse: null, jobs: [],
};

describe('runService', () => {
  it('getRuns GETs /runs with CSV filter serialisation', async () => {
    let seen!: URL;
    server.use(
      http.get('/api/runs', ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json({ response: [], maxJsonLength: 0 });
      }),
    );
    await runService.getRuns({
      date: '2026-08-13', clientIds: [1, 2], regionIds: [3], ourRefs: ['R'], speeds: [10],
    });
    expect(seen.searchParams.get('date')).toBe('2026-08-13');
    expect(seen.searchParams.get('clientIds')).toBe('1,2');
    expect(seen.searchParams.get('speeds')).toBe('10');
  });

  it('insertOrUpdate POSTs /runs with the body', async () => {
    let method: string | null = null; let seen: unknown;
    server.use(
      http.post('/api/runs', async ({ request }) => {
        method = request.method;
        seen = await request.json();
        return HttpResponse.json({ response: { result: 'ok', message: 'saved' } });
      }),
    );
    await runService.insertOrUpdate(runStub);
    expect(method).toBe('POST');
    expect((seen as InsertOrUpdateRunBody).name).toBe('R1');
  });

  it('update PUTs /runs/:id', async () => {
    let method: string | null = null;
    server.use(
      http.put('/api/runs/:id', ({ request, params }) => {
        method = request.method;
        expect(params.id).toBe('5');
        return HttpResponse.json({ response: { result: 'ok', message: 'ok' } });
      }),
    );
    await runService.update(5, runStub);
    expect(method).toBe('PUT');
  });

  it('remove DELETEs /runs/:id', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/runs/:id', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: { result: 'ok', message: 'ok' } });
      }),
    );
    await runService.remove(9);
    expect(method).toBe('DELETE');
  });

  it('assignJob POSTs /runs/:runId/assign with { jobId, fromRunId, runId }', async () => {
    let seen: unknown;
    server.use(
      http.post('/api/runs/:runId/assign', async ({ request, params }) => {
        expect(params.runId).toBe('1');
        seen = await request.json();
        return HttpResponse.json({ response: { result: 'ok', message: 'ok' } });
      }),
    );
    await runService.assignJob(1, 42, 7);
    expect(seen).toEqual({ jobId: 42, fromRunId: 7, runId: 1 });
  });

  it('removeJob DELETEs /runs/jobs/:jobId', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/runs/jobs/:jobId', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: { result: 'ok', message: 'ok' } });
      }),
    );
    await runService.removeJob(3);
    expect(method).toBe('DELETE');
  });

  it('setJobStartEnd POSTs /runs/:runId/jobs/:jobId/start-end with { isStart, isEnd }', async () => {
    let seen: any;
    server.use(
      http.post('/api/runs/:runId/jobs/:jobId/start-end', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: { result: 'ok', message: 'ok' } });
      }),
    );
    await runService.setJobStartEnd(1, 2, { isStart: true });
    expect(seen).toEqual({ isStart: true, isEnd: undefined });
  });

  it('dispatch POSTs /runs/dispatch with { runs }', async () => {
    let seen: any;
    server.use(
      http.post('/api/runs/dispatch', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: [{ result: 'ok', message: null }] });
      }),
    );
    await runService.dispatch([runStub]);
    expect(seen.runs.length).toBe(1);
  });

  it('dispatchJobs POSTs /runs/dispatch-jobs with status:1', async () => {
    let seen: any;
    server.use(
      http.post('/api/runs/dispatch-jobs', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: [{ result: 'ok', message: null }] });
      }),
    );
    await runService.dispatchJobs([1, 2], 5, 'RN');
    expect(seen).toEqual({ jobIds: [1, 2], courierId: 5, runName: 'RN', status: 1 });
  });
});
