import { request } from './api';

/**
 * Bulk Import direct-insert client (Phase 1 rewrite - 2026-07-22).
 *
 * Talks to /api/bulk-import which is the ported BulkImportHyper surface:
 *   - GET  /jobs                         list previously imported bulk jobs
 *   - POST /upload   (multipart)         parse an uploaded CSV / XLSX
 *   - POST /import                       direct-insert flow (final wizard step)
 *   - DELETE /jobs/{id}                  soft-delete a routed bulk job
 *   - DELETE /tuc-jobs/{id}              void an on-demand / prebook tucJob
 *
 * The previous Pass 2 shadow-table client (preview / submit / promote /
 * inline row edit) is retired in this phase. The old contract lives on
 * under /api/bulk-import-retired for a short cutover window but nothing
 * in the React SPA references it any more.
 */

// -----------------------------------------------------------------------------
// Shared response envelope (mirrors Core.Application.Dtos.BulkImport.Common
// BaseResponse). Every endpoint returns { success, messages, ... }.
// -----------------------------------------------------------------------------

export interface BulkMessage {
  message?: string | null;
  code?: string | null;
}

export interface BulkBaseResponse {
  messageId: string;
  success: boolean;
  messages: BulkMessage[];
}

// -----------------------------------------------------------------------------
// GET /api/bulk-import/jobs - past routed / on-demand bulk jobs. Mirrors
// BulkJobListDto server-side.
// -----------------------------------------------------------------------------

export interface BulkJobDto {
  id: number;
  jobNumber: string | null;
  bookDate: string;                 // ISO date
  speed: string | null;
  clientCode: string | null;
  amount: number | null;
  quantity: number | null;

  fromAddress: string | null;
  fromSuburb: string | null;
  toAddress: string | null;
  toSuburb: string | null;
  toPostCode: string | null;

  fromCompany: string | null;
  fromCity: string | null;
  fromState: string | null;
  fromZipCode: string | null;
  toCompany: string | null;
  toCity: string | null;
  toState: string | null;
  toZipCode: string | null;

  canDelete: boolean;
  type: string;                     // 'routed' | 'ondemand'
}

export interface BulkJobsResponse extends BulkBaseResponse {
  jobs: BulkJobDto[];
}

// -----------------------------------------------------------------------------
// POST /api/bulk-import/upload - the server returns the parsed grid as a JSON
// string (List<Dictionary<string, object>>) inside a wrapper. We normalise
// that into { headers, rows } on the client so the wizard doesn't have to
// care about the wire quirk.
// -----------------------------------------------------------------------------

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

// -----------------------------------------------------------------------------
// POST /api/bulk-import/import - direct-insert. Mirrors BulkImportRequest /
// BulkImportResponse. The `Jobs` collection is what actually gets inserted;
// the batch-level fields (ClientId, BookDate, ScheduleId, SpeedId, ...) are
// the row-common defaults the server applies.
// -----------------------------------------------------------------------------

export interface BulkImportJobCreateDto {
  jobNumber?: string | null;
  bookDate?: string | null;         // yyyy-MM-dd
  fromContact?: string | null;
  fromCompany?: string | null;
  fromAddress?: string | null;

  // NZ
  fromSuburb?: string | null;
  fromPostCode?: string | null;

  // US
  fromUnit?: string | null;
  fromCity?: string | null;
  fromState?: string | null;
  fromZipCode?: string | null;

  fromLatitude?: string | null;
  fromLongitude?: string | null;
  fromGeoType?: number | null;

  toCompany?: string | null;
  toAddress?: string | null;

  // NZ
  toSuburb?: string | null;
  toPostCode?: string | null;

  // US
  toUnit?: string | null;
  toCity?: string | null;
  toState?: string | null;
  toZipCode?: string | null;

  toLatitude?: string | null;
  toLongitude?: string | null;
  toGeoType?: number | null;

  toContact?: string | null;
  toContactPhone?: string | null;

  quantity?: number | null;
  length?: number;
  width?: number;
  height?: number;
  weight?: number;

  clientRefA?: string | null;
  clientRefB?: string | null;
  ourRef?: string | null;
  notes?: string | null;
  trackingEmail?: string | null;
  trackingMobile?: string | null;

  courierCode?: string | null;
  courierId?: number | null;
  amount?: number | null;
  courierPercentageOverride?: number | null;

  onHold?: boolean | null;
  nationwideDoc?: boolean | null;

  errorMessage?: string | null;
  stopType?: string | null;
}

