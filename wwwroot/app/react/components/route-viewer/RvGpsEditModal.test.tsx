import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvGpsEditModal } from './RvGpsEditModal';
import type { BulkJob } from '../../services/routeViewerService';

const baseJob: Partial<BulkJob> = {
  bulkJobId: 1,
  jobId: 100,
  jobNumber: 'JOB-1',
  fromAddress: '1 A St',
  fromSuburb: 'Ponsonby',
  fromPostCode: 1011,
  toAddress: '2 B St',
  toSuburb: 'Grey Lynn',
  toPostCode: 1021,
  pickUpLatitude: -36.85,
  pickUpLongitude: 174.76,
  toLat: -36.86,
  toLng: 174.77,
  deliveryLatitude: null,
  deliveryLongitude: null,
};

function renderModal(props: Partial<Parameters<typeof RvGpsEditModal>[0]> = {}) {
  const defaults = {
    job: baseJob as BulkJob,
    leg: 'pickup' as const,
    onClose: vi.fn(),
    onSaved: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  renderWithProviders(<RvGpsEditModal {...merged} />);
  return merged;
}

describe('RvGpsEditModal', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      googleMapsKey: null,
      isUsTenant: false,
    };
  });

  it('shows API-key-missing note when googleMapsKey is null', () => {
    renderModal();
    expect(screen.getByText(/Google Maps API key not configured/)).toBeInTheDocument();
  });

  it('renders "Pickup" title in pickup leg', () => {
    renderModal({ leg: 'pickup' });
    expect(screen.getByText(/Update GPS - Pickup/)).toBeInTheDocument();
  });

  it('renders "Delivery" title in delivery leg', () => {
    renderModal({ leg: 'delivery' });
    expect(screen.getByText(/Update GPS - Delivery/)).toBeInTheDocument();
  });

  it('populates pickup leg fields', () => {
    renderModal({ leg: 'pickup' });
    expect(screen.getByDisplayValue('1 A St')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ponsonby')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1011')).toBeInTheDocument();
  });

  it('populates delivery leg fields', () => {
    renderModal({ leg: 'delivery' });
    expect(screen.getByDisplayValue('2 B St')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Grey Lynn')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1021')).toBeInTheDocument();
  });

  it('cancel triggers onClose', async () => {
    const props = renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('Save button disabled without lat/lng', async () => {
    // Use job without any lat/lng populated
    renderModal({
      job: { ...baseJob, pickUpLatitude: null, pickUpLongitude: null } as BulkJob,
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('submits + calls onSaved on 200', async () => {
    let sent: any = null;
    server.use(
      http.post('/api/runviewer/jobs/gps', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ response: 'ok' });
      }),
    );
    const props = renderModal({ leg: 'pickup' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(sent.leg).toBe('pickup');
    expect(sent.latitude).toBeCloseTo(-36.85);
  });

  it('shows inline error on 500', async () => {
    server.use(
      http.post('/api/runviewer/jobs/gps', () =>
        HttpResponse.json({ messages: [{ message: 'gps boom' }] }, { status: 500 }),
      ),
    );
    renderModal();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/gps boom/)).toBeInTheDocument();
  });

  it('lets operator edit address text', async () => {
    renderModal();
    const user = userEvent.setup();
    const addr = screen.getByDisplayValue('1 A St');
    await user.clear(addr);
    await user.type(addr, '99 New Rd');
    expect(screen.getByDisplayValue('99 New Rd')).toBeInTheDocument();
  });
});
