import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

// Every heavy child component gets a light identity stub so we can test the
// RunViewer's own composition + delegation. The unit tests for those
// children live in their own files.
vi.mock('../../hooks/useAutoPoll', () => ({ useAutoPoll: () => undefined }));
vi.mock('../../components/route-viewer/RvFilterBar', () => ({
  RvFilterBar: ({ onChange, onRefresh, isRefreshing, extraActions, value }: any) => (
    <div data-testid="rv-filter-bar">
      filter-bar runDate={value.runDate}
      <button onClick={() => onChange({ ...value, regionIds: [7] })}>set-region</button>
      <button onClick={() => onChange({ ...value, runDate: '2026-08-14' })}>set-date</button>
      <button onClick={onRefresh}>refresh</button>
      <span>refreshing={String(!!isRefreshing)}</span>
      <div>{extraActions}</div>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/RvRunList', () => ({
  RvRunList: ({ runs, onSelect, onContextMenu, onViewModeChange, viewMode, onDropCourier }: any) => (
    <div data-testid="rv-run-list">
      run-list ({runs.length} rows) viewMode={viewMode}
      {runs.map((r: any) => (
        <button key={r.id}
          onClick={(e) => onSelect(r.id, { ctrl: e.ctrlKey, shift: e.shiftKey })}
          onContextMenu={(e) => onContextMenu(e, r.id)}
        >
          run-{r.id}
        </button>
      ))}
      <button onClick={() => onViewModeChange('Inbound')}>vm-inbound</button>
      <button onClick={() => onDropCourier(1, 'KEV')}>drop-courier</button>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/RvJobDetail', () => ({
  RvJobDetail: ({ bulkJobId, onPickSibling, onPrint, onSend, onTransferRoute, initialJob }: any) => (
    <div data-testid="rv-job-detail">
      job-detail bulkJobId={String(bulkJobId ?? 'null')}
      <button onClick={() => onPickSibling({ bulkJobId: 0, job: { jobId: 999, bulkJobId: 0, jobNumber: 'LH1' } })}>
        pick-lh-leg
      </button>
      <button onClick={() => onPickSibling({ bulkJobId: 5, job: { jobId: 5, bulkJobId: 5, jobNumber: 'REAL' } })}>
        pick-real-sib
      </button>
      <button onClick={onPrint}>print-job</button>
      <button onClick={() => onSend({ bulkJobId: 42, trackingEmail: 'a@b.com' })}>send-pod</button>
      <button onClick={() => onTransferRoute({ bulkJobId: 42, bulkRunId: 99 })}>transfer-route</button>
      <span>initialJob={initialJob?.jobNumber ?? 'null'}</span>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/RvRunContextMenu', () => ({
  RvRunContextMenu: ({ x, y, runId, onClose, onDone }: any) => (
    <div data-testid="rv-run-ctx">
      ctx run={runId} x={x} y={y}
      <button onClick={onClose}>close-ctx</button>
      <button onClick={onDone}>done-ctx</button>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/RvJobContextMenu', () => ({
  RvJobContextMenu: ({ jobs, onClose, onDone }: any) => (
    <div data-testid="rv-job-ctx">
      job-ctx jobs={jobs.length}
      <button onClick={onClose}>close-job-ctx</button>
      <button onClick={onDone}>done-job-ctx</button>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/RvBox', () => ({
  RvBox: ({ title, actions, children }: any) => (
    <div data-testid={`rv-box-${title.replace(/\W+/g, '-').toLowerCase()}`}>
      <h4>{title}</h4>
      <div>{actions}</div>
      <div>{children}</div>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/RvOverviewBox', () => ({
  RvOverviewBox: ({ onRegionPick }: any) => (
    <div data-testid="rv-overview">
      overview<button onClick={() => onRegionPick(11)}>pick-region</button>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/RvRunListLite', () => ({
  RvRunListLite: ({ variant, runs }: any) => (
    <div data-testid={`rv-lite-${variant}`}>lite-{variant} ({runs.length})</div>
  ),
}));
vi.mock('../../components/route-viewer/RvMapBox', () => ({
  RvMapBox: ({ runJobs }: any) => (
    <div data-testid="rv-map-box">map ({runJobs.length})</div>
  ),
}));
vi.mock('../../components/route-viewer/RvScanDetailBox', () => ({
  RvScanDetailBox: ({ selectedJobId }: any) => (
    <div data-testid="rv-scan">scan={String(selectedJobId ?? 'null')}</div>
  ),
}));
vi.mock('../../components/route-viewer/RvCouriersBox', () => ({
  RvCouriersBox: ({ onPick }: any) => (
    <div data-testid="rv-couriers">
      couriers<button onClick={() => onPick({ courierId: 77, code: 'KEV', name: 'Kev Tester' })}>pick-courier</button>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/RvClientIntelBox', () => ({
  RvClientIntelBox: ({ mobile }: any) => (
    <div data-testid="rv-intel">intel-mobile={String(mobile ?? 'null')}</div>
  ),
}));
vi.mock('../../components/route-viewer/RvUtilityActions', () => ({
  RvUtilityActions: ({ onPrint, onTopUp, onApplyLayout, snapshotLayout }: any) => (
    <div data-testid="rv-util">
      <button onClick={() => onPrint('runAllocation')}>print-ra</button>
      <button onClick={() => onPrint('woop')}>print-woop</button>
      <button onClick={() => onPrint('unknownKey')}>print-unknown</button>
      <button onClick={onTopUp}>topup</button>
      <button onClick={() => onApplyLayout({ name: 'LayoutX', rvHorizontal: [20, 30, 20, 30] })}>apply-layout</button>
      <button onClick={() => snapshotLayout()}>snap-layout</button>
    </div>
  ),
}));
vi.mock('../../components/route-viewer/TopUpDialog', () => ({
  TopUpDialog: ({ onClose, onBooked, jobId }: any) => (
    <div data-testid="rv-topup">
      topup jobId={jobId}
      <button onClick={onClose}>close-topup</button>
      <button onClick={onBooked}>book-topup</button>
    </div>
  ),
}));
// react-resizable-panels wraps our tree with Panel + PanelGroup; passthrough.
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: any) => <div>{children}</div>,
  Panel: ({ children }: any) => <div>{children}</div>,
  PanelResizeHandle: () => <div data-testid="handle" />,
}));

import RunViewer from './RunViewer';

const baselineHandlers = () => [
  http.get('/api/runviewer/filters/clients', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/regions', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/speeds', () => HttpResponse.json({ response: [] })),
];

const stubRuns = (rows: unknown[]) =>
  http.get('/api/runviewer/runs', () => HttpResponse.json({ response: rows }));

const run = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, name: 'RUN-1', area: 'AKL', suburbs: '',
  fromCities: null, toLocationName: null,
  velocity: null, hashKey: null, status: null,
  jobs: 3, incompleteJobs: 3, totalPickup: 0, incompletePickup: 0,
  hasReturns: false, returnsTotal: 0, isMissing: false,
  preAssigned: 0, isActive: 1,
  courierName: 'Kev', courierCode: 'KEV',
  courierPercentageFormatted: null,
  courierOnlineStatus: null, courierOfflineMins: null,
  agentName: null, isNpAgent: false, ...over,
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

describe('RunViewer - render', () => {
  it('renders the filter bar + delegated cockpit boxes for an admin user', async () => {
    server.use(stubRuns([run()]), ...baselineHandlers());
    renderPage();
    expect(await screen.findByTestId('rv-filter-bar')).toBeInTheDocument();
    // Left column
    expect(screen.getByTestId('rv-overview')).toBeInTheDocument();
    expect(screen.getByTestId('rv-run-list')).toBeInTheDocument();
    // Slim column (admin-only) is present because default AppUser
    // isn't a network partner.
    expect(screen.getByTestId('rv-lite-preAssigned')).toBeInTheDocument();
    expect(screen.getByTestId('rv-lite-returns')).toBeInTheDocument();
    expect(screen.getByTestId('rv-lite-exceptions')).toBeInTheDocument();
    // Right column
    expect(screen.getByTestId('rv-map-box')).toBeInTheDocument();
    expect(screen.getByTestId('rv-couriers')).toBeInTheDocument();
    expect(screen.getByTestId('rv-intel')).toBeInTheDocument();
    expect(screen.getByTestId('rv-scan')).toBeInTheDocument();
  });

  it('hides the slim column for network-partner users', async () => {
    const original = (window as any).__APP_USER__;
    (window as any).__APP_USER__ = { ...original, isNetworkPartner: true };
    try {
      server.use(stubRuns([]), ...baselineHandlers());
      renderPage();
      await screen.findByTestId('rv-filter-bar');
      expect(screen.queryByTestId('rv-lite-preAssigned')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rv-lite-returns')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rv-lite-exceptions')).not.toBeInTheDocument();
    } finally { (window as any).__APP_USER__ = original; }
  });

  it('shows "Pick a run to see its jobs." when nothing is selected', async () => {
    server.use(stubRuns([]), ...baselineHandlers());
    renderPage();
    expect(await screen.findByText(/Pick a run to see its jobs\./))
      .toBeInTheDocument();
  });

  it('applies the ?runDate=<...> query param to the filter state', async () => {
    server.use(stubRuns([]), ...baselineHandlers());
    renderPage('/?runDate=2026-08-14');
    const bar = await screen.findByTestId('rv-filter-bar');
    expect(bar.textContent).toContain('runDate=2026-08-14');
  });

  it('the RunList is rendered with the runs returned by the query', async () => {
    server.use(stubRuns([run({ id: 1 }), run({ id: 2 })]), ...baselineHandlers());
    renderPage();
    const list = await screen.findByTestId('rv-run-list');
    await waitFor(() => expect(list.textContent).toContain('run-list (2 rows)'));
  });
});
