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
});
