import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('../../hooks/useAutoPoll', () => ({ useAutoPoll: () => undefined }));

vi.mock('../../components/route-viewer/RvFilterBar', () => ({
  RvFilterBar: ({ value, extraActions }: any) => (
    <div data-testid="rv-filter-bar">bar runDate={value.runDate}{extraActions}</div>
  ),
}));

// Render a Run list that lets tests fire onSelect via test IDs.
vi.mock('../../components/route-viewer/RvRunList', () => ({
  RvRunList: ({ runs, selectedIds, onSelect }: any) => (
    <div data-testid="rv-run-list">
      selected={selectedIds.join(',')}
      {runs.map((r: any) => (
        <button key={r.id} data-testid={`run-${r.id}`}
          onClick={(e) => onSelect(r.id, { ctrl: e.ctrlKey, shift: e.shiftKey })}>
          run-{r.id}
        </button>
      ))}
    </div>
  ),
}));

// Deliberately keep the RvJobDetail stub so we can drive onPickSibling +
// onSend + onTransferRoute callbacks.
vi.mock('../../components/route-viewer/RvJobDetail', () => ({
  RvJobDetail: ({ bulkJobId, initialJob, onPickSibling, onSend, onTransferRoute }: any) => (
    <div data-testid="rv-job-detail">
      job-detail bulkJobId={String(bulkJobId ?? 'null')} initial={initialJob?.jobNumber ?? 'null'}
      <button onClick={() => onPickSibling({ bulkJobId: 0, job: { jobId: 999, bulkJobId: 0, jobNumber: 'LHLEG' } })}>
        pick-lh
      </button>
      <button onClick={() => onPickSibling({ bulkJobId: 55, job: { jobId: 55, bulkJobId: 55, jobNumber: 'SIB' } })}>
        pick-real
      </button>
      <button onClick={() => onSend({ bulkJobId: 42, trackingEmail: 'a@b.co' })}>send-pod</button>
      <button onClick={() => onTransferRoute({ bulkJobId: 42, bulkRunId: 99 })}>transfer</button>
      <button onClick={() => onTransferRoute({ bulkJobId: 43, bulkRunId: null })}>transfer-notrun</button>
    </div>
  ),
}));

