// Route Viewer API client. Every backend endpoint under
// `/api/runviewer/*` returns the Style A response envelope
// `{ response: T }`, so this module unwraps once here to keep the
// consuming query hooks and components typed on the payload only.
//
// Kept flat (one module for all Route Viewer surfaces) rather than
// per-controller sub-modules - the Route Viewer contract is stable +
// small enough that one file scans faster than following imports across
// six. If it grows past ~500 lines, split by controller.

import { buildQuery, request } from './api';

// Row-shape mirrors of the C# DTOs. Match the JSON casing that Newtonsoft
// emits from RoutedOperations (camelCase by default; `area` stays
// lowercase per BulkRunDto contract).
export interface Lookup { id: number; label: string }
export interface SuburbLookup extends Lookup { alias?: string | null }

/** Sibling-job payload for the Related-tabs strip. Carries a full
 *  BulkJob snapshot so LH1/LH2/etc. legs (which have no tblBulkJob
 *  row and can't be fetched via the single-job endpoint) still
 *  render on click. */
export interface SiblingJob {
  jobId: number;
  bulkJobId: number;
  jobNumber: string | null;
  jobStatus: string | null;
  tabLabel: string;
  job: BulkJob | null;
}

export interface BulkRun {
  id: number;
  name: string | null;
  area: string | null;             // INTENTIONALLY lowercase per DTO
  suburbs: string | null;
  /** Concatenated pickup cities (LHP-pickup line 5). Populated on
   *  synthetic route-runs; empty on real-bulk. Feeds the Run List
   *  "From" column with legacy fallback: fromCities || suburbs || ''. */
  fromCities: string | null;
  /** LHP-destination depot name from tblBulkRegion. Populated on
   *  synthetic route-runs; empty on real-bulk. Feeds the Run List
   *  "To" column with legacy fallback: toLocationName || area || ''. */
  toLocationName: string | null;
  velocity: string | null;
  hashKey: string | null;
  status: string | null;
  jobs: number;
  incompleteJobs: number;
  totalPickup: number;
  incompletePickup: number;
  hasReturns: boolean;
  returnsTotal: number;
  isMissing: boolean;
  preAssigned: number;             // 0 / 1, NOT bool
  isActive: number;                // 0 / 1, NOT bool
  courierName: string | null;
  courierCode: string | null;
  courierPercentageFormatted: string | null;
  courierOnlineStatus: string | null;
  courierOfflineMins: string | null;
  agentName: string | null;
  isNpAgent: boolean;
}

export interface BulkJob {
  bulkJobId: number;
  // tucJob.ucjbID - the LIVE job id (different from BulkJobID). 0 if
  // the bulk job hasn't been materialised into tucJob yet. Needed by
  // callers that hit SPs like RVW_stpJobSiblings that key off ucjbID.
  jobId: number;
  jobNumber: string | null;
  jobStatus: string | null;
  clientCode: string | null;
  speedName: string | null;
  /** Short-code speed name emitted by the SPs (e.g. "CORT"). Distinct
   *  from speedName which is the long label. Run-jobs grid uses this. */
  speed: string | null;
  fromCompany: string | null;
  fromAddress: string | null;
  fromSuburb: string | null;
  toCompany: string | null;
  toAddress: string | null;
  toSuburb: string | null;
  bookDate: string | null;
  bookTime: string | null;
  pickupWindowStart: string | null;
  pickupWindowEnd: string | null;
  pickupWindow: string | null;
  pickedUp: string | null;
  dispatched: string | null;
  podTime: string | null;
  podName: string | null;
  amount: number | null;
  courierId: number | null;
  courierName: string | null;
  courierCode: string | null;
  contact: string | null;
  phone: string | null;
  deliverToContact: string | null;
  deliverToPhone: string | null;
  trackingEmail: string | null;
  proofOfDeliveryMobile: string | null;
  proofOfDeliveryEmail: string | null;
  notes: string | null;
  deliveryNotes: string | null;
  labelNotes: string | null;
  size: string | null;
  qty: number | null;
  weight: number | null;
  speedId: number | null;
  ourRef: string | null;
  refA: string | null;
  refB: string | null;
  runName: string | null;
  runOrder: number | null;
  bulkRunId: number | null;
  multiboxParentId: number | null;
  parentJobId: number | null;
  regionId: number | null;
  regionName: string | null;
  agentName: string | null;
  agentType: string | null;
  isNpAgent: boolean;
  // Backend BulkJobDto sends lat/lng as decimal, which serialises to
  // JSON number. Accept both string + number for defence.
  pickUpLatitude: number | string | null;
  pickUpLongitude: number | string | null;
  deliveryLatitude: number | string | null;
  deliveryLongitude: number | string | null;
  toLat: number | null;
  toLng: number | null;
  // Postcodes for pickup + delivery. int? on server.
  fromPostCode: number | null;
  toPostCode: number | null;
  // Pickup + delivery city labels (separate from suburb - legacy Run
  // Jobs grid shows City as a distinct column).
  fromCity: string | null;
  toCity: string | null;
}

