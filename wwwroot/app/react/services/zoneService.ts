import { request } from './api';

export interface RatingZonePolygon {
  polygonId: number;
  name: string;
  colorHex: string | null;
}

export interface RatingZoneBucket {
  zone: number;
  postcodes: string[];
  /** Custom polygons that are members of this zone (custom-polygons spec
   *  3.2). Rendered after the postcodes so a zone reads as one coverage set.
   *  Defaulted defensively because older fixtures omit it. */
  polygons?: RatingZonePolygon[];
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
