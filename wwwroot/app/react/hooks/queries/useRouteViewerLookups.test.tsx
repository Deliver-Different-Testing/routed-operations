import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../../test/server';
import { useRouteViewerLookups } from './useRouteViewerLookups';
import { AuthProvider } from '../../context/AuthContext';
import type { ReactNode } from 'react';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

describe('useRouteViewerLookups', () => {
  it('flows from loading to success and returns the 3 lookups', async () => {
    server.use(
      http.get('/api/runviewer/filters/clients', () =>
        HttpResponse.json({ response: [{ id: 1, label: 'ACME' }] })),
      http.get('/api/runviewer/filters/regions', () =>
        HttpResponse.json({ response: [{ id: 2, label: 'AKL' }] })),
      http.get('/api/runviewer/filters/speeds', () =>
        HttpResponse.json({ response: [{ id: 3, label: 'CORT' }] })),
    );
    const { result } = renderHook(() => useRouteViewerLookups('2026-08-13'), { wrapper: makeWrapper() });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.clients).toEqual([{ id: 1, label: 'ACME' }]);
    expect(result.current.regions).toEqual([{ id: 2, label: 'AKL' }]);
    expect(result.current.speeds).toEqual([{ id: 3, label: 'CORT' }]);
    expect(result.current.errors).toEqual([]);
  });

  it('derives clientInternal / multipleClients from auth defaults (no window.__APP_USER__ overrides in this test)', async () => {
    server.use(
      http.get('/api/runviewer/filters/clients', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/filters/regions', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/filters/speeds', () => HttpResponse.json({ response: [] })),
    );
    const { result } = renderHook(() => useRouteViewerLookups('2026-08-13'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // Default test AppUser has clientTypeId=null and clientCount=null.
    expect(result.current.clientInternal).toBe(false);
    expect(result.current.multipleClients).toBe(false);
  });

  it('is disabled when runDate is empty (returns empty arrays, no fetch)', () => {
    // No handlers registered on purpose - if the queries fired MSW would 500.
    const { result } = renderHook(() => useRouteViewerLookups(''), { wrapper: makeWrapper() });
    expect(result.current.clients).toEqual([]);
    expect(result.current.regions).toEqual([]);
    expect(result.current.speeds).toEqual([]);
  });

  it('is disabled when the enabled flag is false', () => {
    const { result } = renderHook(() => useRouteViewerLookups('2026-08-13', false), {
      wrapper: makeWrapper(),
    });
    expect(result.current.clients).toEqual([]);
    expect(result.current.regions).toEqual([]);
    expect(result.current.speeds).toEqual([]);
  });

  it('surfaces errors when a lookup call fails', async () => {
    server.use(
      http.get('/api/runviewer/filters/clients', () =>
        new HttpResponse('nope', { status: 500 })),
      http.get('/api/runviewer/filters/regions', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/filters/speeds', () => HttpResponse.json({ response: [] })),
    );
    const { result } = renderHook(() => useRouteViewerLookups('2026-08-13'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.errors.length).toBeGreaterThan(0));
  });
});
