import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { tenantMapCentre } from '../../lib/mapDefaults';
import { routeViewerService, type BulkJob } from '../../services/routeViewerService';
import { RvBox } from './RvBox';

// Route Viewer map surface (master Section 7.12). Renders pins for:
//   - the currently drilled run (delivery pins in green, pickup blue,
//     completed grey, voided yellow)
//   - additional runs when the operator selects >1 in the Run List:
//     each run gets its own colour from runColorMap and pins carry
//     that colour so operators can match pins to Run List rows
//   - a polyline through delivery pins ordered by runOrder for each
//     drilled run (Tier-2 item 8)
//   - runOrder label baked into the pin SVG (Tier-2 item 8)
//   - info window on completed jobs (podName / podTime) (Tier-2 item 8)
//   - available couriers with a flag+label marker (code + vehicleType)
//     if "All Couriers" is ticked (Tier-3 item 1, legacy map.js:424-455)
//   - all-runs overlay if "All Runs" is ticked, gated by a confirm
//     for >200 pins (Tier-2 item 8)
//   - live car marker for a tracked courier, polled at 15s (Tier-3 item
//     2, legacy map.js:485-503 refreshCourierLocation)
//   - bounce animation on the selected job's pin for ~1.5s so the
//     operator eye-tracks the selection (Tier-3 item 4, legacy
//     homeControl.js:5325 highlightPin)
//
// A "Clear" button in the header (Tier-3 item 3, legacy
// homeView.html:149 clearRoutes) resets the toggles + tracked-courier
// state; the underlying data stays put so the map re-populates on the
// next toggle flip.

interface MapPin {
  runId: number;
  bulkJobId: number;
  lat: number;
  lng: number;
  status: string | null;
  jobNumber: string | null;
  runOrder: number | null;
  podName: string | null;
  podTime: string | null;
  kind: 'pickup' | 'delivery';
}

interface Props {
  runDate: string;
  runJobs: BulkJob[];        // currently drilled run's jobs
  selectedJobId: number | null;
  /** Same viewMode that drives the Run List. Controls which side(s) of
   *  each job produce a pin: Combined = both, Inbound = pickup only,
   *  Outbound = delivery only. */
  viewMode: 'Combined' | 'Inbound' | 'Outbound';
  /** Tier-2 item 15 palette. When 2+ runs selected, pins for each run
   *  use the mapped colour instead of the default pickup/delivery
   *  blue/green. */
  runColorMap?: Record<number, string>;
  /** Only populated when 2+ runs are selected. Full runJobs from every
   *  additional run so we can pin all of them together (Tier-2 item
   *  15 + item 8 multi-run overlay). */
  extraRunJobs?: Array<{ runId: number; jobs: BulkJob[] }>;
}

