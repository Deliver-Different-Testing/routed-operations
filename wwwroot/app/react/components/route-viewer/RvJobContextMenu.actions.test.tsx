import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvJobContextMenu } from './RvJobContextMenu';
import type { BulkJob } from '../../services/routeViewerService';

const mkJob = (over: Partial<BulkJob> = {}): BulkJob => ({
  bulkJobId: 1, jobId: 100, jobNumber: 'JOB-100', jobStatus: 'D',
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
  size: null, qty: null, weight: null, speedId: 1,
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

function renderMenu(over: Partial<Parameters<typeof RvJobContextMenu>[0]> = {}) {
  const defaults = {
    x: 10,
    y: 10,
    jobs: [mkJob()],
    onClose: vi.fn(),
    onDone: vi.fn(),
  };
  const props = { ...defaults, ...over };
  renderWithProviders(<RvJobContextMenu {...props} />);
  return props;
}

describe('RvJobContextMenu (actions)', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
      fullName: 'Kev',
    };
  });

  it('activate: confirms + POSTs + calls onDone', async () => {
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/activate', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const props = renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Activate'));
    // confirm dialog appears
    await user.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(hit).toBe(1));
    expect(props.onDone).toHaveBeenCalled();
  });

  it('aborts activate when confirm cancelled', async () => {
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/activate', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Activate'));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    // Not fired
    await new Promise((r) => setTimeout(r, 30));
    expect(hit).toBe(0);
  });

  it('void jobs POSTs cancel endpoint', async () => {
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/cancel', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const props = renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Void'));
    // Confirm dialog appears with a "Void" button as its data-primary
    await waitFor(() => {
      const primary = document.querySelector('[data-primary="true"]');
      expect(primary).not.toBeNull();
    });
    const primary = document.querySelector('[data-primary="true"]') as HTMLButtonElement;
    await user.click(primary);
    await waitFor(() => expect(hit).toBe(1));
    expect(props.onDone).toHaveBeenCalled();
  });

  it('complete: prompts for POD name + POSTs when non-empty', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('Alice');
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/complete', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Complete'));
    await waitFor(() => expect(hit).toBe(1));
  });

  it('complete: aborts when POD name blank', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('');
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/complete', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Complete'));
    await new Promise((r) => setTimeout(r, 30));
    expect(hit).toBe(0);
  });

  it('send SMS: prompts + POSTs per-job send', async () => {
    vi.spyOn(window, 'prompt').mockReturnValueOnce('Hi');
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/send-sms', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Send SMS'));
    await waitFor(() => expect(hit).toBe(1));
  });

  it('makeLmc: confirms + POSTs lmc for each job', async () => {
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/lmc', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Make LMC'));
    await user.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(hit).toBe(1));
  });

  it('move back to RunBuilder: confirms + POSTs', async () => {
    let hit = 0;
    server.use(
      http.post('/api/runviewer/jobs/move-back-to-runbuilder', () => {
        hit++;
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Move back to RunBuilder'));
    await user.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => expect(hit).toBe(1));
  });
});
