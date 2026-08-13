import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { regionService } from './regionService';

describe('regionService', () => {
  it('getForRunDate GETs /regions?runDate=', async () => {
    let seenUrl!: URL;
    server.use(
      http.get('/api/regions', ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json([{ regionId: 1, name: 'AKL' }]);
      }),
    );
    const r = await regionService.getForRunDate('2026-08-13');
    expect(seenUrl.searchParams.get('runDate')).toBe('2026-08-13');
    expect(r).toEqual([{ regionId: 1, name: 'AKL' }]);
  });

  it('propagates server errors', async () => {
    server.use(
      http.get('/api/regions', () => new HttpResponse('bad', { status: 500 })),
    );
    await expect(regionService.getForRunDate('2026-08-13')).rejects.toThrow();
  });
});
