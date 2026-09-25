import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { speedService } from './speedService';

describe('speedService', () => {
  it('getForRunDate GETs /speeds?runDate=', async () => {
    let seen!: URL;
    server.use(
      http.get('/api/speeds', ({ request }) => {
        seen = new URL(request.url);
        return HttpResponse.json([{ speedId: 1, name: 'CORT' }]);
      }),
    );
    const r = await speedService.getForRunDate('2026-08-13');
    expect(seen.searchParams.get('runDate')).toBe('2026-08-13');
    expect(r).toEqual([{ speedId: 1, name: 'CORT' }]);
  });

  it('getAll GETs /speeds/all', async () => {
    server.use(
      http.get('/api/speeds/all', () => HttpResponse.json([{ id: 2, label: 'BULK' }])),
    );
    const r = await speedService.getAll();
    expect(r[0].id).toBe(2);
  });
});
