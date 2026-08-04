import { request } from './api';

export interface RatingZoneBucket {
  zone: number;
  postcodes: string[];
}

export interface RatingZoneGroup {
  groupId: number | null;
  groupName: string;
  /** US-only; NZ rows leave this null. */
  zoneName: string | null;
  postcodeCount: number;
  zones: RatingZoneBucket[];
}

export interface RatingZoneDepot {
  /** "NZ" | "US" — the frontend uses this to switch column labels. */
  countryCode: string;
  depotId: number;
  depotName: string;
  postcodeCount: number;
  groups: RatingZoneGroup[];
}

export const zoneService = {
  getRatingZones: () =>
    request<{ response: RatingZoneDepot[] }>('/zones/rating-postcodes'),
};
