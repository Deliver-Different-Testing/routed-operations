import { request, buildQuery } from './api';
import type { BulkBaseResponse } from './bulkImportService';

/**
 * ClientsController client. Mirrors the Phase 1 API surface in
 * /api/clients (list / typeahead search / per-client settings bundle /
 * schedules-by-book-date). Every response inherits the common
 * BulkBaseResponse envelope (messageId + success + messages).
 */

// -----------------------------------------------------------------------------
// Types.
// -----------------------------------------------------------------------------

export interface ClientDto {
  id: number;
  code: string;
  name: string;
  isUsTenant: boolean;
}

export interface ClientsResponse extends BulkBaseResponse {
  clients: ClientDto[];
  isInternal: boolean;
  isUsTenant: boolean;
}

// Settings bundle: enough to drive the Step 2 config panel + downstream
// booking rules. The nested shape is intentionally loose (the wizard only
// reaches for a handful of fields today).
export interface ContactDto {
  id: number;
  firstName: string | null;
  surname: string | null;
  email: string | null;
  phone: string | null;
}

export interface SpeedDto {
  id: number;
  name: string;
  code: string | null;
}

export interface StockSizeDto {
  id: number;
  name: string;
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
}

export interface ScheduleDto {
  id: number;
  name: string | null;
  dayOfWeek: number;
  startTime: string;                // HH:mm:ss serialised TimeSpan
  cutoffHours: number;
  speed: SpeedDto | null;
  depotId: number;
}

export interface ClientSettingsDto {
  id: number;
  code: string;
  name: string;
  jobPrefix: string | null;
  isUsTenant: boolean;
  contacts: ContactDto[];
  speeds: SpeedDto[];
  stockSizes: StockSizeDto[];
  schedules: ScheduleDto[];
  referenceAMandatory: boolean;
  referenceAMessage: string | null;
  referenceBMandatory: boolean;
  referenceBMessage: string | null;
  // Bulk home-delivery pickup opt-in. Server attaches
  // BulkImportResponse.pickupJob only when this is true; the wizard skips
  // Step 8 when false.
  createBulkHomeDeliveryPickup: boolean;
}

export interface ClientSettingsResponse extends BulkBaseResponse {
  settings: ClientSettingsDto;
}

export interface SchedulesResponse extends BulkBaseResponse {
  schedules: ScheduleDto[];
}

// -----------------------------------------------------------------------------
// Service.
// -----------------------------------------------------------------------------

export const clientsService = {
  getClients: () =>
    request<ClientsResponse>('/clients').then((raw) => ({ response: raw })),

  search: (query: string) =>
    request<ClientsResponse>(`/clients/search${buildQuery({ search: query })}`).then(
      (raw) => ({ response: raw })
    ),

  getSettings: (clientId: number) =>
    request<ClientSettingsResponse>(`/clients/${clientId}/settings`).then((raw) => ({
      response: raw,
    })),

  // /clients/{ClientId}/schedules/{BookDate}/{SpeedId}/{depotId} - preserves the
  // legacy mixed-case route casing (server matches by position).
  getSchedules: (clientId: number, bookDate: string, speedId: number, depotId: number) =>
    request<SchedulesResponse>(
      `/clients/${clientId}/schedules/${encodeURIComponent(bookDate)}/${speedId}/${depotId}`
    ).then((raw) => ({ response: raw })),
};
