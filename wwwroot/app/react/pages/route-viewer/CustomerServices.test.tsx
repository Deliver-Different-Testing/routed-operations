import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('../../hooks/useAutoPoll', () => ({
  useAutoPoll: () => undefined,
}));
vi.mock('../../components/route-viewer/RvJobDetail', () => ({
  RvJobDetail: ({ bulkJobId }: any) => (
    <div data-testid="rv-job-detail">detail for {bulkJobId ?? 'none'}</div>
  ),
}));

import CustomerServices from './CustomerServices';

function renderPage(initialRoute = '/route-viewer/cs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <CustomerServices />
    </QueryClientProvider>,
    { initialRoute },
  );
}

const mkRow = (over: Record<string, any> = {}) => ({
  bulkEventId: 1,
  bulkJobId: 100,
  clientId: null,
  courierId: null,
  jobNumber: 'JOB-100',
  courierCode: 'ACE',
  notes: 'Called client',
  internal: true,
  clientCreated: false,
  clientFollowup: false,
  createdByName: 'Kev',
  eventDate: '2026-08-13',
  created: '2026-08-13T10:00:00Z',
  closedDate: null,
  closedByName: null,
  ...over,
});

// Default job snapshot returned by the /api/runviewer/jobs/:id handler.
// Tests that need Track-It or map-iframe assertions override the handler
// with a per-test payload; others just need SOMETHING back so the CS
// page's selectedJobQ doesn't error on an unhandled request.
const mkJobSnapshot = (over: Record<string, any> = {}) => ({
  bulkJobId: 100,
  jobId: 100,
  jobNumber: 'JOB-100',
  jobStatus: null,
  clientCode: 'ACME',
  speedName: null,
  speed: null,
  fromCompany: null,
  fromAddress: null,
  fromSuburb: null,
  toCompany: null,
  toAddress: null,
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
  qty: null,
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
  trackingLink: null,
  ...over,
});

