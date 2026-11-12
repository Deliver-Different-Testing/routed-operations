// Links from Routed Operations into the matching Configurator (DFRNT Drive
// Config) settings page. The two apps share a host pattern per tenant:
//   routedoperations.<tenant>[.staging].deliverdifferent.com
//   dfrntdriveconfig.<tenant>[.staging].deliverdifferent.com
// so the Configurator origin is this origin with the first label swapped.
// Anywhere else (localhost, the .local. dev host) there is no Configurator to
// point at, and no link is rendered.

const RO_PREFIX = 'routedoperations.';
const CONFIG_PREFIX = 'dfrntdriveconfig.';

/** The Configurator origin for the current Routed Operations origin, or null. */
export function configuratorOrigin(origin: string = window.location.origin): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!host.startsWith(RO_PREFIX)) return null;
  // Local dev host (routedoperations.local.deliverdifferent.com) has no
  // Configurator alongside it.
  if (host.startsWith(`${RO_PREFIX}local.`)) return null;
  url.hostname = CONFIG_PREFIX + host.slice(RO_PREFIX.length);
  return url.origin;
}

/** Configurator page for one driver location list (tblClearListArea). */
export function driverLocationListUrl(id: number, origin?: string): string | null {
  const base = configuratorOrigin(origin);
  return base ? `${base}/settings/driver-locations/${id}` : null;
}

/** Configurator page for one depot / location (tblBulkRegion). */
export function depotSettingsUrl(id: number, origin?: string): string | null {
  const base = configuratorOrigin(origin);
  return base ? `${base}/settings/locations/${id}` : null;
}
