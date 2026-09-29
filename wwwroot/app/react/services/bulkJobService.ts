import { request } from './api';

// Recurring Routes port. Wraps the RecurringLinehaulJobsController endpoints
// consumed by the Mapped Stops drill-down. Not the full RunViewer BulkJob
// service; only the three methods the drill-down needs.

/** Which table a Mapped Stops row lives in. A linehaul leg's child job is
 *  written to exactly one of these, so `id` alone does not identify a row and
 *  has to be sent back together with the source. Mirrors JobSources on the
 *  server; omitting it there resolves to 'bulk'. tucJobArchive is not a source:
 *  it only holds void or finished jobs. */
export type JobSource = 'bulk' | 'tuc';

export interface BulkJobListItem {
  id: number;
  source: JobSource;
  jobNumber: string;
  pickup: string | null;
  drop: string | null;
  speedId: number;
  speedShortName: string;
  speedName: string;
  speedGroupingId: number | null;
  speedGroupingName: string | null;
  bookDate: string | null;
  bookTime: string | null;
  statusName: string | null;
}

export interface BulkJobDetail {
  id: number;
  source: JobSource;
  jobNumber: string;
  customer: string;
  statusName: string;
  pickupAddress: string;
  dropAddress: string;
  bookDate: string | null;
  bookTime: string | null;
  linehaulRunName: string | null;
  speedId: number;
  speedShortName: string;
  speedName: string;
  speedGroupingId: number | null;
  speedGroupingName: string | null;
  speedEditable: boolean;
  notes: string | null;
}

/** One page of Mapped Stops rows. Mirrors BulkJobPageDto. */
export interface BulkJobPage {
  total: number;
  page: number;
  pageSize: number;
  entries: BulkJobListItem[];
}

const unwrap = <T>(p: Promise<{ response: T }>): Promise<T> => p.then((r) => r.response);

const buildStopsQuery = (page: number, pageSize: number, search: string) => {
  const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search.trim()) p.set('search', search.trim());
  return `?${p.toString()}`;
};

export const bulkJobService = {
  /** Paged. `search` filters on job number server-side, so it covers the whole
   *  run rather than the rows already loaded. */
  listForLinehaulRun: (runId: number, page = 1, pageSize = 50, search = '') =>
    unwrap(request<{ response: BulkJobPage }>(
      `/recurring-linehaul-runs/${runId}/jobs${buildStopsQuery(page, pageSize, search)}`)),

  listForRoute: (routeId: number) =>
    unwrap(request<{ response: BulkJobListItem[] }>(`/recurring-routes/${routeId}/jobs`)),

  getDetail: (jobId: number, source: JobSource = 'bulk') =>
    unwrap(request<{ response: BulkJobDetail }>(`/recurring-jobs/${jobId}?source=${source}`)),

  updateSpeed: (jobId: number, speedId: number, source: JobSource = 'bulk') =>
    unwrap(request<{ response: BulkJobDetail }>(`/recurring-jobs/${jobId}/speed?source=${source}`, {
      method: 'PATCH', body: JSON.stringify({ speedId }),
    })),
};
