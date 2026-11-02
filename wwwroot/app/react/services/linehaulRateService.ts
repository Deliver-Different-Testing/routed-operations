import { request, buildQuery } from './api';

/** A priced speed column on a run. `speedId` null is the any-speed column. */
export interface LinehaulSpeedCell {
  speedId: number | null;
  speedName: string;
  rateId: number | null;
  amount: number | null;
  amountPercentage: number | null;
}

export interface LinehaulRunRate {
  runId: number;
  runName: string;
  fromDepotId: number;
  fromDepotName: string;
  toDepotId: number;
  toDepotName: string;
  startTime: string | null;
  despatchTime: string | null;
  /** Any-speed, any-schedule price for the client being viewed. */
  anySpeed: LinehaulSpeedCell;
  speedCells: LinehaulSpeedCell[];
  /** How many schedules carry their own price on this run. */
  scheduleRateCount: number;
  scheduleMinAmount: number | null;
  scheduleMaxAmount: number | null;
  usedBySchedules: string[];
}

export interface LinehaulScheduleRate {
  rateId: number;
  scheduleId: number;
  scheduleName: string;
  speedId: number | null;
  speedName: string;
  clientId: number | null;
  clientCode: string | null;
  amount: number | null;
  amountPercentage: number | null;
  active: boolean;
}

export interface LinehaulDepotOption { depotId: number; name: string }
export interface LinehaulSpeedOption { speedId: number; name: string }

export interface LinehaulBootstrap {
  fromDepots: LinehaulDepotOption[];
  toDepots: LinehaulDepotOption[];
  speeds: LinehaulSpeedOption[];
}

export interface LinehaulRateUpsertBody {
  linehaulRunId: number;
  scheduleId?: number | null;
  speedId?: number | null;
  clientId?: number | null;
  /** Both null clears the price. Both set is refused by the server. */
  amount?: number | null;
  amountPercentage?: number | null;
}

export const linehaulRateService = {
  bootstrap: () =>
    request<{ response: LinehaulBootstrap }>('/linehaul-rates/bootstrap'),

  runs: (p: { fromDepotId?: number | null; toDepotId?: number | null; clientId?: number | null }) =>
    request<{ response: LinehaulRunRate[] }>(`/linehaul-rates${buildQuery({
      fromDepotId: p.fromDepotId ?? undefined,
      toDepotId: p.toDepotId ?? undefined,
      clientId: p.clientId ?? undefined,
    })}`),

  scheduleRates: (runId: number, clientId?: number | null) =>
    request<{ response: LinehaulScheduleRate[] }>(
      `/linehaul-rates/runs/${runId}/schedules${buildQuery({ clientId: clientId ?? undefined })}`),

  upsert: (body: LinehaulRateUpsertBody) =>
    request<{ response: LinehaulSpeedCell }>('/linehaul-rates', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  addSpeedColumn: (runId: number, speedId: number, clientId?: number | null) =>
    request<{ response: LinehaulSpeedCell }>(
      `/linehaul-rates/runs/${runId}/speeds/${speedId}${buildQuery({ clientId: clientId ?? undefined })}`,
      { method: 'POST' }),
};
