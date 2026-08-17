import { describe, expect, it, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvJobDetail } from './RvJobDetail';
import type { BulkJob } from '../../services/routeViewerService';

const mkJob = (over: Partial<BulkJob> = {}): BulkJob => ({
  bulkJobId: 1, jobId: 100, jobNumber: 'JOB-100', jobStatus: 'D',
  clientCode: 'ACME', speedName: 'CORT', speed: 'CORT',
  fromCompany: 'Pick Co', fromAddress: '1 Pick St', fromSuburb: 'A',
  toCompany: 'Del Co', toAddress: '2 Del St', toSuburb: 'B',
  bookDate: '13/08/2026', bookTime: '09:00:00',
  pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: '09:00 - 10:00',
  pickedUp: null, dispatched: null, podTime: null, podName: null,
  amount: 12.5, courierId: null, courierName: 'K', courierCode: 'KEV',
  contact: 'Alice', phone: '021', deliverToContact: 'Bob', deliverToPhone: '022',
  trackingEmail: 'b@x.com', proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
  notes: 'Pickup notes', deliveryNotes: 'Delivery notes', labelNotes: null,
  size: 'S', qty: 3, weight: 2, speedId: 1,
  ourRef: 'ORef', refA: 'RefA', refB: 'RefB',
  runName: 'r', runOrder: 5, bulkRunId: 20,
  multiboxParentId: null, parentJobId: null, regionId: null, regionName: null,
  agentName: 'AG', agentType: 'Local', isNpAgent: false,
  pickUpLatitude: -36.85, pickUpLongitude: 174.76,
  deliveryLatitude: -36.86, deliveryLongitude: 174.77,
  toLat: -36.86, toLng: 174.77, fromPostCode: 1011, toPostCode: 1021,
  fromCity: 'AKL', toCity: 'AKL',
  ...over,
});

function renderDetail(over: Partial<Parameters<typeof RvJobDetail>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const defaults = { bulkJobId: 1, initialJob: mkJob() };
  const props = { ...defaults, ...over };
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <RvJobDetail {...props} />
    </QueryClientProvider>,
  );
}