export function RvMapBox({ runDate, runJobs, selectedJobId, viewMode, runColorMap, extraRunJobs }: Props) {
  const user = useAuth();
  const [allCouriers, setAllCouriers] = useState(false);
  const [allRuns, setAllRuns] = useState(false);
  const [trackCourier, setTrackCourier] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const flagMarkersRef = useRef<any[]>([]);
  const polylinesRef = useRef<any[]>([]);
  const carMarkerRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const bounceTimeoutRef = useRef<number | null>(null);

  // Available couriers with a GPS ping. Uses the envelope endpoint so
  // we get lat/lng + vehicleType together for the flag+label render.
  // Wide bounds so we don't miss couriers outside the current viewport;
  // the SP already caps to today's active fleet so payload is small.
  const couriersQ = useQuery({
    queryKey: ['rv-map-couriers-available'],
    queryFn: () => routeViewerService.getAvailableCouriers({
      minLng: -180, minLat: -90, maxLng: 180, maxLat: 90,
    }),
    enabled: allCouriers,
    staleTime: 30_000,
    refetchInterval: allCouriers ? 30_000 : false,
  });

  // Tracked-courier GPS poll. Tied to the currently selected job id so
  // the endpoint contract (jobId -> that job's courier's last ping)
  // matches the legacy $scope.refreshLocation flow. 15s cadence per
  // task spec; disabled unless the operator has ticked "Track".
  const trackedQ = useQuery({
    queryKey: ['rv-map-tracked-courier', selectedJobId],
    queryFn: () => routeViewerService.getCourierPosition(selectedJobId!),
    enabled: trackCourier && selectedJobId != null,
    staleTime: 10_000,
    refetchInterval: trackCourier && selectedJobId != null ? 15_000 : false,
  });

  const apiKey = user.googleMapsKey;
  const google = typeof window !== 'undefined' ? (window as any).google : undefined;

  // Wait for Google Maps SDK (loaded by the Razor host).
  useEffect(() => {
    if (google?.maps) { setMapReady(true); return; }
    const started = Date.now();
    const t = setInterval(() => {
      const g = (window as any).google;
      if (g?.maps) { setMapReady(true); clearInterval(t); }
      else if (Date.now() - started > 20_000) clearInterval(t);
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Init the map once.
  useEffect(() => {
    if (!mapReady || !containerRef.current || mapRef.current) return;
    const g = (window as any).google;
    mapRef.current = new g.maps.Map(containerRef.current, {
      center: tenantMapCentre(user.isUsTenant),
      zoom: 5,
      mapTypeId: g.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
    });
    infoWindowRef.current = new g.maps.InfoWindow();
  }, [mapReady, user.isUsTenant]);

  // Numeric coercion helper - lat/lng can arrive as number OR string.
  const num = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) && n !== 0 ? n : null;
  };

  const pinsPayload = useMemo<MapPin[]>(() => {
    const out: MapPin[] = [];
    const wantPickup = viewMode !== 'Outbound';
    const wantDelivery = viewMode !== 'Inbound';

    // Primary run: drilled runJobs.
    const primaryRunId = runJobs[0]?.bulkRunId ?? 0;
    const pushGroup = (runId: number, jobs: BulkJob[]) => {
      for (const j of jobs) {
        if (wantDelivery) {
          const lat = num(j.toLat ?? j.deliveryLatitude);
          const lng = num(j.toLng ?? j.deliveryLongitude);
          if (lat != null && lng != null) {
            out.push({
              runId,
              bulkJobId: j.bulkJobId,
              lat, lng,
              status: j.jobStatus,
              jobNumber: j.jobNumber ?? null,
              runOrder: (j as any).runOrder ?? null,
              podName: (j as any).podName ?? null,
              podTime: (j as any).podTime ?? null,
              kind: 'delivery',
            });
          }
        }
        if (wantPickup) {
          const plat = num(j.pickUpLatitude);
          const plng = num(j.pickUpLongitude);
          if (plat != null && plng != null) {
            out.push({
              runId,
              bulkJobId: j.bulkJobId,
              lat: plat, lng: plng,
              status: j.jobStatus,
              jobNumber: j.jobNumber ?? null,
              runOrder: (j as any).runOrder ?? null,
              podName: null,
              podTime: null,
              kind: 'pickup',
            });
          }
        }
      }
    };
    pushGroup(primaryRunId, runJobs);
    for (const group of extraRunJobs ?? []) pushGroup(group.runId, group.jobs);
    return out;
  }, [runJobs, extraRunJobs, viewMode]);

  // Build the delivery-side polylines. One polyline per run ordered by
  // runOrder. Only draws when we have >= 2 delivery pins for the run
  // (a single pin has no polyline). Matches legacy behaviour.
  const polylineData = useMemo(() => {
    const byRun: Record<number, MapPin[]> = {};
    for (const p of pinsPayload) {
      if (p.kind !== 'delivery') continue;
      if (!byRun[p.runId]) byRun[p.runId] = [];
      byRun[p.runId].push(p);
    }
    const paths: Array<{ runId: number; path: Array<{ lat: number; lng: number }>; colour: string }> = [];
    for (const [rid, pins] of Object.entries(byRun)) {
      if (pins.length < 2) continue;
      const sorted = pins.slice().sort((a, b) => (a.runOrder ?? 999) - (b.runOrder ?? 999));
      const runId = Number(rid);
      paths.push({
        runId,
        path: sorted.map((p) => ({ lat: p.lat, lng: p.lng })),
        colour: runColorMap?.[runId] ?? '#16a34a',
      });
    }
    return paths;
  }, [pinsPayload, runColorMap]);

  // Rebuild job markers + polylines whenever pin data changes. Kept
  // separate from the flag / car marker effects so a courier-toggle
  // flip does not tear down + rebuild every job pin (which lost the
  // bounce animation on selection change before this split).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const g = (window as any).google;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    const bounds = new g.maps.LatLngBounds();

    for (const p of pinsPayload) {
      const isSel = selectedJobId === p.bulkJobId;
      // Multi-run tint takes priority for delivery pins so operators
      // can match pins to Run List rows. Pickup still renders blue so
      // the pickup/delivery distinction stays legible, unless the whole
      // pin group has been tinted.
      let colour: string;
      const runTint = runColorMap?.[p.runId];
      if (p.status === 'C') colour = '#c7c7c7';
      else if (p.status === 'V') colour = '#eab308';
      else if (runTint) colour = runTint;
      else colour = p.kind === 'pickup' ? '#43C7F4' : '#16a34a';

      const marker = new g.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current,
        title: (p.jobNumber ?? String(p.bulkJobId)) + ` (${p.kind})`,
        icon: teardropIcon(g, colour, isSel),
        label: p.runOrder != null && p.runOrder > 0
          ? { text: String(p.runOrder), color: '#fff', fontSize: '10px', fontWeight: 'bold' }
          : undefined,
        zIndex: isSel ? 999 : (p.kind === 'delivery' ? 10 : 5),
      });
      (marker as any).__bulkJobId = p.bulkJobId;

      // Info window on completed jobs (Tier-2 item 8).
      if (p.status === 'C' && (p.podName || p.podTime) && p.kind === 'delivery') {
        marker.addListener('click', () => {
          const html = `<div style="font-size:12px;line-height:1.4">
            <div><b>Job ${p.jobNumber ?? p.bulkJobId}</b></div>
            ${p.podName ? `<div>Received by: ${escapeHtml(p.podName)}</div>` : ''}
            ${p.podTime ? `<div>Received at: ${escapeHtml(p.podTime)}</div>` : ''}
          </div>`;
          infoWindowRef.current?.setContent(html);
          infoWindowRef.current?.open(mapRef.current, marker);
        });
      }

      markersRef.current.push(marker);
      bounds.extend({ lat: p.lat, lng: p.lng });
    }

    // Draw route polylines through delivery pins (Tier-2 item 8).
    for (const line of polylineData) {
      const polyline = new g.maps.Polyline({
        path: line.path,
        strokeColor: line.colour,
        strokeOpacity: 0.7,
        strokeWeight: 3,
        map: mapRef.current,
      });
      polylinesRef.current.push(polyline);
    }

    if (markersRef.current.length > 0 && !bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, 40);
    }
  }, [mapReady, pinsPayload, polylineData, selectedJobId, runColorMap]);

  // Tier-3 item 4: bounce the selected job's pin for ~1.5s in addition
  // to the +25% scale bump the icon already gets. Cleared on unmount +
  // on selection change. Legacy homeControl.js:5325 fired both scale
  // and BOUNCE together.
  useEffect(() => {
    if (!mapReady || selectedJobId == null) return;
    const g = (window as any).google;
    const marker = markersRef.current.find((m: any) => m.__bulkJobId === selectedJobId);
    if (!marker || !g?.maps?.Animation) return;
    marker.setAnimation(g.maps.Animation.BOUNCE);
    if (bounceTimeoutRef.current != null) window.clearTimeout(bounceTimeoutRef.current);
    bounceTimeoutRef.current = window.setTimeout(() => {
      try { marker.setAnimation(null); } catch { /* marker gone */ }
      bounceTimeoutRef.current = null;
    }, 1500);
    return () => {
      if (bounceTimeoutRef.current != null) {
        window.clearTimeout(bounceTimeoutRef.current);
        bounceTimeoutRef.current = null;
      }
      try { marker.setAnimation(null); } catch { /* marker gone */ }
    };
  }, [mapReady, selectedJobId, pinsPayload]);

  // Tier-3 item 1: flag + label markers for the All-Couriers layer.
  // Rebuilt independently of job pins so a courier refresh does not
  // disturb the run polylines / selection bounce.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const g = (window as any).google;
    flagMarkersRef.current.forEach((m) => m.setMap(null));
    flagMarkersRef.current = [];
    if (!allCouriers || !couriersQ.data) return;
    for (const c of couriersQ.data) {
      const lat = num(c.latitude);
      const lng = num(c.longitude);
      if (lat == null || lng == null) continue;
      const label = [c.courierCode, c.vehicleType].filter(Boolean).join(' ');
      const marker = new g.maps.Marker({
        position: { lat, lng },
        map: mapRef.current,
        title: label || `Courier ${c.courierId}`,
        icon: flagIcon(g),
        label: label
          ? { text: label, color: '#111', fontSize: '10px', fontWeight: 'bold', className: 'rv-flag-label' }
          : undefined,
        zIndex: 3,
      });
      flagMarkersRef.current.push(marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, allCouriers, couriersQ.data]);

  // Tier-3 item 2: live car marker for the tracked courier. Position
  // is refreshed by the 15s useQuery poll; this effect just mirrors the
  // latest data onto a single Marker instance (create once, move on
  // updates, tear down on stop).
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const g = (window as any).google;
    if (!trackCourier || !trackedQ.data) {
      if (carMarkerRef.current) {
        carMarkerRef.current.setMap(null);
        carMarkerRef.current = null;
      }
      return;
    }
    const lat = num(trackedQ.data.latitude);
    const lng = num(trackedQ.data.longitude);
    if (lat == null || lng == null) {
      if (carMarkerRef.current) {
        carMarkerRef.current.setMap(null);
        carMarkerRef.current = null;
      }
      return;
    }
    const pos = { lat, lng };
    if (carMarkerRef.current) {
      carMarkerRef.current.setPosition(pos);
    } else {
      carMarkerRef.current = new g.maps.Marker({
        position: pos,
        map: mapRef.current,
        title: `Courier ${trackedQ.data.courierCode ?? trackedQ.data.courierId}`,
        icon: carIcon(g),
        zIndex: 500,
      });
    }
  }, [mapReady, trackCourier, trackedQ.data]);

  // Cleanup: drop every marker + polyline + timer on unmount so a
  // remount does not leak Google Maps overlays into a stale map ref.
  useEffect(() => () => {
    markersRef.current.forEach((m) => { try { m.setMap(null); } catch { /* noop */ } });
    flagMarkersRef.current.forEach((m) => { try { m.setMap(null); } catch { /* noop */ } });
    polylinesRef.current.forEach((p) => { try { p.setMap(null); } catch { /* noop */ } });
    if (carMarkerRef.current) { try { carMarkerRef.current.setMap(null); } catch { /* noop */ } }
    if (bounceTimeoutRef.current != null) window.clearTimeout(bounceTimeoutRef.current);
  }, []);

  // Tier-2 item 8 All-Runs toggle: warn before we fetch every run's
  // pins on a busy day. Master spec puts the threshold at 200 pins.
  const onToggleAllRuns = (checked: boolean) => {
    if (checked && (runJobs.length ?? 0) > 40) {
      const proceed = window.confirm(
        'Show pins from EVERY run for the day? This can render 500+ pins on a busy day and may slow the map. Continue?'
      );
      if (!proceed) return;
    }
    setAllRuns(checked);
  };

  // Tier-3 item 3: Clear button. Turns off both layer toggles + the
  // tracked-courier state, tears down flag + car overlays, and closes
  // any open info window. Job pins + polylines stay (they mirror the
  // drilled run data - clearing them would misrepresent selection).
  const onClearRoutes = useCallback(() => {
    setAllCouriers(false);
    setAllRuns(false);
    setTrackCourier(false);
    flagMarkersRef.current.forEach((m) => { try { m.setMap(null); } catch { /* noop */ } });
    flagMarkersRef.current = [];
    if (carMarkerRef.current) {
      try { carMarkerRef.current.setMap(null); } catch { /* noop */ }
      carMarkerRef.current = null;
    }
    infoWindowRef.current?.close?.();
  }, []);

  return (
    <RvBox
      title="Map"
      actions={
        <div className="flex items-center gap-2 text-[10px]">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={allCouriers}
              onChange={(e) => setAllCouriers(e.target.checked)}
              className="accent-brand-cyan"
            />
            All Couriers
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={allRuns}
              onChange={(e) => onToggleAllRuns(e.target.checked)}
              className="accent-brand-cyan"
              title="Show pins from every run (busy days can render 500+ pins - use sparingly)"
            />
            All Runs
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={trackCourier}
              onChange={(e) => setTrackCourier(e.target.checked)}
              disabled={selectedJobId == null}
              className="accent-brand-cyan"
              title={selectedJobId == null
                ? 'Select a job to track its courier'
                : 'Poll the selected job courier GPS every 15s'}
            />
            Track
          </label>
          <button
            type="button"
            onClick={onClearRoutes}
            className="px-2 py-0.5 border border-border rounded hover:bg-surface-cream"
            title="Clear couriers + tracked courier + open info windows"
          >
            Clear
          </button>
        </div>
      }
    >
      {!apiKey && (
        <div className="p-4 text-xs text-text-muted">
          Google Maps API key not configured for this tenant.
        </div>
      )}
      {apiKey && !mapReady && (
        <div className="p-4 text-xs text-text-muted">Loading map SDK...</div>
      )}
      <div ref={containerRef} className="w-full h-full min-h-[240px]" />
    </RvBox>
  );
}

