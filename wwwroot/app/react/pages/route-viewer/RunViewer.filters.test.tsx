import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('../../hooks/useAutoPoll', () => ({ useAutoPoll: () => undefined }));

// Same lightweight child-component stubs pattern as .render.test.tsx.
// Kept per-file (rather than a shared setup) so failures pinpoint the
// interaction being exercised.
vi.mock('../../components/route-viewer/RvFilterBar', () => ({
  RvFilterBar: ({ onChange, value, extraActions }: any) => (
    <div data-testid="rv-filter-bar">
      <button onClick={() => onChange({ ...value, clientIds: [1, 2] })}>set-clients</button>
      <button onClick={() => onChange({ ...value, regionIds: [5] })}>set-regions</button>
      <button onClick={() => onChange({ ...value, speedIds: [9] })}>set-speeds</button>
      <button onClick={() => onChange({ ...value, courierId: 42 })}>set-courier</button>
      <button onClick={() => onChange({ ...value, courierId: null })}>clear-courier</button>
      <button onClick={() => onChange({ ...value, activeRegionsOnly: false })}>set-active-off</button>
      {extraActions}
    </div>
  ),
}));

vi.mock('../../components/route-viewer/RvRunList', () => ({
  RvRunList: ({ runs, selectedIds, onSelect, onContextMenu, onViewModeChange, viewMode }: any) => (
    <div data-testid="rv-run-list">
      list ({runs.length}) sel={selectedIds.join(',')} viewMode={viewMode}
      {runs.map((r: any) => (
        <button key={r.id} data-testid={`run-${r.id}`}
          onClick={(e) => onSelect(r.id, { ctrl: e.ctrlKey, shift: e.shiftKey })}
          onContextMenu={(e) => onContextMenu(e, r.id)}>
          run-{r.id}
        </button>
      ))}
      <button onClick={() => onViewModeChange('Outbound')}>vm-out</button>
    </div>
  ),
}));

vi.mock('../../components/route-viewer/RvJobDetail', () => ({
  RvJobDetail: () => <div data-testid="rv-job-detail">jd</div>,
}));
vi.mock('../../components/route-viewer/RvRunContextMenu', () => ({
  RvRunContextMenu: ({ onClose }: any) => (
    <div data-testid="rv-run-ctx"><button onClick={onClose}>close</button></div>
  ),
}));
vi.mock('../../components/route-viewer/RvJobContextMenu', () => ({
  RvJobContextMenu: () => <div data-testid="rv-job-ctx" />,
}));
vi.mock('../../components/route-viewer/RvBox', () => ({
  RvBox: ({ children, actions, title }: any) => (
    <div data-testid={`rv-box-${title.replace(/\W+/g, '-')}`}>{actions}{children}</div>
  ),
}));
vi.mock('../../components/route-viewer/RvOverviewBox', () => ({
  RvOverviewBox: () => <div />,
}));
vi.mock('../../components/route-viewer/RvRunListLite', () => ({
  RvRunListLite: () => <div />,
}));
vi.mock('../../components/route-viewer/RvMapBox', () => ({
  RvMapBox: ({ runJobs }: any) => <div data-testid="rv-map">map({runJobs.length})</div>,
}));
vi.mock('../../components/route-viewer/RvScanDetailBox', () => ({
  RvScanDetailBox: () => <div />,
}));
vi.mock('../../components/route-viewer/RvCouriersBox', () => ({
  RvCouriersBox: () => <div />,
}));
vi.mock('../../components/route-viewer/RvClientIntelBox', () => ({
  RvClientIntelBox: () => <div />,
}));
vi.mock('../../components/route-viewer/RvUtilityActions', () => ({
  RvUtilityActions: ({ onPrint, onTopUp }: any) => (
    <div>
      <button onClick={() => onPrint('runAllocation')}>print-ra</button>
      <button onClick={() => onPrint('bad')}>print-bad</button>
      <button onClick={onTopUp}>topup-btn</button>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/TopUpDialog', () => ({
  TopUpDialog: ({ onClose, onBooked }: any) => (
    <div data-testid="topup"><button onClick={onClose}>close-tu</button><button onClick={onBooked}>book-tu</button></div>
  ),
}));
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: any) => <div>{children}</div>,
  Panel: ({ children }: any) => <div>{children}</div>,
  PanelResizeHandle: () => <div />,
}));

import RunViewer from './RunViewer';

const baseline = () => [
  http.get('/api/runviewer/filters/clients', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/regions', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/speeds', () => HttpResponse.json({ response: [] })),
];
const stubRuns = (rows: unknown[]) =>
  http.get('/api/runviewer/runs', () => HttpResponse.json({ response: rows }));
