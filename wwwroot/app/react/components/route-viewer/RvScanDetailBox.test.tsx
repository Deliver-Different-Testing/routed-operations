import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvScanDetailBox } from './RvScanDetailBox';

const stubScans = (rows: any[]) =>
  http.get('/api/runviewer/scans/detail', () =>
    HttpResponse.json({ response: rows }),
  );

function renderBox(selectedJobId: number | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <RvScanDetailBox selectedJobId={selectedJobId} />
    </QueryClientProvider>,
  );
}

describe('RvScanDetailBox', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isUsTenant: false,
      timeZone: 'Pacific/Auckland',
    };
    server.use(stubScans([]));
  });

  it('renders the box title', () => {
    renderBox(null);
    expect(screen.getByText('Scan Detail')).toBeInTheDocument();
  });

  it('shows the idle prompt when selectedJobId is null', () => {
    renderBox(null);
    expect(
      screen.getByText(/Select a job to see its scan history\./),
    ).toBeInTheDocument();
  });

  it('shows the table header + Loading row while fetching', () => {
    server.use(
      http.get('/api/runviewer/scans/detail', () => new Promise(() => {})),
    );
    renderBox(123);
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('Scan Type')).toBeInTheDocument();
    expect(screen.getByText('Courier')).toBeInTheDocument();
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders an empty-state row when the SP returns no rows', async () => {
    server.use(stubScans([]));
    renderBox(1);
    expect(
      await screen.findByText(/No scans for this job yet\./),
    ).toBeInTheDocument();
  });

  it('renders a scan row with time / detail / courier + NP badge', async () => {
    server.use(
      stubScans([
        {
          scanId: 1,
          scanDateTime: '2026-08-13T09:30:00Z',
          scanDetail: 'PICKED UP',
          courier: 'Kev',
          isNpAgent: true,
        },
      ]),
    );
    renderBox(1);
    expect(await screen.findByText('PICKED UP')).toBeInTheDocument();
    expect(screen.getByText('Kev')).toBeInTheDocument();
    expect(screen.getByText('NP')).toBeInTheDocument();
  });

  it('falls back to time / scanType / courierName when primary fields missing', async () => {
    server.use(
      stubScans([
        {
          // no scanId, so falls back to index-based key
          time: '09:00',
          scanType: 'DELIVERED',
          courierName: 'Fallback',
        },
      ]),
    );
    renderBox(2);
    expect(await screen.findByText('DELIVERED')).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('Fallback')).toBeInTheDocument();
    // No NP badge when isNpAgent is missing/false
    expect(screen.queryByText('NP')).toBeNull();
  });

  it('renders dashes when scan detail and courier are both missing', async () => {
    server.use(
      stubScans([{ scanId: 5 }]),
    );
    renderBox(3);
    // Wait for data-row to render (data-row has 3 td children, empty-state has 1).
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      const dataRow = Array.from(rows).find((r) => r.children.length === 3);
      expect(dataRow).toBeTruthy();
    });
    // All three cells fall back to '-'.
    const tbody = document.querySelector('tbody');
    const dashes = Array.from(tbody?.querySelectorAll('td') ?? []).filter(
      (td) => td.textContent === '-',
    );
    expect(dashes.length).toBe(3);
  });

  it('formats scanDateTime via tenantTime using tenant tz (NZ)', async () => {
    // 2026-08-13T09:30:00Z is 21:30 in Pacific/Auckland (NZST, UTC+12).
    server.use(
      stubScans([
        {
          scanId: 1,
          scanDateTime: '2026-08-13T09:30:00Z',
          scanDetail: 'X',
          courier: 'C',
        },
      ]),
    );
    renderBox(1);
    // NZ output is 24-hour HH:mm.
    expect(await screen.findByText('21:30')).toBeInTheDocument();
  });

  it('formats with 12-hour clock for US tenants', async () => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isUsTenant: true,
      timeZone: 'America/Los_Angeles',
    };
    server.use(
      stubScans([
        {
          scanId: 1,
          scanDateTime: '2026-08-13T20:30:00Z',
          scanDetail: 'X',
          courier: 'C',
        },
      ]),
    );
    renderBox(1);
    // 20:30 UTC -> 13:30 in PDT (UTC-7). US tenant uses 12-hour clock so
    // that renders as "1:30 PM".
    const el = await screen.findByText(/1:30\s?PM/i);
    expect(el).toBeInTheDocument();
  });
});
