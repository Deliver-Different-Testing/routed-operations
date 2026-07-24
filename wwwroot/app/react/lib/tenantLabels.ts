// Tenant-aware label helpers. Kept in one place so cockpit + wizard +
// CSV export agree on which word to show for the postcode / suburb /
// currency column depending on tenant country.

export function postcodeLabel(isUs: boolean, short = true): string {
  if (isUs) return short ? 'Zip' : 'Zip Code';
  return short ? 'Postcode' : 'Postal Code';
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