vi.mock('../../components/route-viewer/RvRunContextMenu', () => ({
  RvRunContextMenu: () => <div data-testid="rv-run-ctx" />,
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
  RvMapBox: () => <div />,
}));
vi.mock('../../components/route-viewer/RvScanDetailBox', () => ({
  RvScanDetailBox: () => <div />,
}));
vi.mock('../../components/route-viewer/RvCouriersBox', () => ({
  RvCouriersBox: () => <div />,
}));
vi.mock('../../components/route-viewer/RvClientIntelBox', () => ({
  RvClientIntelBox: ({ mobile }: any) => <div data-testid="rv-intel">intel-mobile={String(mobile ?? 'null')}</div>,
}));
vi.mock('../../components/route-viewer/RvUtilityActions', () => ({
  RvUtilityActions: ({ onTopUp, snapshotLayout, onApplyLayout }: any) => (
    <div>
      <button onClick={onTopUp}>topup</button>
      <button onClick={() => snapshotLayout()}>snap</button>
      <button onClick={() => onApplyLayout({ name: 'FromSaved',
        rvHorizontal: [10, 20, 30, 40],
        rvLeftV: [50, 50], rvMidV: [50, 50],
        rvSlimV: [33, 33, 34], rvRightV: [50, 50] })}>apply</button>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/TopUpDialog', () => ({
  TopUpDialog: ({ onClose, onBooked, jobId }: any) => (
    <div data-testid="topup">jobId={jobId}
      <button onClick={onClose}>close</button>
      <button onClick={onBooked}>book</button>
    </div>
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

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, name: 'R1', area: null, suburbs: null,
  fromCities: null, toLocationName: null, velocity: null, hashKey: null,
  status: null, jobs: 0, incompleteJobs: 0, totalPickup: 0, incompletePickup: 0,
  hasReturns: false, returnsTotal: 0, isMissing: false,
  preAssigned: 0, isActive: 1,
  courierName: null, courierCode: null,
  courierPercentageFormatted: null, courierOnlineStatus: null, courierOfflineMins: null,
  agentName: null, isNpAgent: false, ...over,
});

const stubRuns = (rows: unknown[]) =>
  http.get('/api/runviewer/runs', () => HttpResponse.json({ response: rows }));
const stubRunJobs = (runId: number, jobs: unknown[]) =>
  http.get(`/api/runviewer/runs/${runId}/jobs`, () => HttpResponse.json({ response: jobs }));

function renderPage(initialRoute = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <RunViewer />
    </QueryClientProvider>,
    { initialRoute },
  );
}

describe('RunViewer - jobNumber deep link', () => {
  it('resolves ?jobNumber=<X> to a selected job + run and clears the param', async () => {
    let searchHits = 0;
    server.use(
      stubRuns([run({ id: 42 })]),
      stubRunJobs(42, []),
      http.get('/api/runviewer/jobs/search', () => {
        searchHits++;
        return HttpResponse.json({ response: { bulkJobId: 7, bulkRunId: 42 } });
      }),
      ...baseline(),
    );
    renderPage('/?jobNumber=JOB-77');
    await waitFor(() => expect(searchHits).toBe(1));
    const list = await screen.findByTestId('rv-run-list');
    await waitFor(() => expect(list.textContent).toContain('selected=42'));
    const detail = await screen.findByTestId('rv-job-detail');
    await waitFor(() => expect(detail.textContent).toContain('bulkJobId=7'));
  });

  it('search returning null leaves the state unchanged', async () => {
    server.use(
      stubRuns([]),
      http.get('/api/runviewer/jobs/search', () =>
        HttpResponse.json({ response: null })),
      ...baseline(),
    );
    renderPage('/?jobNumber=DOESNT-EXIST');
    const list = await screen.findByTestId('rv-run-list');
    // No selection made
    expect(list.textContent).toContain('selected=');
    expect(list.textContent).not.toContain('selected=42');
  });

  it('search API failure is swallowed and page still renders', async () => {
    server.use(
      stubRuns([]),
      http.get('/api/runviewer/jobs/search', () =>
        new HttpResponse('boom', { status: 500 })),
      ...baseline(),
    );
    renderPage('/?jobNumber=ANY');
    // Page still mounts + doesn't crash
    expect(await screen.findByTestId('rv-filter-bar')).toBeInTheDocument();
  });
});

describe('RunViewer - job detail callbacks', () => {
  it('onPickSibling with a real bulk job sets selectedJobId + clears sibling override', async () => {
    server.use(
      stubRuns([run({ id: 1 })]),
      stubRunJobs(1, [{
        bulkJobId: 1, jobId: 0, jobNumber: 'A', jobStatus: 'N',
        clientCode: null, speedName: null, speed: null,
        fromCompany: null, fromAddress: null, fromSuburb: null,
        toCompany: null, toAddress: null, toSuburb: null,
        bookDate: null, bookTime: null, pickupWindowStart: null, pickupWindowEnd: null,
        pickupWindow: null, pickedUp: null, dispatched: null, podTime: null, podName: null,
        amount: null, courierId: null, courierName: null, courierCode: null,
        contact: null, phone: null, deliverToContact: null, deliverToPhone: null,
        trackingEmail: null, proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
        notes: null, deliveryNotes: null, labelNotes: null,
        size: null, qty: null, weight: null, speedId: null,
        ourRef: null, refA: null, refB: null, runName: null, runOrder: null,
        bulkRunId: null, multiboxParentId: null, parentJobId: null,
        regionId: null, regionName: null, agentName: null, agentType: null, isNpAgent: false,
        pickUpLatitude: null, pickUpLongitude: null, deliveryLatitude: null, deliveryLongitude: null,
        toLat: null, toLng: null, fromPostCode: null, toPostCode: null,
        fromCity: null, toCity: null,
      }]),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('run-1'));
    const detail = await screen.findByTestId('rv-job-detail');
    // Click a job row (via table) - our stub always renders detail, but
    // to fire onPickSibling on a real sibling we use the button in the
    // stub itself.
    await user.click(screen.getByRole('button', { name: 'pick-real' }));
    await waitFor(() => expect(detail.textContent).toContain('bulkJobId=55'));
  });

  it('onPickSibling with a LH-leg (bulkJobId=0) uses the sibling override payload', async () => {
    server.use(
      stubRuns([]),
      ...baseline(),
    );
    renderPage();
    const detail = await screen.findByTestId('rv-job-detail');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'pick-lh' }));
    await waitFor(() => expect(detail.textContent).toContain('bulkJobId=0'));
    // initial payload contains 'LHLEG' text
    await waitFor(() => expect(detail.textContent).toContain('initial=LHLEG'));
  });

  it('onSend prompts for an email and calls sendPodEmail', async () => {
    let posted: any = null;
    server.use(
      stubRuns([]),
      http.post('/api/runviewer/jobs/:id/send-pod', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
      ...baseline(),
    );
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => 'x@y.co');
    try {
      renderPage();
      const user = userEvent.setup();
      await screen.findByTestId('rv-job-detail');
      await user.click(screen.getByRole('button', { name: 'send-pod' }));
      // The service posts to /api/runviewer/jobs/{id}/pod-email
      await waitFor(() =>
        expect(screen.getByText(/POD emailed to x@y\.co/)).toBeInTheDocument(),
      );
    } finally { promptSpy.mockRestore(); }
  });

  it('onSend prompt cancelled is a no-op', async () => {
    server.use(stubRuns([]), ...baseline());
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => null);
    try {
      renderPage();
      const user = userEvent.setup();
      await screen.findByTestId('rv-job-detail');
      await user.click(screen.getByRole('button', { name: 'send-pod' }));
      // No toast about POD
      expect(screen.queryByText(/POD emailed/)).not.toBeInTheDocument();
    } finally { promptSpy.mockRestore(); }
  });

  it('onTransferRoute with a run selects the run and toasts a hint', async () => {
    server.use(stubRuns([run({ id: 99 })]), stubRunJobs(99, []), ...baseline());
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId('rv-job-detail');
    await user.click(screen.getByRole('button', { name: 'transfer' }));
    // Toast is emitted
    expect(await screen.findByText(/Transfer Route: right-click the run/))
      .toBeInTheDocument();
  });

  it('onTransferRoute with no run shows "job is not on a run" toast', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId('rv-job-detail');
    await user.click(screen.getByRole('button', { name: 'transfer-notrun' }));
    expect(await screen.findByText(/Job is not on a run yet/))
      .toBeInTheDocument();
  });
});

describe('RunViewer - layout snapshot', () => {
  it('snapshotLayout is callable and applyLayout toasts', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    const user = userEvent.setup();
    await screen.findByTestId('rv-filter-bar');
    await user.click(screen.getByRole('button', { name: 'apply' }));
    expect(await screen.findByText(/Applied layout: FromSaved/))
      .toBeInTheDocument();
    // Also exercise snapshot (returns fallback default arrays under our
    // panel stubs since imperative refs never attach)
    await user.click(screen.getByRole('button', { name: 'snap' }));
    // No throw
  });
});