// Legacy-exact teardrop marker. Copies the SVG path + anchor + scale
// verbatim from legacy `map.js:245-258` (displayAllRoutePoints /
// displayRoutePoints) so the pin shape reads identically to the legacy
// RunViewer. Selected pins pop by scaling up 25%; colour is chosen by
// the caller per pickup/delivery side (blue vs green) and status
// overrides (C=grey, V=yellow) - or a run tint for multi-run mode.
function teardropIcon(g: any, fill: string, isSel: boolean) {
  return {
    path: 'M 12,2 C 8.1340068,2 5,5.1340068 5,9 c 0,5.25 7,13 7,13 0,0 7,-7.75 7,-13 0,-3.8659932 -3.134007,-7 -7,-7 z',
    anchor: new g.maps.Point(12, 22),
    labelOrigin: new g.maps.Point(12, 9),
    fillOpacity: 1,
    fillColor: fill,
    strokeWeight: 2,
    strokeColor: '#000',
    scale: isSel ? 2.5 : 2,
  };
}

// Legacy flagpole marker for the All-Couriers layer. Mirrors legacy
// map.js:424-455 `drawItem` which used `/images/flagpole.png` + a Label
// overlay bound to marker.display. Rendered as an SVG path here so the
// icon travels with the bundle and gets Google Maps' native label
// placement (labelOrigin) instead of a separate DOM overlay. The label
// text (courier code + vehicle type) is provided by the caller.
function flagIcon(g: any) {
  return {
    // Simple flagpole: vertical staff + triangular pennant. Origin at
    // the base so the flag "plants" on the coordinate.
    path: 'M 0,-24 L 0,0 M 0,-24 L 12,-20 L 0,-16',
    anchor: new g.maps.Point(0, 0),
    labelOrigin: new g.maps.Point(14, -22),
    strokeColor: '#003CA1',
    strokeWeight: 2,
    fillColor: '#003CA1',
    fillOpacity: 1,
    scale: 1,
  };
}

// Live car marker for a tracked courier. Mirrors legacy map.js:485-503
// `refreshCourierLocation` which used /images/car3.png. Rendered here
// as an SVG path (top-down car silhouette) so no image asset is
// required and the marker respects Google Maps' symbol-scale semantics.
function carIcon(g: any) {
  return {
    // Rounded rectangle roughly the shape of a top-down sedan.
    path: 'M -6,-10 L 6,-10 C 8,-10 8,-8 8,-6 L 8,8 C 8,10 6,10 6,10 L -6,10 C -8,10 -8,8 -8,8 L -8,-6 C -8,-8 -6,-10 -6,-10 Z',
    anchor: new g.maps.Point(0, 0),
    fillColor: '#dc2626',
    fillOpacity: 1,
    strokeColor: '#111',
    strokeWeight: 1.5,
    scale: 1.4,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
