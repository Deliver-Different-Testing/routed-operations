import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';
import { makeJob } from './CockpitPage.fixtures';
import type { BulkJob } from '@/types';

/**
 * Coverage for the autoRoute=ON branch of runBuildExecution: HERE
 * findsequence2 happy path, HERE error catch branch, and the routing-mode
 * pass-through. Split into its own file so ordering does not fight the
 * autoRoute=OFF suite in CockpitPage.build-runs.test.tsx.
 */

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: null,
    isUsTenant: false,
  };
  try {
    localStorage.clear();
    // Auto route ON so runBuildExecution hits the HERE branch.
    localStorage.setItem('routed-operations.autoRoute', '1');
  } catch { /* ignore */ }
});
afterEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
});

const jobs: BulkJob[] = [
  makeJob(11, { jobNumber: 'J-11', toPostCode: 1000 }),
  makeJob(12, { jobNumber: 'J-12', toPostCode: 1000 }),
];

function baseHandlers(jobsList: BulkJob[] = jobs) {
  return [
    http.get('/api/regions', () => HttpResponse.json([])),
    http.get('/api/speeds', () => HttpResponse.json([])),
    http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [] })),
    http.get('/api/fleets', () => HttpResponse.json({ fleets: [] })),
    http.get('/api/jobs/filters/clients', () => HttpResponse.json({ response: { clients: [] } })),
    http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
    http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
    http.get('/api/jobs', () => HttpResponse.json({ bulkJobs: jobsList, maxJsonLength: 10000 })),
    http.get('/api/runs', () => HttpResponse.json({ response: [], maxJsonLength: 10000 })),
    http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
  ];
}

async function selectAllAndConfirmBuild() {
  await screen.findByText('J-11');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
  const buildBtn = await screen.findByRole('button', { name: /Build Runs/ });
  await waitFor(() => expect(buildBtn).not.toBeDisabled());
  fireEvent.click(buildBtn);
  fireEvent.click(await screen.findByRole('button', { name: 'Build' }));
  fireEvent.click(await screen.findByRole('button', { name: /Build 1 bucket/ }));
}

describe('CockpitPage - runBuildExecution with autoRoute ON', () => {
  it('Delivery Window mode calls HERE findsequence2 and creates runs', async () => {
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
        toPostCode: 1000,
      }),
      makeJob(12, {
        jobNumber: 'J-12',
        scheduleWindowStart: '1900-01-01T06:00:00Z',
        scheduleWindowEnd: '1900-01-01T09:00:00Z',
        toPostCode: 1001,
      }),
    ];
    let hereCalls = 0;
    let runInserts = 0;
    server.use(...baseHandlers(dwJobs));
    server.use(
      http.post('/api/routes/here-sequence-typed', () => {
        hereCalls += 1;
        return HttpResponse.json({
          orderedWaypointIds: ['w1', 'w2'],
          orderedNames: ['start', 'J-11', 'J-12'],
          totalMinutes: 30,
          legMinutes: [0, 15, 15],
        });
      }),
      http.post('/api/runs', () => {
        runInserts += 1;
        return HttpResponse.json({ response: { result: 'Success', message: '5555' } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllAndConfirmBuild();
    await waitFor(() => {
      expect(hereCalls).toBeGreaterThan(0);
      expect(runInserts).toBeGreaterThan(0);
    });
  });

  it('Delivery Window mode with HERE failure falls back to postcode order without crashing', async () => {
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
      makeJob(12, {
        jobNumber: 'J-12',
        scheduleWindowStart: '1900-01-01T06:00:00Z',
        scheduleWindowEnd: '1900-01-01T09:00:00Z',
      }),
    ];
    let runInserts = 0;
    server.use(...baseHandlers(dwJobs));
    server.use(
      http.post('/api/routes/here-sequence-typed', () => HttpResponse.error()),
      http.post('/api/runs', () => {
        runInserts += 1;
        return HttpResponse.json({ response: { result: 'Success', message: '6666' } });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllAndConfirmBuild();
    // Fallback path still creates the run.
    await waitFor(() => expect(runInserts).toBeGreaterThan(0));
  });

  it('Delivery Window mode with routingMode aToA passes returnToStart=true to HERE', async () => {
    localStorage.setItem(
      'RoutedOps_buildConfig',
      JSON.stringify({
        buildParameter: 'deliveryWindow',
        minutesPerStop: 2,
        vehicleCapacityEnabled: false,
        vehicleSizeId: 'custom',
        vehicleCubicCap: 15,
        routingMode: 'aToA',
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
      makeJob(12, {
        jobNumber: 'J-12',
        scheduleWindowStart: '1900-01-01T06:00:00Z',
        scheduleWindowEnd: '1900-01-01T09:00:00Z',
      }),
    ];
    let seenReturnToStart: boolean | null = null;
    server.use(...baseHandlers(dwJobs));
    server.use(
      http.post('/api/routes/here-sequence-typed', async ({ request }) => {
        const body = await request.json() as { returnToStart: boolean };
        seenReturnToStart = body.returnToStart;
        return HttpResponse.json({
          orderedWaypointIds: [], orderedNames: ['start', 'J-11', 'J-12'],
          totalMinutes: 10, legMinutes: [0, 5, 5],
        });
      }),
      http.post('/api/runs', () =>
        HttpResponse.json({ response: { result: 'Success', message: '7777' } })
      ),
    );
    renderWithProviders(<CockpitPage />);
    await selectAllAndConfirmBuild();
    await waitFor(() => expect(seenReturnToStart).toBe(true));
  });
});
