import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { bulkPolygonService, parsePartiallyIncludedZips } from './bulkPolygonService';

const stub = {
  polygonId: 1, name: 'p', sourceType: 0, sourceCode: null,
  centroidLatitude: 0, centroidLongitude: 0, active: true, points: [],
  attachedRouteCount: 0, attachedRoutes: [], partiallyIncludedZips: null,
  createdUtc: '2026-08-13', createdBy: 'test', lastModifiedUtc: null, updatedBy: null,
};

describe('parsePartiallyIncludedZips', () => {
  it('returns [] for null / undefined / empty', () => {
    expect(parsePartiallyIncludedZips(null)).toEqual([]);
    expect(parsePartiallyIncludedZips(undefined)).toEqual([]);
    expect(parsePartiallyIncludedZips('')).toEqual([]);
  });

  it('strips sentinel commas + trims whitespace + drops empties', () => {
    expect(parsePartiallyIncludedZips(',1010, 1011 ,1012,')).toEqual(['1010', '1011', '1012']);
  });
});

describe('bulkPolygonService', () => {
  it('list GETs /bulk-polygons', async () => {
    server.use(
      http.get('/api/bulk-polygons', () => HttpResponse.json({ response: [stub] })),
    );
    const r = await bulkPolygonService.list();
    expect(r.response).toEqual([stub]);
  });

  it('get GETs /bulk-polygons/:id', async () => {
    server.use(
      http.get('/api/bulk-polygons/:id', ({ params }) => {
        expect(params.id).toBe('5');
        return HttpResponse.json({ response: stub });
      }),
    );
    const r = await bulkPolygonService.get(5);
    expect(r.response.polygonId).toBe(1);
  });

  it('create POSTs /bulk-polygons with the body', async () => {
    let seen: any;
    server.use(
      http.post('/api/bulk-polygons', async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ response: stub });
      }),
    );
    await bulkPolygonService.create({
      name: 'new', centroidLatitude: 1, centroidLongitude: 2, points: [],
    });
    expect(seen.name).toBe('new');
  });

  it('updateShape PUTs /bulk-polygons/:id/shape', async () => {
    let method: string | null = null;
    server.use(
      http.put('/api/bulk-polygons/:id/shape', ({ request, params }) => {
        method = request.method;
        expect(params.id).toBe('7');
        return HttpResponse.json({ response: stub });
      }),
    );
    await bulkPolygonService.updateShape(7, { centroidLatitude: 0, centroidLongitude: 0, points: [] });
    expect(method).toBe('PUT');
  });

  it('updateMeta PUTs /bulk-polygons/:id', async () => {
    server.use(
      http.put('/api/bulk-polygons/:id', () => HttpResponse.json({ response: stub })),
    );
    const r = await bulkPolygonService.updateMeta(1, { name: 'renamed' });
    expect(r.response.polygonId).toBe(1);
  });

  it('remove DELETEs /bulk-polygons/:id', async () => {
    let method: string | null = null;
    server.use(
      http.delete('/api/bulk-polygons/:id', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const r = await bulkPolygonService.remove(3);
    expect(method).toBe('DELETE');
    expect(r.response).toBe('ok');
  });
});