export interface RunFilters {
  runDate: string;                     // yyyy-MM-dd
  clientInternal?: boolean;
  multipleClients?: boolean;
  clientId?: number | null;
  clientIds?: number[];
  regionIds?: number[];
  speedIds?: number[];
  group?: 'Combined' | 'Inbound' | 'Outbound';
}

function toCsv(ids: number[] | undefined): string | undefined {
  return ids && ids.length > 0 ? ids.join(',') : undefined;
}

async function unwrap<T>(url: string): Promise<T> {
  const wrapped = await request<{ response: T }>(url);
  return wrapped.response;
}

async function unwrapPost<T>(url: string, body: unknown): Promise<T> {
  const wrapped = await request<{ response: T }>(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return wrapped.response;
}

export const routeViewerService = {
  // -----------------------------------------------------------------
  // Filters
  // -----------------------------------------------------------------
  getClients: (runDate: string, clientInternal = false, multipleClients = false) =>
    unwrap<Lookup[]>(
      `/runviewer/filters/clients${buildQuery({
        runDate,
        clientInternal: String(clientInternal),
        multipleClients: String(multipleClients),
      })}`,
    ),

  getSpeeds: (runDate: string) =>
    unwrap<Lookup[]>(`/runviewer/filters/speeds${buildQuery({ runDate })}`),

  getRegions: (runDate: string) =>
    unwrap<Lookup[]>(`/runviewer/filters/regions${buildQuery({ runDate })}`),

  getSuburbs: () => unwrap<SuburbLookup[]>('/runviewer/filters/suburbs'),

  getTopUpServices: () => unwrap<Lookup[]>('/runviewer/filters/topup-services'),

  // -----------------------------------------------------------------
  // Runs
  // -----------------------------------------------------------------
  getRuns: (filters: RunFilters) =>
    unwrap<BulkRun[]>(
      `/runviewer/runs${buildQuery({
        runDate: filters.runDate,
        clientInternal: String(filters.clientInternal ?? false),
        multipleClients: String(filters.multipleClients ?? false),
        clientId: filters.clientId ?? undefined,
        clientIds: toCsv(filters.clientIds),
        regionIds: toCsv(filters.regionIds),
        speedIds: toCsv(filters.speedIds),
        group: filters.group,
      })}`,
    ),

  getRunJobs: (runId: number, runDate: string, group?: string) =>
    unwrap<BulkJob[]>(
      `/runviewer/runs/${runId}/jobs${buildQuery({ runDate, group })}`,
    ),

  getJobSiblings: (jobId: number) =>
    unwrap<SiblingJob[]>(`/runviewer/runs/job-siblings${buildQuery({ jobId })}`),

  getRegionOverview: (runDate: string, group?: string) =>
    unwrap<Array<{ regionId: number; regionName: string; jobs: number; incomplete: number }>>(
      `/runviewer/runs/overview${buildQuery({ runDate, group })}`,
    ),

  // -----------------------------------------------------------------
  // Jobs
  // -----------------------------------------------------------------
  getBulkJob: (bulkJobId: number) =>
    unwrap<BulkJob>(`/runviewer/jobs/${bulkJobId}`),

  searchByJobNumber: (jobNumber: string) =>
    unwrap<BulkJob[]>(`/runviewer/jobs/search${buildQuery({ jobNumber })}`),

  getJobItems: (bulkJobId: number) =>
    unwrap<Array<{ barcode: string; description: string | null; scanned: boolean }>>(
      `/runviewer/jobs/items${buildQuery({ bulkJobId })}`,
    ),

  /** Returns an array of base64-encoded JPEG bytes (System.Text.Json
   *  serialises `List<byte[]>` as array-of-base64-strings). Frontend
   *  wraps each entry in a `data:image/jpeg;base64,` src to render. */
  getPodPhotos: (bulkJobId: number) =>
    unwrap<string[]>(`/runviewer/jobs/pod-photos${buildQuery({ bulkJobId })}`),

  // -----------------------------------------------------------------
  // Couriers
  // -----------------------------------------------------------------
  getActiveCouriers: (runDate: string) =>
    unwrap<Array<{ courierId: number; code: string; name: string }>>(
      `/runviewer/couriers${buildQuery({ runDate })}`,
    ),

  searchCouriers: (q: string) =>
    unwrap<Array<{ courierId: number; code: string; name: string }>>(
      `/runviewer/couriers/search${buildQuery({ q })}`,
    ),

  // -----------------------------------------------------------------
  // Scans / events
  // -----------------------------------------------------------------
  getScanDetail: (jobId: number) =>
    unwrap<Array<{ time: string; scanType: string; courierName: string; isNpAgent: boolean }>>(
      `/runviewer/scans/detail${buildQuery({ jobId })}`,
    ),

  getEvents: (runDate: string, clientInternal = false, includeClosed = false) =>
    unwrap<Array<{ eventId: number; jobNumber: string; createdByName: string; notes: string; closed: boolean }>>(
      `/runviewer/events${buildQuery({
        runDate,
        clientInternal: String(clientInternal),
        includeClosed: String(includeClosed),
      })}`,
    ),

  // -----------------------------------------------------------------
  // Assignment (P6)
  // -----------------------------------------------------------------
  assignRoute: (payload: {
    jobIds: number[];
    courierId?: number | null;
    agentId?: number | null;
    npAgentId?: number | null;
  }) => unwrapPost<{ assigned: number }>('/runviewer/jobs/assign', payload),

  // -----------------------------------------------------------------
  // Job actions (T1.b endpoints wrapping RVW_stp* mutation SPs)
  // Every action returns { response: 'ok' } on 200; NP scope violation
  // surfaces as 403 which the fetch wrapper turns into a thrown
  // ApiError with the SP-emitted message.
  // -----------------------------------------------------------------
  activateJob: (jobId: number) => unwrapPost<string>('/runviewer/jobs/activate', { jobId }),
  pickupJob: (jobId: number) => unwrapPost<string>('/runviewer/jobs/pickup', { jobId }),
  missingJob: (jobId: number) => unwrapPost<string>('/runviewer/jobs/missing', { jobId }),
  completeJob: (jobId: number, podName: string, completedTime?: string | null) =>
    unwrapPost<string>('/runviewer/jobs/complete', { jobId, podName, completedTime }),
  lmcJob: (jobId: number, bulkJobId: number, fromCourierCode: string) =>
    unwrapPost<string>('/runviewer/jobs/lmc', { jobId, bulkJobId, fromCourierCode }),
  releaseJob: (jobId: number) => unwrapPost<string>('/runviewer/jobs/release', { jobId }),
  transferJob: (jobId: number, fromCourierCode: string, toCourierCode: string) =>
    unwrapPost<string>('/runviewer/jobs/transfer-courier', { jobId, fromCourierCode, toCourierCode }),
  sendSmsToJob: (jobId: number, mobile: string, message: string) =>
    unwrapPost<string>('/runviewer/jobs/send-sms', { jobId, mobile, message }),
  cancelJobs: (bulkJobIds: number[]) =>
    unwrapPost<string>('/runviewer/jobs/cancel', { bulkJobIds }),
  moveJobsBackToRunBuilder: (bulkJobIds: number[], newDateTime: string, newSpeed: number, voidOriginal: boolean) =>
    unwrapPost<string>('/runviewer/jobs/move-back-to-runbuilder', {
      bulkJobIds, newDateTime, newSpeed, void: voidOriginal,
    }),
  addJobNote: (jobId: number, notes: string) =>
    unwrapPost<string>('/runviewer/jobs/add-note', { jobId, notes }),
  addBulkJobNote: (bulkJobId: number, notes: string) =>
    unwrapPost<string>('/runviewer/jobs/add-bulk-note', { bulkJobId, notes }),

  /** Click-to-edit patch for the Detail-pane text fields (notes / refs
   *  / our ref / quantity / to-address / to-suburb). Server preserves
   *  unmentioned fields. Wraps WS_stpBulkJob_Update. */
  /** GPS coordinate + address update. leg = 'pickup' | 'delivery'
   *  selects the target SP on the server. */
  updateJobGps: (payload: {
    bulkJobId: number;
    leg: 'pickup' | 'delivery';
    address: string;
    suburb: string;
    postCode?: number | null;
    latitude: number;
    longitude: number;
    addressLines?: string[];
  }) => unwrapPost<string>('/runviewer/jobs/gps', payload),

  updateJobTextFields: (bulkJobId: number, patch: {
    toAddress?: string;
    toSuburb?: string;
    quantity?: number;
    notes?: string;
    refA?: string;
    refB?: string;
    ourRef?: string;
  }) => unwrapPost<string>(`/runviewer/jobs/${bulkJobId}/text-fields`, patch),

  transferRoute: (payload: {
    jobIds: number[];
    toRouteId: number;
    transferBooking: boolean;
    transferZipcodes: boolean;
  }) => unwrapPost<{ transferred: number; bookings: number; zipcodes: number }>(
    '/runviewer/jobs/transfer-route',
    payload,
  ),

  getTransferContext: (anchorJobId?: number) =>
    unwrap<Array<{ routeId: number; label: string }>>(
      `/runviewer/routes/active${buildQuery({ anchorJobId })}`,
    ),
};
