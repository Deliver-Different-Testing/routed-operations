import type { Page, Request, Route } from '@playwright/test';
import { mockRouteViewerApis } from './routeViewerMocks';

// Shared fixtures for the Medical Will Call Route Viewer specs (#1001,
// #1003, #1004). Built on mockRouteViewerApis: every specific stub here is
// registered AFTER it, so it wins (Playwright runs handlers last-registered
// first).
//
// Shapes follow the real controllers:
//   - runs        GET  /api/runviewer/runs                  { response: BulkRun[] }
//   - run jobs    GET  /api/runviewer/runs/{runId}/jobs      { response: BulkJob[] }   RunViewerRunController.cs:59
//   - routes      GET  /api/runviewer/routes/active          { response: RouteTransferContextResponse }
//                 RunViewerRouteTransferController.cs:24-36, RouteTransferDto.cs:11-26
//   - transfer    POST /api/runviewer/jobs/transfer-route    { response: TransferRouteResult } or 400 { message }
//                 RunViewerRouteTransferController.cs:56-78, RouteTransferDto.cs:55-73
//   - assign      POST /api/runviewer/jobs/assign            { response: BulkAssignmentResult }
//                 RunViewerAssignmentController.cs:77-94, AssignmentDto.cs:78-86
//   - courier q   GET  /api/runviewer/couriers/search?q=     { response: CourierListDto[] }
//                 RunViewerCourierController.cs:33-38, CourierDto.cs:17
//   - event       POST /api/runviewer/events                 { response: { bulkEventId } } or 400 { message }
//                 RunViewerEventController.cs:56-70

export const FILTER_KEY = 'rv-filters:0:dev@example.com';
export const RUN_DATE = '2026-11-04';

export const WILL_CALL_SPEED_ID = 423;
export const MEDICAL_CLIENT_ID = 77;
export const WILL_CALL_COURIER = { courierId: 9, code: 'WC9', name: 'Will Call Driver' };

export interface SeededFilters {
  clientIds?: number[];
  regionIds?: number[];
  speedIds?: number[];
  courierId?: number | null;
  viewMode?: 'Combined' | 'Inbound' | 'Outbound';
}

/** Seeds the persisted Run Viewer filters (RunViewer.tsx onFiltersChange
 *  storage shape) before the page boots. */
export async function seedFilters(page: Page, f: SeededFilters = {}) {
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: FILTER_KEY,
    value: {
      clientIds: f.clientIds ?? [],
      regionIds: f.regionIds ?? [],
      speedIds: f.speedIds ?? [],
      courierId: f.courierId ?? null,
      activeRegionsOnly: true,
      availableCouriersOnly: false,
      viewMode: f.viewMode ?? 'Combined',
    },
  });
}

/** A synthetic route run: id = -RouteId (RVW_stpBulkRuns_2, BulkRunDto.Id). */
export const routeRun = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  area: 'Burbank',
  suburbs: null,
  fromCities: null,
  toLocationName: null,
  velocity: 'green',
  hashKey: 'stub-hash',
  status: 'LIVE',
  jobs: 2,
  incompleteJobs: 0,
  totalPickup: 0,
  incompletePickup: 0,
  hasReturns: false,
  returnsTotal: 0,
  isMissing: false,
  preAssigned: 0,
  isActive: 1,
  courierName: null,
  courierCode: null,
  courierPercentageFormatted: null,
  courierOnlineStatus: '',
  courierOfflineMins: '',
  agentName: null,
  isNpAgent: false,
  ...extra,
});

/** A Run Jobs grid row. `bulkJobId` defaults to a value that is NOT the
 *  tucJob id, so a test can tell which id space a request used. */
export const job = (
  jobId: number,
  jobNumber: string,
  runId: number,
  runName: string,
  extra: Record<string, unknown> = {},
) => ({
  bulkJobId: jobId + 900000, jobId, jobNumber, jobStatus: 'D',
  clientCode: 'MED', speedName: 'Will Call', speed: null,
  fromCompany: null, fromAddress: `${jobId} Lab Way`, fromSuburb: null,
  toCompany: null, toAddress: '2 Clinic Rd', toSuburb: null,
  bookDate: null, bookTime: null,
  pickupWindowStart: null, pickupWindowEnd: null, pickupWindow: null,
  pickedUp: null, dispatched: null, podTime: null, podName: null,
  amount: null, courierId: null, courierName: null, courierCode: null,
  contact: null, phone: null, deliverToContact: null, deliverToPhone: null,
  trackingEmail: null, proofOfDeliveryMobile: null, proofOfDeliveryEmail: null,
  notes: null, deliveryNotes: null, labelNotes: null,
  size: null, qty: null, weight: null, speedId: WILL_CALL_SPEED_ID,
  ourRef: null, refA: null, refB: null,
  runName, runOrder: 1, bulkRunId: runId,
  multiboxParentId: null, parentJobId: null, regionId: null, regionName: null,
  agentName: null, agentType: null, isNpAgent: false,
  pickUpLatitude: 34.18, pickUpLongitude: -118.3,
  deliveryLatitude: 33.6, deliveryLongitude: -117.7,
  toLat: 33.6, toLng: -117.7, fromPostCode: null, toPostCode: null,
  fromCity: null, toCity: 'Aliso Viejo',
  ...extra,
});

export type Job = ReturnType<typeof job>;

export const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export interface WillCallMockOptions {
  runs: Array<ReturnType<typeof routeRun>>;
  /** Jobs per run id. A function gets the request's search params so a
   *  stub can answer like RVW_stpBulkRunJobs does for the filters sent. */
  jobsByRun: Record<number, Job[] | ((q: URLSearchParams) => Job[])>;
  activeCouriers?: Array<{ courierId: number; code: string | null; name: string }>;
}

export interface WillCallRecorder {
  jobFetches: URL[];
  posts: Array<{ url: string; body: unknown }>;
}

/** Base mocks + run list + per-run job stubs. Records every run-jobs GET
 *  and every POST body so a spec can assert what the browser sent. */
export async function mockWillCall(page: Page, opts: WillCallMockOptions): Promise<WillCallRecorder> {
  await mockRouteViewerApis(page, { runDate: RUN_DATE, includePalmyRun: false });
  const rec: WillCallRecorder = { jobFetches: [], posts: [] };

  page.on('request', (req: Request) => {
    if (req.method() === 'POST' && req.url().includes('/api/runviewer/')) {
      rec.posts.push({ url: req.url(), body: req.postDataJSON() });
    }
  });

  await page.route(/\/api\/runviewer\/runs(\?.*)?$/, (route) => json(route, { response: opts.runs }));
  await page.route(/\/api\/runviewer\/couriers(\?.*)?$/, (route) =>
    json(route, { response: opts.activeCouriers ?? [] }));
  await page.route(/\/api\/runviewer\/runs\/-?\d+\/jobs(\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    rec.jobFetches.push(url);
    const runId = Number(url.pathname.split('/').slice(-2)[0]);
    const entry = opts.jobsByRun[runId] ?? [];
    const rows = typeof entry === 'function' ? entry(url.searchParams) : entry;
    return json(route, { response: rows });
  });
  return rec;
}

/** POST bodies sent to one endpoint, in order. */
export const postsTo = (rec: WillCallRecorder, path: string) =>
  rec.posts.filter((p) => new URL(p.url).pathname === path).map((p) => p.body as Record<string, unknown>);
