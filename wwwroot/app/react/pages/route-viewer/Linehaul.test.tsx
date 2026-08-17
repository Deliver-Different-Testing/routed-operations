import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import {
  linehaulReportStamp,
  linehaulCtxMenuItems,
  parseScanHistory,
  scanChipTone,
} from './Linehaul';

// Silence the polling hook - the page fires refetches on a 25s interval
// which is not what these tests are exercising. Real hook is covered by
// its own test.
vi.mock('../../hooks/useAutoPoll', () => ({
  useAutoPoll: () => undefined,
}));

// The right-side detail column mounts RvJobDetail + RvScanDetailBox which
// themselves fetch. Stub to keep the network surface tight. The stub also
// echoes the props Linehaul passes it (bulkJobId + a button that calls
// onPickSibling with a canned payload) so the sibling-navigation test can
// drive the flow without booting the real RvJobDetail + siblings SP stack.
vi.mock('../../components/route-viewer/RvJobDetail', () => ({
  RvJobDetail: (props: {
    bulkJobId: number | null;
    initialJob: unknown;
    onPickSibling?: (sib: {
      jobId: number;
      bulkJobId: number;
      jobNumber: string | null;
      jobStatus: string | null;
      tabLabel: string;
      job: unknown;
    }) => void;
  }) => (
    <div data-testid="rv-job-detail" data-bulk-job-id={String(props.bulkJobId ?? '')}>
      detail
      <button
        type="button"
        data-testid="pick-lh1-sibling"
        onClick={() => props.onPickSibling?.({
          jobId: 5501,
          bulkJobId: 0,
          jobNumber: null,
          jobStatus: 'D',
          tabLabel: '*LH1',
          job: { bulkJobId: 0, jobId: 5501, jobNumber: 'JOB-LH1' },
        })}
      >
        pick LH1
      </button>
      <button
        type="button"
        data-testid="pick-real-sibling"
        onClick={() => props.onPickSibling?.({
          jobId: 7777,
          bulkJobId: 4242,
          jobNumber: 'JOB-4242',
          jobStatus: 'D',
          tabLabel: '',
          job: { bulkJobId: 4242, jobId: 7777, jobNumber: 'JOB-4242' },
        })}
      >
        pick real sibling
      </button>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/RvScanDetailBox', () => ({
  RvScanDetailBox: (props: { selectedJobId: number | null }) => (
    <div data-testid="rv-scan-detail" data-selected-job-id={String(props.selectedJobId ?? '')}>
      scan-detail
    </div>
  ),
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

// The filter dropdowns (Clients / Regions / Speeds) mount
// `useRouteViewerLookups`, which fires GETs for /filters/clients,
// /filters/regions, /filters/speeds. Stub all three so MSW does not
// throw on the unhandled request.
const stubLookups = (over: {
  clients?: Array<{ id: number; label: string }>;
  regions?: Array<{ id: number; label: string }>;
  speeds?: Array<{ id: number; label: string }>;
} = {}) => [
  http.get('/api/runviewer/filters/clients', () =>
    HttpResponse.json({ response: over.clients ?? [] })),
  http.get('/api/runviewer/filters/regions', () =>
    HttpResponse.json({ response: over.regions ?? [] })),
  http.get('/api/runviewer/filters/speeds', () =>
    HttpResponse.json({ response: over.speeds ?? [] })),
];

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
    server.use(stubRuns([]), stubOverview([]), ...stubLookups());
    renderPage();
    expect(screen.getByLabelText('Date') || screen.getByText('Date'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export manifest CSV/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print labels/ }))
      .toBeInTheDocument();
  });

  it('renders empty-state rows when the runs API returns no rows', async () => {
    server.use(stubRuns([]), stubOverview([]), ...stubLookups());
    renderPage();
    expect(await screen.findByText(/No linehaul runs for this date./))
      .toBeInTheDocument();
  });

  it('renders a run row with its counts', async () => {
    server.use(stubRuns([runRow()]), stubOverview([]), ...stubLookups());
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
      ...stubLookups(),
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
      ...stubLookups(),
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
    const user = userEvent.setup();
    await user.click(expand);
    await waitFor(() => expect(hit).toBe(1));
    expect(await screen.findByText('JOB-99')).toBeInTheDocument();
  });

  it('sorts the run list by header click and toggles direction on second click', async () => {
    // Two rows with names that would order Zebra-then-Alpha in load
    // order and Alpha-then-Zebra after an ascending sort.
    server.use(
      stubRuns([
        runRow({ id: 1, name: 'Zebra-Run', fromDepot: 'AKL', toDepot: 'HAM' }),
        runRow({ id: 2, name: 'Alpha-Run', fromDepot: 'AKL', toDepot: 'HAM' }),
      ]),
      stubOverview([]),
      ...stubLookups(),
    );
    renderPage();
    await screen.findByText('Zebra-Run');
    // Multiple columns start with "Run" ("Run" run-list header + "Run
    // Scan" overview header), so scope the header lookup to the ones
    // we tag with aria-sort (only the sortable run-list headers set
    // it) and pick the "Run" one.
    const runHeader = screen.getAllByRole('columnheader')
      .find((th) => th.hasAttribute('aria-sort') && /^Run(\s|$)/.test(th.textContent ?? ''))!;
    expect(runHeader).toBeTruthy();
    const user = userEvent.setup();

    // Baseline: Zebra appears before Alpha in DOM order.
    const bodyBefore = document.querySelectorAll('tbody tr td.font-medium');
    expect(bodyBefore[0]?.textContent).toContain('Zebra-Run');

    // First click: ascending -> Alpha before Zebra + aria-sort=ascending.
    await user.click(runHeader);
    await waitFor(() =>
      expect(runHeader.getAttribute('aria-sort')).toBe('ascending'));
    const bodyAfterAsc = document.querySelectorAll('tbody tr td.font-medium');
    expect(bodyAfterAsc[0]?.textContent).toContain('Alpha-Run');

    // Second click: descending -> Zebra back at the top.
    await user.click(runHeader);
    await waitFor(() =>
      expect(runHeader.getAttribute('aria-sort')).toBe('descending'));
    const bodyAfterDesc = document.querySelectorAll('tbody tr td.font-medium');
    expect(bodyAfterDesc[0]?.textContent).toContain('Zebra-Run');
  });

  it('narrows the run set when a courier filter is applied', async () => {
    server.use(
      stubRuns([
        runRow({ id: 1, name: 'Run-Kev', courierId: 3, courierName: 'Kev', courierCode: 'KEV' }),
        runRow({ id: 2, name: 'Run-Jo', courierId: 7, courierName: 'Jo', courierCode: 'JO' }),
      ]),
      stubOverview([]),
      ...stubLookups(),
    );
    renderPage();
    await screen.findByText('Run-Kev');
    await screen.findByText('Run-Jo');

    // Open the Couriers multi-select and check Kev only.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Couriers/ }));
    // MultiSelect renders one checkbox per option under a wrapping label.
    const kevBox = await screen.findByRole('checkbox', { name: /Kev/ });
    await user.click(kevBox);

    await waitFor(() => expect(screen.queryByText('Run-Jo')).not.toBeInTheDocument());
    expect(screen.getByText('Run-Kev')).toBeInTheDocument();
  });

  it('narrows further when the Search jobs input is typed into', async () => {
    server.use(
      stubRuns([
        runRow({ id: 1, name: 'AKL-HAM', fromDepot: 'AKL', toDepot: 'HAM' }),
        runRow({ id: 2, name: 'WLG-CHC', fromDepot: 'WLG', toDepot: 'CHC' }),
      ]),
      stubOverview([]),
      ...stubLookups(),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    await screen.findByText('WLG-CHC');

    const user = userEvent.setup();
    const search = screen.getByPlaceholderText('Search jobs...');
    await user.type(search, 'WLG');

    // 200ms debounce - wait for the row to drop out.
    await waitFor(
      () => expect(screen.queryByText('AKL-HAM')).not.toBeInTheDocument(),
      { timeout: 1_000 },
    );
    expect(screen.getByText('WLG-CHC')).toBeInTheDocument();
  });

  it('renders sortable headers on the expanded per-run jobs table', async () => {
    server.use(
      stubRuns([runRow({ id: 1, name: 'AKL-HAM', toDepotId: 5 })]),
      stubOverview([]),
      ...stubLookups(),
      http.get('/api/runviewer/jobs/linehaul', () =>
        HttpResponse.json({
          response: [
            { bulkJobId: 1, jobNumber: 'J-B', clientCode: 'ACME', toAddress: 'a', pallet: 'P', items: 1, pickedUp: null },
            { bulkJobId: 2, jobNumber: 'J-A', clientCode: 'ACME', toAddress: 'a', pallet: 'P', items: 2, pickedUp: null },
          ],
        })),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Expand' }));

    await screen.findByText('J-B');
    // Job # column header inside the expanded table. There is also
    // the run row above, so scope by aria role columnheader + name.
    const jobHeader = screen.getAllByRole('columnheader', { name: /^Job #/ })[0];
    await user.click(jobHeader);
    await waitFor(() =>
      expect(jobHeader.getAttribute('aria-sort')).toBe('ascending'));

    // After asc sort, J-A should come before J-B in the expanded table.
    const expandedTable = jobHeader.closest('table')!;
    const jobCells = within(expandedTable).getAllByText(/^J-/);
    expect(jobCells[0].textContent).toBe('J-A');
  });

  it('routes an LH-leg sibling pick through the sibling snapshot override', async () => {
    // Operator drills into a linehaul job (bulkJobId=99), then clicks
    // an LH1 sibling tab in the RvJobDetail strip. LH legs have no
    // tblBulkJob row (sibling.bulkJobId=0), so Linehaul must switch
    // the detail pane via the sibling snapshot rather than by
    // focusedJobId. ScanList stays keyed to the primary job (its own
    // bulkJobId=0 branch is a no-op path, but the wiring should still
    // hand the override's bulkJobId through).
    server.use(
      stubRuns([runRow({ id: 1, name: 'AKL-HAM', toDepotId: 5 })]),
      stubOverview([]),
      ...stubLookups(),
      http.get('/api/runviewer/jobs/linehaul', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 99, jobNumber: 'JOB-99', clientCode: 'ACME',
            toAddress: '2 K Rd', pallet: 'P-1', items: 3, pickedUp: null,
          }],
        })),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    // Click the JOB-99 row in the expanded panel to focus it.
    await user.click(await screen.findByText('JOB-99'));

    // JobDetail mock now sees bulkJobId=99.
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail').getAttribute('data-bulk-job-id'))
        .toBe('99'));

    // Click the LH1 sibling tab. The stub fires onPickSibling with an
    // LH-leg payload (bulkJobId=0, jobId=5501, job snapshot present).
    // Detail pane switches to the sibling override; ScanList also
    // switches (bulkJobId=0 is a documented render no-op inside
    // ScanList itself, but the prop wiring is the contract under test).
    await user.click(screen.getByTestId('pick-lh1-sibling'));
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail').getAttribute('data-bulk-job-id'))
        .toBe('0'));
    expect(screen.getByTestId('rv-scan-detail').getAttribute('data-selected-job-id'))
      .toBe('0');
  });

  it('promotes a real-tblBulkJob sibling pick to focusedJobId (clears override)', async () => {
    // When the sibling has a real bulkJobId > 0 + a job snapshot,
    // Linehaul routes through focusedJobId so the ScanList query key
    // + any downstream refetches stay valid across future polls.
    server.use(
      stubRuns([runRow({ id: 1, name: 'AKL-HAM', toDepotId: 5 })]),
      stubOverview([]),
      ...stubLookups(),
      http.get('/api/runviewer/jobs/linehaul', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 99, jobNumber: 'JOB-99', clientCode: 'ACME',
            toAddress: '2 K Rd', pallet: 'P-1', items: 3, pickedUp: null,
          }],
        })),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await user.click(await screen.findByText('JOB-99'));
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail').getAttribute('data-bulk-job-id'))
        .toBe('99'));

    // Sibling with real tblBulkJob (bulkJobId=4242).
    await user.click(screen.getByTestId('pick-real-sibling'));
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail').getAttribute('data-bulk-job-id'))
        .toBe('4242'));
    expect(screen.getByTestId('rv-scan-detail').getAttribute('data-selected-job-id'))
      .toBe('4242');
  });
});

