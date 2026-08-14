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

// Print grid row factory. Only the fields PrintManager renders /
// sorts on / searches over need populating; the rest are defaulted
// null so BulkJob strict-mode stays happy in the test payload.
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  bulkJobId: 1,
  jobId: 0,
  jobNumber: 'J1',
  jobStatus: null,
  clientCode: 'A',
  speedName: null,
  speed: 'CORT',
  fromCompany: null,
  fromAddress: null,
  fromSuburb: null,
  toCompany: null,
  toAddress: 'x',
  toSuburb: null,
  bookDate: null,
  bookTime: null,
  pickupWindowStart: null,
  pickupWindowEnd: null,
  pickupWindow: null,
  pickedUp: null,
  dispatched: null,
  podTime: null,
  podName: null,
  amount: null,
  courierId: null,
  courierName: null,
  courierCode: null,
  contact: null,
  phone: null,
  deliverToContact: null,
  deliverToPhone: null,
  trackingEmail: null,
  proofOfDeliveryMobile: null,
  proofOfDeliveryEmail: null,
  notes: null,
  deliveryNotes: null,
  labelNotes: null,
  size: null,
  qty: 1,
  weight: null,
  speedId: null,
  ourRef: null,
  refA: null,
  refB: null,
  runName: null,
  runOrder: null,
  bulkRunId: null,
  multiboxParentId: null,
  parentJobId: null,
  regionId: null,
  regionName: null,
  agentName: null,
  agentType: null,
  isNpAgent: false,
  pickUpLatitude: null,
  pickUpLongitude: null,
  deliveryLatitude: null,
  deliveryLongitude: null,
  toLat: null,
  toLng: null,
  fromPostCode: null,
  toPostCode: null,
  fromCity: null,
  toCity: null,
  ...over,
});

