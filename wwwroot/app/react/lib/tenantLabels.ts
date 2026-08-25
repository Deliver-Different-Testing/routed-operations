// Tenant-aware label helpers. Kept in one place so cockpit + wizard +
// CSV export + Schedules module all agree on which word to show for the
// postcode / suburb / currency column depending on tenant country.
//
// Convention: functions take `isUs` (boolean) as the FIRST arg so
// call sites read `postcodeLabel(user.isUsTenant)` etc.

export function postcodeLabel(isUs: boolean, short = true): string {
  if (isUs) return short ? 'Zip' : 'Zip Code';
  return short ? 'Postcode' : 'Postal Code';
}

/** Plural form of postcode/zip. Use when the label is a header like "Postcodes" or a count noun. */
export function postcodePluralLabel(isUs: boolean): string {
  return isUs ? 'Zips' : 'Postcodes';
}

/** The regional depot / location entity (tblBulkRegion). NZ operators call
 *  these "Depots"; US operators call them "Locations". */
export function depotLabel(isUs: boolean, plural = false): string {
  if (isUs) return plural ? 'Locations' : 'Location';
  return plural ? 'Depots' : 'Depot';
}

/** The postcode-group / zip-group entity (BulkZonePostcodeGroup).
 *  Same DB entity, different operator-facing word per tenant. */
export function postcodeGroupLabel(isUs: boolean, plural = false): string {
  if (isUs) return plural ? 'Zip Groups' : 'Zip Group';
  return plural ? 'Postcode Groups' : 'Postcode Group';
}

export function stateLabel(isUs: boolean): string {
  return isUs ? 'State' : 'Region';
}

export function cityLabel(isUs: boolean): string {
  return isUs ? 'City' : 'Suburb';
}

export function currencyCode(isUs: boolean): 'USD' | 'NZD' {
  return isUs ? 'USD' : 'NZD';
}

export function currencySymbol(isUs: boolean): string {
  return isUs ? '$' : 'NZ$';
}