describe('CustomerServices', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
      isUsTenant: false,
      timeZone: 'Pacific/Auckland',
      fullName: 'Kev',
    };
    // Default job snapshot handler + noop search handler so tests
    // that don't care about job-detail / typeahead specifics don't
    // hit the onUnhandledRequest error trap. Register `search`
    // FIRST so the more-specific literal path wins over the
    // `:id` param handler when MSW checks matches in registration
    // order.
    server.use(
      http.get('/api/runviewer/jobs/search', () =>
        new HttpResponse(null, { status: 404 })),
      http.get('/api/runviewer/jobs/:id', ({ params }) => {
        // Guard: if the "id" is literally "search" (e.g. the search
        // handler was overridden by a test with a different pattern),
        // fall through to 404 rather than returning a bogus snapshot.
        if (String(params.id) === 'search') {
          return new HttpResponse(null, { status: 404 });
        }
        return HttpResponse.json({
          response: mkJobSnapshot({ bulkJobId: Number(params.id) }),
        });
      }),
    );
  });

  it('renders toolbar with date + include-closed + follow-up radios', async () => {
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: [] })),
    );
    renderPage();
    expect(await screen.findByLabelText(/Include closed/)).toBeInTheDocument();
    // Follow-up options for admin
    expect(screen.getByLabelText('All')).toBeInTheDocument();
    expect(screen.getByLabelText('UCL')).toBeInTheDocument();
    expect(screen.getByLabelText('Client')).toBeInTheDocument();
  });

  it('hides admin follow-up radios for NP', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: [] })),
    );
    renderPage();
    await waitFor(() => expect(screen.queryByLabelText('UCL')).toBeNull());
  });

  it('shows empty message when no events', async () => {
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: [] })),
    );
    renderPage();
    expect(await screen.findByText(/No events for this date/)).toBeInTheDocument();
  });

  it('renders event rows', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow()] })),
    );
    renderPage();
    expect(await screen.findByText('JOB-100')).toBeInTheDocument();
    // Multiple UCL elements exist (radio label + row badge); assert both present
    expect(screen.getAllByText('UCL').length).toBeGreaterThan(1);
    expect(screen.getByText(/Called client/)).toBeInTheDocument();
  });

  it('filters UCL / Client via follow-up radio', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 1, internal: true, clientFollowup: false, jobNumber: 'UCL-A' }),
            mkRow({ bulkEventId: 2, internal: false, clientFollowup: true, jobNumber: 'CLIENT-B' }),
          ],
        })),
    );
    renderPage();
    await screen.findByText('UCL-A');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('UCL'));
    expect(screen.getByText('UCL-A')).toBeInTheDocument();
    expect(screen.queryByText('CLIENT-B')).toBeNull();
    await user.click(screen.getByLabelText('Client'));
    expect(screen.queryByText('UCL-A')).toBeNull();
    expect(screen.getByText('CLIENT-B')).toBeInTheDocument();
  });

  it('selects an event + shows JobDetail', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow({ bulkJobId: 555 })] })),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('JOB-100'));
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail')).toHaveTextContent('555'),
    );
  });

  it('opens Create event dialog + refreshes on save', async () => {
    let refetched = 0;
    server.use(
      http.get('/api/runviewer/events', () => {
        refetched++;
        return HttpResponse.json({ response: [] });
      }),
      http.post('/api/runviewer/events', () =>
        HttpResponse.json({ response: 'ok' })),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Create event/ }));
    expect(await screen.findByText('Create event')).toBeInTheDocument();
  });

  it('deep-link ?eid=<id> preselects the row', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 42, jobNumber: 'JOB-42', bulkJobId: 555 }),
          ],
        })),
    );
    renderPage('/route-viewer/cs?eid=42');
    await waitFor(() =>
      expect(screen.getByTestId('rv-job-detail')).toHaveTextContent('555'),
    );
  });

  it('EventActions: reply POSTs + close POSTs', async () => {
    let reply = 0;
    let close = 0;
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow()] })),
      http.post('/api/runviewer/events/1/reply', () => {
        reply++;
        return HttpResponse.json({ response: 'ok' });
      }),
      http.post('/api/runviewer/events/1/close', () => {
        close++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('JOB-100'));
    const replyInput = await screen.findByPlaceholderText(/Add reply/);
    await user.type(replyInput, 'noted');
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(reply).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Close event' }));
    await waitFor(() => expect(close).toBe(1));
  });

  it('shows loading state', async () => {
    server.use(
      http.get('/api/runviewer/events', () => new Promise(() => {})),
    );
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByText(/Loading/).length).toBeGreaterThan(0),
    );
  });

  it('Copy Link button: fires generate-direct-link + writes URL to clipboard', async () => {
    // jsdom provides a Clipboard instance on navigator that no-ops
    // writeText. Spy on it so we can assert the call + capture the URL.
    const writeText = vi
      .spyOn(window.navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    let calledWith: URL | null = null;
    try {
      server.use(
        http.get('/api/runviewer/events', () =>
          HttpResponse.json({
            response: [
              mkRow({
                bulkEventId: 7,
                clientId: 42,
                internal: false,
                jobNumber: 'SHARE-7',
              }),
            ],
          })),
        http.get('/api/runviewer/events/direct-link', ({ request: req }) => {
          calledWith = new URL(req.url);
          return HttpResponse.json({
            response: { url: 'https://runviewer.example/#/CS?eid=7' },
          });
        }),
      );
      renderPage();
      const user = userEvent.setup();
      await screen.findByText('SHARE-7');
      const btn = screen.getByRole('button', { name: /Copy event link/i });
      await user.click(btn);
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText).toHaveBeenCalledWith('https://runviewer.example/#/CS?eid=7');
      // Confirm the endpoint was hit with the expected query string.
      expect(calledWith).not.toBeNull();
      expect(calledWith!.searchParams.get('eventId')).toBe('7');
      expect(calledWith!.searchParams.get('clientId')).toBe('42');
    } finally {
      writeText.mockRestore();
    }
  });

  it('Copy Link button: hidden on internal-only events', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 8, clientId: 42, internal: true, jobNumber: 'INT-ONLY' }),
          ],
        })),
    );
    renderPage();
    await screen.findByText('INT-ONLY');
    expect(screen.queryByRole('button', { name: /Copy event link/i })).toBeNull();
  });

  // ---- Part A #40: sortable headers + pagination + Client Visible col ----

  it('sortable column header toggles asc / desc when clicked', async () => {
    // Two rows with different jobNumbers so a sort mutates the DOM
    // order predictably.
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 1, jobNumber: 'AAA-1' }),
            mkRow({ bulkEventId: 2, jobNumber: 'BBB-2' }),
          ],
        })),
    );
    renderPage();
    await screen.findByText('AAA-1');
    const jobHeader = screen.getByRole('columnheader', { name: /Job #/ });
    const user = userEvent.setup();
    // First click -> asc; AAA before BBB
    await user.click(jobHeader);
    await waitFor(() => {
      expect(jobHeader).toHaveAttribute('aria-sort', 'ascending');
    });
    let cells = screen.getAllByText(/^(AAA|BBB)-\d$/);
    expect(cells[0]).toHaveTextContent('AAA-1');
    expect(cells[1]).toHaveTextContent('BBB-2');
    // Second click -> desc; BBB before AAA
    await user.click(jobHeader);
    await waitFor(() => {
      expect(jobHeader).toHaveAttribute('aria-sort', 'descending');
    });
    cells = screen.getAllByText(/^(AAA|BBB)-\d$/);
    expect(cells[0]).toHaveTextContent('BBB-2');
    expect(cells[1]).toHaveTextContent('AAA-1');
  });

  it('pagination: renders 45 per page + Next advances to page 2', async () => {
    // Seed 50 rows; page 1 shows first 45 (JOB-01..45), page 2 shows
    // JOB-46..50.
    const rows = Array.from({ length: 50 }).map((_, i) => mkRow({
      bulkEventId: i + 1,
      // Zero-pad so lexical asc sort matches numeric asc for the first
      // 45. Sort defaults to created-desc (all same timestamp) so the
      // fed order is preserved.
      jobNumber: `JOB-${String(i + 1).padStart(2, '0')}`,
    }));
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: rows })),
    );
    renderPage();
    await screen.findByText('JOB-01');
    // Row 45 is on page 1, row 46 is not
    expect(screen.getByText('JOB-45')).toBeInTheDocument();
    expect(screen.queryByText('JOB-46')).toBeNull();
    // Pager renders numbered buttons; click page 2
    const page2Btn = screen.getByRole('button', { name: 'Page 2' });
    const user = userEvent.setup();
    await user.click(page2Btn);
    await waitFor(() => expect(screen.getByText('JOB-46')).toBeInTheDocument());
    expect(screen.getByText('JOB-50')).toBeInTheDocument();
    expect(screen.queryByText('JOB-45')).toBeNull();
  });

  it('Client Visible column renders for admin when at least one event is client-visible', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 1, internal: false, jobNumber: 'CV-1' }),
            mkRow({ bulkEventId: 2, internal: true, jobNumber: 'IN-2' }),
          ],
        })),
    );
    renderPage();
    await screen.findByText('CV-1');
    expect(screen.getByRole('columnheader', { name: /Client Visible/ })).toBeInTheDocument();
    // The visible row shows the tick badge; the internal row does not.
    expect(screen.getAllByLabelText('Client visible').length).toBe(1);
  });

  it('Client Visible column is hidden when every event is internal', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 1, internal: true, jobNumber: 'IN-1' }),
            mkRow({ bulkEventId: 2, internal: true, jobNumber: 'IN-2' }),
          ],
        })),
    );
    renderPage();
    await screen.findByText('IN-1');
    expect(screen.queryByRole('columnheader', { name: /Client Visible/ })).toBeNull();
  });

  it('Client Visible column is hidden for network-partner users', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [
            mkRow({ bulkEventId: 1, internal: false, jobNumber: 'CV-1' }),
          ],
        })),
    );
    renderPage();
    await screen.findByText('CV-1');
    expect(screen.queryByRole('columnheader', { name: /Client Visible/ })).toBeNull();
  });

  // ---- Part B #41: right-click menu + Close Event modal ----

  it('right-click on an event row opens the Close Event context menu', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow({ bulkEventId: 99, jobNumber: 'RC-99' })] })),
    );
    renderPage();
    const row = (await screen.findByText('RC-99')).closest('tr')!;
    const user = userEvent.setup();
    await user.pointer({ target: row, keys: '[MouseRight]' });
    // Context menu title + Close Event item both present.
    expect(await screen.findByText('Event #99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close Event' })).toBeInTheDocument();
  });

  it('Close Event modal defaults closer name to user.fullName + POSTs on submit', async () => {
    let closedWith: any = null;
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow({ bulkEventId: 200, jobNumber: 'CE-200' })] })),
      http.post('/api/runviewer/events/200/close', async ({ request: req }) => {
        closedWith = await req.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderPage();
    const row = (await screen.findByText('CE-200')).closest('tr')!;
    const user = userEvent.setup();
    await user.pointer({ target: row, keys: '[MouseRight]' });
    await user.click(await screen.findByRole('button', { name: 'Close Event' }));
    // Modal opens with editable closer name defaulted to user.fullName ('Kev').
    const nameInput = await screen.findByLabelText('Closer name');
    expect(nameInput).toHaveValue('Kev');
    // Also shows the read-only event id.
    const dialog = nameInput.closest('div[data-modal-open]') as HTMLElement;
    expect(within(dialog).getByDisplayValue('200')).toBeInTheDocument();
    // Edit + submit. Scope 'Close' to the modal so we do not match the
    // Modal's own header X-icon which also carries aria-label="Close".
    await user.clear(nameInput);
    await user.type(nameInput, 'Ada');
    const submitBtn = within(dialog).getAllByRole('button', { name: 'Close' })
      .find((b) => b.textContent?.trim() === 'Close');
    await user.click(submitBtn!);
    await waitFor(() => expect(closedWith).not.toBeNull());
    expect(closedWith).toEqual({ closedBy: 'Ada' });
  });

  it('Close Event menu item is disabled when the event is already closed', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({
          response: [mkRow({
            bulkEventId: 300,
            jobNumber: 'ALREADY-300',
            closedDate: '2026-08-13T12:00:00Z',
            closedByName: 'Somebody',
          })],
        })),
    );
    renderPage();
    const row = (await screen.findByText('ALREADY-300')).closest('tr')!;
    const user = userEvent.setup();
    await user.pointer({ target: row, keys: '[MouseRight]' });
    const item = await screen.findByRole('button', { name: 'Event already closed' });
    expect(item).toBeDisabled();
  });

  // ---- Part A #42: top-bar job typeahead + createJobEvent ----

  it('top-bar job search fires searchByJobNumber (debounced) and shows results', async () => {
    let seenJobNumber: string | null = null;
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/jobs/search', ({ request: req }) => {
        seenJobNumber = new URL(req.url).searchParams.get('jobNumber');
        return HttpResponse.json({
          response: mkJobSnapshot({
            bulkJobId: 777,
            jobNumber: 'FOUND-777',
            clientCode: 'DEMO',
            toAddress: '10 Willis St',
            toSuburb: 'Wellington',
          }),
        });
      }),
    );
    renderPage();
    const searchInput = await screen.findByLabelText('Search jobs');
    const user = userEvent.setup();
    await user.type(searchInput, 'FOUND-777');
    // Debounced dropdown eventually shows the hit line with job # +
    // client code + suburb + address.
    await waitFor(() => expect(seenJobNumber).toBe('FOUND-777'));
    expect(await screen.findByText('FOUND-777')).toBeInTheDocument();
    expect(screen.getByText('DEMO')).toBeInTheDocument();
    expect(screen.getByText(/Wellington - 10 Willis St/)).toBeInTheDocument();
  });

  it('picking a top-bar search result opens Create Event dialog with that jobId', async () => {
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/jobs/search', () =>
        HttpResponse.json({
          response: mkJobSnapshot({
            bulkJobId: 888,
            jobNumber: 'PICK-888',
            toAddress: '1 Queen St',
            toSuburb: 'Auckland',
          }),
        })),
    );
    renderPage();
    const searchInput = await screen.findByLabelText('Search jobs');
    const user = userEvent.setup();
    await user.type(searchInput, 'PICK-888');
    const hitButton = await screen.findByRole('button', { name: /PICK-888/ });
    // onMouseDown fires before onBlur so the click registers.
    await user.pointer({ target: hitButton, keys: '[MouseLeft]' });
    // Create Event modal opens; job number label reflects the picked job.
    expect(await screen.findByText('Create event')).toBeInTheDocument();
    // CreateEventDialog renders "#<jobId>" when jobNumber prop is
    // undefined (CS doesn't pass it) - confirms the picked bulkJobId
    // flows through.
    expect(screen.getByText('#888')).toBeInTheDocument();
  });

  it('typeahead miss (404) renders "No results" without crashing', async () => {
    server.use(
      http.get('/api/runviewer/events', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/jobs/search', () =>
        new HttpResponse(null, { status: 404 })),
    );
    renderPage();
    const searchInput = await screen.findByLabelText('Search jobs');
    const user = userEvent.setup();
    await user.type(searchInput, 'nope');
    expect(await screen.findByText('No results')).toBeInTheDocument();
  });

  // ---- Part B #43: Track-It button + Google Maps iframe ----

  it('Track-It button opens the tracking link in a new tab when selected event has one', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      server.use(
        http.get('/api/runviewer/events', () =>
          HttpResponse.json({ response: [mkRow({ bulkEventId: 55, bulkJobId: 606, jobNumber: 'TR-606' })] })),
        http.get('/api/runviewer/jobs/606', () =>
          HttpResponse.json({
            response: mkJobSnapshot({
              bulkJobId: 606,
              jobNumber: 'TR-606',
              trackingLink: 'https://track.example/abc',
              toAddress: '2 Featherston St',
              toSuburb: 'Wellington',
            }),
          })),
      );
      renderPage();
      const user = userEvent.setup();
      await user.click(await screen.findByText('TR-606'));
      const btn = await screen.findByRole('button', { name: /Track it/i });
      await user.click(btn);
      expect(openSpy).toHaveBeenCalledWith('https://track.example/abc', '_blank');
    } finally {
      openSpy.mockRestore();
    }
  });

  it('Track-It button is hidden when the selected event has no tracking link', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow({ bulkEventId: 66, bulkJobId: 707, jobNumber: 'NT-707' })] })),
      http.get('/api/runviewer/jobs/707', () =>
        HttpResponse.json({
          response: mkJobSnapshot({ bulkJobId: 707, jobNumber: 'NT-707', trackingLink: null }),
        })),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('NT-707'));
    // Give the query a beat to resolve, then confirm no Track-It button.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Track it/i })).toBeNull(),
    );
  });

  it('Delivery-map iframe renders with the delivery address when toAddress is present', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow({ bulkEventId: 77, bulkJobId: 808, jobNumber: 'MP-808' })] })),
      http.get('/api/runviewer/jobs/808', () =>
        HttpResponse.json({
          response: mkJobSnapshot({
            bulkJobId: 808,
            jobNumber: 'MP-808',
            toAddress: '5 Lambton Quay',
            toSuburb: 'Wellington',
          }),
        })),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('MP-808'));
    const iframe = await screen.findByTestId('cs-delivery-map');
    expect(iframe).toBeInTheDocument();
    const src = iframe.getAttribute('src') ?? '';
    // URL-encoded query should embed BOTH the street + suburb so the
    // Google Maps pin lands on the right city.
    expect(src).toContain('https://maps.google.com/maps?q=');
    expect(src).toContain(encodeURIComponent('5 Lambton Quay'));
    expect(src).toContain(encodeURIComponent('Wellington'));
    expect(src).toContain('output=embed');
  });

  it('Delivery-map iframe does not render when the job has no toAddress', async () => {
    server.use(
      http.get('/api/runviewer/events', () =>
        HttpResponse.json({ response: [mkRow({ bulkEventId: 88, bulkJobId: 909, jobNumber: 'NM-909' })] })),
      http.get('/api/runviewer/jobs/909', () =>
        HttpResponse.json({
          response: mkJobSnapshot({ bulkJobId: 909, jobNumber: 'NM-909', toAddress: null }),
        })),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('NM-909'));
    // Give the query a beat to resolve; iframe should stay absent.
    await waitFor(() =>
      expect(screen.queryByTestId('cs-delivery-map')).toBeNull(),
    );
  });
});
