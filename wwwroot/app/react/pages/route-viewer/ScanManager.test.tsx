import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('../../hooks/useAutoPoll', () => ({
  useAutoPoll: () => undefined,
}));

import ScanManager from './ScanManager';

const baseline = () => [
  http.get('/api/runviewer/runs/overview', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/scans', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/scans/routed', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/scans/detail', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/scans/item-progress', () => HttpResponse.json({ response: [] })),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <ScanManager />
    </QueryClientProvider>,
    { initialRoute: '/route-viewer/scans' },
  );
}

describe('ScanManager', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isUsTenant: false,
      isNetworkPartner: false,
    };
    server.use(...baseline());
  });

  it('renders the Date + Mode toggles + defaults', async () => {
    renderPage();
    expect(screen.getByText(/Mode:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bulk' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Routed' })).toBeInTheDocument();
  });

  it('shows "No scan rows for this date" when empty (Bulk)', async () => {
    server.use(
      ...baseline(),
      http.get('/api/runviewer/scans', () => HttpResponse.json({ response: [] })),
    );
    renderPage();
    expect(await screen.findByText(/No scan rows for this date/)).toBeInTheDocument();
  });

  it('renders bulk rows returned by the SP', async () => {
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 1, bulkParentId: null, jobNumber: 'JOB-1', clientCode: 'ACME',
            deliveryDate: null, readyTime: null, toAddress: '99 K Rd',
            items: 3, sortScanned: 0, runScanned: 0, pickScanned: 0,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          }],
        })),
      ...baseline(),
    );
    renderPage();
    expect(await screen.findByText('JOB-1')).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();
  });

  it('switches to Routed mode + fires routed endpoint', async () => {
    let hit = 0;
    server.use(
      http.get('/api/runviewer/scans/routed', () => {
        hit++;
        return HttpResponse.json({ response: [] });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Routed' }));
    await waitFor(() => expect(hit).toBeGreaterThan(0));
    expect(await screen.findByText(/No routed shipments/)).toBeInTheDocument();
  });

  it('expands routed row + lazy loads item progress', async () => {
    let iHit = 0;
    server.use(
      http.get('/api/runviewer/scans/routed', () =>
        HttpResponse.json({
          response: [{
            jobId: 999, clientCode: 'ACME', jobNumber: 'J-999', toAddress: 'x',
            suburb: null, stage: null, legs: '[]',
            scannedItems: 0, expectedItems: 0, hasShort: false, isDivergent: false,
          }],
        })),
      http.get('/api/runviewer/scans/item-progress', () => {
        iHit++;
        return HttpResponse.json({ response: [] });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Routed' }));
    expect(await screen.findByText('J-999')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await waitFor(() => expect(iHit).toBe(1));
  });

  it('picks a row to load scan detail rows', async () => {
    let dHit = 0;
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 7, bulkParentId: null, jobNumber: 'J-7', clientCode: 'A',
            deliveryDate: null, readyTime: null, toAddress: null,
            items: 1, sortScanned: 1, runScanned: 2, pickScanned: 1,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          }],
        })),
      http.get('/api/runviewer/scans/detail', () => {
        dHit++;
        return HttpResponse.json({ response: [] });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('J-7'));
    await waitFor(() => expect(dHit).toBeGreaterThan(0));
    expect(await screen.findByText(/No scans on file/)).toBeInTheDocument();
  });

  it('toggles client internal checkbox', async () => {
    renderPage();
    const user = userEvent.setup();
    const cb = await screen.findByLabelText(/Client internal/);
    await user.click(cb);
    expect(cb).toBeChecked();
  });

  it('fires Remove missing boxes when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    let hit = 0;
    server.use(
      http.post('/api/runviewer/scans/remove-missing', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Remove missing boxes/ }));
    await waitFor(() => expect(hit).toBeGreaterThan(0));
  });

  it('aborts Remove missing boxes when confirm cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    let hit = 0;
    server.use(
      http.post('/api/runviewer/scans/remove-missing', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Remove missing boxes/ }));
    expect(hit).toBe(0);
  });

  it('US tenant defaults to Routed mode', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isUsTenant: true };
    renderPage();
    // Routed button should be active - can check by class or aria-pressed
    expect(await screen.findByText(/No routed shipments/)).toBeInTheDocument();
  });
});
