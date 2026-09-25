// Historic Archive Upload client. Talks to /api/historic-archive
// (HistoricArchiveController).
//
// Upload path uses FormData (multipart) - the parse endpoint returns a
// preview grid + the canonical field list the wizard's Map Columns step
// renders. Commit + batches endpoints use the JSON `request` wrapper.

import { request } from './api';

export interface HistoricArchiveUploadResponse {
  fileName: string;
  headers: string[];
  rows: Array<Record<string, string | null>>;
  canonicalFields: string[];
  requiredFields: string[];
}

export interface HistoricArchiveCommitRequest {
  fileName: string;
  mapping: Record<string, string>;
  rows: Array<Record<string, string | null>>;
  notes?: string | null;
}

export interface HistoricArchiveRowError {
  rowIndex: number;
  jobNumber: string | null;
  message: string;
}

export interface HistoricArchiveCommitResponse {
  batchId: number;
  insertedCount: number;
  rejectedCount: number;
  importedIdStart: number | null;
  importedIdEnd: number | null;
  errors: HistoricArchiveRowError[];
}

export interface HistoricArchiveBatch {
  id: number;
  uploadedAt: string;
  uploadedByContact: number;
  /** Resolved "First Last" from TucClientContacts; null when the contact
   *  is not in the current tenant. */
  uploadedByName: string | null;
  fileName: string;
  tenantCode: string;
  rowCount: number;
  insertedCount: number;
  rejectedCount: number;
  /** Comma-joined distinct client codes across the archive rows the batch
   *  produced. Null when the batch had 0 inserts. */
  clientCodes: string | null;
  notes: string | null;
  importedIdStart: number | null;
  importedIdEnd: number | null;
}

/** GET /batches/{id} - batch detail with deserialised per-row error list. */
export interface HistoricArchiveBatchDetail extends HistoricArchiveBatch {
  errors: HistoricArchiveRowError[];
}

/** Slim projection over tucJobArchive for the drill-down. Mirrors
 *  server-side HistoricArchiveJobDto. */
export interface HistoricArchiveJob {
  ucjbId: number;
  jobNumber: string | null;
  clientCode: string | null;
  clientId: number | null;
  jobDate: string;
  completedTime: string | null;
  amount: number | null;
  courierPayment: number | null;
  podName: string | null;
  clientRefA: string | null;
  clientRefB: string | null;
  ourRef: string | null;
  notes: string | null;
  deliveryCompany: string | null;
  deliveryAddress: string | null;
  deliveryCity: string | null;
  deliveryPostCode: string | null;
}

export interface HistoricArchiveJobsPage {
  total: number;
  limit: number;
  offset: number;
  rows: HistoricArchiveJob[];
}

export const historicArchiveService = {
  uploadFile: async (file: File): Promise<HistoricArchiveUploadResponse> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/historic-archive/upload', {
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
        // ignore - no JSON body
      }
      throw new Error(hint);
    }
    return (await res.json()) as HistoricArchiveUploadResponse;
  },

  commit: (payload: HistoricArchiveCommitRequest): Promise<HistoricArchiveCommitResponse> =>
    request<HistoricArchiveCommitResponse>('/historic-archive/commit', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getBatches: (limit = 50, offset = 0): Promise<HistoricArchiveBatch[]> =>
    request<HistoricArchiveBatch[]>(`/historic-archive/batches?limit=${limit}&offset=${offset}`),

  getBatch: (id: number): Promise<HistoricArchiveBatchDetail> =>
    request<HistoricArchiveBatchDetail>(`/historic-archive/batches/${id}`),

  getBatchJobs: (id: number, limit = 50, offset = 0): Promise<HistoricArchiveJobsPage> =>
    request<HistoricArchiveJobsPage>(
      `/historic-archive/batches/${id}/jobs?limit=${limit}&offset=${offset}`,
    ),
};