describe('Linehaul run-scoped label print + full-day report', () => {
  // Both actions consume Blob + createObjectURL. jsdom doesn't
  // implement those, so we stub them + capture what the code hands
  // back. window.open is spied on so the label test can assert the
  // PDF gets opened; the anchor click is spied on so the report test
  // can read the .download filename.
  let openSpy: ReturnType<typeof vi.spyOn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let capturedFilename: string | null = null;

  beforeEach(() => {
    capturedFilename = null;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL =
      vi.fn(() => 'blob:mock');
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL =
      vi.fn();
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) { capturedFilename = this.download; },
    );
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    openSpy.mockRestore();
    clickSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('linehaulReportStamp formats YYMMDD_HHmmss with padded fields', () => {
    // Fixed instant lets us pin the expected shape without leaking
    // wall-clock timing into the assertion.
    const stamp = linehaulReportStamp(new Date(2026, 0, 3, 4, 5, 6));
    expect(stamp).toBe('260103_040506');
  });

  it('per-run Labels button posts the run-scoped payload to the label endpoint', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      stubRuns([runRow({
        id: 1, name: 'AKL-HAM', toDepotId: 5, courierId: 3,
        courierName: 'Kev', courierCode: 'KEV',
      })]),
      stubOverview([]),
      // Provide a client + speed lookup so the multi-selects have
      // options; the per-run action forwards whatever ids the operator
      // has ticked in those dropdowns.
      ...stubLookups({
        clients: [{ id: 42, label: 'ACME' }],
        speeds: [{ id: 9, label: 'CORT' }],
      }),
      http.post('/api/runviewer/labels/linehaul-jobs', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(new Blob(['pdf-bytes'], { type: 'application/pdf' }), {
          status: 200,
          headers: { 'Content-Type': 'application/pdf' },
        });
      }),
    );
    renderPage();
    await screen.findByText('AKL-HAM');

    const user = userEvent.setup();
    // Tick a client + a speed so the payload carries them through as
    // comma-joined id strings (mirrors legacy behaviour).
    await user.click(screen.getByRole('button', { name: /Clients/ }));
    await user.click(await screen.findByRole('checkbox', { name: /ACME/ }));
    await user.click(screen.getByRole('button', { name: /Speeds/ }));
    await user.click(await screen.findByRole('checkbox', { name: /CORT/ }));

    const labelBtn = screen.getByRole('button', { name: /^Labels$/ });
    await user.click(labelBtn);

    await waitFor(() => expect(capturedBody).not.toBeNull());
    expect(capturedBody).toEqual({
      bookDate: expect.any(String),
      depotId: 5,
      runName: 'AKL-HAM',
      clientIds: '42',
      speedIds: '9',
    });
    // PDF opens in a new tab via window.open on the object URL.
    await waitFor(() => expect(openSpy).toHaveBeenCalled());
    expect(openSpy).toHaveBeenCalledWith('blob:mock', '_blank');
  });

  it('per-run Labels button is disabled when depot or run name is missing', async () => {
    server.use(
      stubRuns([runRow({ id: 1, name: 'AKL-HAM', toDepotId: null })]),
      stubOverview([]),
      ...stubLookups(),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    const labelBtn = screen.getByRole('button', { name: /^Labels$/ });
    expect(labelBtn).toBeDisabled();
  });

  it('Download Linehaul Report hits the report endpoint with runDate + saves yymmdd_HHmmss filename', async () => {
    let hitUrl: string | null = null;
    server.use(
      stubRuns([]),
      stubOverview([]),
      ...stubLookups(),
      http.get('/api/runviewer/reports/linehaul', ({ request }) => {
        hitUrl = request.url;
        return new HttpResponse(new Blob(['col1,col2\r\n1,2'], { type: 'text/csv' }), {
          status: 200,
          headers: { 'Content-Type': 'text/csv' },
        });
      }),
    );
    renderPage();
    // Date input renders with the tenant-today ymd; capture it so we
    // can assert the query string carries the same value.
    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    const runDate = dateInput.value;
    expect(runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const user = userEvent.setup();
    const reportBtn = screen.getByRole('button', { name: /Download Linehaul Report/ });
    await user.click(reportBtn);

    await waitFor(() => expect(hitUrl).not.toBeNull());
    expect(hitUrl!).toContain('/api/runviewer/reports/linehaul');
    expect(hitUrl!).toContain(`runDate=${encodeURIComponent(runDate)}`);

    await waitFor(() => expect(capturedFilename).not.toBeNull());
    // Legacy filename shape: LinehaulReport_YYMMDD_HHmmss.csv.
    expect(capturedFilename!).toMatch(/^LinehaulReport_\d{6}_\d{6}\.csv$/);
  });

  it('Download Linehaul Report alerts the operator when the server returns a non-2xx', async () => {
    server.use(
      stubRuns([]),
      stubOverview([]),
      ...stubLookups(),
      http.get('/api/runviewer/reports/linehaul', () =>
        HttpResponse.json({ message: 'proxy not configured' }, { status: 501 })),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Download Linehaul Report/ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('501'));
    // No download attempted on failure.
    expect(capturedFilename).toBeNull();
  });
});

