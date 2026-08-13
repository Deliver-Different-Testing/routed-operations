import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('../../components/route-viewer/RvJobDetail', () => ({
  RvJobDetail: () => <div data-testid="rv-job-detail">detail</div>,
}));
vi.mock('../../components/route-viewer/RvScanDetailBox', () => ({
  RvScanDetailBox: () => <div data-testid="rv-scan-detail">scan-detail</div>,
}));

import PrintManager from './PrintManager';

const baseline = () => [
  http.get('/api/runviewer/runs/overview', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/scans', () => HttpResponse.json({ response: [] })),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <PrintManager />
    </QueryClientProvider>,
    { initialRoute: '/route-viewer/print' },
  );
}

describe('PrintManager', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isUsTenant: false,
      isNetworkPartner: false,
    };
    server.use(...baseline());
  });

  it('renders toolbar with date + sort + action buttons', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Select all/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print Labels \(0\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel \(0\)/ })).toBeInTheDocument();
  });

  it('shows "No print-eligible jobs" when empty', async () => {
    renderPage();
    expect(await screen.findByText(/No print-eligible jobs/)).toBeInTheDocument();
  });

  it('renders jobs + selects rows', async () => {
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 1, bulkParentId: null, jobNumber: 'J1', clientCode: 'A',
            deliveryDate: null, readyTime: null, toAddress: 'x',
            items: 2, sortScanned: 0, runScanned: 0, pickScanned: 0,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          }],
        })),
      ...baseline(),
    );
    renderPage();
    expect(await screen.findByText('J1')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByText('J1'));
    expect(screen.getByRole('button', { name: /Print Labels \(1\)/ })).toBeInTheDocument();
  });

  it('sort mode changes column ordering', async () => {
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [
            { bulkJobId: 1, bulkParentId: null, jobNumber: 'Z1', clientCode: 'B',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 1, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0 },
            { bulkJobId: 2, bulkParentId: null, jobNumber: 'A1', clientCode: 'A',
              deliveryDate: null, readyTime: null, toAddress: null,
              items: 1, sortScanned: 0, runScanned: 0, pickScanned: 0,
              invalidPickScanned: 0, transferScanned: 0, transitScanned: 0 },
          ],
        })),
      ...baseline(),
    );
    renderPage();
    const first = await screen.findByText('A1');
    const second = await screen.findByText('Z1');
    // Sort by job# default: A1 must appear before Z1 in DOM order
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('selectAll checks every row + clearAll clears', async () => {
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [1, 2].map((i) => ({
            bulkJobId: i, bulkParentId: null, jobNumber: `J${i}`, clientCode: 'A',
            deliveryDate: null, readyTime: null, toAddress: null,
            items: 1, sortScanned: 0, runScanned: 0, pickScanned: 0,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          })),
        })),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('J1');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Select all/ }));
    expect(screen.getByRole('button', { name: /Print Labels \(2\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Clear/ }));
    expect(screen.getByRole('button', { name: /Print Labels \(0\)/ })).toBeInTheDocument();
  });

  it('opens edit qty modal + saves', async () => {
    let hit = 0;
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 5, bulkParentId: null, jobNumber: 'J5', clientCode: 'A',
            deliveryDate: null, readyTime: null, toAddress: null,
            items: 4, sortScanned: 0, runScanned: 0, pickScanned: 0,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          }],
        })),
      http.post('/api/runviewer/jobs/5/text-fields', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('J5');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Edit qty/ }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(hit).toBe(1));
  });

  it('cancels edit qty modal', async () => {
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 5, bulkParentId: null, jobNumber: 'J5', clientCode: 'A',
            deliveryDate: null, readyTime: null, toAddress: null,
            items: 4, sortScanned: 0, runScanned: 0, pickScanned: 0,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          }],
        })),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('J5');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Edit qty/ }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText(/Edit item quantity/)).toBeNull(),
    );
  });

  it('prints selected + POST hit', async () => {
    let hit = 0;
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 1, bulkParentId: null, jobNumber: 'J1', clientCode: 'A',
            deliveryDate: null, readyTime: null, toAddress: null,
            items: 1, sortScanned: 0, runScanned: 0, pickScanned: 0,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          }],
        })),
      http.post('/api/runviewer/labels/bulk-jobs', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('J1');
    const user = userEvent.setup();
    await user.click(screen.getByText('J1'));
    await user.click(screen.getByRole('button', { name: /Print Labels \(1\)/ }));
    await waitFor(() => expect(hit).toBe(1));
  });

  it('cancels selected with confirm', async () => {
    let hit = 0;
    server.use(
      http.get('/api/runviewer/scans', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 1, bulkParentId: null, jobNumber: 'J1', clientCode: 'A',
            deliveryDate: null, readyTime: null, toAddress: null,
            items: 1, sortScanned: 0, runScanned: 0, pickScanned: 0,
            invalidPickScanned: 0, transferScanned: 0, transitScanned: 0,
          }],
        })),
      http.post('/api/runviewer/jobs/cancel', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('J1');
    const user = userEvent.setup();
    await user.click(screen.getByText('J1'));
    await user.click(screen.getByRole('button', { name: /Cancel \(1\)/ }));
    // Confirm dialog with primary "OK"
    const primary = await screen.findByRole('button', { name: 'OK' });
    await user.click(primary);
    await waitFor(() => expect(hit).toBe(1));
  });
});
