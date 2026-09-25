import { request } from './api';

export interface QuoteSetSummary {
  quoteSetCode: string;
  jobCount: number;
  lastUploadedUtc: string | null;
}

export interface QuoteJobUploadRow {
  customer: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  fromPostCode: number | null;
  toPostCode: number | null;
  weightKg: number | null;
  windowStart: string | null;   // "HH:mm:ss"
  windowEnd: string | null;
  isPickup: boolean;
}

export interface QuoteUploadBody {
  quoteSetCode: string;
  rows: QuoteJobUploadRow[];
}

export interface QuoteUploadResult {
  quoteSetCode: string;
  rowsUploaded: number;
}

export interface QuoteSimulateBody {
  quoteSetCode: string;
  rateCard: string;
  serviceLevel: string;
  maxStopsPerRun: number;
  targetUtilisationPct: number;
}

export interface QuoteSimulateResult {
  quoteSetCode: string;
  jobCount: number;
  driversRequired: number;
  avgShiftHours: number;
  costPerJob: number;
  costPerKm: number;
  totalCost: number;
  marginPct: number;
  recommendedQuote: number;
}

export const quoteService = {
  getSets: () => request<{ response: QuoteSetSummary[] }>('/quote/sets'),

  upload: (body: QuoteUploadBody) =>
    request<{ response: QuoteUploadResult }>('/quote/upload', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  simulate: (body: QuoteSimulateBody) =>
    request<{ response: QuoteSimulateResult }>('/quote/simulate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteSet: (quoteSetCode: string) =>
    request<{ response: { quoteSetCode: string; deleted: number } }>(
      `/quote/sets/${encodeURIComponent(quoteSetCode)}`,
      { method: 'DELETE' }),
};