describe('Linehaul row context menu (Part A - Assign Route / Assign Courier)', () => {
  // linehaulCtxMenuItems is a pure builder - unit tests avoid the full
  // render cycle so the branching (NP vs admin, run vs job target) is
  // covered without staging every stub.
  it('admin sees both Assign Route and Assign Courier on a run target', () => {
    const { title, items } = linehaulCtxMenuItems(
      { kind: 'run', runId: 42, runName: 'AKL-HAM' },
      false,
      () => undefined,
    );
    expect(title).toBe('Run AKL-HAM');
    expect(items.map((i) => i.label)).toEqual(['Assign Route', 'Assign Courier']);
  });

  it('NP sees only Assign Courier on a run target', () => {
    const { items } = linehaulCtxMenuItems(
      { kind: 'run', runId: 42, runName: 'AKL-HAM' },
      true,
      () => undefined,
    );
    expect(items.map((i) => i.label)).toEqual(['Assign Courier']);
  });

  it('admin sees both Assign Route and Assign Courier on a job target', () => {
    const { title, items } = linehaulCtxMenuItems(
      { kind: 'job', runId: 42, bulkJobId: 99, jobNumber: 'JOB-99' },
      false,
      () => undefined,
    );
    expect(title).toBe('Job JOB-99');
    expect(items.map((i) => i.label)).toEqual(['Assign Route', 'Assign Courier']);
  });

  it('item click forwards the target through to the openAssign callback', () => {
    const openAssign = vi.fn();
    const target = { kind: 'job' as const, runId: 42, bulkJobId: 99, jobNumber: 'JOB-99' };
    const { items } = linehaulCtxMenuItems(target, false, openAssign);
    items[0].onClick();
    expect(openAssign).toHaveBeenCalledWith(target);
  });

  it('right-clicking a run row opens the ctx menu with Assign Route + Assign Courier', async () => {
    server.use(
      stubRuns([runRow({ id: 1, name: 'AKL-HAM', toDepotId: 5 })]),
      stubOverview([]),
      ...stubLookups(),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    // Right-click on the run row cell (font-medium is the Run column
    // that carries the run name). Fire a native contextmenu event so
    // the onContextMenu handler on the <tr> promotes it into ctx state.
    const nameCell = screen.getByText('AKL-HAM');
    const runRowEl = nameCell.closest('tr')!;
    act(() => {
      runRowEl.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 40, clientY: 60,
      }));
    });
    // Menu appears with both admin items + a run-scoped title.
    expect(await screen.findByText('Run AKL-HAM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Route' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Courier' })).toBeInTheDocument();
  });

  it('right-clicking an expanded job row opens the ctx menu with a job-scoped title', async () => {
    server.use(
      stubRuns([runRow({ id: 1, name: 'AKL-HAM', toDepotId: 5 })]),
      stubOverview([]),
      ...stubLookups(),
      http.get('/api/runviewer/jobs/linehaul', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 99, jobNumber: 'JOB-99', clientCode: 'ACME',
            toAddress: '2 K Rd', pallet: 'P-1', items: 3, pickedUp: null,
            scanHistory: null,
          }],
        })),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    const jobCell = await screen.findByText('JOB-99');
    const jobRowEl = jobCell.closest('tr')!;
    act(() => {
      jobRowEl.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 40, clientY: 60,
      }));
    });
    expect(await screen.findByText('Job JOB-99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Route' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign Courier' })).toBeInTheDocument();
  });
});

