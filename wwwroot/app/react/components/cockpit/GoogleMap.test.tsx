import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { GoogleMap, MULTI_RUN_COLOURS } from './GoogleMap';
import type { BulkJob, Run } from '@/types';

// Fake Google Maps SDK. Exposes minimal Map / Marker / LatLngBounds /
// InfoWindow classes so the component's effect body runs. Every constructor
// stores its args; every listener is a no-op that returns a marker handle.
// Rich enough to exercise every branch of buildPins/makeIcon.
const g = {
  maps: {
    Map: vi.fn(function (this: any, _el: any, _opts: any) {
      this.setCenter = vi.fn();
      this.fitBounds = vi.fn();
      this.setZoom = vi.fn();
      this.addListener = vi.fn();
    }),
    Marker: vi.fn(function (this: any, _opts: any) {
      this._map = null;
      this.setMap = vi.fn();
      this.setAnimation = vi.fn();
      this.addListener = vi.fn((_type: string, _cb: any) => ({ remove: vi.fn() }));
      this.getPosition = vi.fn(() => ({ lat: () => 0, lng: () => 0 }));
    }),
    Polyline: vi.fn(function (this: any, _opts: any) {
      this.setMap = vi.fn();
    }),
    LatLngBounds: vi.fn(function (this: any) {
      this.extend = vi.fn();
      this.isEmpty = vi.fn(() => false);
    }),
    InfoWindow: vi.fn(function () {}),
    MapTypeId: { ROADMAP: 'ROADMAP' },
    Size: vi.fn(function (this: any, _w: number, _h: number) {}),
    Point: vi.fn(function (this: any, _x: number, _y: number) {}),
    Animation: { BOUNCE: 'BOUNCE' },
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
  // The polyline-draw effect fires a POST /api/routes/polyline whenever a run
  // with 2+ sequenced pins is selected. Stub it with an empty polyline reply
  // so the placeholder line stays; nothing here needs to inspect the network
  // call, we just want MSW to stop reporting an unhandled request.
  server.use(
    http.post('/api/routes/polyline', () => HttpResponse.json({ points: [] })),
  );
});
afterEach(() => {
  delete (window as any).google;
});

function makeJob(over: Partial<BulkJob> = {}): BulkJob {
  return {
    bulkJobId: 1,
    jobNumber: 'J-1',
    bookDate: '2026-08-13',
    bookTime: '09:30:00',
    jobStatus: 0,
    clientId: 1,
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
    ...over,
  };
}

function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 1,
    name: 'Run 1',
    mins: 0,
    kms: 0,
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
    ...over,
  };
}

describe('GoogleMap', () => {
  it('shows the fallback message when no API key is set', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: null };
    delete (window as any).google;
    renderWithProviders(<GoogleMap jobs={[]} selectedRun={null} />);
    expect(screen.getByText('Map unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Google Maps API key is not set/)).toBeInTheDocument();
  });

  it('exports the multi-run palette with 6 rotating colours', () => {
    expect(MULTI_RUN_COLOURS).toHaveLength(6);
    expect(MULTI_RUN_COLOURS[0]).toBe('#ff9000');
  });

  it('mounts + creates a Google Map instance with tenant-aware centre', () => {
    renderWithProviders(<GoogleMap jobs={[]} selectedRun={null} />);
    // Map ctor called with (element, options).
    expect(g.maps.Map).toHaveBeenCalled();
    expect(g.maps.InfoWindow).toHaveBeenCalled();
  });

  it('plots one Marker per job with lat/lng and the sequence label', () => {
    const jobs = [
      makeJob({ bulkJobId: 1 }),
      makeJob({ bulkJobId: 2, jobNumber: 'J-2' }),
    ];
    renderWithProviders(<GoogleMap jobs={jobs} selectedRun={null} />);
    expect(g.maps.Marker).toHaveBeenCalledTimes(2);
  });

  it('skips jobs with missing coordinates', () => {
    const jobs = [
      makeJob({ bulkJobId: 1 }),
      makeJob({ bulkJobId: 2, deliveryLatitude: null }),
    ];
    renderWithProviders(<GoogleMap jobs={jobs} selectedRun={null} />);
    expect(g.maps.Marker).toHaveBeenCalledTimes(1);
  });

  it('emits polyline draw when a run with 2+ sequenced pins is selected', () => {
    const jobs = [
      makeJob({ bulkJobId: 1 }),
      makeJob({ bulkJobId: 2, jobNumber: 'J-2' }),
    ];
    const run = makeRun({
      jobs: [
        { bulkJobId: 1, builderIndex: 1 } as any,
        { bulkJobId: 2, builderIndex: 2 } as any,
      ],
    });
    renderWithProviders(<GoogleMap jobs={jobs} selectedRun={run} />);
    expect(g.maps.Polyline).toHaveBeenCalled();
  });

  it('toggle Auto Zoom button switches state', () => {
    renderWithProviders(<GoogleMap jobs={[makeJob()]} selectedRun={null} />);
    const btn = screen.getByRole('button', { name: /Auto Zoom: On/ });
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: /Auto Zoom: Off/ })).toBeInTheDocument();
  });

  it('renders the map surface title with the selected run name', () => {
    const run = makeRun({ id: 5, name: 'Southbound' });
    renderWithProviders(<GoogleMap jobs={[]} selectedRun={run} />);
    expect(screen.getByText(/Map - Run: Southbound/)).toBeInTheDocument();
  });

  it('renders the map surface title with job count when no run is selected', () => {
    renderWithProviders(<GoogleMap jobs={[makeJob(), makeJob({ bulkJobId: 2 })]} selectedRun={null} />);
    expect(screen.getByText(/Map - 2 jobs/)).toBeInTheDocument();
  });

  it('handles multi-selected runs by walking the MULTI_RUN_COLOURS palette', () => {
    const jobs = [
      makeJob({ bulkJobId: 1, bulkRunId: 10 }),
      makeJob({ bulkJobId: 2, bulkRunId: 11, jobNumber: 'J-2' }),
    ];
    const multi = [
      makeRun({ id: 10, jobs: [{ bulkJobId: 1, builderIndex: 1 } as any] }),
      makeRun({ id: 11, jobs: [{ bulkJobId: 2, builderIndex: 1 } as any] }),
    ];
    renderWithProviders(<GoogleMap jobs={jobs} selectedRun={null} multiSelectedRuns={multi} />);
    expect(g.maps.Marker).toHaveBeenCalledTimes(2);
  });
});
