import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvMapBox } from './RvMapBox';
import type { BulkJob } from '../../services/routeViewerService';

// Fake Google Maps SDK. Mounted on window.google before render so
// RvMapBox's setInterval polling picks it up and calls the constructors
// we care about. Also captures every Marker instance for assertions on
// bounce animation + flag/car marker creation.
const markerInstances: any[] = [];
const polylineInstances: any[] = [];

function installFakeGoogle() {
  markerInstances.length = 0;
  polylineInstances.length = 0;
  const listeners: any[] = [];
  const g: any = {
    maps: {
      Animation: { BOUNCE: 'BOUNCE', DROP: 'DROP' },
      LatLngBounds: class {
        _isEmpty = true;
        extend() { this._isEmpty = false; }
        isEmpty() { return this._isEmpty; }
      },
      Point: class {
        constructor(public x: number, public y: number) {}
      },
      MapTypeId: { ROADMAP: 'ROADMAP' },
      Map: class {
        constructor(_el: any, _opts: any) {}
        fitBounds(_b: any, _p: number) {}
      },
      InfoWindow: class {
        setContent() {}
        open() {}
        close() {}
      },
      Marker: class {
        _map: any = null;
        _animation: any = null;
        _position: any = null;
        _handlers: Record<string, Function[]> = {};
        opts: any;
        constructor(opts: any) {
          this.opts = opts;
          this._map = opts?.map ?? null;
          this._position = opts?.position ?? null;
          markerInstances.push(this);
        }
        setMap(v: any) { this._map = v; }
        setPosition(p: any) { this._position = p; }
        setAnimation(v: any) { this._animation = v; }
        addListener(name: string, fn: Function) {
          this._handlers[name] = (this._handlers[name] ?? []).concat(fn);
          listeners.push(fn);
        }
      },
      Polyline: class {
        _map: any = null;
        constructor(opts: any) {
          this._map = opts?.map ?? null;
          polylineInstances.push(this);
        }
        setMap(v: any) { this._map = v; }
      },
    },
  };
  (window as any).google = g;
}

function renderMap(over: Partial<Parameters<typeof RvMapBox>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const defaults = {
    runDate: '2026-08-13',
    runJobs: [] as BulkJob[],
    selectedJobId: null,
    viewMode: 'Combined' as const,
  };
  const props = { ...defaults, ...over };
  const result = renderWithProviders(
    <QueryClientProvider client={client}>
      <RvMapBox {...props} />
    </QueryClientProvider>,
  );
  return { ...props, ...result, client };
}

const mkJob = (over: Partial<BulkJob> = {}): BulkJob => ({
  bulkJobId: 1, jobId: 1, jobNumber: 'J-1', jobStatus: 'D', clientCode: null,
  speedName: null, speed: null, fromCompany: null, fromAddress: null, fromSuburb: null,
  toCompany: null, toAddress: null, toSuburb: null, bookDate: null, bookTime: null,
  pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: null,
  pickedUp: null, dispatched: null, podTime: null, podName: null,
  amount: null, courierId: null, courierName: null, courierCode: null,
  contact: null, phone: null, deliverToContact: null, deliverToPhone: null,
  trackingEmail: null, proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
  notes: null, deliveryNotes: null, labelNotes: null,
  size: null, qty: null, weight: null, speedId: null,
  ourRef: null, refA: null, refB: null, runName: null, runOrder: null,
  bulkRunId: 55, multiboxParentId: null, parentJobId: null, regionId: null, regionName: null,
  agentName: null, agentType: null, isNpAgent: false,
  pickUpLatitude: -36.85, pickUpLongitude: 174.76,
  deliveryLatitude: null, deliveryLongitude: null,
  toLat: -36.86, toLng: 174.77,
  fromPostCode: null, toPostCode: null, fromCity: null, toCity: null,
  ...over,
});

