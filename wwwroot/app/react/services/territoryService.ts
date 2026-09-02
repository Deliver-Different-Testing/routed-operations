import { request, buildQuery } from './api';

// Wire shapes for /api/territory. Separate NZ / US shapes on purpose
// - the frontend switches on `countryCode` and never blends them.

export interface Depot {
  id: number;
  name: string | null;
  active: boolean;
}

export interface PostcodeGroup {
  id: number;
  name: string | null;
  depotId: number | null;
  depotName: string | null;
  clientId: number | null;
  /** Resolved client code (e.g. "ACME"). Null for client-agnostic groups. */
  clientCode: string | null;
  postcodeCount: number;
}

export interface NzPostcode {
  id: number;
  postCode: number;
  zone: number;
  depotId: number | null;
  depotName: string | null;
  postcodeGroupId: number | null;
  postcodeGroupName: string | null;
  fromSiteId: number;
  name: string | null;
  fromLatLng: string | null;
}

export interface UsZipZone {
  id: number;
  zip: string | null;
  zoneNumber: number | null;
  zoneNameId: number | null;
  zoneName: string | null;
  zoneGroupId: number | null;
  zoneGroupName: string | null;
  postcodeGroupId: number | null;
  postcodeGroupName: string | null;
  applyCongestion: boolean | null;
}

export interface ZoneNameRow {
  id: number;
  name: string | null;
  zoneGroupId: number | null;
  zoneGroupName: string | null;
  locationId: number | null;
  locationName: string | null;
  zipCount: number;
}

export interface ZoneGroupRow {
  id: number;
  name: string | null;
  clearListAreaId: number | null;
  zoneNameCount: number;
}

export interface TerritoryBootstrap {
  /** "NZ" | "US". Frontend switches tab content by this. */
  countryCode: 'NZ' | 'US' | string;
  depots: Depot[];
  postcodeGroups: PostcodeGroup[];
  nzPostcodes: NzPostcode[];
  usZipZones: UsZipZone[];
  zoneNames: ZoneNameRow[];
  zoneGroups: ZoneGroupRow[];
}

export interface PostcodeGroupUpsertBody {
  name: string;
  depotId: number | null;
  /** Preferred: client code (e.g. "ACME"). Backend resolves to id.
   *  If clientCode is set, clientId is ignored. Blank / null = client-agnostic. */
  clientCode: string | null;
  /** Legacy id-based path. Kept for internal callers. */
  clientId: number | null;
}
export interface NzPostcodeUpsertBody {
  postCode: number;
  zone: number;
  depotId: number | null;
  postcodeGroupId: number | null;
  fromSiteId: number;
  name: string | null;
  fromLatLng: string | null;
}
export interface UsZipZoneUpsertBody {
  zip: string;
  zoneNumber: number | null;
  zoneNameId: number | null;
  zoneZipGroupId: number | null;
  applyCongestion: boolean | null;
  clientId: number | null;
}
export interface ZoneNameUpsertBody {
  name: string;
  zoneGroupId: number | null;
  locationId: number | null;
}
export interface ZoneGroupUpsertBody {
  name: string;
  clearListAreaId: number | null;
}

/** A polygon bound (or bindable) to a zone name / postcode group.
 *  Response shape from /api/territory/{zone|group}/{id}/polygons. */
export interface BoundPolygon {
  polygonId: number;
  name: string;
  zoneNameId: number | null;
  postcodeGroupId: number | null;
  centroidLatitude: number;
  centroidLongitude: number;
}

export interface PolygonBindBody {
  zoneNameId: number | null;
  postcodeGroupId: number | null;
}

/** Resolve postcode ZipPolygon rows the Schedule editor map should
 *  render. Backend joins BulkZonePostcode -> ZipPolygon by depot + zone
 *  for the zone-derived bucket and by postcode ints for the bound
 *  bucket. Empty arrays are fine on either side. */
export interface PostcodesForScheduleBody {
  depotId: number | null;
  zones: number[];
  boundPostcodes: number[];
}

export interface PostcodesForScheduleResponse {
  boundZipPolygonIds: number[];
  zoneDerivedZipPolygonIds: number[];
}

// Small helper - keeps write-method bodies terse below.
const write = <TResp, TBody>(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: TBody) =>
  request<{ response: TResp }>(url, body === undefined
    ? { method }
    : { method, body: JSON.stringify(body) });

