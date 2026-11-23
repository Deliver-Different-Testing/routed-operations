import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import {
  bulkPolygonService, formatOverlapPct, parsePartiallyIncludedZips, savedZipsToastTrailer, splitFocusSelection, splitTouchedZips,
} from './bulkPolygonService';

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

// Touched postcodes spec 4.3: the operator must see every postcode booking
// assesses, slivers included, with the biggest partial overlaps first.
describe('splitTouchedZips', () => {
  it('returns empty groups for null / undefined / []', () => {
    expect(splitTouchedZips(undefined)).toEqual({ full: [], partial: [] });
    expect(splitTouchedZips(null)).toEqual({ full: [], partial: [] });
    expect(splitTouchedZips([])).toEqual({ full: [], partial: [] });
  });

  it('splits on isFull and orders partly covered by overlap descending, slivers kept', () => {
    // Polygon 30 "Cambridge to Tirau Corridor" on Urgent prod, 16 Nov, plus one full row.
    const { full, partial } = splitTouchedZips([
      { zip: '3494', isFull: false, overlapPct: 8.31 },
      { zip: '3495', isFull: false, overlapPct: 0.01 },
      { zip: '3410', isFull: false, overlapPct: 12.33 },
      { zip: '3200', isFull: true, overlapPct: 100 },
      { zip: '3484', isFull: false, overlapPct: 12.13 },
      { zip: '3100', isFull: true, overlapPct: 99.27 },
    ]);
    expect(full).toEqual(['3100', '3200']);
    expect(partial.map((z) => z.zip)).toEqual(['3410', '3484', '3494', '3495']);
  });

  it('breaks equal overlaps by zip so the order is stable', () => {
    const { partial } = splitTouchedZips([
      { zip: '3496', isFull: false, overlapPct: 4.21 },
      { zip: '3434', isFull: false, overlapPct: 4.21 },
    ]);
    expect(partial.map((z) => z.zip)).toEqual(['3434', '3496']);
  });
});

describe('formatOverlapPct', () => {
  it('shows the stored two decimals without trailing zeros', () => {
    expect(formatOverlapPct(8.31)).toBe('8.31%');
    expect(formatOverlapPct(12.3)).toBe('12.3%');
    expect(formatOverlapPct(0.01)).toBe('0.01%');
    expect(formatOverlapPct(50)).toBe('50%');
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

  it('list sends each app as a repeated app= query parameter, none when empty', async () => {
    const seen: string[] = [];
    server.use(
      http.get('/api/bulk-polygons', ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ response: [stub] });
      }),
    );
    await bulkPolygonService.list({ app: ['SCHEDULES', 'ROUTES'] });
    await bulkPolygonService.list({ app: [] });
    expect(seen).toEqual(['?app=SCHEDULES&app=ROUTES', '']);
  });

  it('setAppsBulk PUTs /bulk-polygons/apps with ids, add and remove', async () => {
    let body: unknown;
    server.use(
      http.put('/api/bulk-polygons/apps', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ response: { updated: 2, perimeterChanged: true } });
      }),
    );
    const r = await bulkPolygonService.setAppsBulk([3, 4], ['PERIMETER']);
    expect(body).toEqual({ polygonIds: [3, 4], add: ['PERIMETER'], remove: [] });
    expect(r.response).toEqual({ updated: 2, perimeterChanged: true });
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

describe('splitFocusSelection', () => {
  it('selects fully covered zips and keeps partly covered ones shown only', () => {
    const resolved = [{ zip: '2102', id: 1 }, { zip: '3494', id: 2 }, { zip: '3495', id: 3 }];
    const { selected, shownOnly } = splitFocusSelection(resolved, ['3494', '3495']);
    expect(selected.map((z) => z.zip)).toEqual(['2102']);
    expect(shownOnly.map((z) => z.zip)).toEqual(['3494', '3495']);
  });

  it('selects everything when there are no partly covered zips (zones drawer, packed list)', () => {
    const resolved = [{ zip: '3410' }, { zip: '3484' }];
    expect(splitFocusSelection(resolved, [])).toEqual({ selected: resolved, shownOnly: [] });
  });
});

describe('savedZipsToastTrailer', () => {
  it('counts every touched postcode, not the >= 10% packed list', () => {
    const polygon = {
      partiallyIncludedZips: '3410,3484',
      touchedZips: [
        { zip: '3410', isFull: false, overlapPct: 12.33 }, { zip: '3484', isFull: false, overlapPct: 12.13 },
        { zip: '3494', isFull: false, overlapPct: 8.31 }, { zip: '3496', isFull: false, overlapPct: 4.21 },
        { zip: '3434', isFull: false, overlapPct: 2.5 }, { zip: '3432', isFull: false, overlapPct: 0.03 },
        { zip: '3495', isFull: false, overlapPct: 0.01 },
      ],
    };
    expect(savedZipsToastTrailer(polygon))
      .toBe(' Fully covers 0, partly covers 7: 3410, 3484, 3494, 3496, 3434, 3432, +1 more.');
  });

  it('lists fully covered postcodes first', () => {
    expect(savedZipsToastTrailer({ partiallyIncludedZips: null, touchedZips: [
      { zip: '2104', isFull: false, overlapPct: 40 }, { zip: '2102', isFull: true, overlapPct: 100 },
    ] })).toBe(' Fully covers 1, partly covers 1: 2102, 2104.');
  });

  it('falls back to the packed list when the response has no touched rows', () => {
    expect(savedZipsToastTrailer({ partiallyIncludedZips: '3410,3484' }))
      .toBe(' Derived 2 postcodes: 3410, 3484.');
    expect(savedZipsToastTrailer({ partiallyIncludedZips: null, touchedZips: [] }))
      .toBe(' (no overlapping postcodes)');
  });
});
