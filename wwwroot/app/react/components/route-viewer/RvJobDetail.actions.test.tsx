import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('RvJobDetail (actions)', () => {
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

  it('fires onTransferRoute on Transfer Route click', async () => {
    const onTransferRoute = vi.fn();
    renderDetail({ onTransferRoute });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Transfer Route/ }));
    expect(onTransferRoute).toHaveBeenCalled();
  });

  it('fires onPrint / onSend on header icon click', async () => {
    const onPrint = vi.fn();
    const onSend = vi.fn();
    renderDetail({ onPrint, onSend });
    const user = userEvent.setup();
    await user.click(screen.getByTitle('Print'));
    await user.click(screen.getByTitle('Send'));
    expect(onPrint).toHaveBeenCalled();
    expect(onSend).toHaveBeenCalled();
  });

  it('opens GPS modal on pickup card right-click', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: null };
    renderDetail();
    // Right-click the pickup card (element with title "PICKUP")
    const pickupCard = screen.getByText('Pickup').closest('div')!.parentElement!.parentElement!;
    fireEvent.contextMenu(pickupCard);
    expect(await screen.findByText(/Update GPS - Pickup/)).toBeInTheDocument();
  });

  it('editable ref field commits on Enter + fires PATCH', async () => {
    let called = false;
    server.use(
      http.get('/api/runviewer/runs/job-siblings', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/jobs/pod-photos', () => HttpResponse.json({ response: [] })),
      http.post('/api/runviewer/jobs/1/text-fields', () => {
        called = true;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderDetail();
    const user = userEvent.setup();
    // Click "RefA" cell value to swap to input
    const refCell = screen.getByText('RefA');
    await user.click(refCell);
    const input = await screen.findByDisplayValue('RefA');
    await user.clear(input);
    await user.type(input, 'newRefA{enter}');
    await waitFor(() => expect(called).toBe(true));
  });

  it('cancels edit on Escape without firing PATCH', async () => {
    let called = false;
    server.use(
      http.get('/api/runviewer/runs/job-siblings', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/jobs/pod-photos', () => HttpResponse.json({ response: [] })),
      http.post('/api/runviewer/jobs/1/text-fields', () => {
        called = true;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderDetail();
    const user = userEvent.setup();
    await user.click(screen.getByText('RefA'));
    const input = await screen.findByDisplayValue('RefA');
    await user.type(input, 'x');
    fireEvent.keyDown(input, { key: 'Escape' });
    // Wait some ticks
    await new Promise((r) => setTimeout(r, 30));
    expect(called).toBe(false);
  });

  it('editable notes card enters edit mode + commits on blur', async () => {
    let called = false;
    server.use(
      http.get('/api/runviewer/runs/job-siblings', () => HttpResponse.json({ response: [] })),
      http.get('/api/runviewer/jobs/pod-photos', () => HttpResponse.json({ response: [] })),
      http.post('/api/runviewer/jobs/1/text-fields', () => {
        called = true;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderDetail();
    const user = userEvent.setup();
    const editBtn = screen.getAllByText('edit')[0];
    await user.click(editBtn);
    const ta = await screen.findByDisplayValue('Pickup notes');
    await user.clear(ta);
    await user.type(ta, 'new pickup');
    // Blur commits
    fireEvent.blur(ta);
    await waitFor(() => expect(called).toBe(true));
  });

  it('shows readOnly rows for non-Internal client (no edit affordance)', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, clientTypeId: 'External' };
    renderDetail();
    // No "edit" button in notes card
    expect(screen.queryByText('edit')).toBeNull();
  });

  it('fires onJumpToClientIntel with the current job on click', async () => {
    const onJumpToClientIntel = vi.fn();
    renderDetail({
      initialJob: mkJob({ deliverToPhone: '022' }),
      onJumpToClientIntel,
    });
    const user = userEvent.setup();
    await user.click(screen.getByTitle('Jump to Client Intel'));
    expect(onJumpToClientIntel).toHaveBeenCalledTimes(1);
    // First arg should be the job passed in.
    expect(onJumpToClientIntel.mock.calls[0][0]).toMatchObject({ bulkJobId: 1 });
  });

  it('opens Track-It link in a new tab on click', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    try {
      renderDetail({ initialJob: mkJob({ trackingLink: 'https://track.example/JOB-1' }) });
      const user = userEvent.setup();
      await user.click(screen.getByTitle('Open Track-It link'));
      expect(openSpy).toHaveBeenCalledWith('https://track.example/JOB-1', '_blank');
    } finally {
      openSpy.mockRestore();
    }
  });

  it('sibling tab click fires onPickSibling', async () => {
    const onPickSibling = vi.fn();
    server.use(
      http.get('/api/runviewer/runs/job-siblings', () =>
        HttpResponse.json({
          response: [
            { jobId: 100, bulkJobId: 1, jobNumber: 'JOB-100', jobStatus: 'D', tabLabel: '', job: null },
            { jobId: 101, bulkJobId: 0, jobNumber: null, jobStatus: 'D', tabLabel: '*LHP', job: null },
          ],
        })),
      http.get('/api/runviewer/jobs/pod-photos', () =>
        HttpResponse.json({ response: [] })),
    );
    renderDetail({ initialJob: mkJob({ jobId: 100 }), onPickSibling });
    const user = userEvent.setup();
    const tab = await screen.findByText('*LHP');
    await user.click(tab);
    expect(onPickSibling).toHaveBeenCalled();
  });
});
