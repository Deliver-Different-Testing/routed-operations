import { buildQuery, request } from './api';
import type { BulkJob, JobFilters } from '../types';

interface BulkJobsResponse {
  bulkJobs: BulkJob[];
  maxJsonLength: number;
}

export const jobService = {
  getBulkJobs: (filters: JobFilters) =>
    request<BulkJobsResponse>(`/jobs${buildQuery({
      date: filters.date,
      clientIds: filters.clientIds.map(String),
      regionIds: filters.regionIds.map(String),
      ourRefs: filters.ourRefs,
      speeds: filters.speeds.map(String),
    })}`),

  getClientFilters: () =>
    request<{ response: { clients: { id: number; label: string }[] } }>('/jobs/filters/clients'),

  getOurRefs: (runDate: string) =>
    request<{ ourRefs: string[] }>(`/jobs/filters/refs${buildQuery({ runDate })}`),

  getMultiboxChildren: (parentJobId: number) =>
    request<{ response: number[] }>(`/jobs/${parentJobId}/multibox-children`),

  updateDetail: (jobId: number, field: string, value: string) =>
    request<{ response: string }>(`/jobs/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify({ jobId, field, value }),
    }),

  updateGps: (jobId: number, address: string, lat: string, lng: string, postCode: string) =>
    request<{ response: string }>(`/jobs/${jobId}/gps`, {
      method: 'PATCH',
      body: JSON.stringify({ jobId, address, lat, lng, postCode }),
    }),

  bulkMove: (jobIds: number[], newDate: string, runName: string) =>
    request<{ response: unknown }>('/jobs/bulk-move', {
      method: 'POST',
      body: JSON.stringify({ jobIds, newDate, runName }),
    }),

  void: (jobIds: number[], isVoid: boolean, runDate: string) =>
    request<{ response: unknown }>('/jobs/void', {
      method: 'POST',
      body: JSON.stringify({ jobIds, isVoid, runDate }),
    }),

  syncHd: (runDate: string) =>
    request<{ response: { result: string; message: string | null } }>(
      `/jobs/sync-hd${buildQuery({ runDate })}`,
      { method: 'POST' }
    ),
};
