import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../../test/server';
import { useCockpitLookups } from './useCockpitLookups';
import type { ReactNode } from 'react';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useCockpitLookups', () => {
  it('reports loading initially then success with all 7 lookups', async () => {
    server.use(
      http.get('/api/regions', () => HttpResponse.json([{ id: 1, name: 'AKL' }])),
      http.get('/api/speeds', ({ request }) => {
        // Only respond to the date-scoped call, not /speeds/all.
        const url = new URL(request.url);
        if (url.searchParams.get('runDate')) return HttpResponse.json([{ id: 10, name: 'CORT' }]);
        return HttpResponse.json([]);
      }),
      http.get('/api/fleets', () => HttpResponse.json({ fleets: [{ fleetId: 5 }] })),
      http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [{ courierId: 9 }] })),
      http.get('/api/jobs/filters/clients', () =>
        HttpResponse.json({ response: { clients: [{ id: 2, label: 'ACME' }] } })),
      http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: ['REF1'] })),
      http.get('/api/vehicle-sizes', () =>
        HttpResponse.json({ response: [{ vehicleSizeId: 3, name: 'Van' }] })),
    );

    const { result } = renderHook(() => useCockpitLookups('2026-08-13'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.regions).toEqual([{ id: 1, name: 'AKL' }]);
    expect(result.current.speeds).toEqual([{ id: 10, name: 'CORT' }]);
    expect(result.current.fleets).toEqual({ fleets: [{ fleetId: 5 }] });
    expect(result.current.couriers).toEqual({ potentialCouriers: [{ courierId: 9 }] });
    expect(result.current.clients).toEqual({ response: { clients: [{ id: 2, label: 'ACME' }] } });
    expect(result.current.ourRefs).toEqual({ ourRefs: ['REF1'] });
    expect(result.current.vehicleSizes).toEqual({ response: [{ vehicleSizeId: 3, name: 'Van' }] });
    expect(result.current.errors).toEqual([]);
  });

  it('reports independent failure - one 500 does not blank the other 6 lookups', async () => {
    server.use(
      http.get('/api/regions', () => HttpResponse.json([{ id: 1, name: 'AKL' }])),
      http.get('/api/speeds', () => HttpResponse.json([{ id: 10, name: 'CORT' }])),
      http.get('/api/fleets', () => new HttpResponse('boom', { status: 500 })),
      http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [] })),
      http.get('/api/jobs/filters/clients', () => HttpResponse.json({ response: { clients: [] } })),
      http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
      http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
    );
    const { result } = renderHook(() => useCockpitLookups('2026-08-13'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.regions).toEqual([{ id: 1, name: 'AKL' }]);
    expect(result.current.errors.length).toBe(1);
    expect(result.current.fleets).toBeUndefined();
  });
});
