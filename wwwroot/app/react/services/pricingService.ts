import { request, buildQuery } from './api';

export interface RateSpeedColumn { speedId: number; name: string }

/** `inherited` true means the figure belongs to the default sheet and this
 *  client has no row of its own, which the grid renders grey. */
export interface RateCell {
  zone: number;
  speedId: number;
  rateId: number | null;
  amount: number | null;
  courierPercentage: number | null;
  inherited: boolean;
  defaultAmount: number | null;
}

export interface ZoneRateGrid {
  postcodeGroupId: number;
  postcodeGroupName: string;
  depotId: number | null;
  depotName: string | null;
  clientId: number | null;
  clientLabel: string;
  zones: number[];
  speeds: RateSpeedColumn[];
  cells: RateCell[];
  overriddenCellCount: number;
  /** True while BulkZoneRate.PostcodeGroupId is unfilled and the grid is
   *  resolving through the group's depot instead. */
  resolvedByDepot: boolean;
}

export interface ZoneRateUpsertBody {
  postcodeGroupId: number;
  zone: number;
  speedId: number;
  clientId?: number | null;
  amount?: number | null;
  courierPercentage?: number | null;
}

export interface PackageRate {
  id: number;
  setId: number | null;
  setName: string | null;
  clientId: number | null;
  name: string | null;
  fromCubic: number | null;
  toCubic: number | null;
  fromWeight: number | null;
  toWeight: number | null;
  cubicRate: number;
}

/** `usingOwnRows` is the rule said out loud: a client with any rows of its own
 *  uses only its own, with no merge against the default. */
export interface PackageRates {
  clientId: number | null;
  clientLabel: string;
  usingOwnRows: boolean;
  rows: PackageRate[];
}

export interface PackageRateUpsertBody {
  id?: number | null;
  clientId?: number | null;
  setId?: number | null;
  name?: string | null;
  fromCubic?: number | null;
  toCubic?: number | null;
  fromWeight?: number | null;
  toWeight?: number | null;
  cubicRate: number;
}

export interface Surcharge {
  id: number;
  /** Padded spelling an operator recognises. */
  code: string;
  /** The int actually stored, because PostCode is an int. */
  value: number;
  clientId: number | null;
  surcharge: number | null;
}

export interface SurchargeUpsertBody {
  id?: number | null;
  postcode: string;
  clientId?: number | null;
  surcharge?: number | null;
}

export interface OfferedSpeed {
  speedId: number;
  name: string;
  offeredGlobally: boolean;
  offeredForClient: boolean;
  clientRowId: number | null;
}

export interface RateSheet {
  id: number; postcodeGroupId: number; name: string;
  isDefault: boolean; courierPayHere: boolean;
}
export interface RateSet { id: number; name: string; isDefault: boolean }
export interface PricingGroupOption {
  id: number; name: string; depotId: number | null;
  depotName: string | null; clientId: number | null;
}

export interface PricingBootstrap {
  groups: PricingGroupOption[];
  speeds: RateSpeedColumn[];
  sheets: RateSheet[];
  rateSets: RateSet[];
}

export const pricingService = {
  bootstrap: () => request<{ response: PricingBootstrap }>('/pricing/bootstrap'),

  zoneRates: (postcodeGroupId: number, clientId?: number | null) =>
    request<{ response: ZoneRateGrid }>(
      `/pricing/zone-rates${buildQuery({ postcodeGroupId, clientId: clientId ?? undefined })}`),

  upsertZoneRate: (body: ZoneRateUpsertBody) =>
    request<{ response: RateCell }>('/pricing/zone-rates', {
      method: 'PUT', body: JSON.stringify(body),
    }),

  resetOverrides: (postcodeGroupId: number, clientId: number) =>
    request<{ response: number }>(
      `/pricing/zone-rates/reset${buildQuery({ postcodeGroupId, clientId })}`,
      { method: 'POST' }),

  packageRates: (clientId?: number | null) =>
    request<{ response: PackageRates }>(
      `/pricing/package-rates${buildQuery({ clientId: clientId ?? undefined })}`),

  upsertPackageRate: (body: PackageRateUpsertBody) =>
    request<{ response: PackageRate }>('/pricing/package-rates', {
      method: 'PUT', body: JSON.stringify(body),
    }),

  deletePackageRate: (id: number) =>
    request<{ response: string }>(`/pricing/package-rates/${id}`, { method: 'DELETE' }),

  surcharges: (clientId?: number | null) =>
    request<{ response: Surcharge[] }>(
      `/pricing/surcharges${buildQuery({ clientId: clientId ?? undefined })}`),

  upsertSurcharge: (body: SurchargeUpsertBody) =>
    request<{ response: Surcharge }>('/pricing/surcharges', {
      method: 'PUT', body: JSON.stringify(body),
    }),

  deleteSurcharge: (id: number) =>
    request<{ response: string }>(`/pricing/surcharges/${id}`, { method: 'DELETE' }),

  speeds: (clientId?: number | null) =>
    request<{ response: OfferedSpeed[] }>(
      `/pricing/speeds${buildQuery({ clientId: clientId ?? undefined })}`),

  setSpeedOffered: (speedId: number, offered: boolean, clientId?: number | null) =>
    request<{ response: OfferedSpeed }>(
      `/pricing/speeds/${speedId}${buildQuery({ offered: String(offered), clientId: clientId ?? undefined })}`,
      { method: 'POST' }),
};
