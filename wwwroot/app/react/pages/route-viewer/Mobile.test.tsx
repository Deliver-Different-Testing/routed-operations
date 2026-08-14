import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('../../hooks/useAutoPoll', () => ({
  useAutoPoll: () => undefined,
}));

import Mobile from './Mobile';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <Mobile />
    </QueryClientProvider>,
  );
}

// Baseline handlers for the hooks Mobile always mounts (excluding /runs so
// individual tests can pass their own /runs handler first without ordering
// gotchas). Pass these AFTER any per-test overrides.
const baseline = () => [
  http.get('/api/runviewer/filters/clients', () =>
    HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/regions', () =>
    HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/speeds', () =>
    HttpResponse.json({ response: [] })),
];
const stubRuns = (rows: unknown[]) =>
  http.get('/api/runviewer/runs', () =>
    HttpResponse.json({ response: rows }));

describe('Route Viewer Mobile page', () => {
  it('renders the top bar with a date input and Filters button', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    // Bottom nav: Overview + Runs tabs are always present.
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Runs' })).toBeInTheDocument();
    expect(screen.getByLabelText('Filters')).toBeInTheDocument();
  });

  it('shows the "No runs." message when the runs API returns empty', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    expect(await screen.findByText(/No runs\./)).toBeInTheDocument();
  });

  it('renders a run row when the runs API returns one', async () => {
    server.use(
      stubRuns([{
        id: 1, name: 'RUN-A', area: 'AKL', suburbs: '',
        fromCities: null, toLocationName: null,
        velocity: null, hashKey: null, status: null,
        jobs: 5, incompleteJobs: 5, totalPickup: 0, incompletePickup: 0,
        hasReturns: false, returnsTotal: 0, isMissing: false,
        preAssigned: 0, isActive: 1,
        courierName: 'Kev', courierCode: 'KEV',
        courierPercentageFormatted: null,
        courierOnlineStatus: null, courierOfflineMins: null,
        agentName: null, isNpAgent: false,
      }]),
      ...baseline(),
    );
    renderPage();
    expect(await screen.findByText('RUN-A')).toBeInTheDocument();
    expect(screen.getByText(/5 jobs/)).toBeInTheDocument();
    expect(screen.getByText(/AKL - Kev/)).toBeInTheDocument();
  });

  it('switches to Overview tab and hits the region-overview endpoint', async () => {
    let hit = 0;
    server.use(
      stubRuns([]),
      ...baseline(),
      http.get('/api/runviewer/runs/overview', () => {
        hit++;
        return HttpResponse.json({ response: [] });
      }),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    await waitFor(() => expect(hit).toBe(1));
    expect(await screen.findByText(/No regions with jobs./))
      .toBeInTheDocument();
  });

  it('opens the filters drawer when Filters is clicked and closes on Close', async () => {
    server.use(stubRuns([]), ...baseline());
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Filters'));
    expect(await screen.findByRole('heading', { name: 'Filters' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Filters' })).not.toBeInTheDocument()
    );
  });

  it('opens the RvGpsEditModal with the delivery leg when Fix GPS To is tapped', async () => {
    const jobRow = {
      bulkJobId: 7, jobId: 700, jobNumber: 'JOB-7', jobStatus: null,
      clientCode: 'ACME', speedName: null, speed: null,
      fromCompany: null, fromAddress: '11 Pickup St', fromSuburb: 'Ponsonby',
      toCompany: null, toAddress: '22 Deliver Rd', toSuburb: 'Grey Lynn',
      bookDate: null, bookTime: null,
      pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: null,
      pickedUp: null, dispatched: null, podTime: null, podName: null,
      amount: null, courierId: null, courierName: null, courierCode: null,
      contact: null, phone: null, deliverToContact: null, deliverToPhone: null,
      trackingEmail: null, proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
      notes: null, deliveryNotes: null, labelNotes: null,
      size: null, qty: null, weight: null, speedId: null,
      ourRef: null, refA: null, refB: null,
      runName: null, runOrder: null, bulkRunId: null,
      multiboxParentId: null, parentJobId: null, regionId: null, regionName: null,
      agentName: null, agentType: null, isNpAgent: false,
      pickUpLatitude: -36.85, pickUpLongitude: 174.76,
      deliveryLatitude: -36.86, deliveryLongitude: 174.77,
      toLat: -36.86, toLng: 174.77,
      fromPostCode: 1011, toPostCode: 1021,
      fromCity: null, toCity: null,
    };
    server.use(
      stubRuns([{
        id: 9, name: 'RUN-9', area: 'AKL', suburbs: '',
        fromCities: null, toLocationName: null,
        velocity: null, hashKey: null, status: null,
        jobs: 1, incompleteJobs: 1, totalPickup: 0, incompletePickup: 0,
        hasReturns: false, returnsTotal: 0, isMissing: false,
        preAssigned: 0, isActive: 1, courierName: null,
        courierCode: null, courierPercentageFormatted: null,
        courierOnlineStatus: null, courierOfflineMins: null,
        agentName: null, isNpAgent: false,
      }]),
      ...baseline(),
      http.get('/api/runviewer/runs/9/jobs', () =>
        HttpResponse.json({ response: [jobRow] })),
      http.get('/api/runviewer/jobs/7', () =>
        HttpResponse.json({ response: jobRow })),
      http.get('/api/runviewer/couriers/position', () =>
        HttpResponse.json({ response: null })),
    );
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByText('RUN-9'));
    await user.click(await screen.findByText('JOB-7'));
    // Detail view rendered - Fix GPS buttons visible on both address rows.
    const fixGpsTo = await screen.findByRole('button', { name: 'Fix GPS To' });
    expect(screen.getByRole('button', { name: 'Fix GPS From' })).toBeInTheDocument();
    await user.click(fixGpsTo);
    // Modal opens with the delivery leg title.
    expect(await screen.findByText(/Update GPS - Delivery - Job JOB-7/)).toBeInTheDocument();
    // Delivery leg populates the To address into the editable field.
    expect(screen.getByDisplayValue('22 Deliver Rd')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------
  // Tap-to-edit surface (12 fields ported from legacy mobile/jobDetail.tpl)
  // -----------------------------------------------------------------

  it('drills into a run when the run row is tapped', async () => {
    let jobsHit = 0;
    server.use(
      stubRuns([{
        id: 42, name: 'RUN-42', area: 'AKL', suburbs: '',
        fromCities: null, toLocationName: null,
        velocity: null, hashKey: null, status: null,
        jobs: 2, incompleteJobs: 2, totalPickup: 0, incompletePickup: 0,
        hasReturns: false, returnsTotal: 0, isMissing: false,
        preAssigned: 0, isActive: 1, courierName: null,
        courierCode: null, courierPercentageFormatted: null,
        courierOnlineStatus: null, courierOfflineMins: null,
        agentName: null, isNpAgent: false,
      }]),
      ...baseline(),
      http.get('/api/runviewer/runs/42/jobs', () => {
        jobsHit++;
        return HttpResponse.json({
          response: [{
            bulkJobId: 1, jobId: 0, jobNumber: 'JOB-1', jobStatus: null,
            clientCode: null, speedName: null, speed: null,
            fromCompany: null, fromAddress: null, fromSuburb: null,
            toCompany: null, toAddress: '99 K Rd', toSuburb: 'Grey Lynn',
            bookDate: null, bookTime: null,
            pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: null,
            pickedUp: null, dispatched: null, podTime: null, podName: null,
            amount: null, courierId: null, courierName: null, courierCode: null,
            contact: null, phone: null, deliverToContact: null, deliverToPhone: null,
            trackingEmail: null, proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
            notes: null, deliveryNotes: null, labelNotes: null,
            size: null, qty: null, weight: null, speedId: null,
            ourRef: null, refA: null, refB: null,
            runName: null, runOrder: null, bulkRunId: null,
            multiboxParentId: null, parentJobId: null, regionId: null, regionName: null,
            agentName: null, agentType: null, isNpAgent: false,
            pickUpLatitude: null, pickUpLongitude: null,
            deliveryLatitude: null, deliveryLongitude: null,
            toLat: null, toLng: null, fromPostCode: null, toPostCode: null,
            fromCity: null, toCity: null,
          }],
        });
      }),
    );
    renderPage();
    const runRow = await screen.findByText('RUN-42');
    const user = userEvent.setup();
    await user.click(runRow);
    await waitFor(() => expect(jobsHit).toBe(1));
    expect(await screen.findByText('JOB-1')).toBeInTheDocument();
  });
});

// ---------- Tap-to-edit surface (12 fields ported from mobileControl) ---

// Full BulkJob stub with realistic values across the 12 tap-to-edit
// fields. Individual tests spread + override to isolate one field at
// a time (e.g. `mkJob({ qty: 5 })` for the Items row test).
const mkJob = (over: Record<string, unknown> = {}) => ({
  bulkJobId: 11, jobId: 1100, jobNumber: 'JOB-11', jobStatus: null,
  clientCode: 'ACME', speedName: 'CORT', speed: 'CORT',
  fromCompany: 'From Co', fromAddress: '1 Pick St', fromSuburb: 'A',
  toCompany: 'To Co', toAddress: '2 Del St', toSuburb: 'B',
  bookDate: '13/08/2026', bookTime: '09:00:00',
  pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: null,
  pickedUp: null, dispatched: null, podTime: null, podName: null,
  amount: 42.5, courierId: null, courierName: 'Kev', courierCode: 'KEV',
  contact: 'Alice', phone: '021', deliverToContact: 'Bob', deliverToPhone: '022 333 4444',
  trackingEmail: 'bob@x.com', proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
  notes: 'ring on arrival', deliveryNotes: null, labelNotes: null,
  size: 'S', qty: 3, weight: 2, speedId: 1,
  ourRef: 'OR-1', refA: 'RA-1', refB: 'RB-1',
  runName: 'R', runOrder: 7, bulkRunId: 20,
  multiboxParentId: null, parentJobId: null, regionId: null, regionName: null,
  agentName: null, agentType: null, isNpAgent: false,
  pickUpLatitude: -36.85, pickUpLongitude: 174.76,
  deliveryLatitude: -36.86, deliveryLongitude: 174.77,
  toLat: -36.86, toLng: 174.77,
  fromPostCode: 1011, toPostCode: 1021,
  fromCity: null, toCity: null,
  ...over,
});

const runStub = (id: number, name: string) => ({
  id, name, area: 'AKL', suburbs: '', fromCities: null, toLocationName: null,
  velocity: null, hashKey: null, status: null,
  jobs: 1, incompleteJobs: 1, totalPickup: 0, incompletePickup: 0,
  hasReturns: false, returnsTotal: 0, isMissing: false,
  preAssigned: 0, isActive: 1, courierName: null, courierCode: null,
  courierPercentageFormatted: null, courierOnlineStatus: null, courierOfflineMins: null,
  agentName: null, isNpAgent: false,
});

async function drillToDetail(job: ReturnType<typeof mkJob>) {
  const runId = 100;
  server.use(
    stubRuns([runStub(runId, 'RUN-X')]),
    ...baseline(),
    http.get(`/api/runviewer/runs/${runId}/jobs`, () =>
      HttpResponse.json({ response: [job] })),
    http.get(`/api/runviewer/jobs/${job.bulkJobId}`, () =>
      HttpResponse.json({ response: job })),
    http.get('/api/runviewer/couriers/position', () =>
      HttpResponse.json({ response: null })),
  );
  const rendered = renderPage();
  const user = userEvent.setup();
  await user.click(await screen.findByText('RUN-X'));
  // Job row shows jobNumber in the middle-pane list; tap it to drill
  // into the Detail view. Wait for the Detail view heading to render
  // (title uses `Job {jobNumber ?? bulkJobId}` - not a jobId lookup).
  await user.click(await screen.findByText(String(job.jobNumber)));
  return { user, rendered };
}

describe('Route Viewer Mobile - tap-to-edit surface (12 fields)', () => {
  const originalUser = (window as any).__APP_USER__;

  beforeEach(() => {
    // Internal client so the 5 supported edit rows render editable
    // rather than short-circuiting via readOnlyEdit().
    (window as any).__APP_USER__ = {
      ...originalUser,
      isNetworkPartner: false,
      isUsTenant: false,
      timeZone: 'Pacific/Auckland',
      clientTypeId: 'Internal',
    };
  });

  afterEach(() => {
    (window as any).__APP_USER__ = originalUser;
  });

  it('renders all 12 tap-to-edit field labels on the Detail view', async () => {
    await drillToDetail(mkJob());
    // Each of the 12 labels ported from legacy jobDetail.tpl.
    for (const label of [
      'To', 'Notes', 'Phone', 'Email', 'Size', 'Items',
      'Run Order', 'Date', 'Ref A', 'Ref B', 'Del Loc', 'Charge',
    ]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it('taps the To row -> textarea appears; blur commits { toAddress } patch', async () => {
    let body: any = null;
    server.use(
      http.post('/api/runviewer/jobs/11/text-fields', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const { user } = await drillToDetail(mkJob({ toAddress: '2 Del St' }));
    const btn = await screen.findByRole('button', { name: 'Edit To' });
    await user.click(btn);
    const ta = await screen.findByRole('textbox', { name: 'Edit To' });
    await user.clear(ta);
    await user.type(ta, '99 New Rd');
    fireEvent.blur(ta);
    await waitFor(() => expect(body).toEqual({ toAddress: '99 New Rd' }));
  });

  it('taps the Notes row -> textarea; blur commits { notes } patch', async () => {
    let body: any = null;
    server.use(
      http.post('/api/runviewer/jobs/11/text-fields', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const { user } = await drillToDetail(mkJob({ notes: 'ring on arrival' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Notes' }));
    const ta = await screen.findByRole('textbox', { name: 'Edit Notes' });
    await user.clear(ta);
    await user.type(ta, 'leave at door');
    fireEvent.blur(ta);
    await waitFor(() => expect(body).toEqual({ notes: 'leave at door' }));
  });

  it('taps the Items row -> number input; Enter commits { quantity } patch', async () => {
    let body: any = null;
    server.use(
      http.post('/api/runviewer/jobs/11/text-fields', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const { user } = await drillToDetail(mkJob({ qty: 3 }));
    await user.click(await screen.findByRole('button', { name: 'Edit Items' }));
    const input = await screen.findByRole('spinbutton', { name: 'Edit Items' });
    await user.clear(input);
    await user.type(input, '5{enter}');
    await waitFor(() => expect(body).toEqual({ quantity: 5 }));
  });

  it('items row falls back to 1 when the driver clears without a number', async () => {
    let body: any = null;
    server.use(
      http.post('/api/runviewer/jobs/11/text-fields', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const { user } = await drillToDetail(mkJob({ qty: 3 }));
    await user.click(await screen.findByRole('button', { name: 'Edit Items' }));
    const input = await screen.findByRole('spinbutton', { name: 'Edit Items' });
    await user.clear(input);
    fireEvent.blur(input);
    await waitFor(() => expect(body).toEqual({ quantity: 1 }));
  });

  it('taps the Ref A row -> Enter commits { refA } patch', async () => {
    let body: any = null;
    server.use(
      http.post('/api/runviewer/jobs/11/text-fields', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const { user } = await drillToDetail(mkJob({ refA: 'RA-1' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Ref A' }));
    const input = await screen.findByRole('textbox', { name: 'Edit Ref A' });
    await user.clear(input);
    await user.type(input, 'RA-2{enter}');
    await waitFor(() => expect(body).toEqual({ refA: 'RA-2' }));
  });

  it('taps the Ref B row -> Enter commits { refB } patch', async () => {
    let body: any = null;
    server.use(
      http.post('/api/runviewer/jobs/11/text-fields', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const { user } = await drillToDetail(mkJob({ refB: 'RB-1' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Ref B' }));
    const input = await screen.findByRole('textbox', { name: 'Edit Ref B' });
    await user.clear(input);
    await user.type(input, 'RB-9{enter}');
    await waitFor(() => expect(body).toEqual({ refB: 'RB-9' }));
  });

  it('unsupported fields (Phone/Email/Size/Run Order/Date/Del Loc/Charge) render as static rows - no Edit button', async () => {
    await drillToDetail(mkJob());
    // Only the 5 supported fields have an Edit-<label> button.
    // The other 7 render as plain divs with tooltips.
    for (const supported of ['Edit To', 'Edit Notes', 'Edit Items', 'Edit Ref A', 'Edit Ref B']) {
      expect(screen.getByRole('button', { name: supported })).toBeInTheDocument();
    }
    for (const notSupported of ['Edit Phone', 'Edit Email', 'Edit Size', 'Edit Run Order', 'Edit Date', 'Edit Del Loc', 'Edit Charge']) {
      expect(screen.queryByRole('button', { name: notSupported })).toBeNull();
    }
  });

  it('non-Internal client sees ALL 12 rows as static (readOnly)', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, clientTypeId: 'External' };
    await drillToDetail(mkJob());
    // No Edit-<field> buttons should be present at all.
    for (const label of [
      'To', 'Notes', 'Phone', 'Email', 'Size', 'Items',
      'Run Order', 'Date', 'Ref A', 'Ref B', 'Del Loc', 'Charge',
    ]) {
      expect(screen.queryByRole('button', { name: `Edit ${label}` })).toBeNull();
    }
  });

  it('LH-leg (bulkJobId=0) short-circuits to readOnly across all 5 supported rows', async () => {
    // LH legs have no tblBulkJob row - even Internal users cannot edit.
    await drillToDetail(mkJob({ bulkJobId: 0, jobNumber: 'JOB-LH' }));
    // No Edit- buttons for the 5 supported labels.
    for (const label of ['To', 'Notes', 'Items', 'Ref A', 'Ref B']) {
      expect(screen.queryByRole('button', { name: `Edit ${label}` })).toBeNull();
    }
  });

  it('save error surfaces via toast (error kind)', async () => {
    server.use(
      http.post('/api/runviewer/jobs/11/text-fields', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })),
    );
    const { user } = await drillToDetail(mkJob({ refA: 'RA-1' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Ref A' }));
    const input = await screen.findByRole('textbox', { name: 'Edit Ref A' });
    await user.clear(input);
    await user.type(input, 'X{enter}');
    // Toast surface renders a fresh div with the failure message.
    expect(await screen.findByText(/Save failed:/)).toBeInTheDocument();
  });

  it('Escape cancels an edit without firing the endpoint', async () => {
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/11/text-fields', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const { user } = await drillToDetail(mkJob({ refA: 'RA-1' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Ref A' }));
    const input = await screen.findByRole('textbox', { name: 'Edit Ref A' });
    await user.type(input, 'oops');
    fireEvent.keyDown(input, { key: 'Escape' });
    // Allow any async plumbing to settle.
    await new Promise((r) => setTimeout(r, 30));
    expect(hit).toBe(0);
  });
});
