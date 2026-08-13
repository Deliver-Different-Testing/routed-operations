import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { FixGpsModal } from './FixGpsModal';
import type { BulkJob } from '@/types';

// Mock Google Maps SDK. Same shape as GoogleMap.test.tsx but slimmer since
// the Fix GPS modal only uses Map + Marker + right-click listener.
const g = {
  maps: {
    Map: vi.fn(function (this: any) {
      this.setCenter = vi.fn();
      this.setZoom = vi.fn();
      this.addListener = vi.fn();
    }),
    Marker: vi.fn(function (this: any) {
      this.setMap = vi.fn();
      this.addListener = vi.fn(() => ({ remove: vi.fn() }));
    }),
    MapTypeId: { ROADMAP: 'ROADMAP' },
  },
};

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: 'fake-key',
    isUsTenant: false,
  };
  (window as any).google = g;
  vi.clearAllMocks();
});
afterEach(() => {
  delete (window as any).google;
});

function makeJob(): BulkJob {
  return {
    bulkJobId: 42,
    jobNumber: 'JOB-42',
    bookDate: '2026-08-13',
    bookTime: '09:30:00',
    jobStatus: 0,
    clientId: 100,
    clientCode: 'ACME',
    amount: 0,
    speed: 10,
    speedName: null,
    fromCompany: null,
    fromAddress: '1 Sender St',
    fromSuburb: 'CBD',
    fromPostCode: 1010,
    toCompany: null,
    toAddress: '99 Recipient Rd',
    toSuburb: 'Ponsonby',
    toPostCode: 1011,
    size: 0,
    qty: 0,
    weight: 0,
    courierId: null,
    courierName: null,
    clientRefa: null,
    clientRefb: null,
    ourRef: null,
    notes: null,
    pickUpLatitude: null,
    pickUpLongitude: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    prebookJob: false,
    onHold: false,
    void: false,
    done: false,
    bulkRunId: null,
    runName: null,
    runOrder: null,
    multiboxParentId: null,
    parentId: null,
    regionId: null,
    barcode: null,
    okToLeave: null,
    contact: null,
    deliverToContact: null,
    deliverToPhone: null,
    trackingEmail: null,
    trackingMobile: null,
    proofOfDeliveryEmail: null,
    proofOfDeliveryMobile: null,
    scheduleId: null,
    scheduleName: null,
    scheduleWindowStart: null,
    scheduleWindowEnd: null,
    jobCubicM3: null,
    maxJobsPerRun: null,
    applyPickupCutoff: null,
    pickupCutoffHours: null,
    prefixRunName: null,
    postCodeMergeTo: null,
    runSequence: 0,
    bulkJobRunId: 0,
  };
}

