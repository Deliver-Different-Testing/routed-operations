import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CockpitPage } from './CockpitPage';

// Minimal Google Maps SDK stub so the embedded GoogleMap subcomponent runs
// its init effect. Same shape as GoogleMap.test.tsx.
const gmaps = {
  maps: {
    Map: vi.fn(function (this: any) {
      this.setCenter = vi.fn();
      this.fitBounds = vi.fn();
      this.setZoom = vi.fn();
      this.addListener = vi.fn();
    }),
    Marker: vi.fn(function (this: any) {
      this.setMap = vi.fn();
      this.setAnimation = vi.fn();
      this.addListener = vi.fn(() => ({ remove: vi.fn() }));
      this.getPosition = vi.fn(() => ({ lat: () => 0, lng: () => 0 }));
    }),
    Polyline: vi.fn(function (this: any) {
      this.setMap = vi.fn();
    }),
    LatLngBounds: vi.fn(function (this: any) {
      this.extend = vi.fn();
      this.isEmpty = vi.fn(() => true);
    }),
    InfoWindow: vi.fn(function () {}),
    MapTypeId: { ROADMAP: 'ROADMAP' },
    Size: vi.fn(),
    Point: vi.fn(),
    Animation: { BOUNCE: 'BOUNCE' },
  },
};

beforeEach(() => {
  (window as any).__APP_USER__ = {
    ...(window as any).__APP_USER__,
    googleMapsKey: null, // Force the map to show the "unavailable" fallback
                        // so we skip the DOM-heavy map init entirely.
    isUsTenant: false,
  };
  (window as any).google = gmaps;
  // Loose bootstrap handlers so the CockpitPage's initial fetches don't
  // throw "unhandled request" MSW errors. Everything returns empty
  // collections; individual tests below can override to seed richer data.
  server.use(
    http.get('/api/regions', () => HttpResponse.json([])),
    http.get('/api/speeds', () => HttpResponse.json([])),
    http.get('/api/couriers', () => HttpResponse.json({ potentialCouriers: [] })),
    http.get('/api/fleets', () => HttpResponse.json({ fleets: [] })),
    http.get('/api/jobs/filters/clients', () =>
      HttpResponse.json({ response: { clients: [] } })
    ),
    http.get('/api/jobs/filters/refs', () => HttpResponse.json({ ourRefs: [] })),
    http.get('/api/vehicle-sizes', () => HttpResponse.json({ response: [] })),
    http.get('/api/jobs', () =>
      HttpResponse.json({ bulkJobs: [], maxJsonLength: 10000 })
    ),
    http.get('/api/runs', () => HttpResponse.json({ response: [], maxJsonLength: 10000 })),
    http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
  );
});
afterEach(() => {
  delete (window as any).google;
});

describe('CockpitPage', () => {
  it('renders the panels + FiltersBar without throwing', async () => {
    renderWithProviders(<CockpitPage />);
    // FiltersBar buttons.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sync EH/HD' })).toBeInTheDocument();
    // Empty state rows from JobsList and RunList render.
    expect(screen.getByText(/No jobs match the current filters/)).toBeInTheDocument();
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
  });

  it('shows the map fallback when there is no Google Maps API key', async () => {
    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByText('Map unavailable')).toBeInTheDocument());
  });

  it('renders jobs delivered from the /api/jobs endpoint', async () => {
    server.use(
      http.get('/api/jobs', () =>
        HttpResponse.json({
          bulkJobs: [
            {
              bulkJobId: 1,
              jobNumber: 'FROM-SERVER',
              bookDate: '2026-08-13',
              bookTime: '2026-08-13T09:30:00',
              jobStatus: 0,
              clientId: 100,
              clientCode: 'ACME',
              amount: 0,
              speed: 10,
              speedName: null,
              fromCompany: null,
              fromAddress: null,
              fromSuburb: null,
              fromPostCode: null,
              toCompany: null,
              toAddress: null,
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
              deliveryLatitude: '-36.86',
              deliveryLongitude: '174.76',
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
            },
          ],
          maxJsonLength: 10000,
        })
      ),
    );
    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByText('FROM-SERVER')).toBeInTheDocument());
  });

  it('renders runs delivered from the /api/runs endpoint', async () => {
    server.use(
      http.get('/api/runs', () =>
        HttpResponse.json({
          response: [
            {
              id: 999,
              name: 'SERVER-RUN',
              mins: 30,
              kms: 8,
              courierId: null,
              courierName: null,
              status: 0,
              revenue: null,
              payout: null,
              courierPercentage: null,
              googleRouteResponse: null,
              despatchDateTime: null,
              noReroute: false,
              routingMode: 0,
              finishAtBulkJobId: null,
              isVoidRun: false,
              fleet: null,
              jobs: [],
            },
          ],
          maxJsonLength: 10000,
        })
      ),
    );
    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(screen.getByText('SERVER-RUN')).toBeInTheDocument());
  });

  it('changing the Filters date input triggers a reload with the new date', async () => {
    let jobsCallCount = 0;
    let lastUrl = '';
    server.use(
      http.get('/api/jobs', ({ request }) => {
        jobsCallCount += 1;
        lastUrl = request.url;
        return HttpResponse.json({ bulkJobs: [], maxJsonLength: 10000 });
      }),
    );
    renderWithProviders(<CockpitPage />);
    await waitFor(() => expect(jobsCallCount).toBeGreaterThan(0));
    const dateInput = screen.getByLabelText(/Date/) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-12-25' } });
    await waitFor(() => expect(lastUrl).toContain('date=2026-12-25'));
  });

  it('recovers when the /api/jobs endpoint returns an error (no crash)', async () => {
    server.use(
      http.get('/api/jobs', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
    );
    renderWithProviders(<CockpitPage />);
    // Even after the failure, the FiltersBar still mounts so the page did
    // not crash.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument());
  });
});
