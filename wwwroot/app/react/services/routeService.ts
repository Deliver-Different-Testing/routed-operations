import { request } from './api';

export interface SavvyLocation {
  name: string;
  latitude: number;
  longitude: number;
  visitDurationInMinutes: number;
}

export interface LatLng {
  lat: number;
  lng: number;
  name?: string;
}

export interface HereSequenceStop {
  name: string;
  lat: number;
  lng: number;
}

export interface HereSequenceResult {
  orderedWaypointIds: string[];
  orderedNames: string[];
  totalMinutes: number;
  legMinutes: number[];
}

export const routeService = {
  optimize: (waypoints: SavvyLocation[]) =>
    request<{ routes: LatLng[] }>('/routes/optimize', {
      method: 'POST',
      body: JSON.stringify(waypoints),
    }),

  optimizeWithName: (waypoints: SavvyLocation[]) =>
    request<{ routes: LatLng[] }>('/routes/optimize-with-name', {
      method: 'POST',
      body: JSON.stringify(waypoints),
    }),

  hereSequence: (requestData: string) =>
    request<unknown>('/routes/here-sequence', {
      method: 'POST',
      body: JSON.stringify({ requestData }),
    }),

  hereSequenceTyped: (
    start: HereSequenceStop,
    destinations: HereSequenceStop[],
    opts?: { returnToStart?: boolean; finishAtName?: string | null },
  ) =>
    request<HereSequenceResult>('/routes/here-sequence-typed', {
      method: 'POST',
      body: JSON.stringify({
        start,
        destinations,
        returnToStart: opts?.returnToStart ?? false,
        finishAtName: opts?.finishAtName ?? null,
      }),
    }),
};
