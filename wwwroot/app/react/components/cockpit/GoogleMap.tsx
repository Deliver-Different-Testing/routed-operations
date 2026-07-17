import { useEffect, useRef, useState } from 'react';
import type { BulkJob, Run } from '../../types';
import { Panel } from '../common/Panel';
import { Button } from '../common/Button';
import { useAuth } from '../../context/AuthContext';
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
}

// Legacy runList palette for multi-selected runs (HereMap.tpl line ~230).
const MULTI_RUN_COLOURS = ['#ff9000', '#00a3ff', '#ffff00', '#b13cff', '#3cffb1', '#ff3cff'];

interface Pin {
  lat: number;
  lng: number;
  label: string;
  kind: 'pickup' | 'delivery' | 'start' | 'end' | 'sequenced' | 'unassigned' | 'multiRun';
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
export function GoogleMap({ jobs, selectedRun, selectedJobId, multiSelectedRuns, onPinClick, onPinContextMenu }: Props) {
  const user = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  // Index of markers by bulkJobId so `highlightPin`-style bouncing (fired when
  // the operator clicks a job in a list) can find the marker in O(1). Cleared
  // whenever markers are rebuilt.
  const markersByJobIdRef = useRef<Map<number, any>>(new Map());
  const polylineRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  // Legacy Auto Zoom control: when true (default) the map re-fits its bounds
  // to the current pin cluster on every render. Operators sometimes want the
  // map to hold its position (zoomed out review of the whole day), so this
  // toggle sits top-left of the map surface.
  const [autoZoom, setAutoZoom] = useState(true);

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
      // San Francisco fallback; setMapBounds below jumps to the real cluster
      // once markers land. Matches the legacy Auckland fallback pattern.
      center: { lat: 37.7749, lng: -122.4194 },
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

    // Legacy "Center here" - right-click the map background and centre on
    // the click coordinates. See HereMap.tpl:63-69 (map.setContextMenu on
    // control: 'map').
    map.addListener('rightclick', (e: any) => {
      if (e?.latLng) {
        map.setCenter(e.latLng);
      }
    });

    return () => {
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      if (polylineRef.current) polylineRef.current.setMap(null);
      polylineRef.current = null;
      mapRef.current = null;
    };
  }, [ready]);

  // Re-render markers when jobs / selected run changes.
  useEffect(() => {
    if (!mapRef.current) return;
    const g = (window as any).google;
    if (!g?.maps) return;

    // Clear the previous markers + polyline.
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    markersByJobIdRef.current.clear();
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }

    const pins = buildPins(jobs, selectedRun, multiSelectedRuns ?? []);
    if (pins.length === 0) return;

    const bounds = new g.maps.LatLngBounds();
    pins.forEach((p) => {
      const marker = new g.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current,
        icon: makeIcon(g, p),
        label: p.kind === 'sequenced' && p.sequence != null
          ? { text: String(p.sequence), color: '#14152D', fontSize: '10px', fontWeight: '700' }
          : undefined,
        title: p.label,
      });
      bounds.extend(marker.getPosition());

      marker.addListener('click', () => {
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

    // Route line through the sequenced pins of the selected run. Matches the
    // legacy directionsDisplay path but without pulling Directions - a plain
    // polyline is enough for a visual sequence hint.
    if (selectedRun) {
      const seqPins = pins
        .filter((p) => p.kind === 'sequenced' && p.sequence != null)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      if (seqPins.length > 1) {
        polylineRef.current = new g.maps.Polyline({
          path: seqPins.map((p) => ({ lat: p.lat, lng: p.lng })),
          geodesic: true,
          strokeColor: '#606DB4',
          strokeOpacity: 0.9,
          strokeWeight: 3,
          map: mapRef.current,
        });
      }
    }
  }, [ready, jobs, selectedRun, multiSelectedRuns, onPinClick, onPinContextMenu, autoZoom]);

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
    </Panel>
  );
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
 * Legacy createPin() shape - a raindrop-style path Google Maps renders as an
 * SVG marker icon. Colours per legacy: green start, blue end, grey unassigned,
 * orange run-stop, red delivery (fallback).
 */
function makeIcon(g: any, p: Pin) {
  const fill = p.kind === 'multiRun' && p.colour ? p.colour
    : p.kind === 'start' ? '#b0f26f'
    : p.kind === 'end' ? '#6fb4f0'
    : p.kind === 'sequenced' ? '#F2994A'
    : p.kind === 'unassigned' ? '#c7c7c7'
    : p.kind === 'pickup' ? '#43C7F4'
    : '#EF4444';
  return {
    path: 'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1,1 10,-30 C 10,-22 2,-20 0,0 z',
    fillColor: fill,
    fillOpacity: 1,
    strokeColor: '#14152D',
    strokeWeight: 1.5,
    scale: 1,
    labelOrigin: new g.maps.Point(0, -30),
  };
}
