import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { tenantMapCentre } from '../../lib/mapDefaults';
import { routeViewerService, type BulkJob } from '../../services/routeViewerService';
import { RvBox } from './RvBox';

// Route Viewer map surface (master Section 7.12). Renders pins for:
//   - the currently drilled run (delivery pins in green, pickup blue,
//     completed grey, voided yellow - taxonomy already added to
//     GoogleMap.tsx palette in P8)
//   - available couriers if "All Couriers" is ticked (fetched via
//     GET /api/runviewer/couriers?runDate=)
//   - every run's pins if "All Runs" is ticked (currently disabled
//     without a confirm gate - Section 7.12 note: this can push 500+
//     pins on a busy day, so a confirm dialog is called for; ticked
//     stub for now)
//
// Wraps its own Google Maps map rather than reusing the Route Builder's
// GoogleMap.tsx because that component is deeply coupled to the
// cockpit's Run / RunJob shape. Route Viewer's BulkJob shape is
// different; a shared abstraction would be over-engineered for two
// callers.

interface Props {
  runDate: string;
  runJobs: BulkJob[];        // currently drilled run's jobs
  selectedJobId: number | null;
  /** Same viewMode that drives the Run List. Controls which side(s) of
   *  each job produce a pin: Combined = both, Inbound = pickup only,
   *  Outbound = delivery only. Matches legacy homeControl.js updateRun
   *  logic (lines ~1316-1340). */
  viewMode: 'Combined' | 'Inbound' | 'Outbound';
}

export function RvMapBox({ runDate, runJobs, selectedJobId, viewMode }: Props) {
  const user = useAuth();
  const [allCouriers, setAllCouriers] = useState(false);
  const [allRuns, setAllRuns] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const couriersQ = useQuery({
    queryKey: ['rv-map-couriers', runDate],
    queryFn: () => routeViewerService.getActiveCouriers(runDate),
    enabled: allCouriers && !!runDate,
    staleTime: 30_000,
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
  }, [mapReady, user.isUsTenant]);

  // Numeric coercion helper - lat/lng can arrive as number OR string
  // depending on which SP populated the payload (RVW_stpBulkRunJobs
  // emits float, RVW_stpBulkJob also float; but the wider BulkJob
  // interface tolerates strings from historic wire shapes).
  const num = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) && n !== 0 ? n : null;
  };

  const pinsPayload = useMemo(() => {
    const out: Array<{ bulkJobId: number; lat: number; lng: number; status: string | null; title: string; kind: 'pickup' | 'delivery' }> = [];
    // Per legacy homeControl.js updateRun (lines ~1316-1340): every job
    // on the currently drilled run contributes 1-2 pins depending on
    // viewMode. Combined = pickup + delivery for each job. Inbound =
    // pickup only. Outbound = delivery only. The pin colour is chosen
    // downstream by side (kind) with status overrides.
    const wantPickup = viewMode !== 'Outbound';
    const wantDelivery = viewMode !== 'Inbound';
    for (const j of runJobs) {
      if (wantDelivery) {
        const lat = num(j.toLat ?? j.deliveryLatitude);
        const lng = num(j.toLng ?? j.deliveryLongitude);
        if (lat != null && lng != null) {
          out.push({
            bulkJobId: j.bulkJobId,
            lat, lng,
            status: j.jobStatus,
            title: (j.jobNumber ?? String(j.bulkJobId)) + ' (delivery)',
            kind: 'delivery',
          });
        }
      }
      if (wantPickup) {
        const plat = num(j.pickUpLatitude);
        const plng = num(j.pickUpLongitude);
        if (plat != null && plng != null) {
          out.push({
            bulkJobId: j.bulkJobId,
            lat: plat, lng: plng,
            status: j.jobStatus,
            title: (j.jobNumber ?? String(j.bulkJobId)) + ' (pickup)',
            kind: 'pickup',
          });
        }
      }
    }
    return out;
  }, [runJobs, viewMode]);

  // Rebuild markers whenever pin data or courier toggle changes.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const g = (window as any).google;
    // Tear down previous markers.
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const bounds = new g.maps.LatLngBounds();

    for (const p of pinsPayload) {
      const isSel = selectedJobId === p.bulkJobId;
      // Pickup pins render blue (matches legacy "up arrow blue"), delivery
      // pins green (matches legacy "down arrow green"). Completed / voided
      // jobs muted regardless of side. Selection is signalled by the
      // scaled-up pin size only - do NOT recolour, or the pickup + delivery
      // pair for the selected job collapses to the same orange dot and
      // operators lose the pickup/delivery distinction. Colour palette
      // matches GoogleMap.tsx makeIcon() so pins across both map components
      // are visually consistent.
      const colour = p.status === 'C' ? '#c7c7c7'
        : p.status === 'V' ? '#eab308'
        : p.kind === 'pickup' ? '#43C7F4'
        : '#16a34a';
      const marker = new g.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current,
        title: p.title,
        icon: teardropIcon(g, colour, isSel),
      });
      markersRef.current.push(marker);
      bounds.extend({ lat: p.lat, lng: p.lng });
    }

    if (allCouriers && couriersQ.data) {
      for (const c of couriersQ.data as Array<{ courierId: number; code: string; name: string; lat?: number; lng?: number }>) {
        if (c.lat == null || c.lng == null) continue;
        const marker = new g.maps.Marker({
          position: { lat: c.lat, lng: c.lng },
          map: mapRef.current,
          title: `${c.name} (${c.code})`,
          icon: teardropIcon(g, '#7c3aed', false),
        });
        markersRef.current.push(marker);
        bounds.extend({ lat: c.lat, lng: c.lng });
      }
    }

    if (markersRef.current.length > 0 && !bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds, 40);
    }
  }, [mapReady, pinsPayload, selectedJobId, allCouriers, couriersQ.data]);

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
              onChange={(e) => setAllRuns(e.target.checked)}
              className="accent-brand-cyan"
              title="Show pins from every run (busy days can render 500+ pins - use sparingly)"
            />
            All Runs
          </label>
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
// RunViewer. Using the `path:` Symbol approach (rather than a data-URL
// SVG) lets Google Maps render the pin at native resolution with no
// clipping and no scaledSize rounding artifacts. Selected pins pop by
// scaling up 25%; colour is chosen by the caller per pickup/delivery
// side (blue vs green) and status overrides (C=grey, V=yellow).
function teardropIcon(g: any, fill: string, isSel: boolean) {
  return {
    path: 'M 12,2 C 8.1340068,2 5,5.1340068 5,9 c 0,5.25 7,13 7,13 0,0 7,-7.75 7,-13 0,-3.8659932 -3.134007,-7 -7,-7 z',
    anchor: new g.maps.Point(12, 22),
    fillOpacity: 1,
    fillColor: fill,
    strokeWeight: 2,
    strokeColor: '#000',
    scale: isSel ? 2.5 : 2,
  };
}
