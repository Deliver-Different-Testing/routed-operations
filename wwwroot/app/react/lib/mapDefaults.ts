// Tenant-aware map centre defaults. Kept in one place so the four map
// surfaces (cockpit GoogleMap, FixGpsModal, PolygonBuilder, FixAddressesModal
// fallback pin) all agree on the same pair of coordinates.
//
// US: San Francisco (matches the historic hard-coded fallback the cockpit
// map opened on before any pins landed).
// NZ: Auckland (matches the FixAddressesModal fallback pin that already
// used this coordinate before this helper existed).
export const US_CENTRE = { lat: 37.7749, lng: -122.4194 };
export const NZ_CENTRE = { lat: -36.848, lng: 174.763 };

export function tenantMapCentre(isUsTenant: boolean): { lat: number; lng: number } {
  return isUsTenant ? US_CENTRE : NZ_CENTRE;
}
