import { useEffect, useRef, useState } from 'react';
import type { BulkJob, Run } from '../../types';
import { Panel } from '../common/Panel';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
import { tenantMapCentre } from '../../lib/mapDefaults';
import { routeService } from '../../services/routeService';
import type { MapContextTarget } from './MapContextMenu';

interface Props {
  jobs: BulkJob[];
  selectedRun: Run | null;
  selectedJobId?: number | null;
  // All runs currently multi-selected in the Run List. Legacy colours pins
  // for these runs in a rotating palette (#ff9000/#00a3ff/#ffff00/#b13cff)
  // so operators can eyeball which pins belong to which run at a glance.
  multiSelectedRuns?: Run[];
  onPinClick?: (jobId: number) => void;
  onPinContextMenu?: (target: MapContextTarget) => void;
  // L2.P2.3 Legacy HereMap.tpl:177-184 addGreyClickHandler wired a plain
  // click on an UNASSIGNED (grey) pin to `addToRunFromMap(...)` - one
  // click adds the job to the currently active run. Right-click still
  // opens the full menu (multi-run picker). We call this from the marker
  // click handler ONLY when kind === 'unassigned' AND a selectedRun is
  // present. Absence of this callback preserves the pre-existing (right-
  // click-only) flow, so callers that don't wire it stay unchanged.
  onAddToRunFromMap?: (jobId: number, runId: number) => void;
}

// Legacy runList palette for multi-selected runs (HereMap.tpl line ~230).
// Exported so RunList.tsx can tint multi-selected rows with the SAME palette
// (L2.P3.1) - operators visually cross-reference selected rows to their pin
// clusters on the map. Keep this list in sync with buildPins() below.
export const MULTI_RUN_COLOURS = ['#ff9000', '#00a3ff', '#ffff00', '#b13cff', '#3cffb1', '#ff3cff'];

