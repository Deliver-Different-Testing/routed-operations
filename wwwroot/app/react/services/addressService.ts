import { request } from './api';
import type { BulkBaseResponse } from './bulkImportService';

/**
 * AddressController client. Suburbs / zip codes / regions / depot postcode
 * mapping / geocoding. Every endpoint returns the shared BulkBaseResponse
 * envelope plus a payload-specific collection.
 */

export interface SuburbDto {
  id: number;
  name: string;
  city: string | null;
  postCode: string | null;
}

export interface SuburbsResponse extends BulkBaseResponse {
  suburbs: SuburbDto[];
}

export interface ZipCodeDto {
  id: number;
  zoneNumber: number | null;
  zoneName: string | null;
  zip: string | null;
  clientId: number | null;
  applyCongestion: boolean | null;
}

export interface ZipCodesResponse extends BulkBaseResponse {
  zipCodes: ZipCodeDto[];
}

export interface RegionDto {
  id: number;
  name: string;
  fromCompany: string | null;
  fromAddress: string | null;
  fromCity: string | null;
  fromState: string | null;
  fromZipCode: string | null;
}

export interface RegionsResponse extends BulkBaseResponse {
  regions: RegionDto[];
}

// Matches server RegionPostcodesDto (Id / Name / Postcodes). ASP.NET Core
// camelCases on serialize, so the wire field is `postcodes`, not `postCodes`.
export interface RegionPostcodesDto {
  id: number;
  name: string;
  postcodes: string[];
}

// Matches server SortPostcodesByRegionResponse { Depots, Locations } - the
// SAME response class serves both NZ (populates Depots) and US (populates
// Locations). NZ endpoint /address/depots/postcodes only populates Depots.
export interface DepotPostcodesResponse extends BulkBaseResponse {
  depots: RegionPostcodesDto[];
}

export interface ZipZonesDto {
  zoneId: number;
  zoneName: string;
  zips: string[];
}

export interface ZipPolygonsResponse extends BulkBaseResponse {
  zones: ZipZonesDto[];
}

// Matches server LocationZipcodesDto (Id / Name / ZipCodes).
export interface ZoneLocationDto {
  id: number;
  name: string;
  zipCodes: string[];
}

// Matches server SortZipCodesByLocationResponse { Locations } - US endpoint
// /address/locations/zipcodes.
export interface LocationsZipCodesResponse extends BulkBaseResponse {
  locations: ZoneLocationDto[];
}

export interface AddressDto {
  address: string;
  suburb?: string | null;
  postCode?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}

export interface GeocodeRequest {
  messageId?: string;
  addresses: AddressDto[];
}

export interface GeocodeAddressDto extends AddressDto {
  longitude: string | null;
  latitude: string | null;
  geoType: number | null;
  suggestedPostCode?: string | null;
  suggestedZipCode?: string | null;
}

export interface GeocodeResponse extends BulkBaseResponse {
  addresses: GeocodeAddressDto[];
}

export const addressService = {
  getSuburbs: () =>
    request<SuburbsResponse>('/address/suburbs').then((raw) => ({ response: raw })),

  getZipCodes: () =>
    request<ZipCodesResponse>('/address/zipcodes').then((raw) => ({ response: raw })),

  getRegions: () =>
    request<RegionsResponse>('/address/regions').then((raw) => ({ response: raw })),

  getDepots: () =>
    request<DepotPostcodesResponse>('/address/depots/postcodes').then((raw) => ({
      response: raw,
    })),

  getZipPolygons: () =>
    request<ZipPolygonsResponse>('/address/zip-polygons').then((raw) => ({
      response: raw,
    })),

  getLocationsZipCodes: () =>
    request<LocationsZipCodesResponse>('/address/locations/zipcodes').then((raw) => ({
      response: raw,
    })),

  geocode: (payload: GeocodeRequest) =>
    request<GeocodeResponse>('/address/geocode', {
      method: 'POST',
      body: JSON.stringify(payload),
    }).then((raw) => ({ response: raw })),
};