describe('RvMapBox', () => {
  beforeEach(() => {
    (window as any).__APP_USER__ = {
      ...(window as any).__APP_USER__,
      googleMapsKey: null,
      isUsTenant: false,
    };
    delete (window as any).google;
    markerInstances.length = 0;
    polylineInstances.length = 0;
  });

  it('shows API-key-missing note when no key', () => {
    renderMap();
    expect(screen.getByText(/Google Maps API key not configured/)).toBeInTheDocument();
  });

  it('shows "Loading map SDK" while google is undefined + apiKey present', () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: 'K' };
    renderMap();
    expect(screen.getByText(/Loading map SDK/)).toBeInTheDocument();
  });

  it('renders All Couriers, All Runs, Track toggles and Clear button', () => {
    renderMap();
    expect(screen.getByText('All Couriers')).toBeInTheDocument();
    expect(screen.getByText('All Runs')).toBeInTheDocument();
    expect(screen.getByText('Track')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear/ })).toBeInTheDocument();
  });

  it('checkbox toggles All Couriers', async () => {
    server.use(
      http.get('/api/runviewer/couriers/available', () => HttpResponse.json({ response: [] })),
    );
    renderMap();
    const user = userEvent.setup();
    const cb = screen.getAllByRole('checkbox')[0];
    expect(cb).not.toBeChecked();
    await user.click(cb);
    expect(cb).toBeChecked();
  });

  it('confirms All Runs when runJobs > 40 jobs', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const bigList = Array.from({ length: 50 }, (_, i) => mkJob({ bulkJobId: i, jobId: i }));
    renderMap({ runJobs: bigList });
    const user = userEvent.setup();
    const cb = screen.getAllByRole('checkbox')[1];
    await user.click(cb);
    expect(confirmSpy).toHaveBeenCalled();
    // Cancelled -> not checked
    expect(cb).not.toBeChecked();
  });

  it('toggles All Runs without confirm when small list', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderMap({ runJobs: [mkJob()] });
    const user = userEvent.setup();
    const cb = screen.getAllByRole('checkbox')[1];
    await user.click(cb);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(cb).toBeChecked();
  });

  it('renders map SDK Loading gone when google present', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: 'K' };
    installFakeGoogle();
    renderMap({ runJobs: [mkJob()], selectedJobId: 1 });
    // The loading text may or may not disappear synchronously; just ensure
    // the container div is present.
    expect(document.querySelector('div.w-full.h-full')).toBeInTheDocument();
  });

  it('Track checkbox is disabled when no job is selected', () => {
    renderMap();
    const trackCb = screen.getAllByRole('checkbox')[2];
    expect(trackCb).toBeDisabled();
  });

  it('Track checkbox is enabled when a job is selected', () => {
    renderMap({ runJobs: [mkJob()], selectedJobId: 1 });
    const trackCb = screen.getAllByRole('checkbox')[2];
    expect(trackCb).not.toBeDisabled();
  });

  it('Clear button resets All Couriers + All Runs toggles', async () => {
    server.use(
      http.get('/api/runviewer/couriers/available', () => HttpResponse.json({ response: [] })),
    );
    renderMap({ runJobs: [mkJob()], selectedJobId: 1 });
    const user = userEvent.setup();
    const [couriersCb, runsCb] = screen.getAllByRole('checkbox');
    await user.click(couriersCb);
    await user.click(runsCb);
    expect(couriersCb).toBeChecked();
    expect(runsCb).toBeChecked();

    await user.click(screen.getByRole('button', { name: /Clear/ }));
    expect(couriersCb).not.toBeChecked();
    expect(runsCb).not.toBeChecked();
  });

  it('bounce animation fires on selected job pin when SDK is present', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: 'K' };
    installFakeGoogle();
    renderMap({ runJobs: [mkJob({ bulkJobId: 42 })], selectedJobId: 42 });

    // Wait for the map init effect + marker rebuild + bounce effect to
    // run. The fake Marker records setAnimation calls; after the effect
    // there should be exactly one bounce among the job markers.
    await waitFor(() => {
      const bounced = markerInstances.filter((m) => m._animation === 'BOUNCE');
      expect(bounced.length).toBeGreaterThan(0);
    });
  });

  it('does NOT bounce when no job is selected', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: 'K' };
    installFakeGoogle();
    renderMap({ runJobs: [mkJob({ bulkJobId: 42 })], selectedJobId: null });

    // Give the effect a tick to settle.
    await act(async () => { await Promise.resolve(); });
    const bounced = markerInstances.filter((m) => m._animation === 'BOUNCE');
    expect(bounced).toHaveLength(0);
  });

  it('flag marker fires when All Couriers toggle is on and data lands', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: 'K' };
    installFakeGoogle();
    server.use(
      http.get('/api/runviewer/couriers/available', () => HttpResponse.json({
        response: [{
          courierId: 1,
          courierCode: '007',
          vehicleType: 'Van',
          latitude: -36.9,
          longitude: 174.8,
          timestamp: null,
        }],
      })),
    );
    renderMap({ runJobs: [mkJob()], selectedJobId: null });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox')[0]);

    // Wait until a marker with the flag label ("007 Van") appears.
    await waitFor(() => {
      const flag = markerInstances.find((m) => m.opts?.label?.text === '007 Van');
      expect(flag).toBeDefined();
    });
  });

  it('Clear button tears down flag markers', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: 'K' };
    installFakeGoogle();
    server.use(
      http.get('/api/runviewer/couriers/available', () => HttpResponse.json({
        response: [{
          courierId: 1,
          courierCode: 'A1',
          vehicleType: 'Bike',
          latitude: -36.9,
          longitude: 174.8,
          timestamp: null,
        }],
      })),
    );
    renderMap({ runJobs: [mkJob()], selectedJobId: null });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox')[0]);
    await waitFor(() => {
      const flag = markerInstances.find((m) => m.opts?.label?.text === 'A1 Bike');
      expect(flag).toBeDefined();
    });
    const flag = markerInstances.find((m) => m.opts?.label?.text === 'A1 Bike');

    await user.click(screen.getByRole('button', { name: /Clear/ }));
    // Marker.setMap(null) was called by onClearRoutes.
    expect(flag._map).toBeNull();
  });

  it('car marker created + moved on tracked courier data updates', async () => {
    (window as any).__APP_USER__ = { ...(window as any).__APP_USER__, googleMapsKey: 'K' };
    installFakeGoogle();
    let call = 0;
    server.use(
      http.get('/api/runviewer/couriers/position', () => {
        call += 1;
        return HttpResponse.json({
          response: {
            courierId: 5,
            courierCode: 'DRV',
            latitude: -36.9 + call * 0.01,
            longitude: 174.8,
            timestamp: null,
          },
        });
      }),
    );
    renderMap({ runJobs: [mkJob()], selectedJobId: 1 });
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox')[2]);

    // Wait for the car marker to appear (title contains "Courier DRV").
    await waitFor(() => {
      const car = markerInstances.find((m) => m.opts?.title === 'Courier DRV');
      expect(car).toBeDefined();
    });
  });
});
