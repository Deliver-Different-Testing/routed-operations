import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { rateScheduleService } from './rateScheduleService';

describe('rateScheduleService', () => {
  it('getSpeeds GETs /speeds/grouped and returns { data }', async () => {
    server.use(
      http.get('/api/speeds/grouped', () =>
        HttpResponse.json({ response: [{ id: 1, shortName: 'CORT', name: 'Courier', groupingId: 1, groupingName: 'Std' }] })),
    );
    const r = await rateScheduleService.getSpeeds();
    expect(r.data[0].shortName).toBe('CORT');
  });

  it('surfaces server errors', async () => {
    server.use(
      http.get('/api/speeds/grouped', () => new HttpResponse('bad', { status: 500 })),
    );
    await expect(rateScheduleService.getSpeeds()).rejects.toThrow();
  });
});