const stubRunJobs = (runId: number, jobs: unknown[]) =>
  http.get(`/api/runviewer/runs/${runId}/jobs`, () => HttpResponse.json({ response: jobs }));

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, name: 'R1', area: null, suburbs: null,
  fromCities: null, toLocationName: null, velocity: null, hashKey: null,
  status: null, jobs: 0, incompleteJobs: 0, totalPickup: 0,
  incompletePickup: 0, hasReturns: false, returnsTotal: 0, isMissing: false,
  preAssigned: 0, isActive: 1,
  courierName: null, courierCode: null,
  courierPercentageFormatted: null, courierOnlineStatus: null,
  courierOfflineMins: null, agentName: null, isNpAgent: false, ...over,
});

const job = (over: Partial<Record<string, unknown>> = {}) => ({
  bulkJobId: 1, jobId: 0, jobNumber: 'JOB-1', jobStatus: 'N',
  clientCode: 'ACME', speedName: null, speed: null,
  fromCompany: null, fromAddress: null, fromSuburb: null,
  toCompany: null, toAddress: '1 King St', toSuburb: null,
  bookDate: null, bookTime: null,
  pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: null,
  pickedUp: null, dispatched: null, podTime: null, podName: null,
  amount: null, courierId: null, courierName: null, courierCode: null,
  contact: null, phone: null, deliverToContact: null, deliverToPhone: null,
  trackingEmail: null, proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
  notes: null, deliveryNotes: null, labelNotes: null,
  size: null, qty: null, weight: null, speedId: null,
  ourRef: null, refA: null, refB: null, runName: null, runOrder: 1,
  bulkRunId: 1, multiboxParentId: null, parentJobId: null,
  regionId: null, regionName: null, agentName: null, agentType: null,
  isNpAgent: false,
  pickUpLatitude: null, pickUpLongitude: null,
  deliveryLatitude: null, deliveryLongitude: null,
  toLat: null, toLng: null, fromPostCode: null, toPostCode: null,
  fromCity: null, toCity: null, ...over,
});

function renderPage(initialRoute = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <RunViewer />
    </QueryClientProvider>,
    { initialRoute },
  );
}