// Server-side PickupJobToCreateDto (Core/Application/Dtos/BulkImport/Bulk/
// PickupJobCreateDto.cs). This is the sub-object embedded in the pickup rate
// request / book request and returned from /import for pickup-enabled clients.
export interface PickupJobToCreateDto {
  bookedBy?: string | null;
  fromAddress?: string | null;
  fromSuburb?: string | null;
  fromPostCode?: number | null;
  speed?: string | null;
  speedID?: number | null;
  toAddress?: string | null;
  toSuburb?: string | null;
  toPostCode?: number;
  toAddressType?: string | null;
  referenceA?: string | null;
  referenceB?: string | null;
  size?: string | null;
  weight?: string | null;
  return?: string | null;
  courierNotes?: string | null;
  clientNotes?: string | null;
  fromContactName?: string | null;
  fromPhoneNumber?: string | null;
  toContactName?: string | null;
  toPhoneNumber?: string | null;
  type?: string | null;
  pickUpFrom?: string | null;
  quantity?: number | null;
  leaveNotHome?: string | null;
  jobNotificationType?: string | null;
  jobNotificationEmail?: string | null;
  jobNotificationMobile?: string | null;
  toAddressCode?: string | null;
  fromAddressCode?: string | null;
  clientID: number;
  time: string;                     // ISO local
  hold?: boolean | null;
  fixedAmount?: number | null;
  jobID?: number | null;
  agentAmount?: number | null;
  agentCourierID?: number | null;
  fuelSurchargeAmount?: number | null;
  ourRef?: string | null;
  message?: string | null;
  pickUpLatitude?: string | null;
  pickUpLongitude?: string | null;
  deliveryLatitude?: string | null;
  deliveryLongitude?: string | null;
  kms?: number | null;
  dGClass?: number | null;
  dGDocument?: boolean | null;
  shopId?: number | null;
  shopRef1?: string | null;
  shopRef2?: string | null;
  shopRef3?: string | null;
  shopRef4?: string | null;
  shopRef5?: string | null;
}

export interface AngularOption {
  label: string;
  value: string;
}

// Mirror of PickupJobToCreateResponse (server DTO). Returned inside
// BulkImportResponse.pickupJob when the client has CreateBulkHomeDeliveryPickup.
export interface PickupJobToCreateResponse {
  numberOfVehicles: AngularOption[];
  vehicleSizes: AngularOption[];
  pickupJob: PickupJobToCreateDto;
}

// PickupJobRequest matches server-side (Bulk/PickupJobRequest.cs). Used by
// both /pickup-rate and /book-pickup.
export interface PickupJobRequest {
  messageId?: string;
  numberOfVehicle: number;
  vehicleSize: string;
  pickupJob: PickupJobToCreateDto;
}

export interface PickupJobRateResponse extends BulkBaseResponse {
  amount: number | null;
}

export interface PickupJobResponseDto extends BulkBaseResponse {
  jobId: number[];
}

export interface BulkImportRequest {
  messageId?: string;
  clientId: number;
  bookDate: string;                 // ISO
  scheduleId?: number | null;
  speedId: number;
  isKmRatedJobs: boolean;
  importAsCompleted: boolean;
  jobType: 'ondemand' | 'routed';
  // pickupJob on the /import request carries the operator's per-batch pickup
  // shape when the server previously returned one on a first-pass response.
  // Second-pass /import (km-rated confirm) MUST forward the inner pickup dto
  // back so BulkImportJobFactory can accumulate PickupJob.Quantity += qty
  // across the sub-passes; otherwise the earlier count is lost. Mirrors
  // legacy homeControl.js:3377 shipping `depot.pickupJob` into the second call.
  // Shape matches server PickupJobRequest { numberOfVehicle, vehicleSize,
  // pickupJob } - on the /import call we only populate .pickupJob because
  // the operator hasn't picked vehicle count / size yet.
  pickupJob?: { pickupJob: PickupJobToCreateDto } | null;
  jobs: BulkImportJobCreateDto[];

  routeFromClientSite?: boolean;
  originLocationId?: number | null;
}

export interface BulkImportResponse extends BulkBaseResponse {
  clientId: number;
  bookDate: string;
  scheduleId: number | null;
  speedId: number;
  jobs: BulkImportJobCreateDto[];
  // Server attaches this when the client has CreateBulkHomeDeliveryPickup.
  // The wizard advances to BookPickupModal when non-null after the loop
  // exits.
  pickupJob?: PickupJobToCreateResponse | null;
}

// -----------------------------------------------------------------------------
// Service implementation.
// -----------------------------------------------------------------------------

