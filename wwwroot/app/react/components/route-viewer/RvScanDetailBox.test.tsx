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
    expect(screen.getByText('Scan')).toBeInTheDocument();
    expect(screen.getByText('Location')).toBeInTheDocument();
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

  it('renders dashes when scan detail, courier, and location are all missing', async () => {
    server.use(
      stubScans([{ scanId: 5 }]),
    );
    renderBox(3);
    // Wait for data-row to render (data-row has 4 td children, empty-state
    // has 1).
    await waitFor(() => {
      const rows = document.querySelectorAll('tbody tr');
      const dataRow = Array.from(rows).find((r) => r.children.length === 4);
      expect(dataRow).toBeTruthy();
    });
    const tbody = document.querySelector('tbody');
    // Scan cell, Location cell, and Courier cell each fall back to '-'.
    // Scan text sits inside a flex wrapper span; Location + Courier are
    // direct td text. We look for at least one '-' in each of the last
    // three cells of the data row.
    const dataRow = Array.from(tbody?.querySelectorAll('tr') ?? []).find(
      (r) => r.children.length === 4,
    );
    expect(dataRow).toBeTruthy();
    const cells = Array.from(dataRow!.children) as HTMLTableCellElement[];
    // Cell 1 = Time -> '-' fallback.
    expect(cells[0].textContent).toBe('-');
    // Cell 2 = Scan -> flex wrapper contains a '-' span.
    expect(cells[1].textContent).toContain('-');
    // Cell 3 = Location -> '-' fallback.
    expect(cells[2].textContent).toBe('-');
    // Cell 4 = Courier -> '-' fallback (no NP badge, no role subtitle).
    expect(cells[3].textContent).toBe('-');
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

  // -------------------------------------------------------------------
  // 2026-08-14 4-column layout coverage (Time / Scan / Location / By).
  // -------------------------------------------------------------------

  it('renders the Location cell text when the DTO includes it', async () => {
    server.use(
      stubScans([
        {
          scanId: 10,
          scanDetail: 'DROP',
          courier: 'Ally',
          location: 'Auckland Hub Bay 3',
        },
      ]),
    );
    renderBox(10);
    expect(await screen.findByText('Auckland Hub Bay 3')).toBeInTheDocument();
  });

  it('renders the leg badge when leg is present', async () => {
    server.use(
      stubScans([
        {
          scanId: 20,
          scanDetail: 'IN TRANSIT',
          courier: 'LHP1',
          leg: 'LH1',
        },
      ]),
    );
    renderBox(20);
    const badge = await screen.findByTestId('rv-scan-leg-badge');
    expect(badge).toHaveTextContent('LH1');
  });

  it('does not render a leg badge when leg is missing', async () => {
    server.use(
      stubScans([
        {
          scanId: 21,
          scanDetail: 'PICKED UP',
          courier: 'Kev',
        },
      ]),
    );
    renderBox(21);
    await screen.findByText('PICKED UP');
    expect(screen.queryByTestId('rv-scan-leg-badge')).toBeNull();
  });

  it('renders item chips parsed from the ItemLabels JSON string', async () => {
    server.use(
      stubScans([
        {
          scanId: 30,
          scanDetail: 'SORT',
          courier: 'Handler-1',
          itemLabels: JSON.stringify(['BC-001', 'BC-002', 'BC-003']),
        },
      ]),
    );
    renderBox(30);
    const chips = await screen.findAllByTestId('rv-scan-item-chip');
    expect(chips).toHaveLength(3);
    expect(chips[0]).toHaveTextContent('BC-001');
    expect(chips[1]).toHaveTextContent('BC-002');
    expect(chips[2]).toHaveTextContent('BC-003');
  });

  it('renders no item chips when ItemLabels JSON is malformed', async () => {
    server.use(
      stubScans([
        {
          scanId: 31,
          scanDetail: 'SORT',
          courier: 'Handler-1',
          itemLabels: 'not-valid-json',
        },
      ]),
    );
    renderBox(31);
    await screen.findByText('SORT');
    expect(screen.queryByTestId('rv-scan-item-chip')).toBeNull();
  });

  it('renders the tote/run subline when both are present', async () => {
    server.use(
      stubScans([
        {
          scanId: 40,
          scanDetail: 'INTO TOTE',
          courier: 'Kev',
          tote: 'T-1234',
          run: 'R-45',
        },
      ]),
    );
    renderBox(40);
    const sub = await screen.findByTestId('rv-scan-toterun');
    expect(sub).toHaveTextContent('Tote T-1234');
    expect(sub).toHaveTextContent('Run R-45');
  });

  it('renders the tote/run subline with only tote when run is missing', async () => {
    server.use(
      stubScans([
        {
          scanId: 41,
          scanDetail: 'INTO TOTE',
          courier: 'Kev',
          tote: 'T-9999',
        },
      ]),
    );
    renderBox(41);
    const sub = await screen.findByTestId('rv-scan-toterun');
    expect(sub).toHaveTextContent('Tote T-9999');
    expect(sub.textContent).not.toMatch(/Run/);
  });

  it('omits the tote/run subline when both are missing', async () => {
    server.use(
      stubScans([
        {
          scanId: 42,
          scanDetail: 'DROP',
          courier: 'Kev',
        },
      ]),
    );
    renderBox(42);
    await screen.findByText('DROP');
    expect(screen.queryByTestId('rv-scan-toterun')).toBeNull();
  });

  it('renders the courier role subtitle when role is present', async () => {
    server.use(
      stubScans([
        {
          scanId: 50,
          scanDetail: 'PICKED UP',
          courier: 'Kev',
          role: 'Driver',
        },
      ]),
    );
    renderBox(50);
    const role = await screen.findByTestId('rv-scan-role');
    expect(role).toHaveTextContent('Driver');
  });

  it('omits the courier role subtitle when role is missing', async () => {
    server.use(
      stubScans([
        {
          scanId: 51,
          scanDetail: 'PICKED UP',
          courier: 'Kev',
        },
      ]),
    );
    renderBox(51);
    await screen.findByText('Kev');
    expect(screen.queryByTestId('rv-scan-role')).toBeNull();
  });
});
