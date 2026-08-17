import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

// Legacy homeView.html:438-457 wired Up/Down arrows to move the .active
// row across whichever .activeTable last received a click. This test
// exercises the React port: Run List / Run Jobs / Pre Assigned /
// Returns / Exceptions each report their visible row order back to
// RunViewer, and Up/Down single-selects the prev/next row within the
// most-recently-clicked table.

vi.mock('../../hooks/useAutoPoll', () => ({ useAutoPoll: () => undefined }));

vi.mock('../../components/route-viewer/RvFilterBar', () => ({
  RvFilterBar: ({ value, extraActions }: any) => (
    <div data-testid="rv-filter-bar">bar runDate={value.runDate}{extraActions}</div>
  ),
}));

// The RvRunList stub reports a fixed visible-run order (sorted by id
// ascending) via the new onVisibleRunsChange prop. The parent stores
// it in a ref and drives arrow-key navigation from there. Stub does
// not implement the internal sort - the child's actual sorted output
// is exercised in RvRunList.test.tsx.
vi.mock('../../components/route-viewer/RvRunList', () => ({
  RvRunList: ({ runs, selectedIds, onSelect, onVisibleRunsChange }: any) => {
    if (onVisibleRunsChange) {
      // Report immediately so the parent's ref is populated on first render.
      queueMicrotask(() => onVisibleRunsChange(runs.map((r: any) => r.id)));
    }
    return (
      <div data-testid="rv-run-list">
        selected={selectedIds.join(',')}
        {runs.map((r: any) => (
          <button key={r.id} data-testid={`run-${r.id}`}
            onClick={(e) => onSelect(r.id, { ctrl: e.ctrlKey, shift: e.shiftKey })}>
            run-{r.id}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock('../../components/route-viewer/RvRunListLite', () => ({
  RvRunListLite: ({ variant, runs, selectedIds, onSelect, onVisibleRunsChange }: any) => {
    // Slim tables filter their variant client-side; the test seeds runs
    // where every row matches every variant so the parent's ref gets
    // the full id list back in each of preAssigned / returns / exceptions.
    if (onVisibleRunsChange) queueMicrotask(() => onVisibleRunsChange(runs.map((r: any) => r.id)));
    return (
      <div data-testid={`rv-lite-${variant}`}>
        lite-{variant} sel={selectedIds.join(',')}
        {runs.map((r: any) => (
          <button key={r.id} data-testid={`lite-${variant}-${r.id}`}
            onClick={(e) => onSelect(r.id, { ctrl: e.ctrlKey, shift: e.shiftKey })}>
            {variant}-{r.id}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock('../../components/route-viewer/RvJobDetail', () => ({
  RvJobDetail: ({ bulkJobId }: any) => (
    <div data-testid="rv-job-detail">jd={String(bulkJobId ?? 'null')}</div>
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
vi.mock('../../components/route-viewer/RvOverviewBox', () => ({ RvOverviewBox: () => <div /> }));
vi.mock('../../components/route-viewer/RvMapBox', () => ({
  RvMapBox: ({ runJobs }: any) => <div data-testid="rv-map">map({runJobs.length})</div>,
}));
vi.mock('../../components/route-viewer/RvScanDetailBox', () => ({ RvScanDetailBox: () => <div /> }));
vi.mock('../../components/route-viewer/RvCouriersBox', () => ({ RvCouriersBox: () => <div /> }));
vi.mock('../../components/route-viewer/RvClientIntelBox', () => ({ RvClientIntelBox: () => <div /> }));
vi.mock('../../components/route-viewer/RvUtilityActions', () => ({ RvUtilityActions: () => <div /> }));
vi.mock('../../components/route-viewer/TopUpDialog', () => ({ TopUpDialog: () => <div /> }));
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
  incompletePickup: 0, hasReturns: true, returnsTotal: 0, isMissing: true,
  preAssigned: 1, isActive: 1,
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

function pressArrow(key: 'ArrowDown' | 'ArrowUp') {
  // useHotkeys binds to `document`; dispatching directly to `document`
  // simulates the keydown that reaches the global listener.
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('RunViewer - arrow-key navigation', () => {
  it('ArrowDown from empty selection jumps to the first Run List row', async () => {
    server.use(
      stubRuns([run({ id: 10 }), run({ id: 20 }), run({ id: 30 })]),
      stubRunJobs(10, []), stubRunJobs(20, []), stubRunJobs(30, []),
      ...baseline(),
    );
    renderPage();
    await screen.findByTestId('run-10');
    // Let the microtask that reports visible ids drain before pressing.
    await Promise.resolve();
    pressArrow('ArrowDown');
    const list = await screen.findByTestId('rv-run-list');
    await waitFor(() => expect(list.textContent).toContain('selected=10'));
  });

  it('ArrowDown / ArrowUp cycle single-select through Run List rows', async () => {
    server.use(
      stubRuns([run({ id: 10 }), run({ id: 20 }), run({ id: 30 })]),
      stubRunJobs(10, []), stubRunJobs(20, []), stubRunJobs(30, []),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('run-10'));
    const list = await screen.findByTestId('rv-run-list');
    await waitFor(() => expect(list.textContent).toContain('selected=10'));
    // Give the mock's microtask time to report visible ids.
    await Promise.resolve();
    pressArrow('ArrowDown');
    await waitFor(() => expect(list.textContent).toContain('selected=20'));
    pressArrow('ArrowDown');
    await waitFor(() => expect(list.textContent).toContain('selected=30'));
    // Clamps at the tail; another Down is a no-op.
    pressArrow('ArrowDown');
    await waitFor(() => expect(list.textContent).toContain('selected=30'));
    pressArrow('ArrowUp');
    await waitFor(() => expect(list.textContent).toContain('selected=20'));
  });

  it('clicking Pre Assigned re-focuses arrow-key navigation to that table', async () => {
    server.use(
      stubRuns([run({ id: 10 }), run({ id: 20 })]),
      stubRunJobs(10, []), stubRunJobs(20, []),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    // First stamp Run List as focused so the state transition is real.
    await user.click(await screen.findByTestId('run-10'));
    // Now click Pre Assigned to move focus.
    const preAssignedBtn = await screen.findByTestId('lite-preAssigned-10');
    await user.click(preAssignedBtn);
    // Arrow should now walk the pre-assigned rows (still 10 -> 20).
    const list = await screen.findByTestId('rv-run-list');
    await Promise.resolve();
    pressArrow('ArrowDown');
    await waitFor(() => expect(list.textContent).toContain('selected=20'));
  });

  it('clicking a job then ArrowDown moves selection within the Run Jobs table', async () => {
    server.use(
      stubRuns([run({ id: 10 })]),
      stubRunJobs(10, [
        job({ bulkJobId: 100, jobNumber: 'J100' }),
        job({ bulkJobId: 101, jobNumber: 'J101' }),
        job({ bulkJobId: 102, jobNumber: 'J102' }),
      ]),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('run-10'));
    // Click the first job row.
    const j100 = await screen.findByText('J100');
    await user.click(j100);
    // ArrowDown moves the run-jobs selection to the next row; the
    // JobDetail stub renders `jd=<bulkJobId>` so we can read it.
    pressArrow('ArrowDown');
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail').textContent).toContain('jd=101'),
    );
    pressArrow('ArrowDown');
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail').textContent).toContain('jd=102'),
    );
    pressArrow('ArrowUp');
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail').textContent).toContain('jd=101'),
    );
  });

  it('does not move selection when an input is focused (arrow keys keep native caret behaviour)', async () => {
    server.use(
      stubRuns([run({ id: 10 }), run({ id: 20 })]),
      stubRunJobs(10, []), stubRunJobs(20, []),
      ...baseline(),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('run-10'));
    const list = await screen.findByTestId('rv-run-list');
    await waitFor(() => expect(list.textContent).toContain('selected=10'));
    // Insert a focused input and dispatch ArrowDown from it.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    // Selection unchanged.
    await Promise.resolve();
    expect(list.textContent).toContain('selected=10');
    document.body.removeChild(input);
  });
});