async function parseUploadResponse(res: Response): Promise<ParsedFile> {
  const text = await res.text();
  // Server may return either a JSON string (double-encoded parse output) or
  // an object like { response: [...] }. Cover both.
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Bulk Import upload returned non-JSON payload.');
  }
  let raw: unknown = payload;
  if (typeof payload === 'string') {
    // Double-encoded: the server sent a JSON string that itself contains a
    // JSON list. Parse once more.
    try {
      raw = JSON.parse(payload);
    } catch {
      throw new Error('Bulk Import upload payload could not be parsed.');
    }
  } else if (payload && typeof payload === 'object') {
    const asObj = payload as Record<string, unknown>;
    if ('response' in asObj && asObj.response !== undefined) {
      raw = asObj.response;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch {
          throw new Error('Bulk Import upload payload could not be parsed.');
        }
      }
    }
  }

  if (!Array.isArray(raw)) {
    throw new Error('Bulk Import upload payload was not an array of rows.');
  }
  const dictRows = raw as Record<string, unknown>[];

  // Preserve column order from the first row when available; fall back to a
  // union across every row so late-appearing headers still surface.
  const headerSet: string[] = [];
  const seen = new Set<string>();
  for (const row of dictRows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headerSet.push(key);
      }
    }
  }

  const rows: Record<string, string>[] = dictRows.map((row) => {
    const out: Record<string, string> = {};
    for (const key of headerSet) {
      const v = row?.[key];
      out[key] = v == null ? '' : String(v);
    }
    return out;
  });

  return { headers: headerSet, rows };
}