const baseline = () => [
  http.get('/api/runviewer/runs/overview', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/jobs/print-list', () => HttpResponse.json({ response: [] })),
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

  it('renders toolbar with date + sort + action buttons + search', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Select all/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print Labels \(0\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel \(0\)/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search jobs...')).toBeInTheDocument();
  });

  it('shows "No print-eligible jobs" when empty', async () => {
    renderPage();
    expect(await screen.findByText(/No print-eligible jobs/)).toBeInTheDocument();
  });

  it('renders every new column header', async () => {
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({ response: [row()] })),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('J1');
    // Column headers are the only <th>s with the click-to-sort title.
    // Scope collection to those to avoid clashing with RvOverviewBox
    // headers rendered above the print grid (Total, Todo, etc.).
    const printHeaders = Array.from(
      document.querySelectorAll('th[title="Click to sort. Click again to reverse."]'),
    ).map((el) => el.textContent?.trim());
    for (const label of ['Client', 'Job #', 'D Date', 'R Time', 'Speed', 'Qty', 'RefA', 'RefB', 'OurRef', 'Mobile', 'Email', 'To', 'Notes']) {
      expect(printHeaders, `header for "${label}"`).toContain(label);
    }
  });

  it('renders values from the 7 new columns', async () => {
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({
          response: [row({
            jobNumber: 'JOB-42',
            speed: 'CORT',
            qty: 3,
            refA: 'RA-1',
            refB: 'RB-2',
            ourRef: 'OUR-9',
            proofOfDeliveryMobile: '021555',
            trackingEmail: 'kev@example.com',
            notes: 'ring buzzer',
          })],
        })),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('JOB-42');
    expect(screen.getByText('CORT')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('RA-1')).toBeInTheDocument();
    expect(screen.getByText('RB-2')).toBeInTheDocument();
    expect(screen.getByText('OUR-9')).toBeInTheDocument();
    expect(screen.getByText('021555')).toBeInTheDocument();
    expect(screen.getByText('kev@example.com')).toBeInTheDocument();
    expect(screen.getByText('ring buzzer')).toBeInTheDocument();
  });

  it('renders jobs + selects rows', async () => {
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({ response: [row({ bulkJobId: 1, jobNumber: 'J1', qty: 2 })] })),
      ...baseline(),
    );
    renderPage();
    expect(await screen.findByText('J1')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByText('J1'));
    expect(screen.getByRole('button', { name: /Print Labels \(1\)/ })).toBeInTheDocument();
  });

  it('legacy sort dropdown default (Job #) orders A1 before Z1', async () => {
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({
          response: [
            row({ bulkJobId: 1, jobNumber: 'Z1', clientCode: 'B' }),
            row({ bulkJobId: 2, jobNumber: 'A1', clientCode: 'A' }),
          ],
        })),
      ...baseline(),
    );
    renderPage();
    const first = await screen.findByText('A1');
    const second = await screen.findByText('Z1');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('column-header click toggles ascending / descending sort', async () => {
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({
          response: [
            row({ bulkJobId: 1, jobNumber: 'B1', clientCode: 'A' }),
            row({ bulkJobId: 2, jobNumber: 'A1', clientCode: 'B' }),
          ],
        })),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('A1');
    const user = userEvent.setup();
    // Find the Client column header by exact text (scope to sortable
    // Print grid headers to avoid RvOverviewBox collisions).
    const findColumnHeader = (label: string) =>
      Array.from(
        document.querySelectorAll<HTMLTableCellElement>('th[title="Click to sort. Click again to reverse."]'),
      ).find((el) => el.textContent?.trim().startsWith(label))!;
    // Click "Client" column header - ASC. A (row 1) should precede B.
    await user.click(findColumnHeader('Client'));
    const clientAsc1 = await screen.findByText('B1');   // row where clientCode='A'
    const clientAsc2 = await screen.findByText('A1');   // row where clientCode='B'
    expect(clientAsc1.compareDocumentPosition(clientAsc2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Click Client header again - DESC. Order flips.
    await user.click(findColumnHeader('Client'));
    expect(clientAsc2.compareDocumentPosition(clientAsc1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('search box filters rows by substring across visible columns', async () => {
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({
          response: [
            row({ bulkJobId: 1, jobNumber: 'JOB-1', notes: 'apple pie' }),
            row({ bulkJobId: 2, jobNumber: 'JOB-2', notes: 'banana bread' }),
          ],
        })),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('JOB-1');
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search jobs...'), 'banana');
    await waitFor(() => {
      expect(screen.queryByText('JOB-1')).toBeNull();
      expect(screen.getByText('JOB-2')).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it('selectAll checks every row + clearAll clears', async () => {
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({
          response: [1, 2].map((i) => row({ bulkJobId: i, jobNumber: `J${i}` })),
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
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({ response: [row({ bulkJobId: 5, jobNumber: 'J5', qty: 4 })] })),
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
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({ response: [row({ bulkJobId: 5, jobNumber: 'J5', qty: 4 })] })),
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
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({ response: [row({ bulkJobId: 1, jobNumber: 'J1' })] })),
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

  it('does not render chevron on non-multibox rows', async () => {
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({ response: [row({ bulkJobId: 1, jobNumber: 'J1' })] })),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('J1');
    expect(screen.queryByRole('button', { name: /Expand multi-box/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Collapse multi-box/ })).toBeNull();
  });

  it('multibox chevron: click fetches children lazily + renders sub-rows; second click collapses; third click reuses cache (no refetch)', async () => {
    let childrenHits = 0;
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({
          response: [row({ bulkJobId: 42, jobNumber: 'PARENT-42', multiBox: true })],
        })),
      http.get('/api/runviewer/jobs/print-children', ({ request }) => {
        const url = new URL(request.url);
        // Verify the endpoint is invoked with the parent bulkJobId.
        expect(url.searchParams.get('bulkJobId')).toBe('42');
        childrenHits++;
        return HttpResponse.json({
          response: [
            row({ bulkJobId: 101, jobNumber: 'CHILD-1' }),
            row({ bulkJobId: 102, jobNumber: 'CHILD-2' }),
          ],
        });
      }),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('PARENT-42');

    // Initially: chevron present, closed, no children in DOM yet.
    const chevron = screen.getByRole('button', { name: /Expand multi-box/ });
    expect(chevron).toBeInTheDocument();
    expect(screen.queryByText('CHILD-1')).toBeNull();
    expect(childrenHits).toBe(0);

    // First click - fetch fires, children render.
    const user = userEvent.setup();
    await user.click(chevron);
    await waitFor(() => expect(screen.getByText('CHILD-1')).toBeInTheDocument());
    expect(screen.getByText('CHILD-2')).toBeInTheDocument();
    expect(childrenHits).toBe(1);

    // Chevron label flips to Collapse when expanded.
    const collapse = screen.getByRole('button', { name: /Collapse multi-box/ });
    expect(collapse).toBeInTheDocument();

    // Second click - collapses (visibility only). Children disappear.
    await user.click(collapse);
    await waitFor(() => expect(screen.queryByText('CHILD-1')).toBeNull());
    // No extra fetch on collapse.
    expect(childrenHits).toBe(1);

    // Third click - re-expand. Children come back from cache with
    // no additional network hit.
    const reopen = screen.getByRole('button', { name: /Expand multi-box/ });
    await user.click(reopen);
    await waitFor(() => expect(screen.getByText('CHILD-1')).toBeInTheDocument());
    expect(childrenHits).toBe(1);
  });

  it('multibox chevron: fetch failure surfaces via toast, row stays collapsed', async () => {
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({
          response: [row({ bulkJobId: 77, jobNumber: 'PARENT-77', multiBox: true })],
        })),
      http.get('/api/runviewer/jobs/print-children', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })),
      ...baseline(),
    );
    renderPage();
    await screen.findByText('PARENT-77');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Expand multi-box/ }));
    // Toast surfaces the failure. ToastProvider renders the message
    // string somewhere in the DOM.
    await waitFor(() => expect(screen.getByText(/Load children failed/)).toBeInTheDocument());
    // Row stays collapsed (chevron label still says Expand).
    expect(screen.getByRole('button', { name: /Expand multi-box/ })).toBeInTheDocument();
  });

  it('cancels selected with confirm', async () => {
    let hit = 0;
    server.use(
      http.get('/api/runviewer/jobs/print-list', () =>
        HttpResponse.json({ response: [row({ bulkJobId: 1, jobNumber: 'J1' })] })),
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
