import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { quoteService } from './quoteService';

describe('quoteService', () => {
  it('getSets GETs /quote/sets', async () => {
    server.use(
      http.get('/api/quote/sets', () =>
        HttpResponse.json({ response: [{ quoteSetCode: 'Q1', jobCount: 5, lastUploadedUtc: null }] })),
    );
    const r = await quoteService.getSets();
    expect(r.response[0].quoteSetCode).toBe('Q1');
  });

  it('upload POSTs /quote/upload', async () => {
    let seen: any;
    server.use(
      http.post('/api/quote/upload', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: { quoteSetCode: 'Q1', rowsUploaded: 2 } });
      }),
    );
    const r = await quoteService.upload({ quoteSetCode: 'Q1', rows: [] });
    expect(seen).toEqual({ quoteSetCode: 'Q1', rows: [] });
    expect(r.response.rowsUploaded).toBe(2);
  });

  it('simulate POSTs /quote/simulate', async () => {
    server.use(
      http.post('/api/quote/simulate', () =>
        HttpResponse.json({ response: {
          quoteSetCode: 'Q1', jobCount: 100, driversRequired: 5, avgShiftHours: 8,
          costPerJob: 3, costPerKm: 1, totalCost: 300, marginPct: 20, recommendedQuote: 400,
        } })),
    );
    const r = await quoteService.simulate({
      quoteSetCode: 'Q1', rateCard: 'std', serviceLevel: 'A',
      maxStopsPerRun: 40, targetUtilisationPct: 80,
    });
    expect(r.response.recommendedQuote).toBe(400);
  });

  it('deleteSet DELETEs /quote/sets/:code (URL-encoded)', async () => {
    let path: string | null = null; let method: string | null = null;
    server.use(
      http.delete('/api/quote/sets/:code', ({ request }) => {
        path = new URL(request.url).pathname;
        method = request.method;
        return HttpResponse.json({ response: { quoteSetCode: 'Q 1', deleted: 5 } });
      }),
    );
    const r = await quoteService.deleteSet('Q 1');
    expect(method).toBe('DELETE');
    expect(path).toBe('/api/quote/sets/Q%201');
    expect(r.response.deleted).toBe(5);
  });
});