export const bulkImportService = {
  getJobs: (): Promise<{ response: BulkJobsResponse }> =>
    // Server returns BulkJobsResponse directly (not wrapped in { response: ... }),
    // but downstream callers expect the double-wrapped shape from the other
    // services, so we normalise it here.
    request<BulkJobsResponse>('/bulk-import/jobs').then((raw) => ({ response: raw })),

  uploadFile: async (file: File): Promise<{ response: ParsedFile }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/bulk-import/upload', {
      method: 'POST',
      credentials: 'same-origin',
      // No Content-Type header - fetch adds the multipart boundary itself.
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      body: form,
    });
    if (!res.ok) {
      let hint = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        hint = err?.message ?? err?.messages?.[0]?.message ?? hint;
      } catch {
        // ignore - server sent no JSON body
      }
      throw new Error(hint);
    }
    const parsed = await parseUploadResponse(res);
    return { response: parsed };
  },

  import: (payload: BulkImportRequest): Promise<{ response: BulkImportResponse }> =>
    request<BulkImportResponse>('/bulk-import/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((raw) => ({ response: raw })),

  // POST /api/bulk-import/pickup-rate - price a pickup batch without
  // committing. Used by BookPickupModal to show a live rate as the operator
  // adjusts vehicle size / count / pickup time / weight.
  getPickupRate: (
    payload: PickupJobRequest
  ): Promise<{ response: PickupJobRateResponse }> =>
    request<PickupJobRateResponse>('/bulk-import/pickup-rate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((raw) => ({ response: raw })),

  // POST /api/bulk-import/book-pickup - commit the pickup. Fires N inserts
  // for N vehicles server-side.
  bookPickup: (
    payload: PickupJobRequest
  ): Promise<{ response: PickupJobResponseDto }> =>
    request<PickupJobResponseDto>('/bulk-import/book-pickup', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((raw) => ({ response: raw })),

  deleteRouted: (id: number): Promise<{ response: BulkBaseResponse }> =>
    request<BulkBaseResponse>(`/bulk-import/jobs/${id}`, { method: 'DELETE' }).then((raw) => ({
      response: raw,
    })),

  deleteOnDemand: (id: number): Promise<{ response: BulkBaseResponse }> =>
    request<BulkBaseResponse>(`/bulk-import/tuc-jobs/${id}`, { method: 'DELETE' }).then((raw) => ({
      response: raw,
    })),

  // Staff Import - NZ internal-staff direct-insert path. The endpoint expects
  // { messageId, jobs: [ { columnName: value, ... } ] } and returns
  // { success, successCount, failedCount, failedJobs, messages }.
  // Server-side auth gate: Internal claim + CountryCode == 'NZ'.
  staffImport: (
    jobs: Array<Record<string, unknown>>
  ): Promise<{ response: StaffImportResponse }> =>
    request<StaffImportResponse>('/bulk-import/staff-import', {
      method: 'POST',
      body: JSON.stringify({ jobs }),
    }).then((raw) => ({ response: raw })),

  // Bulk Complete search: look up existing routed / on-demand jobs by
  // (jobNumber, optional bookDate, optional courierCode) so the operator
  // can review + tick which ones to mark complete. Server response splits
  // into foundJobs + notFoundJobNumbers.
  searchForComplete: (
    payload: BulkJobSearchRequest
  ): Promise<{ response: BulkJobSearchResponse }> =>
    request<BulkJobSearchResponse>('/bulk-import/search-for-complete', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((raw) => ({ response: raw })),

  // Bulk Complete commit: mark the selected jobs as done. Routed jobs go
  // through UTL_stpJob_InsertFromRunBuilder to spawn a shared
  // "BulkImportComplete" run; on-demand rows are updated in-place.
  bulkComplete: (
    payload: BulkJobCompleteRequest
  ): Promise<{ response: BulkBaseResponse }> =>
    request<BulkBaseResponse>('/bulk-import/bulk-complete', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((raw) => ({ response: raw })),

  // Google Drive import - the server pulls the file via the Drive REST API
  // using the caller-supplied access token, parses it through the same
  // CSV / XLSX pipeline as /upload, and returns the parsed grid as a JSON
  // string inside response.data. Callers normalise via parseUploadResponse
  // so downstream code sees the identical { headers, rows } shape.
  importFromGoogleDrive: async (
    fileId: string,
    fileName: string,
    accessToken: string
  ): Promise<{ response: ParsedFile; raw: GoogleDriveImportResponse }> => {
    const raw = await request<GoogleDriveImportResponse>('/bulk-import/import-google-drive', {
      method: 'POST',
      body: JSON.stringify({ fileId, fileName, accessToken }),
    });
    if (!raw.success || !raw.data) {
      const msg = raw.messages?.[0]?.message ?? 'Google Drive import failed.';
      throw new Error(msg);
    }
    // The server returns Data as a JSON string containing the same
    // dictionary-list shape /upload emits. Reuse the same parsing so the
    // frontend has one code path.
    let rowsRaw: unknown;
    try {
      rowsRaw = JSON.parse(raw.data);
    } catch {
      throw new Error('Google Drive import returned unparseable data.');
    }
    if (!Array.isArray(rowsRaw)) {
      throw new Error('Google Drive import returned non-array data.');
    }
    const dictRows = rowsRaw as Record<string, unknown>[];
    const headerSet: string[] = [];
    const seen = new Set<string>();
    for (const row of dictRows) {
      if (!row || typeof row !== 'object') continue;
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          headerSet.push(key);
        }
      }
    }
    const rows: Record<string, string>[] = dictRows.map((row) => {
      const out: Record<string, string> = {};
      for (const key of headerSet) {
        const v = row?.[key];
        out[key] = v == null ? '' : String(v);
      }
      return out;
    });
    return { response: { headers: headerSet, rows }, raw };
  },
};

// -----------------------------------------------------------------------------
// Google Drive response shape - mirrors GoogleDriveImportResponse.cs.
// -----------------------------------------------------------------------------

export interface GoogleDriveImportResponse extends BulkBaseResponse {
  data: string | null;
}

// -----------------------------------------------------------------------------
// Staff Import response shape - mirrors StaffImportResponse.cs. Only used by
// the Staff Import modal on NZ tenants for internal staff.
// -----------------------------------------------------------------------------

export interface FailedJobDto {
  rowNumber: number;
  jobNumber: string | null;
  error: string | null;
}

export interface StaffImportResponse extends BulkBaseResponse {
  successCount: number;
  failedCount: number;
  failedJobs: FailedJobDto[];
}

// -----------------------------------------------------------------------------
// Bulk Complete - search existing jobs by job number then mark selected ones
// complete. Mirrors legacy BulkController.cs:242,262 (SearchForBulkComplete,
// BulkComplete). Used by BulkCompleteModal on the Bulk Import list page.
// -----------------------------------------------------------------------------

export interface BulkJobSearchItem {
  jobNumber: string;
  dateTime?: string | null;      // ISO date - optional narrowing filter
  courierCode?: string | null;
}

export interface BulkJobSearchRequest {
  messageId?: string;
  clientId: number;
  jobs: BulkJobSearchItem[];
  jobType: 'routed' | 'ondemand';
}

export interface BulkJobFoundDto {
  id: number;
  jobNumber: string | null;
  bookDate: string;
  speed: string | null;
  clientCode: string | null;
  amount: number | null;
  fromAddress: string | null;
  fromSuburb: string | null;
  toAddress: string | null;
  toSuburb: string | null;
  courierCode: string | null;
  status: string | null;
  done: boolean;
  void: boolean;
  type: string;                    // 'routed' | 'ondemand'
  canComplete: boolean;
}

export interface BulkJobSearchResponse extends BulkBaseResponse {
  foundJobs: BulkJobFoundDto[];
  notFoundJobNumbers: string[];
}

export interface BulkJobCompleteItem {
  jobId: number;
  jobNumber?: string | null;
  courierCode?: string | null;
}

export interface BulkJobCompleteRequest {
  messageId?: string;
  clientId: number;
  jobs: BulkJobCompleteItem[];
  jobType: 'routed' | 'ondemand';
}
