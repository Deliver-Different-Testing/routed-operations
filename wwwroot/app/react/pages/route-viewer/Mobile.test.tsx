import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('../../hooks/useAutoPoll', () => ({
  useAutoPoll: () => undefined,
}));

import Mobile from './Mobile';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <Mobile />
    </QueryClientProvider>,
  );
}

// Baseline handlers for the hooks Mobile always mounts (excluding /runs so
// individual tests can pass their own /runs handler first without ordering
// gotchas). Pass these AFTER any per-test overrides.
const baseline = () => [
  http.get('/api/runviewer/filters/clients', () =>
    HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/regions', () =>
    HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/speeds', () =>
    HttpResponse.json({ response: [] })),
];
const stubRuns = (rows: unknown[]) =>
  http.get('/api/runviewer/runs', () =>
    HttpResponse.json({ response: rows }));

describe('Route Viewer Mobile page', () => {
  it('renders the top bar with a date input and Filters button', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    // Bottom nav: Overview + Runs tabs are always present.
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Runs' })).toBeInTheDocument();
    expect(screen.getByLabelText('Filters')).toBeInTheDocument();
  });

  it('shows the "No runs." message when the runs API returns empty', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    expect(await screen.findByText(/No runs\./)).toBeInTheDocument();
  });

  it('renders a run row when the runs API returns one', async () => {
    server.use(
      stubRuns([{
        id: 1, name: 'RUN-A', area: 'AKL', suburbs: '',
        fromCities: null, toLocationName: null,
        velocity: null, hashKey: null, status: null,
        jobs: 5, incompleteJobs: 5, totalPickup: 0, incompletePickup: 0,
        hasReturns: false, returnsTotal: 0, isMissing: false,
        preAssigned: 0, isActive: 1,
        courierName: 'Kev', courierCode: 'KEV',
        courierPercentageFormatted: null,
        courierOnlineStatus: null, courierOfflineMins: null,
        agentName: null, isNpAgent: false,
      }]),
      ...baseline(),
    );
    renderPage();
    expect(await screen.findByText('RUN-A')).toBeInTheDocument();
    expect(screen.getByText(/5 jobs/)).toBeInTheDocument();
    expect(screen.getByText(/AKL - Kev/)).toBeInTheDocument();
  });

  it('switches to Overview tab and hits the region-overview endpoint', async () => {
    let hit = 0;
    server.use(
      stubRuns([]),
      ...baseline(),
      http.get('/api/runviewer/runs/overview', () => {
        hit++;
        return HttpResponse.json({ response: [] });
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await waitFor(() => expect(hit).toBe(1));
    expect(await screen.findByText(/No regions with jobs./))
      .toBeInTheDocument();
  });

  it('opens the filters drawer when Filters is clicked and closes on Close', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Filters'));
    expect(await screen.findByRole('heading', { name: 'Filters' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Filters' })).not.toBeInTheDocument()
    );
  });

  it('drills into a run when the run row is tapped', async () => {
    let jobsHit = 0;
    server.use(
      stubRuns([{
        id: 42, name: 'RUN-42', area: 'AKL', suburbs: '',
        fromCities: null, toLocationName: null,
        velocity: null, hashKey: null, status: null,
        jobs: 2, incompleteJobs: 2, totalPickup: 0, incompletePickup: 0,
        hasReturns: false, returnsTotal: 0, isMissing: false,
        preAssigned: 0, isActive: 1, courierName: null,
        courierCode: null, courierPercentageFormatted: null,
        courierOnlineStatus: null, courierOfflineMins: null,
        agentName: null, isNpAgent: false,
      }]),
      ...baseline(),
      http.get('/api/runviewer/runs/42/jobs', () => {
        jobsHit++;
        return HttpResponse.json({
          response: [{
            bulkJobId: 1, jobId: 0, jobNumber: 'JOB-1', jobStatus: null,
            clientCode: null, speedName: null, speed: null,
            fromCompany: null, fromAddress: null, fromSuburb: null,
            toCompany: null, toAddress: '99 K Rd', toSuburb: 'Grey Lynn',
            bookDate: null, bookTime: null,
            pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: null,
            pickedUp: null, dispatched: null, podTime: null, podName: null,
            amount: null, courierId: null, courierName: null, courierCode: null,
            contact: null, phone: null, deliverToContact: null, deliverToPhone: null,
            trackingEmail: null, proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
            notes: null, deliveryNotes: null, labelNotes: null,
            size: null, qty: null, weight: null, speedId: null,
            ourRef: null, refA: null, refB: null,
            runName: null, runOrder: null, bulkRunId: null,
            multiboxParentId: null, parentJobId: null, regionId: null, regionName: null,
            agentName: null, agentType: null, isNpAgent: false,
            pickUpLatitude: null, pickUpLongitude: null,
            deliveryLatitude: null, deliveryLongitude: null,
            toLat: null, toLng: null, fromPostCode: null, toPostCode: null,
            fromCity: null, toCity: null,
          }],
        });
      }),
    );
    renderPage();
    const runRow = await screen.findByText('RUN-42');
    const user = userEvent.setup();
    await user.click(runRow);
    await waitFor(() => expect(jobsHit).toBe(1));
    expect(await screen.findByText('JOB-1')).toBeInTheDocument();
  });
});
