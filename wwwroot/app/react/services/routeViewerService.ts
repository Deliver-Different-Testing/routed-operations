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

  /** Region roll-up used by the Home Overview box. Backend calls
   *  `RVW_stpRunOverview` (NOT `RVW_stpBulkRuns_2` - different SP,
   *  different projection) which returns SortScan / RunScan / PickedUp
   *  / ToDo / Total per region. Row click narrows the region filter. */
  getRegionOverview: (runDate: string, group?: string) =>
    unwrap<Array<{
      regionId: number;
      region: string | null;
      total: number;
      sortScan: number;
      runScan: number;
      pickedUp: number;
      toDo: number;
      percent: number;
      class: string | null;
      pallet: string | null;
      active: boolean;
    }>>(
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

  /** Single-courier GPS position for the current job (25s poll on
   *  Mobile Job Detail). Returns null when no fix on file. */
  getCourierPosition: (jobId: number) =>
    unwrap<{ courierId: number; courierCode: string | null; latitude: number | null; longitude: number | null; timestamp: string | null } | null>(
      `/runviewer/couriers/position${buildQuery({ jobId })}`,
    ),

  // -----------------------------------------------------------------
  // Scans / events
  // -----------------------------------------------------------------
  getScanDetail: (jobId: number) =>
    unwrap<Array<{ time: string; scanType: string; courierName: string; isNpAgent: boolean }>>(
      `/runviewer/scans/detail${buildQuery({ jobId })}`,
    ),

  /** Bulk-mode Scan Manager grid. Wraps RVW_stpScanJobs.
   *  Tri-state Sort/Run flags plus binary Pick/InvalidPick/Transfer/Transit. */
  getBulkScanJobs: (runDate: string, clientInternal = false) =>
    unwrap<Array<{
      bulkJobId: number;
      bulkParentId: number | null;
      jobNumber: string | null;
      clientCode: string | null;
      deliveryDate: string | null;
      readyTime: string | null;
      toAddress: string | null;
      items: number;
      sortScanned: number;
      runScanned: number;
      pickScanned: number;
      invalidPickScanned: number;
      transferScanned: number;
      transitScanned: number;
    }>>(`/runviewer/scans${buildQuery({ runDate, clientInternal: String(clientInternal) })}`),

  /** Routed-mode Scan Manager grid. Legs is a JSON string per-row. */
  getRoutedScanJobs: (runDate: string) =>
    unwrap<Array<{
      jobId: number;
      bulkJobId: number;
      jobNumber: string | null;
      clientCode: string | null;
      toAddress: string | null;
      suburb: string | null;
      companyName: string | null;
      stage: string | null;
      currentLeg: string | null;
      itemCount: number;
      scannedItems: number;
      expectedItems: number;
      legs: string | null;
      hasShort: boolean;
      isDivergent: boolean;
    }>>(`/runviewer/scans/routed${buildQuery({ runDate })}`),

  /** Close a CS event. */
  closeEvent: (eventId: number, closedBy: string) =>
    unwrapPost<string>(`/runviewer/events/${eventId}/close`, { closedBy }),

  /** Prepend a threaded reply to a CS event's Notes field. */
  addEventReply: (eventId: number, note: string, userName: string) =>
    unwrapPost<string>(`/runviewer/events/${eventId}/reply`, { note, userName }),

  /** Admin bulk-purge of missing-scan LHP / DEL child rows for a
   *  run-date + filter slice. Wraps POST /runviewer/scans/remove-missing
   *  which fires RVW_stpRemoveMissingScanJobs server-side. */
  removeMissingScanJobs: (payload: {
    runDate?: string | null;
    clientId?: number | null;
    clientIds?: string | null;
    regionIds?: string | null;
    speedIds?: string | null;
  }) => unwrapPost<string>('/runviewer/scans/remove-missing', payload),

  /** Item-progress rows for a routed shipment. Grouped client-side by
   *  itemBarcode to build the per-item leg-track mini display. */
  getItemProgress: (rootJobId: number) =>
    unwrap<Array<{
      jobId: number;
      itemBarcode: string | null;
      leg: string | null;
      state: string | null;
      tote: string | null;
      isCurrent: boolean;
      scanTime: string | null;
    }>>(`/runviewer/scans/item-progress${buildQuery({ rootJobId })}`),

  /** Scan-panel detail rows (Bulk mode) by rootJobId / scan string. */
  getScanDetailRows: (runDate: string, scan?: string, rootJobId?: number) =>
    unwrap<Array<{
      scanId: number;
      scanDateTime: string | null;
      scanDetail: string | null;
      courier: string | null;
      isNpAgent: boolean;
      leg: string | null;
      location: string | null;
      tote: string | null;
      run: string | null;
      itemLabels: string | null;
      role: string | null;
    }>>(`/runviewer/scans/detail${buildQuery({ runDate, scan, rootJobId })}`),

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

  /** Linehaul region overview roll-up. Wraps
   *  `RVW_stpLinehaulOverview` (has Pallet column absent from the Home
   *  variant). NP-scoped server-side. */
  getLinehaulOverview: (runDate: string, clientIds?: string, speedIds?: string) =>
    unwrap<Array<{
      regionId: number;
      region: string | null;
      total: number;
      sortScan: number;
      runScan: number;
      pickedUp: number;
      toDo: number;
      percent: number;
      class: string | null;
      pallet: string | null;
      active: boolean;
    }>>(`/runviewer/runs/linehaul/overview${buildQuery({ runDate, clientIds, speedIds })}`),

  /** Linehaul jobs for a run (used by the expandable Linehaul sub-panel).
   *  Wraps RVW_stpLineHaulJobs (depotId + name required). */
  getLinehaulJobs: (depotId: number, name: string, runDate: string) =>
    unwrap<Array<{
      bulkJobId: number;
      jobNumber: string | null;
      clientCode: string | null;
      toAddress: string | null;
      pallet: string | null;
      items: number;
      pickedUp: string | null;
    }>>(`/runviewer/jobs/linehaul${buildQuery({ depotId, name, runDate })}`),

  /** Linehaul run list. Wraps RVW_stpLineHaulRuns. */
  getLinehaulRuns: (runDate: string, clientIds?: number[], fromRegionIds?: number[], regionIds?: number[]) =>
    unwrap<Array<{
      id: number;
      name: string | null;
      masterJobNumber: string | null;
      fromDepot: string | null;
      toDepot: string | null;
      toDepotId: number | null;
      jobs: number;
      scannedItems: number;
      expectedItems: number;
      pallet: string | null;
      percent: number | null;
      class: string | null;
      courierId: number | null;
      courierName: string | null;
      courierCode: string | null;
      agentId: number | null;
      agentName: string | null;
      isNpAgent: boolean;
    }>>(`/runviewer/runs/linehaul${buildQuery({
      runDate,
      clientIds: (clientIds ?? []).join(',') || undefined,
      fromRegionIds: (fromRegionIds ?? []).join(',') || undefined,
      regionIds: (regionIds ?? []).join(',') || undefined,
    })}`),

  /** Pre-assign an entire run to a courier via RVW_stpPreAssignRun.
   *  Backs the drag-drop courier-onto-run flow (audit item 13). Pass
   *  the previous courier code (if any) so the SP can release +
   *  re-assign atomically. */
  preAssignRun: (runId: number, toCourierCode: string, fromCourierCode?: string | null) =>
    unwrapPost<string>('/runviewer/jobs/preassign-run', {
      runId,
      toCourierCode,
      fromCourierCode: fromCourierCode ?? null,
    }),

  /** Bulk-transfer every job on a run from one courier to another.
   *  Wraps RVW_stpTransferRun. Different from preAssignRun: this
   *  actually moves the jobs, not just pre-assigns. */
  transferRun: (runId: number, toCourierCode: string, fromCourierCode?: string | null) =>
    unwrapPost<string>('/runviewer/jobs/transfer-run', {
      runId,
      toCourierCode,
      fromCourierCode: fromCourierCode ?? null,
    }),

  /** Soft release a courier from a run. Wraps RVW_stpReleaseRun. */
  releaseRun: (runId: number, courierCode: string) =>
    unwrapPost<string>('/runviewer/jobs/release-run', { runId, courierCode }),

  /** Hard unassign a courier from a run. Wraps RVW_stpUnAssignRun. */
  unassignRun: (runId: number, courierCode: string) =>
    unwrapPost<string>('/runviewer/jobs/unassign-run', { runId, courierCode }),

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

  /** Broadcast SMS to every driver on a run. Wraps RVW_stpMessageRun. */
  sendSmsToRun: (runId: number, message: string) =>
    unwrapPost<string>('/runviewer/jobs/send-sms-run', { runId, message }),
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

  /** Print labels for a set of jobs. Wraps POST /runviewer/labels/bulk-jobs.
   *  Backend is currently 501 (P14: AlertLabel + SSRS wiring pending)
   *  but the UI is wired so it lights up as soon as the endpoint lands. */
  printLabels: (bulkJobIds: number[]) =>
    unwrapPost<string>('/runviewer/labels/bulk-jobs', { bulkJobIds }),

  /** Email a POD photo to an operator-provided address. Proxies to
   *  the legacy /Home/SendPOD endpoint via the same env-var-gated
   *  proxy the label endpoints use. */
  sendPodEmail: (bulkJobId: number, toEmail: string) =>
    unwrapPost<string>(`/runviewer/jobs/${bulkJobId}/send-pod?toEmail=${encodeURIComponent(toEmail)}`, {}),

  /** Client Intel lookup by mobile number. Wraps RVW_stpClientIntel.
   *  Returns null when the mobile has no intel row on file. Fed by the
   *  Detail-pane Client Intel box. */
  getClientIntel: (mobile: string) =>
    unwrap<{ clientIntelId: number; mobile: string; dog: boolean; notes: string | null; hasPhoto: boolean } | null>(
      `/runviewer/jobs/client-intel${buildQuery({ mobile })}`,
    ),

  /** Client Intel images (base64 payload set). */
  getClientIntelImages: (mobile: string) =>
    unwrap<Array<{ photo: string | null; description: string | null; key: string | null }>>(
      `/runviewer/jobs/client-intel-images${buildQuery({ mobile })}`,
    ),

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
