import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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

describe('RvJobContextMenu (render)', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      isNetworkPartner: false,
      fullName: 'Kev',
    };
  });

  it('renders admin menu items for single job', () => {
    renderMenu();
    expect(screen.getByText('Activate')).toBeInTheDocument();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Void')).toBeInTheDocument();
    expect(screen.getByText('Book Direct Redelivery')).toBeInTheDocument();
    expect(screen.getByText('Return to Base')).toBeInTheDocument();
    expect(screen.getByText('Top Up')).toBeInTheDocument();
    expect(screen.getByText('Create Job Event')).toBeInTheDocument();
  });

  it('shows job number in header for single-job menu', () => {
    renderMenu({ jobs: [mkJob({ jobNumber: 'ABC-1' })] });
    expect(screen.getByText(/ABC-1/)).toBeInTheDocument();
  });

  it('shows bulk header for multi-job selection', () => {
    renderMenu({ jobs: [mkJob({ bulkJobId: 1 }), mkJob({ bulkJobId: 2 })] });
    expect(screen.getByText(/2 jobs selected/)).toBeInTheDocument();
  });

  it('disables single-job-only items in bulk mode', () => {
    renderMenu({ jobs: [mkJob({ bulkJobId: 1 }), mkJob({ bulkJobId: 2 })] });
    expect(screen.getByText('Transfer Route').closest('button')!).toBeDisabled();
    expect(screen.getByText('Book Direct Redelivery').closest('button')!).toBeDisabled();
    expect(screen.getByText('Top Up').closest('button')!).toBeDisabled();
  });

  it('disables Create Client Intel when no proofOfDeliveryMobile', () => {
    renderMenu({ jobs: [mkJob({ proofOfDeliveryMobile: null })] });
    expect(screen.getByText('Create Client Intel').closest('button')!).toBeDisabled();
  });

  it('renders NP menu (Assign Courier + Create Job Event only)', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, isNetworkPartner: true };
    renderMenu();
    expect(screen.getByText('Assign Courier')).toBeInTheDocument();
    expect(screen.queryByText('Activate')).toBeNull();
    expect(screen.queryByText('Book Direct Redelivery')).toBeNull();
  });

  it('opens BookRedelivery dialog on Book Direct Redelivery click', async () => {
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Book Direct Redelivery'));
    expect(await screen.findByText('Book direct redelivery')).toBeInTheDocument();
  });

  it('opens Return-to-base variant when Return to Base clicked', async () => {
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Return to Base'));
    expect(await screen.findByText('Book return to base')).toBeInTheDocument();
  });

  it('opens CreateEventDialog on Create Job Event', async () => {
    renderMenu();
    const user = userEvent.setup();
    await user.click(screen.getByText('Create Job Event'));
    expect(await screen.findByText('Create event')).toBeInTheDocument();
  });

  it('opens CreateIntelDialog when mobile present', async () => {
    renderMenu({ jobs: [mkJob({ proofOfDeliveryMobile: '021123' })] });
    const user = userEvent.setup();
    await user.click(screen.getByText('Create Client Intel'));
    expect(await screen.findByText('Create client intel')).toBeInTheDocument();
  });
});
