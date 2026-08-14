import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { MoveBackToRunBuilderDialog } from './MoveBackToRunBuilderDialog';
import type { BulkJob } from '../../services/routeViewerService';

const mkJob = (over: Partial<BulkJob> = {}): BulkJob => ({
  bulkJobId: 42, jobId: 100, jobNumber: 'JOB-100', jobStatus: 'D',
  clientCode: null, speedName: null, speed: null,
  fromCompany: null, fromAddress: null, fromSuburb: null,
  toCompany: null, toAddress: null, toSuburb: null,
  bookDate: null, bookTime: null,
  pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: null,
  pickedUp: null, dispatched: null, podTime: null, podName: null,
  amount: null, courierId: null, courierName: null, courierCode: 'ACE',
  contact: null, phone: null, deliverToContact: null, deliverToPhone: '022',
  trackingEmail: null, proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
  notes: null, deliveryNotes: null, labelNotes: null,
  size: null, qty: null, weight: null, speedId: 5,
  ourRef: null, refA: null, refB: null,
  runName: null, runOrder: null, bulkRunId: 10,
  multiboxParentId: null, parentJobId: null, regionId: null, regionName: null,
  agentName: null, agentType: null, isNpAgent: false,
  pickUpLatitude: null, pickUpLongitude: null,
  deliveryLatitude: null, deliveryLongitude: null,
  toLat: null, toLng: null, fromPostCode: null, toPostCode: null,
  fromCity: null, toCity: null,
  ...over,
});

const stubLookups = () => [
  http.get('/api/runviewer/filters/speeds', () =>
    HttpResponse.json({
      response: [
        { id: 1, label: 'Standard' },
        { id: 5, label: 'Express' },
        { id: 9, label: 'Overnight' },
      ],
    }),
  ),
  http.get('/api/runviewer/filters/clients', () => HttpResponse.json({ response: [] })),
  http.get('/api/runviewer/filters/regions', () => HttpResponse.json({ response: [] })),
];

function renderDlg(
  props: Partial<Parameters<typeof MoveBackToRunBuilderDialog>[0]> = {},
) {
  const defaults = {
    jobs: [mkJob()],
    runDate: '2026-08-14',
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithProviders(
    <QueryClientProvider client={client}>
      <MoveBackToRunBuilderDialog {...merged} />
    </QueryClientProvider>,
  );
  return merged;
}

describe('MoveBackToRunBuilderDialog', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__ };
    server.use(...stubLookups());
  });

  it('defaults Speed to the primary job speedId once lookups load', async () => {
    renderDlg({ jobs: [mkJob({ speedId: 5 })] });
    const speed = await screen.findByLabelText('Speed') as HTMLSelectElement;
    // wait for options to render then confirm the pre-selected value
    await waitFor(() => expect(speed.value).toBe('5'));
  });

  it('defaults Book Time to now-ish (matches YYYY-MM-DDTHH:mm shape)', () => {
    renderDlg();
    const input = screen.getByLabelText('Book Time') as HTMLInputElement;
    // datetime-local of `2026-08-14T13:37` style. Not asserting exact
    // minute (test can race), just shape + that it starts with today's
    // year+month.
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    expect(input.value.startsWith(yearMonth)).toBe(true);
  });

  it('Keep checkbox starts unchecked and toggles', async () => {
    renderDlg();
    const user = userEvent.setup();
    const keep = screen.getByLabelText('Keep Jobs') as HTMLInputElement;
    expect(keep.checked).toBe(false);
    await user.click(keep);
    expect(keep.checked).toBe(true);
  });

  it('submit POSTs payload with speed + bookTime + void=!keep, then onSuccess', async () => {
    let hit = 0;
    let seen: any = null;
    server.use(
      ...stubLookups(),
      http.post('/api/runviewer/jobs/move-back-to-runbuilder', async (info) => {
        hit++;
        seen = await info.request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const props = renderDlg({ jobs: [mkJob({ bulkJobId: 42, speedId: 5 })] });
    const user = userEvent.setup();
    // Wait for speeds to populate + default speed set
    const speed = await screen.findByLabelText('Speed') as HTMLSelectElement;
    await waitFor(() => expect(speed.value).toBe('5'));
    // Change Book Time to a fixed value so we can assert it lands on the wire
    const bookTime = screen.getByLabelText('Book Time') as HTMLInputElement;
    await user.clear(bookTime);
    await user.type(bookTime, '2026-08-15T09:30');
    // Tick Keep so we verify void=!keep=false gets sent
    await user.click(screen.getByLabelText('Keep Jobs'));
    await user.click(screen.getByRole('button', { name: /Move to RunBuilder/ }));
    await waitFor(() => expect(hit).toBe(1));
    expect(seen.bulkJobIds).toEqual([42]);
    expect(seen.newSpeed).toBe(5);
    expect(seen.newDateTime).toBe('2026-08-15T09:30');
    expect(seen.void).toBe(false);
    expect(props.onSuccess).toHaveBeenCalledWith(expect.stringContaining('back to RunBuilder'));
  });

  it('sends void=true when Keep is left unchecked (default)', async () => {
    let seen: any = null;
    server.use(
      ...stubLookups(),
      http.post('/api/runviewer/jobs/move-back-to-runbuilder', async (info) => {
        seen = await info.request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderDlg();
    const user = userEvent.setup();
    const speed = await screen.findByLabelText('Speed') as HTMLSelectElement;
    await waitFor(() => expect(speed.value).toBe('5'));
    await user.click(screen.getByRole('button', { name: /Move to RunBuilder/ }));
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen.void).toBe(true);
  });

  it('cancel button fires onClose only (no POST)', async () => {
    let hit = 0;
    server.use(
      ...stubLookups(),
      http.post('/api/runviewer/jobs/move-back-to-runbuilder', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSuccess).not.toHaveBeenCalled();
    expect(hit).toBe(0);
  });

  it('shows inline error + calls onError when the POST fails', async () => {
    server.use(
      ...stubLookups(),
      http.post('/api/runviewer/jobs/move-back-to-runbuilder', () =>
        HttpResponse.json({ messages: [{ message: 'boom' }] }, { status: 500 }),
      ),
    );
    const props = renderDlg();
    const user = userEvent.setup();
    const speed = await screen.findByLabelText('Speed') as HTMLSelectElement;
    await waitFor(() => expect(speed.value).toBe('5'));
    await user.click(screen.getByRole('button', { name: /Move to RunBuilder/ }));
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
    expect(props.onError).toHaveBeenCalled();
    expect(props.onSuccess).not.toHaveBeenCalled();
  });
});