describe('Linehaul scanHistory chips (Part B - inline Scanned cell)', () => {
  // parseScanHistory + scanChipTone are the two seams the chip strip
  // rides on. Unit tests exercise them directly so the render assertions
  // below can focus on the DOM mapping.
  it('parseScanHistory returns [] for null / empty / malformed input', () => {
    expect(parseScanHistory(null)).toEqual([]);
    expect(parseScanHistory('')).toEqual([]);
    expect(parseScanHistory('{"not":"array"}')).toEqual([]);
    expect(parseScanHistory('!!!not-json')).toEqual([]);
  });

  it('parseScanHistory returns the parsed array for a valid JSON blob', () => {
    const raw = JSON.stringify([
      { ScanDateTime: '2026-08-14 09:00', ScanType: 'Run', Courier: 'KEV Kev' },
      { ScanDateTime: '2026-08-14 08:45', ScanType: 'Sort', Courier: '' },
    ]);
    const parsed = parseScanHistory(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].ScanType).toBe('Run');
  });

  it('scanChipTone maps completed / short / pending scan labels to green / red / grey', () => {
    expect(scanChipTone('Run')).toBe('green');
    expect(scanChipTone('Sort')).toBe('green');
    expect(scanChipTone('Pickup')).toBe('green');
    expect(scanChipTone('InvalidRun')).toBe('red');
    expect(scanChipTone('InvalidPickup')).toBe('red');
    expect(scanChipTone('Tote Exception')).toBe('red');
    expect(scanChipTone('Tote Override')).toBe('red');
    expect(scanChipTone('Transit')).toBe('grey');
    expect(scanChipTone(null)).toBe('grey');
  });

  it('renders one chip per scan entry with the correct tone class on the expanded job row', async () => {
    // SP emits `scanHistory` as a JSON string per row. Fake a row with
    // one green, one red, one grey entry and assert the chip strip DOM
    // carries the expected tone markers.
    const raw = JSON.stringify([
      { ScanDateTime: '2026-08-14 09:00', ScanType: 'Run', Courier: 'KEV Kev' },
      { ScanDateTime: '2026-08-14 08:45', ScanType: 'InvalidRun', Courier: 'KEV Kev' },
      { ScanDateTime: '2026-08-14 08:30', ScanType: 'Transit', Courier: '' },
    ]);
    server.use(
      stubRuns([runRow({ id: 1, name: 'AKL-HAM', toDepotId: 5 })]),
      stubOverview([]),
      ...stubLookups(),
      http.get('/api/runviewer/jobs/linehaul', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 99, jobNumber: 'JOB-99', clientCode: 'ACME',
            toAddress: '2 K Rd', pallet: 'P-1', items: 3, pickedUp: null,
            scanHistory: raw,
          }],
        })),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await screen.findByText('JOB-99');

    // The chip strip carries the data-testid + one chip per entry. Each
    // chip has data-scan-tone = green | red | grey.
    const strip = await screen.findByTestId('scan-history-chips');
    const chips = strip.querySelectorAll('[data-scan-tone]');
    expect(chips.length).toBe(3);
    expect(chips[0].getAttribute('data-scan-tone')).toBe('green');
    expect(chips[1].getAttribute('data-scan-tone')).toBe('red');
    expect(chips[2].getAttribute('data-scan-tone')).toBe('grey');
    // Chip label is the SP-emitted ScanType text.
    expect(chips[0].textContent).toBe('Run');
    expect(chips[1].textContent).toBe('InvalidRun');
    expect(chips[2].textContent).toBe('Transit');
  });

  it('renders a plain "-" when scanHistory is null / empty (never blank)', async () => {
    server.use(
      stubRuns([runRow({ id: 1, name: 'AKL-HAM', toDepotId: 5 })]),
      stubOverview([]),
      ...stubLookups(),
      http.get('/api/runviewer/jobs/linehaul', () =>
        HttpResponse.json({
          response: [{
            bulkJobId: 99, jobNumber: 'JOB-99', clientCode: 'ACME',
            toAddress: '2 K Rd', pallet: 'P-1', items: 3, pickedUp: null,
            scanHistory: '[]',
          }],
        })),
    );
    renderPage();
    await screen.findByText('AKL-HAM');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    await screen.findByText('JOB-99');
    // No chip strip when history is empty.
    expect(screen.queryByTestId('scan-history-chips')).toBeNull();
  });
});