interface Pin {
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

/**
 * Google Maps cockpit surface. Direct port of the legacy HereMap.tpl which
 * despite the filename actually ran Google Maps via the GMaps.js wrapper.
 * Pin colours + right-click actions match legacy exactly:
 *   green (#b0f26f) - route start
 *   blue  (#6fb4f0) - route end
 *   grey  (#c7c7c7) - unassigned / potential delivery
 *   orange - stops on the currently selected run
 *
 * Right-clicking a marker opens the shared MapContextMenu with:
 *   - Assigned pin: Select / Remove from run / Transfer to run
 *   - Unassigned pin: Select / Add to run
 * Legacy analogue: addClickHandler + addGreyClickHandler in HereMap.tpl.
 */
export function GoogleMap({ jobs, selectedRun, selectedJobId, multiSelectedRuns, onPinClick, onPinContextMenu, onAddToRunFromMap }: Props) {
  const user = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  // Index of markers by bulkJobId so `highlightPin`-style bouncing (fired when
  // the operator clicks a job in a list) can find the marker in O(1). Cleared
  // whenever markers are rebuilt.
  const markersByJobIdRef = useRef<Map<number, any>>(new Map());
  // Multiple polylines when the route was chunked into 23-stop Google
  // Directions batches (P1.12, legacy drawDirectionsMoreThan23Waypoints).
  // Kept as an array so we tear all of them down on the next render.
  const polylinesRef = useRef<any[]>([]);
  const infoWindowRef = useRef<any>(null);
  // Latest request token so an in-flight Directions call for a stale run
  // gets discarded when the operator moves to another run mid-fetch.
  const directionsTokenRef = useRef<number>(0);
  const [ready, setReady] = useState(false);
  // Legacy Auto Zoom control: when true (default) the map re-fits its bounds
  // to the current pin cluster on every render. Operators sometimes want the
  // map to hold its position (zoomed out review of the whole day), so this
  // toggle sits top-left of the map surface.
  const [autoZoom, setAutoZoom] = useState(true);
  // P2.1 Map-background context menu. Legacy HereMap.tpl:61-70 opened a small
  // one-item menu ("Centre here") on right-click of the map itself (as opposed
  // to a marker). We stash the click coordinates + latLng here and render a
  // tiny fixed-position popup below.
  const [mapMenu, setMapMenu] = useState<{ clientX: number; clientY: number; lat: number; lng: number } | null>(null);

  const apiKey = user.googleMapsKey;
  const google = typeof window !== 'undefined' ? (window as any).google : undefined;

  // Poll for the async-loaded SDK. Legacy layout also races the load, so we
  // recheck every 200ms until google.maps shows up (or 20s times out).
  useEffect(() => {
    if (!apiKey) return;
    if (google && google.maps) { setReady(true); return; }
    const started = Date.now();
    const t = setInterval(() => {
      const g = (window as any).google;
      if (g && g.maps) { setReady(true); clearInterval(t); }
      else if (Date.now() - started > 20000) { clearInterval(t); }
    }, 200);
    return () => clearInterval(t);
  }, [apiKey, google]);

  // Init the Google Map once the SDK is ready.
  useEffect(() => {
    if (!ready || !mapContainerRef.current || mapRef.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;

    const map = new g.maps.Map(mapContainerRef.current, {
      // Tenant-aware fallback; setMapBounds below jumps to the real cluster
      // once markers land. Auckland on NZ, San Francisco on US.
      center: tenantMapCentre(user.isUsTenant),
      zoom: 4,
      mapTypeId: g.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit.station', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      ],
      // Suppress the browser's native menu on right-click of the map itself
      // so the marker's own right-click context menu is the only surface the
      // operator sees.
      disableDefaultUI: false,
      clickableIcons: false,
    });
    mapRef.current = map;
    infoWindowRef.current = new g.maps.InfoWindow();

    // P2.1 Legacy "Centre here" (HereMap.tpl:61-70). Right-click on the map
    // background opens a mini one-item menu; picking it re-centres. We prefer
    // a menu over a direct setCenter so accidental right-clicks don't teleport
    // the map away from the operator's current view, matching the legacy UX.
    map.addListener('rightclick', (e: any) => {
      const dom = e?.domEvent as MouseEvent | undefined;
      if (!e?.latLng) return;
      setMapMenu({
        clientX: dom?.clientX ?? 0,
        clientY: dom?.clientY ?? 0,
        lat: e.latLng.lat(),
        lng: e.latLng.lng(),
      });
    });

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
      mapRef.current = null;
    };
  }, [ready]);

  // Re-render markers when jobs / selected run changes.
  useEffect(() => {
    if (!mapRef.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;

    // Clear the previous markers + polylines. Bump the directions token so
    // any in-flight fetch for a prior selection resolves into a no-op.
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    markersByJobIdRef.current.clear();
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];
    directionsTokenRef.current += 1;
    const myToken = directionsTokenRef.current;

    const pins = buildPins(jobs, selectedRun, multiSelectedRuns ?? []);
    if (pins.length === 0) return;

    const bounds = new g.maps.LatLngBounds();
    pins.forEach((p) => {
      const marker = new g.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current,
        icon: makeIcon(g, p),
        // Sequence number is baked directly into makeIcon's SVG so it
        // bounces together with the pin during `highlightPin` animation
        // (Google's Marker.label is a separate DOM element that stays
        // stationary during BOUNCE with path-based Symbol icons).
        title: p.label,
      });
      bounds.extend(marker.getPosition());

      marker.addListener('click', () => {
        // L2.P2.3 Legacy grey-pin one-click add. When the operator has
        // a run selected AND the pin is unassigned (grey) AND the run is
        // still editable (not locked, not the Void Jobs run), fire the
        // add directly instead of the standard select. The context menu
        // is still available on right-click for multi-run picking.
        if (
          p.kind === 'unassigned'
          && onAddToRunFromMap
          && selectedRun
          && !selectedRun.isVoidRun
          && (selectedRun.status ?? 0) === 0
        ) {
          onAddToRunFromMap(p.bulkJobId, selectedRun.id);
          return;
        }
        if (onPinClick) onPinClick(p.bulkJobId);
        // Legacy bounce animation on select (HereMap.tpl:522-525 sets
        // Animation.BOUNCE for 1000ms).
        try {
          marker.setAnimation(g.maps.Animation.BOUNCE);
          setTimeout(() => marker.setAnimation(null), 1000);
        } catch { /* older SDK - non-fatal */ }
      });

      // Legacy right-click behaviour: fire the shared context menu at the
      // mouse pointer. The browser MouseEvent is in domEvent for Google.
      marker.addListener('rightclick', (e: any) => {
        if (!onPinContextMenu) return;
        const dom = e?.domEvent as MouseEvent | undefined;
        onPinContextMenu({
          bulkJobId: p.bulkJobId,
          jobNumber: p.jobNumber,
          kind: p.kind === 'pickup' ? 'pickup' : 'delivery',
          runId: p.runId,
          clientX: dom?.clientX ?? 0,
          clientY: dom?.clientY ?? 0,
        });
      });

      markersRef.current.push(marker);
      // Only index the delivery-side pin (there can be a pickup + delivery
      // pair for the same job in future extensions). Delivery is what the
      // Jobs list shows and what the operator wants to bounce.
      markersByJobIdRef.current.set(p.bulkJobId, marker);
    });

    // Fit bounds to the plotted pins so the operator lands on the actual area
    // instead of the San Francisco fallback. Skipped when the operator has
    // toggled auto-zoom off, matching legacy HereMap.tpl:634-636.
    if (autoZoom && !bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds);
    }

