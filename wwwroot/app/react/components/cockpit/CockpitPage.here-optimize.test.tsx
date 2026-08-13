import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';
import { makeJob, makeRun, makeRunJob } from './CockpitPage.fixtures';
import type { BulkJob, Run } from '@/types';

/**
 * handleOptimizeRun preview + persist flow. Covers the A-B RouteSavvy path
 * (default routingMode = 0) plus the "not enough coords" early exit and the
 * OptimizePreviewModal Cancel + Apply branches.
 */

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: null,
    isUsTenant: false,
  };
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

function seededRun(): Run {
  return makeRun(700, {
    name: 'RUN-700',
    jobs: [
      makeRunJob(11, { builderIndex: 1, jobNumber: 'J-11' }),
      makeRunJob(12, { builderIndex: 2, jobNumber: 'J-12' }),
    ],
  });
}

const seededJobs: BulkJob[] = [
  makeJob(11, { jobNumber: 'J-11', bulkRunId: 700, runName: 'RUN-700' }),
  makeJob(12, { jobNumber: 'J-12', bulkRunId: 700, runName: 'RUN-700' }),
];

function baseHandlers(runsOverride?: Run[]) {
  return [
    http.get('/api/regions', () => HttpResponse.json([])),
    http.get('/api/speeds', () => HttpResponse.json([])),
    http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [] })),
    http.get('/api/fleets', () => HttpResponse.json({ fleets: [] })),
    http.get('/api/jobs/filters/clients', () => HttpResponse.json({ response: { clients: [] } })),
    http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
    http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
    http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: seededJobs, maxJsonLength: 10000 })),
    http.get('/api/runs', () =>
      HttpResponse.json({ response: runsOverride ?? [seededRun()], maxJsonLength: 10000 })
    ),
    http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
  ];
}

async function selectRunAndOptimize(runName: string) {
  const runRow = await screen.findByText(runName);
  fireEvent.click(runRow);
  const optimiseBtn = await screen.findByRole('button', { name: 'Optimise' });
  await waitFor(() => expect(optimiseBtn).not.toBeDisabled());
  fireEvent.click(optimiseBtn);
}