export const territoryService = {
  bootstrap: () => request<{ response: TerritoryBootstrap }>('/territory/bootstrap'),
  /** Optional clientId filters to depots that host a postcode group / zone owned by that client. */
  depots: (clientId?: number) => request<{ response: Depot[] }>(`/territory/depots${buildQuery({ clientId })}`),
  /** Optional clientId filters to groups owned by that client or by no client. */
  postcodeGroups: (clientId?: number) =>
    request<{ response: PostcodeGroup[] }>(`/territory/postcode-groups${buildQuery({ clientId })}`),
  nzPostcodes: () => request<{ response: NzPostcode[] }>('/territory/nz/postcodes'),
  usZipZones: () => request<{ response: UsZipZone[] }>('/territory/us/zip-zones'),
  usZoneNames: () => request<{ response: ZoneNameRow[] }>('/territory/us/zone-names'),
  usZoneGroups: () => request<{ response: ZoneGroupRow[] }>('/territory/us/zone-groups'),

  createPostcodeGroup: (b: PostcodeGroupUpsertBody) =>
    write<PostcodeGroup, PostcodeGroupUpsertBody>('/territory/postcode-groups', 'POST', b),
  updatePostcodeGroup: (id: number, b: PostcodeGroupUpsertBody) =>
    write<PostcodeGroup, PostcodeGroupUpsertBody>(`/territory/postcode-groups/${id}`, 'PUT', b),
  removePostcodeGroup: (id: number) =>
    write<string, undefined>(`/territory/postcode-groups/${id}`, 'DELETE'),

  createNzPostcode: (b: NzPostcodeUpsertBody) =>
    write<NzPostcode, NzPostcodeUpsertBody>('/territory/nz/postcodes', 'POST', b),
  updateNzPostcode: (id: number, b: NzPostcodeUpsertBody) =>
    write<NzPostcode, NzPostcodeUpsertBody>(`/territory/nz/postcodes/${id}`, 'PUT', b),
  removeNzPostcode: (id: number) =>
    write<string, undefined>(`/territory/nz/postcodes/${id}`, 'DELETE'),

  createUsZipZone: (b: UsZipZoneUpsertBody) =>
    write<UsZipZone, UsZipZoneUpsertBody>('/territory/us/zip-zones', 'POST', b),
  updateUsZipZone: (id: number, b: UsZipZoneUpsertBody) =>
    write<UsZipZone, UsZipZoneUpsertBody>(`/territory/us/zip-zones/${id}`, 'PUT', b),
  removeUsZipZone: (id: number) =>
    write<string, undefined>(`/territory/us/zip-zones/${id}`, 'DELETE'),

  createZoneName: (b: ZoneNameUpsertBody) =>
    write<ZoneNameRow, ZoneNameUpsertBody>('/territory/us/zone-names', 'POST', b),
  updateZoneName: (id: number, b: ZoneNameUpsertBody) =>
    write<ZoneNameRow, ZoneNameUpsertBody>(`/territory/us/zone-names/${id}`, 'PUT', b),
  removeZoneName: (id: number) =>
    write<string, undefined>(`/territory/us/zone-names/${id}`, 'DELETE'),

  createZoneGroup: (b: ZoneGroupUpsertBody) =>
    write<ZoneGroupRow, ZoneGroupUpsertBody>('/territory/us/zone-groups', 'POST', b),
  updateZoneGroup: (id: number, b: ZoneGroupUpsertBody) =>
    write<ZoneGroupRow, ZoneGroupUpsertBody>(`/territory/us/zone-groups/${id}`, 'PUT', b),
  removeZoneGroup: (id: number) =>
    write<string, undefined>(`/territory/us/zone-groups/${id}`, 'DELETE'),

  /** Depot activate / deactivate. Full depot maintenance (address /
   *  GPS / audit) lives in AdminManager; here we only surface the on-off
   *  toggle so operators can hide a retired depot from the schedule /
   *  linehaul / postcode-group dropdowns without switching apps. */
  deactivateDepot: (id: number) =>
    write<Depot, undefined>(`/territory/depots/${id}/deactivate`, 'POST'),
  reactivateDepot: (id: number) =>
    write<Depot, undefined>(`/territory/depots/${id}/reactivate`, 'POST'),

  polygonsForZoneName: (zoneNameId: number) =>
    request<{ response: BoundPolygon[] }>(`/territory/us/zone-names/${zoneNameId}/polygons`),
  polygonsForPostcodeGroup: (postcodeGroupId: number) =>
    request<{ response: BoundPolygon[] }>(`/territory/postcode-groups/${postcodeGroupId}/polygons`),
  bindPolygon: (polygonId: number, b: PolygonBindBody) =>
    write<BoundPolygon, PolygonBindBody>(`/territory/polygons/${polygonId}/bind`, 'POST', b),

  /** Resolve postcode ZipPolygon ids for the Schedule editor map (both
   *  the bound-directly and the zone-derived buckets). Empty input on
   *  either side returns empty in that bucket. */
  postcodesForSchedule: (b: PostcodesForScheduleBody) =>
    write<PostcodesForScheduleResponse, PostcodesForScheduleBody>(
      '/territory/postcodes-for-schedule', 'POST', b),
};