    // Route line through the sequenced pins of the selected run.
    //
    // P1.12: legacy HereMap.tpl:908-1066 (drawDirectionsMoreThan23Waypoints)
    // chunked the run into 23-waypoint slices for Google Directions and
    // stitched the encoded polylines back together, because the Directions
    // API caps at 25 waypoints per request (origin + destination + up to 23
    // intermediates). We do the same here: for each chunk, request driving
    // directions and render the returned overview_path as a proper Polyline
    // that hugs the road network. If the API call fails (quota, offline,
    // etc.), fall back to a straight-line polyline through the chunk so the
    // operator still sees the sequence.
    if (selectedRun) {
      // Include start + end pins alongside sequenced pins so the polyline
      // covers the full route (leg 1 -> 2 and leg N-1 -> N). Without this,
      // buildPins re-tags the first and last sequenced pins to `start` /
      // `end` (for the green/blue marker colours) and they were being
      // filtered out here - HERE was only asked to route through the
      // interior stops, leaving the operator to eyeball how to reach the
      // first and last delivery.
      const seqPins = pins
        .filter((p) => (p.kind === 'sequenced' || p.kind === 'start' || p.kind === 'end') && p.sequence != null)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      if (seqPins.length > 1) {
        drawRunPolyline(g, mapRef.current, seqPins, polylinesRef, myToken, directionsTokenRef);
      }
    }
  }, [ready, jobs, selectedRun, multiSelectedRuns, onPinClick, onPinContextMenu, onAddToRunFromMap, autoZoom]);

  // P2.1 close-the-map-menu wiring. Mirrors MapContextMenu's Escape + outside-
  // click pattern. Deliberately NOT listening for contextmenu (a second right-
  // click just replaces the menu target via the rightclick handler above).
  useEffect(() => {
    if (!mapMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMapMenu(null); };
    const onClick = () => setMapMenu(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [mapMenu]);

  // highlightPin(job) equivalent: whenever the operator selects a job (from
  // the Jobs list, the Run Builder pane, the group list, wherever) look up
  // the corresponding marker and bounce it for ~1s. Legacy analogue:
  // homeControl.js selectJob(...) -> highlightPin(currentJob) which finds the
  // marker by lat/lng match and calls setAnimation(BOUNCE). Same effect here
  // but O(1) via the bulkJobId map instead of coord matching.
  useEffect(() => {
    if (selectedJobId == null) return;
    const g = (window as any).google;
    if (!g?.maps) return;
    const marker = markersByJobIdRef.current.get(selectedJobId);
    if (!marker) return;
    try {
      marker.setAnimation(g.maps.Animation.BOUNCE);
      const timer = setTimeout(() => marker.setAnimation(null), 1400);
      return () => {
        clearTimeout(timer);
        marker.setAnimation(null);
      };
    } catch { /* older SDK - non-fatal */ }
  }, [selectedJobId]);

  if (!apiKey || !ready) {
    const reason = !apiKey
      ? 'Google Maps API key is not set (GoogleMapsKey env var).'
      : 'Google Maps SDK still loading...';
    return (
      <Panel title="Map">
        <div className="h-full w-full grid place-items-center bg-surface-cream">
          <div className="text-center text-text-muted">
            <div className="text-sm">Map unavailable</div>
            <div className="mt-2 text-xs">{reason}</div>
            <div className="mt-2 text-xs">
              {selectedRun ? `Would render run "${selectedRun.name}"` : `${jobs.length} jobs to plot`}
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title={selectedRun ? `Map - Run: ${selectedRun.name}` : `Map - ${jobs.length} jobs`}
      actions={
        <Button
          variant="neutral"
          size="sm"
          active={autoZoom}
          onClick={() => setAutoZoom((v) => !v)}
          title={autoZoom
            ? 'Auto zoom is on - map re-fits to the pin cluster on every update. Click to disable.'
            : 'Auto zoom is off - map holds its position. Click to enable.'}
        >
          Auto Zoom: {autoZoom ? 'On' : 'Off'}
        </Button>
      }
    >
      <div ref={mapContainerRef} className="h-full w-full" />
      {mapMenu && (
        <ul
          className="fixed z-50 bg-surface-white border border-border rounded shadow-lg text-xs min-w-40"
          style={{ top: mapMenu.clientY, left: mapMenu.clientX }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <li className="px-3 py-2 bg-surface-cream border-b border-border-light font-medium text-text-primary text-[10px] text-text-muted">
            {mapMenu.lat.toFixed(5)}, {mapMenu.lng.toFixed(5)}
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                const g = (window as any).google;
                if (g?.maps && mapRef.current) {
                  mapRef.current.setCenter({ lat: mapMenu.lat, lng: mapMenu.lng });
                }
                setMapMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-surface-cream text-text-primary"
            >
              Centre here
            </button>
          </li>
        </ul>
      )}
    </Panel>
  );
}

/**
 * Polyline drawer backed by HERE Routing v8 (via /api/routes/polyline).
 *
 * Previously used google.maps.DirectionsService with a 23-waypoint chunking
 * dance to work around Google's 25-waypoint cap. HERE v8 accepts 90+
 * waypoints per request and the chunking now lives server-side, so the
 * frontend collapses to a single fetch.
 *
 * Behaviour preserved from the Google-based version:
 *   - Straight-line placeholder rendered immediately so the map doesn't
 *     flash empty during the (few hundred ms) fetch.
 *   - Stale-token check so a mid-fetch run switch discards the reply
 *     rather than drawing over the new selection.
 *   - On any failure (network, empty response) the placeholder stays and
 *     the operator gets straight-line segments - "any line is better than
 *     no line" matches the legacy fallback.
 */
function drawRunPolyline(
  g: any,
  map: any,
  seqPins: Pin[],
  polylinesRef: React.MutableRefObject<any[]>,
  ownToken: number,
  currentTokenRef: React.MutableRefObject<number>
) {
  // Placeholder straight line - kept visible until (or unless) HERE responds.
  const placeholder = new g.maps.Polyline({
    path: seqPins.map((p) => ({ lat: p.lat, lng: p.lng })),
    geodesic: true,
    strokeColor: '#606DB4',
    strokeOpacity: 0.35,
    strokeWeight: 2,
    map,
  });
  polylinesRef.current.push(placeholder);

  const stops = seqPins.map((p) => ({
    name: p.jobNumber ?? `stop-${p.bulkJobId}`,
    lat: p.lat,
    lng: p.lng,
  }));

  routeService.polyline(stops)
    .then((res) => {
      // Stale request check - discard if the operator has moved on.
      if (currentTokenRef.current !== ownToken) return;
      const points = res?.points ?? [];
      if (points.length < 2) return; // keep the placeholder
      const line = new g.maps.Polyline({
        path: points.map((pt) => ({ lat: pt.lat, lng: pt.lng })),
        geodesic: true,
        strokeColor: '#606DB4',
        strokeOpacity: 0.9,
        strokeWeight: 3,
        map,
      });
      placeholder.setMap(null);
      const idx = polylinesRef.current.indexOf(placeholder);
      if (idx >= 0) polylinesRef.current.splice(idx, 1);
      polylinesRef.current.push(line);
    })
    .catch(() => {
      // Silent - the placeholder straight-line stays visible on failure.
    });
}

function buildPins(jobs: BulkJob[], selectedRun: Run | null, multiSelectedRuns: Run[]): Pin[] {
  const out: Pin[] = [];
  const inRun = selectedRun ? new Set(selectedRun.jobs.map((j) => j.bulkJobId)) : null;
  const sequenceByJobId = new Map<number, number>();
  if (selectedRun) {
    selectedRun.jobs.forEach((rj, idx) => {
      sequenceByJobId.set(rj.bulkJobId, rj.builderIndex ?? idx + 1);
    });
  }

  // Build a lookup from bulkJobId -> multi-run colour so any pin whose owner
  // run is multi-selected gets tinted. Skip the currently-selected run so its
  // sequence colouring wins.
  const multiRunColourByJobId = new Map<number, string>();
  multiSelectedRuns.forEach((run, idx) => {
    if (selectedRun && run.id === selectedRun.id) return;
    const colour = MULTI_RUN_COLOURS[idx % MULTI_RUN_COLOURS.length];
    run.jobs.forEach((rj) => multiRunColourByJobId.set(rj.bulkJobId, colour));
  });

  jobs.forEach((j) => {
    const dropLat = parseCoord(j.deliveryLatitude);
    const dropLng = parseCoord(j.deliveryLongitude);
    const label = j.jobNumber ?? String(j.bulkJobId);
    if (dropLat == null || dropLng == null) return;

    // Legacy colour rules (see HereMap.tpl createPin() + drawDirections):
    //   in the selected run           -> orange stop marker w/ sequence label
    //   in another multi-selected run -> palette-tinted marker (see MULTI_RUN_COLOURS)
    //   assigned to a *different* run -> plain delivery pin
    //   unassigned to any run         -> grey (matches legacy potentialJobs)
    let kind: Pin['kind'];
    let colour: string | undefined;
    if (inRun && inRun.has(j.bulkJobId)) {
      kind = 'sequenced';
    } else if (multiRunColourByJobId.has(j.bulkJobId)) {
      kind = 'multiRun';
      colour = multiRunColourByJobId.get(j.bulkJobId);
    } else if (j.bulkRunId != null) {
      kind = 'delivery';
    } else {
      kind = 'unassigned';
    }

    out.push({
      lat: dropLat, lng: dropLng,
      label: `${kind === 'sequenced' ? 'Stop ' + sequenceByJobId.get(j.bulkJobId) + ' - ' : ''}${label}`,
      kind,
      sequence: kind === 'sequenced' ? sequenceByJobId.get(j.bulkJobId) : undefined,
      bulkJobId: j.bulkJobId,
      jobNumber: j.jobNumber,
      runId: j.bulkRunId,
      colour,
    });
  });

  // Legacy also puts a green start pin at the first stop and a blue end pin
  // at the last stop of the selected run. Replay that when a run is selected
  // and has 2+ sequenced pins.
  if (selectedRun && inRun) {
    const seq = out
      .filter((p) => p.kind === 'sequenced')
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    if (seq.length > 0) {
      seq[0].kind = 'start';
      if (seq.length > 1) seq[seq.length - 1].kind = 'end';
    }
  }
  return out;
}

function parseCoord(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * Legacy createPin() shape - a raindrop-style icon Google Maps renders from
 * an inline SVG data URI. Colours per legacy: green start, blue end, grey
 * unassigned, orange run-stop, red delivery (fallback).
 *
 * The sequence number is baked into the SVG itself (as a <text> element)
 * rather than passed via the Marker.label prop. Reason: Google's bounce
 * animation only animates the icon element; when the label is a separate
 * DOM element (path-based Symbol icons + Marker.label), the number stays
 * stationary while the pin bounces - operators see the label desynced.
 * URL-based icons with embedded text bounce as a single unit.
 */
function makeIcon(g: any, p: Pin) {
  const fill = p.kind === 'multiRun' && p.colour ? p.colour
    : p.kind === 'start' ? '#b0f26f'
    : p.kind === 'end' ? '#6fb4f0'
    : p.kind === 'sequenced' ? '#F2994A'
    : p.kind === 'unassigned' ? '#c7c7c7'
    : p.kind === 'completed' ? '#c7c7c7'   // Route Viewer P8: finished job (muted)
    : p.kind === 'voided' ? '#eab308'      // Route Viewer P8: voided job (yellow)
    : p.kind === 'pickup' ? '#43C7F4'
    : '#EF4444';
  const seqText = (p.kind === 'sequenced' || p.kind === 'start' || p.kind === 'end') && p.sequence != null
    ? String(p.sequence)
    : '';
  // Path y-range: 0 (tip, bottom) up to -44 (top of ball), with a radius-11
  // circle centered at (0, -33). Add a little padding on top so the stroke
  // isn't clipped: viewBox spans y = -46..0 (height 46), x = -12..+12 (width
  // 24). Anchor in the returned Point() below is in image pixel coordinates
  // (top-left origin), so (12, 46) is bottom-center - the raindrop tip.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="46" viewBox="-12 -46 24 46">`
    + `<path d="M 0,0 C -2.2,-22 -11,-24.2 -11,-33 A 11,11 0 1,1 11,-33 C 11,-24.2 2.2,-22 0,0 z" `
    + `fill="${fill}" stroke="#14152D" stroke-width="1.5"/>`
    + (seqText
        ? `<text x="0" y="-29" font-size="12" font-weight="700" text-anchor="middle" `
          + `fill="#14152D" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif">`
          + `${seqText}</text>`
        : '')
    + `</svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    size: new g.maps.Size(24, 46),
    scaledSize: new g.maps.Size(24, 46),
    anchor: new g.maps.Point(12, 46),
  };
}