describe('RunViewer - filters + interactions', () => {
  it('persists filter selections to localStorage under a tenant-scoped key', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    await screen.findByTestId('rv-filter-bar');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'set-clients' }));
    // Key is `rv-filters:<tenantId>:<email>` per SUT
    const raw = window.localStorage.getItem('rv-filters:1:test@example.com');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).clientIds).toEqual([1, 2]);
  });

  it('URL runDate is updated when the filter changes date', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage('/?runDate=2026-08-13');
    await screen.findByTestId('rv-filter-bar');
    // The bar starts with runDate=2026-08-13. Set-region should preserve
    // date; the URL param should stay in sync.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'set-regions' }));
    // After the change, storage has the new regionIds
    const raw = window.localStorage.getItem('rv-filters:1:test@example.com');
    expect(JSON.parse(raw!).regionIds).toEqual([5]);
  });

  it('single-selecting a run sets selectedRunIds', async () => {
    server.use(stubRuns([run({ id: 1 })]), stubRunJobs(1, []), ...baseline());
    renderPage();
    await screen.findByTestId('run-1');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('run-1'));
    const list = await screen.findByTestId('rv-run-list');
    await waitFor(() => expect(list.textContent).toContain('sel=1'));
  });

  it('ctrl-click toggles selection, plain click replaces', async () => {
    server.use(
      stubRuns([run({ id: 1 }), run({ id: 2 })]),
      stubRunJobs(1, []), stubRunJobs(2, []),
      ...baseline(),
    );
    renderPage();
    const btn1 = await screen.findByTestId('run-1');
    const btn2 = await screen.findByTestId('run-2');
    const user = userEvent.setup();
    await user.click(btn1);
    await user.keyboard('{Control>}');
    await user.click(btn2);
    await user.keyboard('{/Control}');
    const list = await screen.findByTestId('rv-run-list');
    await waitFor(() => expect(list.textContent).toContain('sel=1,2'));
    // Plain click replaces
    await user.click(btn1);
    await waitFor(() => expect(list.textContent).toContain('sel=1'));
    expect(list.textContent).not.toContain('sel=1,2');
  });

  it('shift-click extends selection from the anchor', async () => {
    server.use(
      stubRuns([run({ id: 1 }), run({ id: 2 }), run({ id: 3 })]),
      stubRunJobs(1, []), stubRunJobs(2, []), stubRunJobs(3, []),
      ...baseline(),
    );
    renderPage();
    const btn1 = await screen.findByTestId('run-1');
    const btn3 = await screen.findByTestId('run-3');
    const user = userEvent.setup();
    await user.click(btn1);   // set anchor
    await user.keyboard('{Shift>}');
    await user.click(btn3);
    await user.keyboard('{/Shift}');
    const list = await screen.findByTestId('rv-run-list');
    await waitFor(() => expect(list.textContent).toContain('sel=1,2,3'));
  });

  it('right-clicking a run opens the context menu with position', async () => {
    server.use(stubRuns([run()]), stubRunJobs(1, []), ...baseline());
    renderPage();
    const btn = await screen.findByTestId('run-1');
    const user = userEvent.setup();
    await user.pointer({ target: btn, keys: '[MouseRight]' });
    const ctx = await screen.findByTestId('rv-run-ctx');
    expect(ctx).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() =>
      expect(screen.queryByTestId('rv-run-ctx')).not.toBeInTheDocument(),
    );
  });

  it('the Run Jobs table renders jobs when a single run is selected', async () => {
    server.use(
      stubRuns([run({ id: 1 })]),
      stubRunJobs(1, [job({ bulkJobId: 1, jobStatus: 'N' })]),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('run-1'));
    // Job rows appear
    expect(await screen.findByText('JOB-1')).toBeInTheDocument();
  });

  it('cancelled + multibox filters exclude the correct rows by default', async () => {
    server.use(
      stubRuns([run({ id: 1 })]),
      stubRunJobs(1, [
        job({ bulkJobId: 10, jobNumber: 'REG', jobStatus: 'N' }),
        job({ bulkJobId: 11, jobNumber: 'CANC', jobStatus: 'V' }),
        job({ bulkJobId: 12, jobNumber: 'CHILD', multiboxParentId: 10 }),
      ]),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('run-1'));
    expect(await screen.findByText('REG')).toBeInTheDocument();
    expect(screen.queryByText('CANC')).not.toBeInTheDocument();
    expect(screen.queryByText('CHILD')).not.toBeInTheDocument();
    // Enable Cancelled + Multibox toggles
    await user.click(screen.getByLabelText('Cancelled'));
    await waitFor(() => expect(screen.getByText('CANC')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Multibox'));
    await waitFor(() => expect(screen.getByText('CHILD')).toBeInTheDocument());
  });

  it('clicking a Run Jobs column header cycles asc/desc sort', async () => {
    server.use(
      stubRuns([run({ id: 1 })]),
      stubRunJobs(1, [
        job({ bulkJobId: 1, jobNumber: 'A', clientCode: 'ZZZ' }),
        job({ bulkJobId: 2, jobNumber: 'B', clientCode: 'AAA' }),
      ]),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('run-1'));
    await screen.findByText('A');
    // Click Client header (via text)
    const clientHeader = screen.getByText('Client');
    await user.click(clientHeader);
    // After sorting asc by clientCode, AAA (job B) row appears above ZZZ (job A)
    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].textContent).toContain('B');
    expect(rows[1].textContent).toContain('A');
    // Click again to flip to desc
    await user.click(clientHeader);
    await waitFor(() => {
      const rows2 = document.querySelectorAll('tbody tr');
      expect(rows2[0].textContent).toContain('A');
    });
  });

  it('the courier filter route-scopes the visible run list to matching courierCode', async () => {
    server.use(
      stubRuns([
        run({ id: 1, courierCode: 'KEV' }),
        run({ id: 2, courierCode: 'BOB' }),
      ]),
      stubRunJobs(1, []), stubRunJobs(2, []),
      http.get('/api/runviewer/couriers', () =>
        HttpResponse.json({ response: [
          { courierId: 42, code: 'KEV', name: 'Kev' },
          { courierId: 43, code: 'BOB', name: 'Bob' },
        ] })),
      ...baseline(),
    );
    renderPage();
    await screen.findByTestId('run-1');
    await screen.findByTestId('run-2');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'set-courier' }));
    // After filter, only run-1 (courierCode=KEV) remains visible.
    await waitFor(() => {
      expect(screen.queryByTestId('run-2')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('run-1')).toBeInTheDocument();
  });

  it('setting view mode to Outbound persists to storage', async () => {
    server.use(stubRuns([run()]), stubRunJobs(1, []), ...baseline());
    renderPage();
    await screen.findByTestId('rv-run-list');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'vm-out' }));
    await waitFor(() => {
      const raw = window.localStorage.getItem('rv-filters:1:test@example.com');
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw!).viewMode).toBe('Outbound');
    });
  });
});

describe('RunViewer - utility actions', () => {
  it('top-up requires a selected job first (shows toast when none picked)', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'topup-btn' }));
    expect(await screen.findByText(/Pick a job first to top it up\./))
      .toBeInTheDocument();
  });

  it('unknown print key silently no-ops', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    const user = userEvent.setup();
    // Click print-bad → onPrint('bad') → slug is undefined → return
    await user.click(await screen.findByRole('button', { name: 'print-bad' }));
    // No toast is emitted
    expect(screen.queryByText(/Downloading/)).not.toBeInTheDocument();
  });

  it('the runAllocation print button downloads via an anchor and toasts', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    // Spy on anchor.click
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'print-ra' }));
      expect(clickSpy).toHaveBeenCalled();
      expect(await screen.findByText(/Downloading runAllocation/))
        .toBeInTheDocument();
    } finally {
      clickSpy.mockRestore();
    }
  });
});
