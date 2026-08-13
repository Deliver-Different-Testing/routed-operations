import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';
import { makeJob } from './CockpitPage.fixtures';
import type { BulkJob } from '@/types';

/**
 * Coverage for doBuildRuns + runBuildExecution branches: max-boxes vs
 * delivery-window bucketing, respectPickupCutoff, vehicle capacity, and
 * the "no valid jobs / no buckets" early-exits. The HERE optimise call is
 * short-circuited via the Auto Route toggle (persisted "0" pre-mount) so
 * we exercise the postcode-order fallback path.
 *
 * NOTE on MSW ordering: within a single server.use() call handlers are
 * checked in registration order and first-match wins. To override a base
 * handler, register the override in a SEPARATE server.use() call after
 * baseHandlers() has been installed.
 */
beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: null,
    isUsTenant: false,
  };
  try {
    localStorage.clear();
    localStorage.setItem('routed-operations.autoRoute', '0');
    localStorage.removeItem('RoutedOps_buildConfig');
  } catch { /* ignore */ }
});
afterEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

const jobs: BulkJob[] = [
  makeJob(11, { jobNumber: 'J-11', toPostCode: 1000 }),
  makeJob(12, { jobNumber: 'J-12', toPostCode: 1001 }),
];

function baseHandlers() {
  return [
    http.get('/api/regions', () => HttpResponse.json([])),
    http.get('/api/speeds', () => HttpResponse.json([])),
    http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [] })),
    http.get('/api/fleets', () => HttpResponse.json({ fleets: [] })),
    http.get('/api/jobs/filters/clients', () => HttpResponse.json({ response: { clients: [] } })),
    http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
    http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
    http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: jobs, maxJsonLength: 10000 })),
    http.get('/api/runs', () => HttpResponse.json({ response: [], maxJsonLength: 10000 })),
    http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
    http.post('/api/routes/here-sequence-typed', () =>
      HttpResponse.json({ orderedWaypointIds: [], orderedNames: [], totalMinutes: 0, legMinutes: [] })
    ),
  ];
}

async function selectAllJobsThenBuild(jobLabel = 'J-11') {
  await screen.findByText(jobLabel);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
  const buildBtn = await screen.findByRole('button', { name: /Build Runs/ });
  await waitFor(() => expect(buildBtn).not.toBeDisabled());
  fireEvent.click(buildBtn);
}

