export interface Pin {
  lat: number;
  lng: number;
  label: string;
  // Route Viewer P8 added 'completed' (grey #c7c7c7) + 'voided' (yellow) to
  // the palette so operator surfaces that show finished jobs (Home map
  // box in read-only mode; Print Manager map) render them muted vs the
  // live orange stops. Route Builder's buildPins() does not currently
  // emit these two - they are consumed by Route Viewer callers that
  // decide job status from `jobStatus === 'C' / 'V'` before pushing pins
  // in. Kept in the shared union so downstream shared components
  // (MapContextMenu etc.) don't need per-caller kind narrowing.
  kind: 'pickup' | 'delivery' | 'start' | 'end' | 'sequenced' | 'unassigned' | 'multiRun' | 'completed' | 'voided';
  sequence?: number;
  bulkJobId: number;
  jobNumber: string | null;
  runId: number | null;
  // Colour override for pins belonging to a multi-selected run (rotating
  // palette). Present only when kind === 'multiRun'.
  colour?: string;
}

export interface PinDiff {
  add: Pin[];
  /** bulkJobIds whose marker should go. */
  remove: number[];
  update: Pin[];
}

/**
 * #1018 C3: what the map has to change to go from the markers it shows
 * (keyed by bulkJobId) to the next pins. A background reload hands back new
 * objects for the same jobs, so pins are compared by value.
 */
export function diffPins(current: ReadonlyMap<number, Pin>, next: readonly Pin[]): PinDiff {
  const add: Pin[] = [];
  const update: Pin[] = [];
  const seen = new Set<number>();
  for (const p of next) {
    seen.add(p.bulkJobId);
    const was = current.get(p.bulkJobId);
    if (!was) add.push(p);
    else if (!samePin(was, p)) update.push(p);
  }
  const remove = [...current.keys()].filter((id) => !seen.has(id));
  return { add, remove, update };
}

function samePin(a: Pin, b: Pin): boolean {
  return a.lat === b.lat && a.lng === b.lng && a.label === b.label && a.kind === b.kind
    && a.sequence === b.sequence && a.jobNumber === b.jobNumber && a.runId === b.runId
    && a.colour === b.colour;
}

/** The selected run's stops (start, sequenced, end) in sequence order. */
export function routeStops(pins: readonly Pin[]): Pin[] {
  return pins
    .filter((p) => (p.kind === 'sequenced' || p.kind === 'start' || p.kind === 'end') && p.sequence != null)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

/**
 * Changes exactly when the route line would: the run's stops, their order or
 * their positions. Empty when there is no line to draw (fewer than 2 stops).
 */
export function routeKey(pins: readonly Pin[]): string {
  const stops = routeStops(pins);
  if (stops.length < 2) return '';
  return stops.map((p) => `${p.bulkJobId}@${p.lat},${p.lng}`).join(';');
}
