import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { vehicleSizeService } from './vehicleSizeService';

describe('vehicleSizeService', () => {
  it('getAll GETs /vehicle-sizes and returns { response }', async () => {
    server.use(
      http.get('/api/vehicle-sizes', () =>
        HttpResponse.json({ response: [{ vehicleSizeId: 1, name: 'Van' }] })),
    );
    const r = await vehicleSizeService.getAll();
    expect(r.response[0].vehicleSizeId).toBe(1);
  });

  it('propagates server errors', async () => {
    server.use(
      http.get('/api/vehicle-sizes', () => new HttpResponse('bad', { status: 500 })),
    );
    await expect(vehicleSizeService.getAll()).rejects.toThrow();
  });
});
