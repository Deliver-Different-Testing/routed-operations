import { useEffect, useMemo, useRef, useState } from 'react';
import { type BulkPolygon, type PolygonPoint } from '../../services/bulkPolygonService';
import { tenantMapCentre } from '../../lib/mapDefaults';

interface LatLng { lat: number; lng: number; }

interface Props {
  polygons: BulkPolygon[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  isUsTenant: boolean;
  googleMapsKey: string | null;
}

/**
 * Read-only Google Map for the Schedule modal's Coverage Polygons
 * section. Mirrors the pattern used by the Recurring Routes edit map
 * (`RouteCoverageMap` in ScheduledRoutes.tsx):
 *
 *   * BOUND polygons render orange filled + non-clickable. Removal is
 *     exclusively via the × on the sidebar chip; a click on the shape
 *     never silently drops coverage (2026-08-06 rule, George).
 *   * UNBOUND polygons render blue outlined + clickable. Click BINDS
 *     the polygon to the schedule.
 *   * Auto-fit happens ONCE on the first render that has any bound
 *     shapes. Subsequent toggles keep the operator's viewport steady.
 *
 * Drawing / vertex editing lives in Polygon Builder, not here.
 */
export function ScheduleCoverageMap({
  polygons, selectedIds, onToggle, isUsTenant, googleMapsKey,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<Map<number, any>>(new Map());
  const didInitialFitRef = useRef<boolean>(false);
  const [ready, setReady] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Refs mirror props so map-listener closures see current state without
  // needing to re-attach every render.
  const selectedRef = useRef(selectedSet);
  selectedRef.current = selectedSet;
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  // ─── Wait for the Google Maps script (loaded by the Razor host). ────
  useEffect(() => {
    if (!googleMapsKey) return;
    if ((window as any).google?.maps) { setReady(true); return; }
    const started = Date.now();
    const t = setInterval(() => {
      if ((window as any).google?.maps) { setReady(true); clearInterval(t); }
      else if (Date.now() - started > 20000) clearInterval(t);
    }, 200);
    return () => clearInterval(t);
  }, [googleMapsKey]);

  // ─── Initialise the map. ────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return;
    const g = (window as any).google;
    const map = new g.maps.Map(containerRef.current, {
      center: tenantMapCentre(isUsTenant),
      zoom: 10,
      mapTypeId: g.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
      clickableIcons: false,
    });
    mapRef.current = map;
    // Google Maps defers tile fetch when the container is not on screen
    // at construction time (perf optimisation added 2024). The modal's
    // Coverage Polygons section sits below the fold on open, so the map
    // renders as an empty div. Force a resize + re-centre the moment
    // the container enters the viewport. Same guard applies whenever the
    // operator collapses / re-opens the modal.
    const centre = map.getCenter();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          g.maps.event.trigger(map, 'resize');
          if (centre) map.setCenter(centre);
        }
      }
    }, { threshold: 0.1 });
    io.observe(containerRef.current);
    (mapRef.current as any).__scheduleMapObserver = io;
    return () => {
      overlaysRef.current.forEach((p) => p.setMap(null));
      overlaysRef.current.clear();
      const io = (mapRef.current as any)?.__scheduleMapObserver as IntersectionObserver | undefined;
      io?.disconnect();
      mapRef.current = null;
      didInitialFitRef.current = false;
    };
  }, [ready, isUsTenant]);

  // ─── Sync polygon overlays. ─────────────────────────────────────────
  useEffect(() => {
    const g = (window as any).google;
    if (!ready || !mapRef.current || !g?.maps) return;

    const wanted = new Set(polygons.map((p) => p.polygonId));
    overlaysRef.current.forEach((poly, id) => {
      if (!wanted.has(id)) { poly.setMap(null); overlaysRef.current.delete(id); }
    });

    polygons.forEach((poly) => {
      const rings = pointsToLatLngRings(poly.points).filter((r) => r.length >= 3);
      if (rings.length === 0) return;
      const bound = selectedSet.has(poly.polygonId);
      // Colour convention matches RouteCoverageMap in ScheduledRoutes.tsx:
      // bound = orange filled, unbound = light-blue outlined ghost. Same
      // two-tone read across both surfaces.
      const opts = bound
        ? {
          strokeColor: '#f2994a', strokeOpacity: 0.9, strokeWeight: 2,
          fillColor: '#f2994a', fillOpacity: 0.28,
          clickable: false, zIndex: 3,
        }
        : {
          strokeColor: '#00A3FF', strokeOpacity: 0.9, strokeWeight: 1.5,
          fillColor: '#00A3FF', fillOpacity: 0.08,
          clickable: true, zIndex: 1,
        };
      let overlay = overlaysRef.current.get(poly.polygonId);
      if (!overlay) {
        overlay = new g.maps.Polygon({ paths: rings, map: mapRef.current, ...opts });
        overlay.addListener('click', () => {
          // Only unbound polygons are clickable; the click BINDS. Bound
          // polygons are non-clickable so an accidental pan-click can't
          // silently detach coverage (mirrors RouteCoverageMap's rule).
          if (selectedRef.current.has(poly.polygonId)) return;
          onToggleRef.current(poly.polygonId);
        });
        overlaysRef.current.set(poly.polygonId, overlay);
      } else {
        overlay.setPaths(rings);
        overlay.setOptions(opts);
      }
    });
  }, [polygons, selectedSet, ready]);

  // ─── Auto-fit ONCE on the first render that has any bound shapes. ───
  //     Subsequent toggles don't re-centre; if the operator has panned
  //     to a specific area, we don't yank the viewport out from under them.
  useEffect(() => {
    const g = (window as any).google;
    if (!ready || !mapRef.current || !g?.maps) return;
    if (didInitialFitRef.current) return;
    if (selectedIds.length === 0) return;
    const bounds = new g.maps.LatLngBounds();
    let count = 0;
    for (const id of selectedIds) {
      const poly = polygons.find((p) => p.polygonId === id);
      if (!poly) continue;
      for (const p of poly.points) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          bounds.extend(new g.maps.LatLng(p.lat, p.lng));
          count++;
        }
      }
    }
    if (count > 0) {
      mapRef.current.fitBounds(bounds, 40);
      didInitialFitRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedIds.join(','), polygons.length]);

  if (!googleMapsKey) {
    return (
      <div className="p-3 text-[11px] text-text-muted italic border border-border rounded-lg">
        Google Maps API key is not set (GoogleMapsKey env var).
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-1.5 bg-surface-cream border-b border-border text-[11px] text-text-muted">
        Orange = bound. Blue = available. Click a blue polygon to bind. Remove is via the ×
        on the checkbox list. Draw or edit polygons in Polygon Builder.
      </div>
      <div ref={containerRef} className="w-full bg-surface-cream" style={{ height: '360px' }} />
    </div>
  );
}

// ─── local helpers ─────────────────────────────────────────────────────

function pointsToLatLngRings(points: PolygonPoint[]): LatLng[][] {
  const byRing = new Map<number, PolygonPoint[]>();
  for (const p of points) {
    const ri = p.ringIndex ?? 0;
    const list = byRing.get(ri);
    if (list) list.push(p); else byRing.set(ri, [p]);
  }
  return [...byRing.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, pts]) =>
      pts.slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((p) => ({ lat: p.lat, lng: p.lng })),
    );
}
