import { buildQuery, request } from './api';
import type { JobFilters, Run } from '../types';

interface RunsResponse {
  response: Run[];
  maxJsonLength: number;
}

export interface InsertOrUpdateRunBody {
  id: number | null;
  name: string;
  mins: number | null;
  kms: number | null;
  status: number | null;
  revenue: number | null;
  payout: number | null;
  courier: { courierId: number | null; courier: string | null } | null;
  courierPercent: string | null;
  googleRouteResponse: unknown;
  jobs: { bulkJobId: number; builderIndex: number | null; jobNumber: string | null }[];
  despatchDateTime?: string | null;
  // Optional routing fields (Plan §Phase 2 §6). Older clients can omit them
  // and the server keeps existing DB values.
  noReroute?: boolean;
  routingMode?: number;              // 0=A-B, 1=A-A, 2=FinishAtStop
  finishAtBulkJobId?: number | null;
}

export const runService = {
  getRuns: (filters: JobFilters) =>
    request<RunsResponse>(`/runs${buildQuery({
      date: filters.date,
      clientIds: filters.clientIds.map(String),
      regionIds: filters.regionIds.map(String),
      ourRefs: filters.ourRefs,
      speeds: filters.speeds.map(String),
    })}`),

  insertOrUpdate: (body: InsertOrUpdateRunBody) =>
    request<{ response: { result: string; message: string } }>('/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: number, body: InsertOrUpdateRunBody) =>
    request<{ response: { result: string; message: string } }>(`/runs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  remove: (id: number) =>
    request<{ response: { result: string; message: string } }>(`/runs/${id}`, {
      method: 'DELETE',
    }),

  assignJob: (runId: number, jobId: number, fromRunId: number | null) =>
    request<{ response: { result: string; message: string } }>(`/runs/${runId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ jobId, fromRunId, runId }),
    }),

  removeJob: (jobId: number) =>
    request<{ response: { result: string; message: string } }>(`/runs/jobs/${jobId}`, {
      method: 'DELETE',
    }),

  setJobStartEnd: (runId: number, jobId: number, opts: { isStart?: boolean; isEnd?: boolean }) =>
    request<{ response: { result: string; message: string } }>(`/runs/${runId}/jobs/${jobId}/start-end`, {
      method: 'POST',
      body: JSON.stringify({
        isStart: opts.isStart,
        isEnd: opts.isEnd,
      }),
    }),

  dispatch: (runs: InsertOrUpdateRunBody[]) =>
    request<{ response: { result: string; message: string | null }[] }>('/runs/dispatch', {
      method: 'POST',
      body: JSON.stringify({ runs }),
    }),

  dispatchJobs: (jobIds: number[], courierId: number | null, runName: string) =>
    request<{ response: { result: string; message: string | null }[] }>('/runs/dispatch-jobs', {
      method: 'POST',
      body: JSON.stringify({ jobIds, courierId, runName, status: 1 }),
    }),
};
