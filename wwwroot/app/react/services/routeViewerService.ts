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
  /** True when the row is a multibox parent (BulkJobDto.MultiBox). Set
   *  by RVW_stpPrintJobsV2 for parent rows so the Print Manager grid can
   *  render the expand chevron. Children are fetched lazily via the
   *  `/runviewer/jobs/print-children` endpoint. */
  multiBox?: boolean;
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
  /** Pre-formatted tracking URL for the job's Track-It link.
   *  Populated by RVW_stpBulkJob / RVW_stpBulkRunJobs via
   *  BulkJobDto.TrackingLink. Null when the SP row has no link. */
  trackingLink?: string | null;
  /** True when the client has an intel record on file for the
   *  delivery mobile. Drives the Client Intel jump icon on the
   *  Detail header (only rendered when true). */
  clientIntel?: boolean;
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
  /** Client dropdown lookup. Backend action signature is
   *  `(runDate, multipleClients, contactId)` and the SP
   *  `RVW_stpBulkClients` narrows the returned list to what the given
   *  `@ContactID` may see. Legacy homeService.js:105-108 passes
   *  contactId; without it every caller sees the full tenant client
   *  list regardless of their contact-scope. */
  getClients: (runDate: string, multipleClients = false, contactId?: number | null) =>
    unwrap<Lookup[]>(
      `/runviewer/filters/clients${buildQuery({
        runDate,
        multipleClients: String(multipleClients),
        contactId: contactId ?? undefined,
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

  /** Middle-pane Run Jobs fetch. `filters` mirrors the filter panel so
   *  RVW_stpBulkRunJobs applies the same tenant-scoped region / speed /
   *  client narrowing that RVW_stpBulkRuns_2 (Run List) already uses.
   *  Legacy homeControl.js:1273 passes these; without them the SP
   *  receives NULL for every scoping param and returns rows outside the
   *  currently-selected region (e.g. Reno LHPs surfacing under a
   *  Burbank-only region filter). Backend contract is
   *  `BulkRunJobsRequest`: RegionIds / SpeedIds / ClientIds are
   *  comma-separated int strings; ClientId is a single id override. */
  getRunJobs: (
    runId: number,
    runDate: string,
    filters?: {
      group?: string;
      regionIds?: number[];
      speedIds?: number[];
      clientIds?: number[];
      clientId?: number | null;
      courierId?: number | null;
      preAssigned?: boolean;
    },
  ) =>
    unwrap<BulkJob[]>(
      `/runviewer/runs/${runId}/jobs${buildQuery({
        runDate,
        group: filters?.group,
        regionIds: toCsv(filters?.regionIds),
        speedIds: toCsv(filters?.speedIds),
        clientIds: toCsv(filters?.clientIds),
        clientId: filters?.clientId ?? undefined,
        courierId: filters?.courierId ?? undefined,
        preAssigned: filters?.preAssigned ? 'true' : undefined,
      })}`,
    ),

  getJobSiblings: (jobId: number) =>
    unwrap<SiblingJob[]>(`/runviewer/runs/job-siblings${buildQuery({ jobId })}`),

  /** Region roll-up used by the Home Overview box. Backend calls
   *  `RVW_stpRunOverview` (NOT `RVW_stpBulkRuns_2` - different SP,
   *  different projection) which returns SortScan / RunScan / PickedUp
   *  / ToDo / Total per region. Row click narrows the region filter.
   *
   *  `filters` forwards the same client / speed / region scope the
   *  filter panel sends to the Run List (RegionOverviewRequest DTO
   *  fields). Without them the SP receives NULL for scoping params and
   *  returns tenant-wide totals - the totals bar then disagrees with
   *  the filtered Run List below it. Legacy homeService.js:135
   *  passes them. */
  getRegionOverview: (
    runDate: string,
    filters?: {
      group?: string;
      clientIds?: number[];
      speedIds?: number[];
      regionIds?: number[];
    },
  ) =>
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
      `/runviewer/runs/overview${buildQuery({
        runDate,
        group: filters?.group,
        clientIds: toCsv(filters?.clientIds),
        speedIds: toCsv(filters?.speedIds),
        regionIds: toCsv(filters?.regionIds),
      })}`,
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

  /** Full per-item barcode rows for Bulk-mode Scan Manager grandchild
   *  expansion. Wraps GET /runviewer/jobs/items which fires
   *  RVW_stpJobItems. Shape mirrors JobItemDto exactly - the older
   *  getJobItems above is a lossy view kept for a caller that only
   *  cares about barcode/scanned. */
  getBulkJobItems: (bulkJobId: number, runDate?: string) =>
    unwrap<Array<{
      bulkJobItemId: number;
      bulkJobId: number;
      barcode: string | null;
      itemName: string | null;
      weight: number | null;
      length: number | null;
      height: number | null;
      depth: number | null;
      sortScanned: boolean;
      runScanned: boolean;
      pickScanned: boolean;
      invalidPickScanned: boolean;
      transferScanned: boolean;
      transitScanned: boolean;
    }>>(`/runviewer/jobs/items${buildQuery({ bulkJobId, runDate })}`),

  /** Returns an array of base64-encoded JPEG bytes (System.Text.Json
   *  serialises `List<byte[]>` as array-of-base64-strings). Frontend
   *  wraps each entry in a `data:image/jpeg;base64,` src to render. */
  getPodPhotos: (bulkJobId: number) =>
    unwrap<string[]>(`/runviewer/jobs/pod-photos${buildQuery({ bulkJobId })}`),

  // -----------------------------------------------------------------
  // Couriers
  // -----------------------------------------------------------------
  getActiveCouriers: (runDate: string) =>
    unwrap<Array<{ courierId: number; code: string | null; name: string }>>(
      `/runviewer/couriers${buildQuery({ runDate })}`,
    ),

  // Backend CourierDto.Code is `string?` - some tenants have couriers
  // with a null tucCourier.Code (medical-prod dev / test rows). The
  // AssignRouteDialog picker guards on this to avoid rendering
  // "Name (null)".
  searchCouriers: (q: string) =>
    unwrap<Array<{ courierId: number; code: string | null; name: string }>>(
      `/runviewer/couriers/search${buildQuery({ q })}`,
    ),

  /** LIKE-typeahead over agents / network-partners for the Assign Route
   *  dialog Agent + NP buckets. Wraps
   *  GET /runviewer/jobs/{jobId}/assignable-targets/agents.
   *  `isNetworkPartner` toggles which slice of tucAgents is returned
   *  (false = Agent bucket, true = NP bucket) - same DTO shape either
   *  way. `jobId` is required by the backend NP scope guard; callers
   *  without a specific anchor job pass 0 (guard no-ops for admin scope,
   *  which is the only scope that ever hits agent/NP - NP-scoped users
   *  see the courier-only variant of the dialog). */
  searchAgents: (jobId: number, q: string, isNetworkPartner: boolean, limit = 200) =>
    unwrap<Array<{ id: number; name: string | null; hint: string | null }>>(
      `/runviewer/jobs/${jobId}/assignable-targets/agents${buildQuery({
        q,
        isNetworkPartner: String(isNetworkPartner),
        limit,
      })}`,
    ),

  /** Single-courier GPS position for the current job (25s poll on
   *  Mobile Job Detail). Returns null when no fix on file. */
  getCourierPosition: (jobId: number) =>
    unwrap<{ courierId: number; courierCode: string | null; latitude: number | null; longitude: number | null; timestamp: string | null } | null>(
      `/runviewer/couriers/position${buildQuery({ jobId })}`,
    ),

  /** Bounding-box query for the "All Couriers" map toggle. Returns every
   *  active courier with a GPS ping inside the given lat/lng envelope,
   *  plus their vehicle type + code for the flag label. Wraps
   *  MAP_stpEnvelope via GET /runviewer/couriers/available. */
  getAvailableCouriers: (bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number }) =>
    unwrap<Array<{
      courierId: number;
      courierCode: string | null;
      vehicleType: string | null;
      latitude: number | null;
      longitude: number | null;
      timestamp: string | null;
    }>>(
      `/runviewer/couriers/available${buildQuery({
        minLng: bounds.minLng,
        minLat: bounds.minLat,
        maxLng: bounds.maxLng,
        maxLat: bounds.maxLat,
      })}`,
    ),

  // -----------------------------------------------------------------
  // Scans / events
  // -----------------------------------------------------------------
  getScanDetail: (jobId: number) =>
    unwrap<Array<{
      scanId?: number;
      scanDateTime?: string | null;
      scanDetail?: string | null;
      courier?: string | null;
      isNpAgent?: boolean;
      // 2026-07-02 extended context columns (BulkScanDetailDto).
      leg?: string | null;
      location?: string | null;
      tote?: string | null;
      run?: string | null;
      /** JSON string of piece barcodes; parsed per-row in RvScanDetailBox. */
      itemLabels?: string | null;
      role?: string | null;
      // Fallback aliases from earlier SP shapes.
      time?: string;
      scanType?: string;
      courierName?: string;
    }>>(
      `/runviewer/scans/detail${buildQuery({ jobId })}`,
    ),

  /** Print Manager grid. Wraps RVW_stpPrintJobsV2 via
   *  GET /runviewer/jobs/print-list. Emits full BulkJob shape so the
   *  Print Manager UI has access to Speed / RefA / RefB / OurRef /
   *  Mobile / Email / Notes for column display and free-text search.
   *  clientInternal / regionIds / clientIds filters are optional. */
  getPrintJobList: (
    runDate: string,
    opts?: { clientInternal?: boolean; clientId?: number | null; clientIds?: number[]; regionIds?: number[] },
  ) =>
    unwrap<BulkJob[]>(
      `/runviewer/jobs/print-list${buildQuery({
        runDate,
        clientInternal: String(opts?.clientInternal ?? false),
        clientId: opts?.clientId ?? undefined,
        clientIds: toCsv(opts?.clientIds),
        regionIds: toCsv(opts?.regionIds),
      })}`,
    ),

  /** Multibox child rows for a Print Manager parent. Wraps
   *  RVW_stpPrintJobChildren via GET /runviewer/jobs/print-children.
   *  Fetched lazily on chevron click and cached client-side so a
   *  second toggle is UI-only. */
  getPrintJobChildren: (bulkJobId: number, runDate?: string) =>
    unwrap<BulkJob[]>(
      `/runviewer/jobs/print-children${buildQuery({ bulkJobId, runDate })}`,
    ),

  /** Bulk-mode Scan Manager grid. Wraps RVW_stpScanJobs.
   *  Tri-state Sort/Run flags plus binary Pick/InvalidPick/Transfer/Transit.
   *  Filter arrays forward to backend so the SP applies the filter at
   *  source rather than the client dropping rows post-fetch. */
  getBulkScanJobs: (
    runDate: string,
    clientInternal = false,
    clientIds?: number[],
    regionIds?: number[],
    speedIds?: number[],
  ) =>
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
    }>>(`/runviewer/scans${buildQuery({
      runDate,
      clientInternal: String(clientInternal),
      clientIds: (clientIds ?? []).join(',') || undefined,
      regionIds: (regionIds ?? []).join(',') || undefined,
      speedIds: (speedIds ?? []).join(',') || undefined,
    })}`),

  /** Routed-mode Scan Manager grid. Legs is a JSON string per-row. */
  getRoutedScanJobs: (
    runDate: string,
    clientIds?: number[],
    regionIds?: number[],
    speedIds?: number[],
  ) =>
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
    }>>(`/runviewer/scans/routed${buildQuery({
      runDate,
      clientIds: (clientIds ?? []).join(',') || undefined,
      regionIds: (regionIds ?? []).join(',') || undefined,
      speedIds: (speedIds ?? []).join(',') || undefined,
    })}`),

  /** Close a CS event. */
  closeEvent: (eventId: number, closedBy: string) =>
    unwrapPost<string>(`/runviewer/events/${eventId}/close`, { closedBy }),

  /** Prepend a threaded reply to a CS event's Notes field. */
  addEventReply: (eventId: number, note: string, userName: string) =>
    unwrapPost<string>(`/runviewer/events/${eventId}/reply`, { note, userName }),

  /** Generate a shareable direct link for a CS event. Server returns
   *  "Link Declined" when the target client has notifications marked
   *  Internal (legacy behaviour); callers should gate the UI on the
   *  event's internal flag before invoking. */
  generateDirectLink: (eventId: number, clientId: number) =>
    unwrap<{ url: string | null }>(
      `/runviewer/events/direct-link${buildQuery({ eventId, clientId })}`,
    ),

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
  /** POST /api/runviewer/jobs/assign - shape matches the backend
   *  BulkAssignRequest DTO exactly: `targetType` is one of "Courier" |
   *  "Agent" | "NetworkPartner"; `targetId` is the corresponding
   *  tucCourier.uccrID or tucAgents.UcagId. Backend returns
   *  BulkAssignmentResult { succeeded, failed, errors, targetType,
   *  targetId, displayName }. */
  assignRoute: (payload: {
    jobIds: number[];
    targetType: 'Courier' | 'Agent' | 'NetworkPartner';
    targetId: number;
  }) => unwrapPost<{
    succeeded: number;
    failed: number;
    errors: string[];
    targetType: string;
    targetId: number;
    displayName: string | null;
  }>('/runviewer/jobs/assign', payload),

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
   *  Wraps RVW_stpLineHaulJobs (depotId + name required). `scanHistory`
   *  is a JSON string (array of { ScanDateTime, ScanType, Courier }, most
   *  recent first, capped at 20). Empty JSON array (`[]`) when the parent
   *  job has no scans in the last 3 days. Consumed by the Linehaul jobs
   *  table Scanned cell which parses per row and renders one chip per
   *  entry. */
  getLinehaulJobs: (depotId: number, name: string, runDate: string) =>
    unwrap<Array<{
      bulkJobId: number;
      jobNumber: string | null;
      clientCode: string | null;
      toAddress: string | null;
      pallet: string | null;
      items: number;
      pickedUp: string | null;
      scanHistory: string | null;
    }>>(`/runviewer/jobs/linehaul${buildQuery({ depotId, name, runDate })}`),

  /** Linehaul run list. Wraps RVW_stpLineHaulRuns. speedIds is passed
   *  through when set - backend already accepts it on LinehaulRunListRequest
   *  so this is a service-only wiring, no controller change. */
  getLinehaulRuns: (
    runDate: string,
    clientIds?: number[],
    fromRegionIds?: number[],
    regionIds?: number[],
    speedIds?: number[],
  ) =>
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
      speedIds: (speedIds ?? []).join(',') || undefined,
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

  /** Print labels for the current cockpit filter set with an operator-
   *  picked sort mode (1=Run Name, 2=Product, 3=Client). Fires the
   *  same POST endpoint as `printLabels` but with a LabelRequest shape
   *  (BookDate + ClientIds + RegionIds + SpeedIds + SortMode) instead
   *  of an explicit bulkJobIds list, matching the legacy AngularJS
   *  getLabels() call that keyed off $parent.labelsSortMode. */
  printLabelsWithSort: (payload: {
    bookDate: string;
    sortMode: number;
    clientIds?: string | null;
    regionIds?: string | null;
    speedIds?: string | null;
  }) => unwrapPost<string>('/runviewer/labels/bulk-jobs', {
    bookDate: payload.bookDate,
    sortMode: payload.sortMode,
    clientIds: payload.clientIds ?? null,
    regionIds: payload.regionIds ?? null,
    speedIds: payload.speedIds ?? null,
  }),

  /** Wraps POST /runviewer/labels/bulk-jobs and returns the raw PDF as
   *  a Blob so the caller can `window.open(URL.createObjectURL(blob))`.
   *  The backend's LabelPdfAsync returns FileContentResult with
   *  Content-Type=application/pdf; the shared `request()` wrapper
   *  assumes JSON and would trip on the binary body, so this method
   *  fetches directly and preserves the CSRF header the wrapper
   *  normally sets. Matches legacy homeControl.js:printLabel mode=4
   *  which base64-decoded the response into a blob and window.open'd
   *  it. Callers pass the same LabelRequest fields as the legacy
   *  (bookDate + sortMode + runName + optional filter csvs). */
  printRunLabelsPdf: async (payload: {
    bookDate: string;
    sortMode: number;
    runName?: string | null;
    bulkJobIds?: string | null;
    clientIds?: string | null;
    courierIds?: string | null;
    regionIds?: string | null;
    speedIds?: string | null;
  }): Promise<Blob> => {
    const res = await fetch('/api/runviewer/labels/bulk-jobs', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        bookDate: payload.bookDate,
        sortMode: payload.sortMode,
        runName: payload.runName ?? null,
        bulkJobIds: payload.bulkJobIds ?? null,
        clientIds: payload.clientIds ?? null,
        courierIds: payload.courierIds ?? null,
        regionIds: payload.regionIds ?? null,
        speedIds: payload.speedIds ?? null,
      }),
    });
    if (!res.ok) {
      // Surface a server-provided message so the toast can name
      // the failure (proxy-not-configured 501, legacy 500, etc.).
      const body = await res.json().catch(() => ({}));
      const msg = body?.message ?? body?.messages?.[0]?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return res.blob();
  },

  /** Wraps GET /runviewer/labels/jobs/{jobId} (single-job Mode 1
   *  tucJob label) and returns the PDF as a Blob. Matches legacy
   *  printLabel mode=1 / mode=2. Same reason as `printRunLabelsPdf`
   *  for bypassing the JSON request wrapper. */
  printSingleJobLabelPdf: async (jobId: number): Promise<Blob> => {
    const res = await fetch(`/api/runviewer/labels/jobs/${jobId}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = body?.message ?? body?.messages?.[0]?.message ?? `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return res.blob();
  },

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

  /** Transfer a job (or set of jobs) to a different route. Payload
   *  field names + response shape MUST match the backend
   *  `TransferRouteRequest` / `TransferRouteResult` DTOs
   *  (Core/Application/Dtos/RouteViewer/RouteTransferDto.cs) exactly -
   *  ASP.NET Core does not tolerate name drift, silently drops
   *  unknown fields, and defaults missing ints to 0 (which then
   *  fails the `NewRouteId > 0` guard on
   *  RunViewerRouteTransferController:56 and 400s). This wrapper
   *  translates the caller's ergonomic `toRouteId` / `transferBooking`
   *  / `transferZipcodes` names into the wire names the backend
   *  actually reads. */
  transferRoute: (payload: {
    jobIds: number[];
    toRouteId: number;
    transferBooking: boolean;
    transferZipcodes: boolean;
  }) => unwrapPost<{
    succeeded: number;
    failed: number;
    rowsUpdated: number;
    bookingsAffected: number;
    bookingRowsUpdated: number;
    zipCodesMoved: number;
    zipMappingsInserted: number;
    zipMappingsDeleted: number;
    zipCodes: string[];
    families: string[];
    errors: string[];
    newRouteId: number | null;
    newRouteName: string | null;
    alsoTransferredRecurringBooking: boolean;
    alsoTransferredZipCodes: boolean;
  }>(
    '/runviewer/jobs/transfer-route',
    {
      jobIds: payload.jobIds,
      newRouteId: payload.toRouteId,
      alsoTransferRecurringBooking: payload.transferBooking,
      alsoTransferZipCodes: payload.transferZipcodes,
    },
  ),

  getTransferContext: (anchorJobId?: number) =>
    unwrap<Array<{ routeId: number; label: string }>>(
      `/runviewer/routes/active${buildQuery({ anchorJobId })}`,
    ),
};