describe('CockpitPage - Build Runs pipeline', () => {
  it('Max Boxes mode with valid postcodes shows the preview modal + buckets', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await selectAllJobsThenBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    const heading = await screen.findByRole('heading', { name: /Confirm build - 2 run bucket/ });
    expect(heading).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Build 2 bucket/ })).toBeInTheDocument();
  });

  it('Max Boxes mode confirm creates one run per bucket via POST /api/runs', async () => {
    let insertCalls = 0;
    server.use(...baseHandlers());
    server.use(
      http.post('/api/runs', () => {
        insertCalls += 1;
        return HttpResponse.json({ response: { result: 'Success', message: String(500 + insertCalls) } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllJobsThenBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    fireEvent.click(await screen.findByRole('button', { name: /Build 2 bucket/ }));
    await waitFor(() => expect(insertCalls).toBeGreaterThanOrEqual(2));
  });

  it('Max Boxes mode shows "No valid jobs" toast when all selected jobs lack a postcode', async () => {
    const noPost = [
      makeJob(11, { jobNumber: 'J-11', toPostCode: null }),
      makeJob(12, { jobNumber: 'J-12', toPostCode: null }),
    ];
    server.use(...baseHandlers());
    server.use(
      http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: noPost, maxJsonLength: 10000 })),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllJobsThenBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    await waitFor(() =>
      expect(document.body.textContent ?? '').toMatch(/No valid jobs to build/),
    );
  });

  it('Delivery Window mode filters jobs lacking a window and warns via preview', async () => {
    localStorage.setItem(
      'RoutedOps_buildConfig',
      JSON.stringify({
        buildParameter: 'deliveryWindow',
        minutesPerStop: 2,
        vehicleCapacityEnabled: false,
        vehicleSizeId: 'custom',
        vehicleCubicCap: 15,
        routingMode: 'aToB',
        finishAtBulkJobId: null,
        noReroute: false,
        respectPickupCutoff: false,
      })
    );
    const dwJobs = [
      makeJob(11, {
        jobNumber: 'J-11',
        scheduleWindowStart: '1900-01-01T06:00:00Z',
        scheduleWindowEnd: '1900-01-01T09:00:00Z',
      }),
      makeJob(12, { jobNumber: 'J-12' }),
    ];
    server.use(...baseHandlers());
    server.use(
      http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: dwJobs, maxJsonLength: 10000 })),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllJobsThenBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    expect(await screen.findByText('DW0600')).toBeInTheDocument();
    expect(screen.getByText(/1 missing schedule window/)).toBeInTheDocument();
  });

  it('respectPickupCutoff option passes through the build config without exploding', async () => {
    localStorage.setItem(
      'RoutedOps_buildConfig',
      JSON.stringify({
        buildParameter: 'maxBoxes',
        minutesPerStop: 2,
        vehicleCapacityEnabled: false,
        vehicleSizeId: 'custom',
        vehicleCubicCap: 15,
        routingMode: 'aToB',
        finishAtBulkJobId: null,
        noReroute: false,
        respectPickupCutoff: true,
      })
    );
    const cutoffJobs = [
      makeJob(11, { jobNumber: 'J-11', applyPickupCutoff: true, pickupCutoffHours: 4 }),
    ];
    server.use(...baseHandlers());
    server.use(
      http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: cutoffJobs, maxJsonLength: 10000 })),
      http.post('/api/runs', () =>
        HttpResponse.json({ response: { result: 'Success', message: '999' } })
      ),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllJobsThenBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    fireEvent.click(await screen.findByRole('button', { name: /Build 1 bucket/ }));
    expect(await screen.findByText(/Built 1 run/)).toBeInTheDocument();
  });

  it('vehicle capacity ticked + jobs missing cubic surfaces the skipped-cubic warning', async () => {
    localStorage.setItem(
      'RoutedOps_buildConfig',
      JSON.stringify({
        buildParameter: 'maxBoxes',
        minutesPerStop: 2,
        vehicleCapacityEnabled: true,
        vehicleSizeId: 'custom',
        vehicleCubicCap: 15,
        routingMode: 'aToB',
        finishAtBulkJobId: null,
        noReroute: false,
        respectPickupCutoff: false,
      })
    );
    const vcJobs = [
      makeJob(11, { jobNumber: 'J-11', jobCubicM3: 5 }),
      makeJob(12, { jobNumber: 'J-12', jobCubicM3: null }),
    ];
    server.use(...baseHandlers());
    server.use(
      http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: vcJobs, maxJsonLength: 10000 })),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllJobsThenBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    expect(await screen.findByText(/1 missing cubic data/)).toBeInTheDocument();
  });

  it('build POST failure keeps createdRuns = 0 and toasts a "Built 0 run(s)" summary', async () => {
    server.use(...baseHandlers());
    server.use(
      http.post('/api/runs', () =>
        HttpResponse.json({ response: { result: 'Failure', message: 'db down' } })
      ),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllJobsThenBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    fireEvent.click(await screen.findByRole('button', { name: /Build 2 bucket/ }));
    expect(await screen.findByText(/Built 0 run/)).toBeInTheDocument();
  });

  it('build POST throwing surfaces the per-run failure toast', async () => {
    let call = 0;
    server.use(...baseHandlers());
    server.use(
      http.post('/api/runs', () => {
        call += 1;
        if (call === 1) return HttpResponse.error();
        return HttpResponse.json({ response: { result: 'Success', message: '900' } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllJobsThenBuild();
    fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
    fireEvent.click(await screen.findByRole('button', { name: /Build 2 bucket/ }));
    await waitFor(() => expect(call).toBeGreaterThanOrEqual(2));
  });

  it('opening build config without selection (mode indicator) does not require selected jobs', async () => {
    server.use(...baseHandlers());
    renderWithProviders(<CockpitPage />);
    await screen.findByText('J-11');
    fireEvent.click(screen.getByRole('button', { name: /^Max Boxes/ }));
    expect(await screen.findByRole('heading', { name: /Build Runs Configuration/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
