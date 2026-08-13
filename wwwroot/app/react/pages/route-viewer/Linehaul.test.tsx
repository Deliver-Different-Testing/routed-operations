import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

// Silence the polling hook - the page fires refetches on a 25s interval
// which is not what these tests are exercising. Real hook is covered by
// its own test.
vi.mock('../../hooks/useAutoPoll', () => ({
  useAutoPoll: () => undefined,
}));

// The right-side detail column mounts RvJobDetail + RvScanDetailBox which
// themselves fetch. Stub to keep the network surface tight.
vi.mock('../../components/route-viewer/RvJobDetail', () => ({
  RvJobDetail: () => <div data-testid="rv-job-detail">detail</div>,
}));
vi.mock('../../components/route-viewer/RvScanDetailBox', () => ({
  RvScanDetailBox: () => <div data-testid="rv-scan-detail">scan-detail</div>,
}));

import Linehaul from './Linehaul';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <Linehaul />
    </QueryClientProvider>,
  );
}

const stubRuns = (rows: unknown[]) =>
  http.get('/api/runviewer/runs/linehaul', () =>
    HttpResponse.json({ response: rows }));

const stubOverview = (rows: unknown[]) =>
  http.get('/api/runviewer/runs/linehaul/overview', () =>
    HttpResponse.json({ response: rows }));

const runRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, name: 'AKL-HAM', masterJobNumber: 'MJ-1',
  fromDepot: 'AKL', toDepot: 'HAM', toDepotId: 5,
  jobs: 12, scannedItems: 8, expectedItems: 15,
  pallet: 'P-1', percent: 53, class: 'orange',
  courierId: 3, courierName: 'Kev', courierCode: 'KEV',
  agentId: null, agentName: null, isNpAgent: false,
  ...over,
});

describe('Route Viewer Linehaul page', () => {
  it('renders the date picker and toolbar buttons', async () => {
    server.use(stubRuns([]), stubOverview([]));
    renderPage();
    expect(screen.getByLabelText('Date') || screen.getByText('Date'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export manifest CSV/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print labels/ }))
      .toBeInTheDocument();
  });

  it('renders empty-state rows when the runs API returns no rows', async () => {
    server.use(stubRuns([]), stubOverview([]));
    renderPage();
    expect(await screen.findByText(/No linehaul runs for this date./))
      .toBeInTheDocument();
  });

  it('renders a run row with its counts', async () => {
    server.use(stubRuns([runRow()]), stubOverview([]));
    renderPage();
    expect(await screen.findByText('AKL-HAM')).toBeInTheDocument();
    expect(screen.getByText('AKL')).toBeInTheDocument();
    expect(screen.getByText('HAM')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('8/15')).toBeInTheDocument();
  });

  it('renders the Region Overview when the SP returns rows', async () => {
    server.use(
      stubRuns([]),
      stubOverview([{
        regionId: 1, region: 'AKL', total: 100, sortScan: 20, runScan: 30,
        pickedUp: 40, toDo: 10, percent: 40, class: 'orange',
        pallet: 'P-1', active: true,
      }]),
    );
    renderPage();
    expect(await screen.findByText('Linehaul Region Overview')).toBeInTheDocument();
    expect(await screen.findByText('AKL')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('expands a run row on chevron click and lazy-loads run jobs', async () => {
    let hit = 0;
    server.use(
      stubRuns([runRow({ id: 1, name: 'AKL-HAM', toDepotId: 5 })]),
      stubOverview([]),
      http.get('/api/runviewer/jobs/linehaul', () => {
        hit++;
        return HttpResponse.json({
          response: [{
            bulkJobId: 99, jobNumber: 'JOB-99', clientCode: 'ACME',
            toAddress: '2 K Rd', pallet: 'P-1', items: 3, pickedUp: null,
          }],
        });
      }),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    const expand = screen.getByRole('button', { name: 'Expand' });
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    await user.click(expand);
    await waitFor(() => expect(hit).toBe(1));
    expect(await screen.findByText('JOB-99')).toBeInTheDocument();
  });
});