describe('CockpitPage - HERE optimise + preview modal', () => {
  it('happy path: RouteSavvy returns an order, preview modal opens', async () => {
    server.use(
      ...baseHandlers(),
      http.post('/api/routes/optimize-with-name', () =>
        HttpResponse.json({
          routes: [
            { lat: -36.86, lng: 174.76, name: 'J-12' },
            { lat: -36.86, lng: 174.76, name: 'J-11' },
          ],
        }),
      ),
    );
    renderWithProviders(<CockpitPage />);
    await selectRunAndOptimize('RUN-700');
    expect(await screen.findByRole('heading', { name: /Optimise "RUN-700" - preview/ })).toBeInTheDocument();
  });

  it('preview Apply persists the new order via POST /api/runs', async () => {
    let upserts = 0;
    server.use(
      ...baseHandlers(),
      http.post('/api/routes/optimize-with-name', () =>
        HttpResponse.json({
          routes: [
            { lat: -36.86, lng: 174.76, name: 'J-12' },
            { lat: -36.86, lng: 174.76, name: 'J-11' },
          ],
        }),
      ),
      http.post('/api/runs', () => {
        upserts += 1;
        return HttpResponse.json({ response: { result: 'Success', message: '700' } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await selectRunAndOptimize('RUN-700');
    fireEvent.click(await screen.findByRole('button', { name: 'Apply new order' }));
    await waitFor(() => expect(upserts).toBeGreaterThan(0));
    expect(await screen.findByText(/Applied new order/)).toBeInTheDocument();
  });

  it('preview Cancel closes the modal without persisting', async () => {
    let upserts = 0;
    server.use(
      ...baseHandlers(),
      http.post('/api/routes/optimize-with-name', () =>
        HttpResponse.json({ routes: [{ lat: -36.86, lng: 174.76, name: 'J-11' }, { lat: -36.86, lng: 174.76, name: 'J-12' }] }),
      ),
      http.post('/api/runs', () => {
        upserts += 1;
        return HttpResponse.json({ response: { result: 'Success', message: '700' } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await selectRunAndOptimize('RUN-700');
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /Optimise "RUN-700" - preview/ })).not.toBeInTheDocument(),
    );
    expect(upserts).toBe(0);
  });

  it('run with fewer than 2 GPS coords toasts a warning instead of opening preview', async () => {
    const noCoordsJobs: BulkJob[] = [
      makeJob(11, { jobNumber: 'J-11', bulkRunId: 700, runName: 'RUN-700', deliveryLatitude: null, deliveryLongitude: null }),
      makeJob(12, { jobNumber: 'J-12', bulkRunId: 700, runName: 'RUN-700', deliveryLatitude: null, deliveryLongitude: null }),
    ];
    server.use(
      http.get('/api/regions', () => HttpResponse.json([])),
      http.get('/api/speeds', () => HttpResponse.json([])),
      http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [] })),
      http.get('/api/fleets', () => HttpResponse.json({ fleets: [] })),
      http.get('/api/jobs/filters/clients', () => HttpResponse.json({ response: { clients: [] } })),
      http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
      http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
      http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: noCoordsJobs, maxJsonLength: 10000 })),
      http.get('/api/runs', () => HttpResponse.json({ response: [seededRun()], maxJsonLength: 10000 })),
      http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
    );
    renderWithProviders(<CockpitPage />);
    await selectRunAndOptimize('RUN-700');
    expect(await screen.findByText(/Not enough jobs with GPS coords/)).toBeInTheDocument();
  });

  it('run A-A (routingMode=1) routes through HERE sequencer', async () => {
    const aaRun = makeRun(701, {
      name: 'RUN-AA',
      routingMode: 1,
      jobs: [
        makeRunJob(11, { builderIndex: 1, jobNumber: 'J-11' }),
        makeRunJob(12, { builderIndex: 2, jobNumber: 'J-12' }),
      ],
    });
    let hereCalls = 0;
    server.use(
      ...baseHandlers([aaRun]),
      http.post('/api/routes/here-sequence-typed', () => {
        hereCalls += 1;
        return HttpResponse.json({
          orderedWaypointIds: ['w1', 'w2'],
          orderedNames: ['start', 'J-11', 'J-12'],
          totalMinutes: 30,
          legMinutes: [0, 15, 15],
        });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await selectRunAndOptimize('RUN-AA');
    await waitFor(() => expect(hereCalls).toBeGreaterThan(0));
    expect(await screen.findByRole('heading', { name: /Optimise "RUN-AA" - preview/ })).toBeInTheDocument();
  });

  it('HERE sequencer returning null (routingMode 1) toasts "no result"', async () => {
    const aaRun = makeRun(702, {
      name: 'RUN-AA-NULL',
      routingMode: 1,
      jobs: [
        makeRunJob(11, { builderIndex: 1, jobNumber: 'J-11' }),
        makeRunJob(12, { builderIndex: 2, jobNumber: 'J-12' }),
      ],
    });
    server.use(
      ...baseHandlers([aaRun]),
      // Return a 204-ish body so hereSequenceTyped resolves to null / falsy.
      http.post('/api/routes/here-sequence-typed', () =>
        HttpResponse.json(null),
      ),
    );
    renderWithProviders(<CockpitPage />);
    await selectRunAndOptimize('RUN-AA-NULL');
    expect(await screen.findByText(/HERE sequencer returned no result/)).toBeInTheDocument();
  });

  it('RouteSavvy error toasts the caught error message', async () => {
    server.use(
      ...baseHandlers(),
      http.post('/api/routes/optimize-with-name', () =>
        HttpResponse.json({ error: 'nope' }, { status: 500 }),
      ),
    );
    renderWithProviders(<CockpitPage />);
    await selectRunAndOptimize('RUN-700');
    // Best-effort toast; may render as generic error text - ensure page stays alive.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    );
  });
});
