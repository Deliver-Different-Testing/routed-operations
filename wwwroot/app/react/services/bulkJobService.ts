import { request } from './api';

// Recurring Routes port. Wraps the RecurringLinehaulJobsController endpoints
// consumed by the Mapped Stops drill-down. Not the full RunViewer BulkJob
// service; only the three methods the drill-down needs.

export interface BulkJobListItem {
  id: number;
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

const unwrap = <T>(p: Promise<{ response: T }>): Promise<T> => p.then((r) => r.response);

export const bulkJobService = {
  listForLinehaulRun: (runId: number) =>
    unwrap(request<{ response: BulkJobListItem[] }>(`/recurring-linehaul-runs/${runId}/jobs`)),

  listForRoute: (routeId: number) =>
    unwrap(request<{ response: BulkJobListItem[] }>(`/recurring-routes/${routeId}/jobs`)),

  getDetail: (jobId: number) =>
    unwrap(request<{ response: BulkJobDetail }>(`/recurring-jobs/${jobId}`)),

  updateSpeed: (jobId: number, speedId: number) =>
    unwrap(request<{ response: BulkJobDetail }>(`/recurring-jobs/${jobId}/speed`, {
      method: 'PATCH', body: JSON.stringify({ speedId }),
    })),
};
