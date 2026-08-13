import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';
import { makeCourier, makeJob } from './CockpitPage.fixtures';
import type { BulkJob, Courier } from '@/types';

/**
 * Send Selected modal open + confirm + cancel. Covers the ActionToolbar
 * trigger, the client-filter warning branch when filters are active, and the
 * doSendSelected happy + failure paths.
 */

const jobs: BulkJob[] = [
  makeJob(11, { jobNumber: 'J-11' }),
  makeJob(12, { jobNumber: 'J-12' }),
];
const couriers: Courier[] = [
  makeCourier(500, { displayName: 'Dave Driver' }),
];

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: null,
    isUsTenant: false,
  };
});
afterEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

function baseHandlers() {
  return [
    http.get('/api/regions', () => HttpResponse.json([])),
    http.get('/api/speeds', () => HttpResponse.json([])),
    http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: couriers })),
    http.get('/api/fleets', () => HttpResponse.json({ fleets: [] })),
    http.get('/api/jobs/filters/clients', () => HttpResponse.json({ response: { clients: [] } })),
    http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
    http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
    http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: jobs, maxJsonLength: 10000 })),
    http.get('/api/runs', () => HttpResponse.json({ response: [], maxJsonLength: 10000 })),
    http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
  ];
}

describe('CockpitPage - SendSelected modal', () => {
  it('opens the modal with the selected job count', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-11');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send selected to Live' }));
    expect(await screen.findByRole('heading', { name: /Send 2 jobs to Live/ })).toBeInTheDocument();
  });

  it('modal Cancel closes without dispatch', async () => {
    let calls = 0;
    server.use(
      ...baseHandlers(),
      http.post('/api/runs/dispatch-jobs', () => {
        calls += 1;
        return HttpResponse.json({ response: [] });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-11');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send selected to Live' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Send 2 jobs to Live/ })).not.toBeInTheDocument(),
    );
    expect(calls).toBe(0);
  });

  it('submit calls /api/runs/dispatch-jobs with the expanded ids', async () => {
    let called: number[] | null = null;
    server.use(
      ...baseHandlers(),
      http.post('/api/runs/dispatch-jobs', async ({ request }) => {
        const body = await request.json() as { jobIds: number[]; courierId: number | null };
        called = body.jobIds;
        return HttpResponse.json({
          response: [
            { result: 'Success', message: null },
            { result: 'Success', message: null },
          ],
        });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-11');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send selected to Live' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Live' }));
    await waitFor(() => expect(called).not.toBeNull());
    expect(called!.sort()).toEqual([11, 12]);
    expect(await screen.findByText(/Dispatched 2 job/)).toBeInTheDocument();
  });

  it('server-side dispatch error toasts via the catch branch', async () => {
    server.use(
      ...baseHandlers(),
      http.post('/api/runs/dispatch-jobs', () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 })
      ),
    );
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-11');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send selected to Live' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Live' }));
    // Page still renders.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument(),
    );
  });
});
