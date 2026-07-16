import { useEffect, useRef, useState } from 'react';
import type { BulkJob, Run } from '../../types';
import { Panel } from '../common/Panel';
import { useAuth } from '../../context/AuthContext';
import type { MapContextTarget } from './MapContextMenu';

interface Props {
  jobs: BulkJob[];
  selectedRun: Run | null;
  onPinClick?: (jobId: number) => void;
  onPinContextMenu?: (target: MapContextTarget) => void;
}

interface Pin {
  lat: number;
  lng: number;
  label: string;
  kind: 'pickup' | 'delivery' | 'start' | 'end' | 'sequenced' | 'unassigned';
  sequence?: number;
  bulkJobId: number;
  jobNumber: string | null;
  runId: number | null;
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
export function GoogleMap({ jobs, selectedRun, onPinClick, onPinContextMenu }: Props) {
  const user = useAuth();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
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
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }

    const pins = buildPins(jobs, selectedRun);
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
  }, [ready, jobs, selectedRun, onPinClick, onPinContextMenu, autoZoom]);

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
        <button
          type="button"
          onClick={() => setAutoZoom((v) => !v)}
          className={`px-2 py-0.5 text-xs border rounded ${
            autoZoom
              ? 'bg-brand-cyan text-brand-dark border-brand-cyan font-medium'
              : 'border-border bg-surface-white hover:bg-surface-light'
          }`}
          title={autoZoom
            ? 'Auto zoom is on - map re-fits to the pin cluster on every update. Click to disable.'
            : 'Auto zoom is off - map holds its position. Click to enable.'}
        >
          Auto Zoom: {autoZoom ? 'On' : 'Off'}
        </button>
      }
    >
      <div ref={mapContainerRef} className="h-full w-full" />
    </Panel>
  );
}

function buildPins(jobs: BulkJob[], selectedRun: Run | null): Pin[] {
  const out: Pin[] = [];
  const inRun = selectedRun ? new Set(selectedRun.jobs.map((j) => j.bulkJobId)) : null;
  const sequenceByJobId = new Map<number, number>();
  if (selectedRun) {
    selectedRun.jobs.forEach((rj, idx) => {
      sequenceByJobId.set(rj.bulkJobId, rj.builderIndex ?? idx + 1);
    });
  }

  jobs.forEach((j) => {
    const dropLat = parseCoord(j.deliveryLatitude);
    const dropLng = parseCoord(j.deliveryLongitude);
    const label = j.jobNumber ?? String(j.bulkJobId);
    if (dropLat == null || dropLng == null) return;

    // Legacy colour rules (see HereMap.tpl createPin() + drawDirections):
    //   in a run                 -> orange stop marker with sequence label
    //   assigned to a *different* run -> keep the run's own colour later
    //                                    (Stage 1 shows plain delivery pin)
    //   unassigned to any run    -> grey (matches legacy potentialJobs)
    let kind: Pin['kind'];
    if (inRun && inRun.has(j.bulkJobId)) {
      kind = 'sequenced';
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
  const fill = p.kind === 'start' ? '#b0f26f'
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
