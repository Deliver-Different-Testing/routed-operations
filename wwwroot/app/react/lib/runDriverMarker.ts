// Cheetah R3 (2026-11-28): when one run is selected, the map shows that
// run's driver at their last GPS fix even if the "All couriers" envelope
// set does not include them. Pure so it can be unit-tested.

export interface CourierPosition {
  courierId: number;
  courierCode: string | null;
  vehicleType: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  timestamp: string | null;
}

export interface DriverMarker {
  courierId: number;
  lat: number;
  lng: number;
  label: string;
}

// F4: [Timestamp] is the tenant server's own clock (NZ on Cheetah), not
// UTC, so read the HH:mm as written. new Date() would shift it by the
// browser's offset.
export function fixTimeLabel(timestamp: string | null | undefined): string | null {
  const m = timestamp ? /[T ](\d{2}):(\d{2})/.exec(timestamp) : null;
  return m ? `${m[1]}:${m[2]}` : null;
}

// F5: one failed request must not stop the poll for good. After an error
// try again every 2 minutes; a success puts it back to every 30 s.
export const MAP_POLL_MS = 30_000;
export const MAP_POLL_AFTER_ERROR_MS = 120_000;
export function mapPollInterval(enabled: boolean, status: string): number | false {
  if (!enabled) return false;
  return status === 'error' ? MAP_POLL_AFTER_ERROR_MS : MAP_POLL_MS;
}

const coord = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/**
 * Marker for the selected run's driver, or null when there is no usable
 * fix or the driver is already drawn by the visible "All couriers" layer.
 */
export function runDriverMarker(
  last: CourierPosition | null | undefined,
  visibleEnvelope: CourierPosition[] | null | undefined,
): DriverMarker | null {
  if (!last) return null;
  const lat = coord(last.latitude);
  const lng = coord(last.longitude);
  if (lat == null || lng == null) return null;
  if (visibleEnvelope?.some((c) => c.courierId === last.courierId && coord(c.latitude) != null && coord(c.longitude) != null)) {
    return null;
  }
  const name = [last.courierCode, last.vehicleType].filter(Boolean).join(' ') || `Courier ${last.courierId}`;
  const time = fixTimeLabel(last.timestamp);
  return { courierId: last.courierId, lat, lng, label: time ? `${name} ${time}` : name };
}
