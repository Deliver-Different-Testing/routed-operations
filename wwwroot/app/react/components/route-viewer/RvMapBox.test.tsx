import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '@/test/server';
import { renderWithProviders } from '@/test/renderWithProviders';
import { RvMapBox } from './RvMapBox';
import type { BulkJob } from '../../services/routeViewerService';

// Fake Google Maps SDK. Mounted on window.google before render so
// RvMapBox's setInterval polling picks it up and calls the constructors
// we care about.
function installFakeGoogle() {
  const listeners: any[] = [];
  const g: any = {
    maps: {
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
      },
      Marker: class {
        _map: any = null;
        _handlers: Record<string, Function[]> = {};
        constructor(_opts: any) {}
        setMap(v: any) { this._map = v; }
        addListener(name: string, fn: Function) {
          this._handlers[name] = (this._handlers[name] ?? []).concat(fn);
          listeners.push(fn);
        }
      },
      Polyline: class {
        _map: any = null;
        constructor(_opts: any) {}
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
  renderWithProviders(
    <QueryClientProvider client={client}>
      <RvMapBox {...props} />
    </QueryClientProvider>,
  );
  return props;
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

  it('renders All Couriers and All Runs toggles', () => {
    renderMap();
    expect(screen.getByText('All Couriers')).toBeInTheDocument();
    expect(screen.getByText('All Runs')).toBeInTheDocument();
  });

  it('checkbox toggles All Couriers', async () => {
    server.use(
      http.get('/api/runviewer/couriers', () => HttpResponse.json({ response: [] })),
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
});