describe('RvJobDetail (render)', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
      isUsTenant: false,
      timeZone: 'Pacific/Auckland',
      clientTypeId: 'Internal',
    };
    server.use(
      http.get('/api/runviewer/runs/job-siblings', () =>
        HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/jobs/pod-photos', () =>
        HttpResponse.json({ response: [] })),
    );
  });

  it('renders empty state when bulkJobId and initialJob are both null', () => {
    renderDetail({ bulkJobId: null, initialJob: null });
    expect(screen.getByText(/Select a job from the middle pane/)).toBeInTheDocument();
  });

  it('renders header + job number when initialJob provided', () => {
    renderDetail({ initialJob: mkJob({ jobNumber: 'JOB-42' }) });
    expect(screen.getByText(/Detail for Job JOB-42/)).toBeInTheDocument();
  });

  it('renders Pricing tile with $ amount for admin', () => {
    renderDetail({ initialJob: mkJob({ amount: 42 }) });
    expect(screen.getByText('$42.00')).toBeInTheDocument();
  });

  it('hides Pricing tile for NP user', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderDetail({ initialJob: mkJob({ amount: 42 }) });
    expect(screen.queryByText('$42.00')).toBeNull();
  });

  it('renders pickup + delivery cards with addresses', () => {
    renderDetail({ initialJob: mkJob() });
    expect(screen.getByText('1 Pick St')).toBeInTheDocument();
    expect(screen.getByText('2 Del St')).toBeInTheDocument();
  });

  it('renders 7 metric labels', () => {
    renderDetail();
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Pickup Window')).toBeInTheDocument();
    expect(screen.getByText('Picked Up')).toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
    expect(screen.getByText('POD Time')).toBeInTheDocument();
    expect(screen.getByText('POD Name')).toBeInTheDocument();
  });

  it('renders info cards (Package / Job / Agent / Courier)', () => {
    renderDetail();
    expect(screen.getByText('Package')).toBeInTheDocument();
    expect(screen.getByText('Job')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('Courier')).toBeInTheDocument();
  });

  it('renders sibling tabs when SP returns rows', async () => {
    server.use(
      http.get('/api/runviewer/runs/job-siblings', () =>
        HttpResponse.json({
          response: [
            { jobId: 100, bulkJobId: 1, jobNumber: 'JOB-100', jobStatus: 'D', tabLabel: '', job: null },
            { jobId: 101, bulkJobId: 0, jobNumber: null, jobStatus: 'D', tabLabel: '*LHP', job: null },
            { jobId: 102, bulkJobId: 0, jobNumber: null, jobStatus: 'D', tabLabel: '*LH1', job: null },
            { jobId: 103, bulkJobId: 0, jobNumber: null, jobStatus: 'D', tabLabel: '*DEL', job: null },
          ],
        })),
      http.get('/api/runviewer/jobs/pod-photos', () =>
        HttpResponse.json({ response: [] })),
    );
    renderDetail({ initialJob: mkJob({ jobId: 100 }) });
    await waitFor(() => expect(screen.getByText('*LHP')).toBeInTheDocument());
    expect(screen.getByText('*LH1')).toBeInTheDocument();
    expect(screen.getByText('*DEL')).toBeInTheDocument();
  });

  it('renders "-" for Ready when no bookDate + bookTime', () => {
    renderDetail({ initialJob: mkJob({ bookDate: null, bookTime: null }) });
    // There are lots of "-" but Ready cell exists
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('does deep-link fetch when initialJob null + bulkJobId > 0', async () => {
    server.use(
      http.get('/api/runviewer/jobs/1', () =>
        HttpResponse.json({ response: mkJob({ jobNumber: 'FROM-FETCH' }) })),
      http.get('/api/runviewer/runs/job-siblings', () =>
        HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/jobs/pod-photos', () =>
        HttpResponse.json({ response: [] })),
    );
    renderDetail({ initialJob: null, bulkJobId: 1 });
    expect(await screen.findByText(/Detail for Job FROM-FETCH/)).toBeInTheDocument();
  });

  it('shows error banner when deep-link fetch fails', async () => {
    server.use(
      http.get('/api/runviewer/jobs/1', () =>
        HttpResponse.json({ messages: [{ message: 'boom' }] }, { status: 500 })),
    );
    renderDetail({ initialJob: null, bulkJobId: 1 });
    expect(await screen.findByText(/Failed: boom/)).toBeInTheDocument();
  });

  it('shows loading when deep-link fetch in flight', () => {
    server.use(
      http.get('/api/runviewer/jobs/1', () =>
        new Promise(() => { /* never resolve */ })),
    );
    renderDetail({ initialJob: null, bulkJobId: 1 });
    expect(screen.getByText(/Loading job/)).toBeInTheDocument();
  });

  it('renders Client Intel jump icon when onJumpToClientIntel provided and phone present', () => {
    renderDetail({
      initialJob: mkJob({ deliverToPhone: '022' }),
      onJumpToClientIntel: () => { /* no-op */ },
    });
    expect(screen.getByTitle('Jump to Client Intel')).toBeInTheDocument();
    expect(screen.getByLabelText('Jump to Client Intel')).toBeInTheDocument();
  });

  it('hides Client Intel jump icon when onJumpToClientIntel not wired', () => {
    renderDetail({ initialJob: mkJob({ deliverToPhone: '022' }) });
    expect(screen.queryByTitle('Jump to Client Intel')).toBeNull();
  });

  it('hides Client Intel jump icon when no phone and no clientIntel flag', () => {
    renderDetail({
      initialJob: mkJob({ deliverToPhone: null, phone: null, clientIntel: false }),
      onJumpToClientIntel: () => { /* no-op */ },
    });
    expect(screen.queryByTitle('Jump to Client Intel')).toBeNull();
  });

  it('renders Track-It icon when trackingLink is present', () => {
    renderDetail({ initialJob: mkJob({ trackingLink: 'https://track.example/JOB-1' }) });
    expect(screen.getByTitle('Open Track-It link')).toBeInTheDocument();
    expect(screen.getByLabelText('Open Track-It link')).toBeInTheDocument();
  });

  it('hides Track-It icon when trackingLink is null', () => {
    renderDetail({ initialJob: mkJob({ trackingLink: null }) });
    expect(screen.queryByTitle('Open Track-It link')).toBeNull();
  });

  it('applies border-error to pickup card when pickup lng is null', () => {
    renderDetail({ initialJob: mkJob({ pickUpLongitude: null }) });
    const card = screen.getByTestId('address-card-pickup');
    expect(card.className).toContain('border-error');
    expect(card.getAttribute('data-missing-coord')).toBe('true');
  });

  it('does not apply border-error to pickup card when pickup lng is present', () => {
    renderDetail({ initialJob: mkJob({ pickUpLongitude: 174.76, pickUpLatitude: -36.85 }) });
    const card = screen.getByTestId('address-card-pickup');
    expect(card.className).not.toContain('border-error');
    expect(card.getAttribute('data-missing-coord')).toBe('false');
  });

  it('applies border-error to delivery card when delivery lng is null', () => {
    renderDetail({
      initialJob: mkJob({ toLng: null, deliveryLongitude: null }),
    });
    const card = screen.getByTestId('address-card-delivery');
    expect(card.className).toContain('border-error');
    expect(card.getAttribute('data-missing-coord')).toBe('true');
  });

  it('does not apply border-error to delivery card when delivery lng is present', () => {
    renderDetail({ initialJob: mkJob({ toLng: 174.77, toLat: -36.86 }) });
    const card = screen.getByTestId('address-card-delivery');
    expect(card.className).not.toContain('border-error');
  });

  it('falls back to deliveryLongitude when toLng is null but deliveryLongitude present', () => {
    renderDetail({
      initialJob: mkJob({ toLng: null, toLat: null, deliveryLongitude: 174.77, deliveryLatitude: -36.86 }),
    });
    const card = screen.getByTestId('address-card-delivery');
    expect(card.getAttribute('data-missing-coord')).toBe('false');
  });

  describe('courier iframe overlay (Part A / #34)', () => {
    it('renders the Google Maps iframe overlay when selectedCourier is set', () => {
      renderDetail({
        bulkJobId: null,
        initialJob: null,
        selectedCourier: { code: 'KEV', name: 'Kev Tester' },
      });
      const wrap = screen.getByTestId('courier-map-overlay');
      expect(wrap).toBeInTheDocument();
      const iframe = wrap.querySelector('iframe');
      expect(iframe).not.toBeNull();
      // The map query is the URL-encoded "code name" pair; the plain
      // Google Maps embed URL does not require an API key.
      expect(iframe!.getAttribute('src')).toContain(
        `https://maps.google.com/maps?q=${encodeURIComponent('KEV Kev Tester')}&output=embed`,
      );
    });

    it('overlay wins even when a job is also selected', () => {
      // selectedCourier takes precedence over the normal detail render
      // so operators clicking a courier row from RvCouriersBox always
      // see the map without needing to clear the job selection first.
      renderDetail({
        bulkJobId: 1,
        initialJob: mkJob(),
        selectedCourier: { code: 'KEV', name: 'Kev Tester' },
      });
      expect(screen.getByTestId('courier-map-overlay')).toBeInTheDocument();
      expect(screen.queryByText(/Detail for Job/)).toBeNull();
    });

    it('does not render the overlay when selectedCourier is null or undefined', () => {
      renderDetail({ initialJob: mkJob(), selectedCourier: null });
      expect(screen.queryByTestId('courier-map-overlay')).toBeNull();
      // Normal detail render still fires.
      expect(screen.getByText(/Detail for Job/)).toBeInTheDocument();
    });
  });
});
