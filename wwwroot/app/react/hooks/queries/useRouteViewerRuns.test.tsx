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