describe('FixGpsModal', () => {
  it('returns null when no job is supplied', () => {
    renderWithProviders(
      <FixGpsModal open job={null} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    // Modal heading absent + no address search input rendered.
    expect(screen.queryByRole('heading', { name: /Fix GPS/ })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Street, city, state')).not.toBeInTheDocument();
  });

  it('does not render body content when closed', () => {
    renderWithProviders(
      <FixGpsModal open={false} job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    expect(screen.queryByRole('heading', { name: /Fix GPS/ })).not.toBeInTheDocument();
  });

  it('shows title with job number when opened', () => {
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    expect(screen.getByRole('heading', { name: /Fix GPS - JOB-42/ })).toBeInTheDocument();
  });

  it('renders Delivery + Pickup toggle and switches sides on click', () => {
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    // Both labels present.
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
    // Delivery is preselected (defaultLeg = ToAddress).
    const deliveryRadio = screen.getByRole('radio', { name: 'Delivery' }) as HTMLInputElement;
    const pickupRadio = screen.getByRole('radio', { name: 'Pickup' }) as HTMLInputElement;
    expect(deliveryRadio.checked).toBe(true);
    fireEvent.click(pickupRadio);
    expect(pickupRadio.checked).toBe(true);
  });

  it('honours defaultLeg when specified', () => {
    renderWithProviders(
      <FixGpsModal
        open
        job={makeJob()}
        defaultLeg="FromAddress"
        onClose={vi.fn()}
        onSave={vi.fn(async () => {})}
      />
    );
    const pickupRadio = screen.getByRole('radio', { name: 'Pickup' }) as HTMLInputElement;
    expect(pickupRadio.checked).toBe(true);
  });

  it('pre-fills the search box with the current listed address', () => {
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    // Delivery leg -> "99 Recipient Rd, Ponsonby, 1011"
    expect(screen.getByDisplayValue('99 Recipient Rd, Ponsonby, 1011')).toBeInTheDocument();
  });

  it('renders the "current on file" summary', () => {
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    expect(screen.getByText(/Current on file:/)).toBeInTheDocument();
  });

  it('forwardGeocode success updates the candidate card', async () => {
    server.use(
      http.get('/api/address/forward-geocode', () =>
        HttpResponse.json({
          found: true,
          lat: -36.85,
          lng: 174.76,
          formattedAddress: '1 Test St, Auckland',
          postCode: '1010',
        }),
      ),
    );
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await waitFor(() =>
      expect(screen.getByText(/1 Test St, Auckland/)).toBeInTheDocument()
    );
    expect(screen.getByText(/-36.850000, 174.760000/)).toBeInTheDocument();
  });

  it('forwardGeocode not-found path shows the error message', async () => {
    server.use(
      http.get('/api/address/forward-geocode', () => HttpResponse.json({ found: false })),
    );
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await waitFor(() => expect(screen.getByText(/No results found/)).toBeInTheDocument());
  });

  it('search input Enter triggers geocode', async () => {
    server.use(
      http.get('/api/address/forward-geocode', () =>
        HttpResponse.json({ found: true, lat: 1, lng: 2, formattedAddress: 'Enter Hit', postCode: null }),
      ),
    );
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    const input = screen.getByPlaceholderText('Street, city, state');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Enter Hit/)).toBeInTheDocument());
  });

  it('Use listed button re-geocodes the current address', async () => {
    server.use(
      http.get('/api/address/forward-geocode', () =>
        HttpResponse.json({ found: true, lat: 1, lng: 2, formattedAddress: 'Listed Result', postCode: '9999' }),
      ),
    );
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use listed' }));
    await waitFor(() => expect(screen.getByText(/Listed Result/)).toBeInTheDocument());
  });

  it('Cancel button calls onClose', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={onClose} onSave={vi.fn(async () => {})} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Apply button is disabled when there is no candidate', () => {
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    expect(screen.getByRole('button', { name: /Apply to delivery/ })).toBeDisabled();
  });

  it('Apply button becomes enabled after a candidate lands + onSave is called with correct fields', async () => {
    server.use(
      http.get('/api/address/forward-geocode', () =>
        HttpResponse.json({ found: true, lat: -36.86, lng: 174.77, formattedAddress: 'Match', postCode: '1010' }),
      ),
    );
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={onClose} onSave={onSave} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Apply to delivery/ })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /Apply to delivery/ }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(42, 'ToAddress', '-36.86', '174.77', '1010')
    );
  });

  it('shows the "Copy this address back" button after a candidate lands', async () => {
    server.use(
      http.get('/api/address/forward-geocode', () =>
        HttpResponse.json({ found: true, lat: 1, lng: 2, formattedAddress: '1 Test, City', postCode: '' }),
      ),
    );
    renderWithProviders(
      <FixGpsModal open job={makeJob()} onClose={vi.fn()} onSave={vi.fn(async () => {})} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Copy this address/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Copy this address/ }));
    // After copy, the search input should hold the trimmed portion (everything
    // after the first comma).
    expect(screen.getByDisplayValue('City')).toBeInTheDocument();
  });
});
