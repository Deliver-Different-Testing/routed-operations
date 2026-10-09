import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../../test/server';
import { useRouteViewerRuns } from './useRouteViewerRuns';
import type { ReactNode } from 'react';

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useRouteViewerRuns', () => {
  it('flows loading -> success and yields the runs array', async () => {
    server.use(
      http.get('/api/runviewer/runs', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('runDate')).toBe('2026-08-13');
        return HttpResponse.json({ response: [{ id: 1, name: 'RUN1' }] });
      }),
    );
    const { result } = renderHook(
      () => useRouteViewerRuns({ runDate: '2026-08-13' }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1, name: 'RUN1' }]);
  });

  it('does not fire when runDate is empty', () => {
    const { result } = renderHook(
      () => useRouteViewerRuns({ runDate: '' }),
      { wrapper: makeWrapper() },
    );
    // enabled=false when runDate empty -> stays idle with no data.
    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
  });

  it('does not fire when the enabled flag is false', () => {
    const { result } = renderHook(
      () => useRouteViewerRuns({ runDate: '2026-08-13' }, false),
      { wrapper: makeWrapper() },
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isFetching).toBe(false);
  });

  // 2026-10-09. These two encode WHY the hook must not carry
  // `placeholderData: keepPreviousData`, not merely that it currently does not.
  // With it, a filter change served the PREVIOUS filter's rows while the new
  // key was in flight, so a depot region showed another city's pickup runs
  // beside a "0 runs" counter until Refresh was pressed. If someone re-adds
  // keepPreviousData to smooth the 25s poll, these fail: the poll refetches the
  // SAME key and never needed it.
  it('clears the run list when the date changes instead of serving the old date', async () => {
    server.use(
      http.get('/api/runviewer/runs', ({ request }) => {
        const runDate = new URL(request.url).searchParams.get('runDate');
        return HttpResponse.json({ response: [{ id: runDate === '2026-10-16' ? 15 : 5, name: runDate ?? '' }] });
      }),
    );
    const { result, rerender } = renderHook(
      ({ runDate }: { runDate: string }) => useRouteViewerRuns({ runDate }),
      { wrapper: makeWrapper(), initialProps: { runDate: '2026-10-15' } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5_000 });
    expect(result.current.data).toEqual([{ id: 5, name: '2026-10-15' }]);

    rerender({ runDate: '2026-10-16' });

    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5_000 });
    expect(result.current.data).toEqual([{ id: 15, name: '2026-10-16' }]);
  });

  it('clears the run list when the region changes instead of serving the old region', async () => {
    server.use(
      http.get('/api/runviewer/runs', ({ request }) => {
        const regionIds = new URL(request.url).searchParams.get('regionIds');
        return HttpResponse.json({ response: [{ id: regionIds === '38' ? 15 : 6, name: regionIds ?? '' }] });
      }),
    );
    const { result, rerender } = renderHook(
      ({ regionIds }: { regionIds: number[] }) => useRouteViewerRuns({ runDate: '2026-10-16', regionIds }),
      { wrapper: makeWrapper(), initialProps: { regionIds: [36] } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5_000 });
    expect(result.current.data).toEqual([{ id: 6, name: '36' }]);

    rerender({ regionIds: [38] });

    expect(result.current.data).toBeUndefined();

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 5_000 });
    expect(result.current.data).toEqual([{ id: 15, name: '38' }]);
  });

  it('propagates errors from the underlying service call', async () => {
    server.use(
      http.get('/api/runviewer/runs', () => new HttpResponse('nope', { status: 500 })),
    );
    const { result } = renderHook(
      () => useRouteViewerRuns({ runDate: '2026-08-13' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
