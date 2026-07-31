import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { tenantMapCentre } from '../lib/mapDefaults';
import { postcodeLabel } from '../lib/tenantLabels';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import {
  recurringRouteService,
  type ZipcodeLookup,
  type ZipPolygonShape,
  type ScheduleLookup,
  type AssignableTargets,
  type AssignableTarget,
} from '../services/recurringRouteService';
import {
  bulkPolygonService,
  type BulkPolygon,
  type PolygonPoint,
} from '../services/bulkPolygonService';
import { MarkerClusterer, SuperClusterAlgorithm, type Renderer } from '@googlemaps/markerclusterer';

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const POLYGON_PALETTE = ['#f2994a', '#3bc7f4', '#606db4', '#10b981', '#ef4444', '#8b5cf6', '#eab308'];
const SNAP_PIXELS = 14;
/** Target max vertex count when converting a raw ZIP polygon to editable
 *  coverage. Real coastline ZIPs can have 1000+ vertices which freezes the
 *  browser when we render one draggable Marker per vertex + midpoint. 120
 *  keeps the shape recognisable while staying under the Google Maps handle
 *  budget. */
const ZIP_TO_COVERAGE_MAX_VERTICES = 120;
/** Absolute cap on how many vertices we'll render draggable handles for.
 *  Above this, edit mode shows a "Simplify shape" prompt instead of handles
 *  to protect the browser. */
const MAX_EDIT_HANDLE_VERTICES = 200;
/** Zoom threshold at which we render INDIVIDUAL zip pills. Below this,
 *  MarkerClusterer collapses them into count bubbles so the operator
 *  always sees "how many zips are here" even at continental zoom. */
const INDIVIDUAL_PILL_MIN_ZOOM = 10;
/** Debounce for viewport marker sync on bounds_changed. Google Maps fires
 *  this event continuously during pan; 300ms feels responsive without
 *  churning marker objects. */
const VIEWPORT_SYNC_DEBOUNCE_MS = 300;
/** Hard cap on how many centroid markers we hand to the clusterer per
 *  viewport. Guards very-low-zoom "whole tenant" views where the viewport
 *  contains 33k+ centroids - the clusterer itself is fast (supercluster
 *  spatial index) but Marker construction is not. Cluster count still
 *  reflects the ACTUAL viewport population separately. */
const MAX_VIEWPORT_MARKERS = 2000;

type Mode = 'view' | 'drawing' | 'lassoing' | 'rectangling' | 'circling' | 'pending' | { edit: number };
/** Vertex count used to approximate a drawn circle as a polygon. 32 is
 *  smooth enough to read as a circle at typical dispatch zoom levels. */
const CIRCLE_APPROX_SIDES = 32;
interface LatLng { lat: number; lng: number; }

/** Right-click context menu state. Rendered at (screenX, screenY) with
 *  actions specific to what was right-clicked (a zip centroid, a loaded
 *  boundary, a coverage polygon, or the map background). */
type ContextMenuTarget =
  | { kind: 'zipCentroid'; zip: ZipcodeLookup }
  | { kind: 'zipShape'; shape: ZipPolygonShape }
  | { kind: 'polygon'; polygon: BulkPolygon }
  | { kind: 'mapBackground'; };
interface ContextMenuState {
  x: number;
  y: number;
  target: ContextMenuTarget;
}

/**
 * Polygon Builder page (Stage 3 - bulk polygon storage + zip-to-coverage flow).
 *
 * TWO features share the same map:
 *   1. Zip picker (existing) - search a real ZipPolygon row, load its
 *      shape, click to select. Save-as-route writes a Route + RouteZipcodes
 *      entry via the shipped recurring-route API. Source ZIP data is
 *      READ-ONLY per Steve's spec KEVIN-ZIP-POLYGON-TO-CUSTOM-COVERAGE-FLOW.
 *   2. Bulk coverage polygon (Stage 3) - operator draws or "converts" a
 *      loaded ZIP shape into an editable operational-coverage polygon
 *      stored in tblBulkRunPolygon + tblBulkRunPolygonPoint. Attaches to
 *      Routes via a M:N junction and participates in the prebook
 *      auto-assign geometry fallback.
 *
 * The "Use as starting shape" button on each selected zip is the one-click
 * conversion Steve wants: it copies the loaded ZIP's vertices into a new
 * bulk polygon (sourceType=1, sourceCode=zip) then auto-enters edit mode
 * so the operator can trim / extend the shape for real-world dispatch
 * without ever mutating the ZIP source table.
 */
export default function PolygonBuilder() {
  const user = useAuth();
  const toast = useToast();
  const zipShortLower = postcodeLabel(user.isUsTenant, true).toLowerCase();
  const zipLongLower = postcodeLabel(user.isUsTenant, false).toLowerCase();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const zipOverlaysRef = useRef<Map<number, any>>(new Map());
  const polygonOverlaysRef = useRef<Map<number, any>>(new Map());
  const drawPreviewPolyRef = useRef<any>(null);
  const drawPreviewMarkersRef = useRef<any[]>([]);
  const editHandlesRef = useRef<any[]>([]);
  const editMidpointsRef = useRef<any[]>([]);
  const editPolyRef = useRef<any>(null);
  const snapHintRef = useRef<any>(null);
  const projectionHelperRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Zip picker state.
  const [loadedShapes, setLoadedShapes] = useState<ZipPolygonShape[]>([]);
  const [selected, setSelected] = useState<ZipcodeLookup[]>([]);
  const [zipSearch, setZipSearch] = useState('');
  const [zipResults, setZipResults] = useState<ZipcodeLookup[]>([]);

  // Bulk polygon state (Stage 3).
  const [polygons, setPolygons] = useState<BulkPolygon[]>([]);
  const [mode, setMode] = useState<Mode>('view');
  const [drawingVertices, setDrawingVertices] = useState<LatLng[]>([]);
  const [selectedPolygons, setSelectedPolygons] = useState<Set<number>>(new Set());

  const [zipSaveOpen, setZipSaveOpen] = useState(false);
  const [polygonSaveOpen, setPolygonSaveOpen] = useState(false);

  // Draft polygon awaiting operator review before save. When drawing
  // finishes (mouseup / auto-close / +Finish), points land here and mode
  // switches to 'pending' - the polygon becomes editable in place. The
  // save-name modal only opens when the operator explicitly clicks
  // "Finish drawing" (which sets openSaveModal true).
  const [pendingPolygon, setPendingPolygon] = useState<LatLng[] | null>(null);
  const [openSaveModal, setOpenSaveModal] = useState(false);
  // Refs for the pending-polygon editable overlay + handles (parallel set
  // to the edit-mode refs above so pending edits don't interfere with a
  // concurrent saved-polygon edit).
  const pendingPolyRef = useRef<any>(null);
  const pendingHandlesRef = useRef<any[]>([]);
  const pendingMidpointsRef = useRef<any[]>([]);
  // ZIP-to-coverage conversion in progress (source zip we seeded from).
  const [converting, setConverting] = useState<ZipcodeLookup | null>(null);

  // Stage 4: cached full-tenant zip centroid list. Fetched once on mount,
  // used to drive the viewport marker layer. Ref (not state) because we
  // don't need re-renders on the cache itself - marker sync reads from it
  // directly during bounds_changed.
  const zipCentroidsRef = useRef<ZipcodeLookup[]>([]);
  const [zipCentroidsReady, setZipCentroidsReady] = useState(false);
  const centroidMarkersRef = useRef<Map<number, any>>(new Map());
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const [visibleCentroidCount, setVisibleCentroidCount] = useState(0);
  const [currentZoom, setCurrentZoom] = useState(11);

  // Stage 4: right-click context menu (see ContextMenuState type).
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Stage 4: freehand lasso in-progress buffer + live polyline ref.
  const lassoBufferRef = useRef<LatLng[]>([]);
  const lassoPreviewRef = useRef<any>(null);
  const lassoRafRef = useRef<number | null>(null);
  // Rectangle drawing in-progress refs.
  const rectStartRef = useRef<LatLng | null>(null);
  const rectPreviewRef = useRef<any>(null);
  // Circle drawing in-progress refs (radius stored in degrees, cheap flat approx).
  const circleCentreRef = useRef<LatLng | null>(null);
  const circlePreviewRef = useRef<any>(null);

  const apiKey = user.googleMapsKey;
  const google = typeof window !== 'undefined' ? (window as any).google : undefined;

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

  useEffect(() => {
    if (!ready || !mapContainerRef.current || mapRef.current) return;
    const g = (window as any).google;
    const map = new g.maps.Map(mapContainerRef.current, {
      center: tenantMapCentre(user.isUsTenant),
      zoom: 11,
      mapTypeId: g.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
      clickableIcons: false,
    });
    mapRef.current = map;

    class ProjectionHelper extends g.maps.OverlayView {
      onAdd() { /* no DOM */ }
      onRemove() { /* no DOM */ }
      draw() { /* no draw */ }
    }
    const helper = new ProjectionHelper();
    helper.setMap(map);
    projectionHelperRef.current = helper;

    // MarkerClusterer for zip centroids. supercluster-backed spatial
    // index scales to tens of thousands of points without slowing pan.
    // Custom renderer styles cluster bubbles for multi-marker clusters
    // (single-marker "clusters" render the underlying pill natively per
    // MarkerClusterer's built-in behaviour).
    clustererRef.current = new MarkerClusterer({
      map,
      algorithm: new SuperClusterAlgorithm({ radius: 60, maxZoom: INDIVIDUAL_PILL_MIN_ZOOM - 1 }),
      renderer: buildClusterRenderer(),
    });

    // Defer marker population until the map has fired its first `idle`
    // event. Without this, MarkerClusterer's render() short-circuits
    // because map.getProjection() returns null until the initial tile
    // load completes - and the markers get added to the clusterer's
    // list but never make it to the DOM even though onAdd's idleListener
    // fires later. Doing the add AFTER idle guarantees the projection
    // exists at addMarkers-time.
    g.maps.event.addListenerOnce(map, 'idle', () => {
      if (zipCentroidsRef.current.length > 0) {
        // Clear the stale marker ref (cleanup nulled them on unmount) so
        // ensureAll's "already built" guard doesn't short-circuit.
        centroidMarkersRef.current.clear();
        ensureAllCentroidMarkers();
        syncCentroidMarkersToViewport();
      }
    });

    // Testing hook: Playwright + manual browser sessions can call
    // google.maps.event.trigger(window.__pbMap, 'click', { latLng: ... })
    // to drive the draw / edit flow without a source change.
    (window as any).__pbMap = map;

    // Track zoom for the centroid-marker gate.
    setCurrentZoom(map.getZoom() ?? 11);
    const zoomListener = map.addListener('zoom_changed', () => {
      setCurrentZoom(map.getZoom() ?? 11);
    });

    // Debounced viewport sync for zip centroid markers.
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSync = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { syncCentroidMarkersToViewport(); }, VIEWPORT_SYNC_DEBOUNCE_MS);
    };
    const boundsListener = map.addListener('bounds_changed', scheduleSync);

    // Right-click on the map background opens the "New polygon / Lasso" menu.
    const rcListener = map.addListener('rightclick', (e: any) => {
      if (!e.domEvent) return;
      setContextMenu({
        x: (e.domEvent as MouseEvent).clientX,
        y: (e.domEvent as MouseEvent).clientY,
        target: { kind: 'mapBackground' },
      });
    });

    return () => {
      if (syncTimer) clearTimeout(syncTimer);
      g.maps.event.removeListener(zoomListener);
      g.maps.event.removeListener(boundsListener);
      g.maps.event.removeListener(rcListener);
      // Detach + CLEAR every overlay ref so React StrictMode's double-mount
      // doesn't cause the resync effects to re-use dead Polygon/Marker
      // instances (whose map was nulled here but the ref kept the pointer,
      // so the sync would reuse the detached instance without reattaching).
      zipOverlaysRef.current.forEach((p) => p.setMap(null));
      zipOverlaysRef.current.clear();
      polygonOverlaysRef.current.forEach((p) => p.setMap(null));
      polygonOverlaysRef.current.clear();
      clustererRef.current?.clearMarkers();
      // MarkerClusterer extends OverlayView which has setMap, but the TS
      // types on @googlemaps/markerclusterer don't expose it. Cast to
      // sidestep the type gap - runtime call is correct.
      (clustererRef.current as any)?.setMap(null);
      clustererRef.current = null;
      centroidMarkersRef.current.forEach((m) => m.setMap(null));
      centroidMarkersRef.current.clear();
      clearDrawPreview();
      clearEditHandles();
      clearLassoPreview();
      snapHintRef.current?.setMap(null);
      helper.setMap(null);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Load bulk polygons on mount.
  useEffect(() => {
    void reloadPolygons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load ALL zip centroids on mount (one call, cached in ref).
  useEffect(() => {
    void (async () => {
      try {
        const res = await recurringRouteService.getAllZipcodeCentroids();
        zipCentroidsRef.current = res.response ?? [];
        setZipCentroidsReady(true);
        // Marker population is triggered from the map-init effect's
        // one-shot 'idle' listener (guarantees projection is ready) OR
        // from the [ready, zipCentroidsReady] effect below.
      } catch (e) { toast.show((e as Error).message, 'error'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build all markers + do initial counter sync when both centroids +
  // map are ready. Also wait for the map to be idle so the clusterer's
  // projection is available (see the idle listener in map-init above
  // for why this matters).
  useEffect(() => {
    const g = (window as any).google;
    if (!ready || !zipCentroidsReady || !mapRef.current || !g?.maps) return;
    const map = mapRef.current;
    const run = () => {
      ensureAllCentroidMarkers();
      syncCentroidMarkersToViewport();
    };
    if (map.getProjection()) { run(); }
    else { g.maps.event.addListenerOnce(map, 'idle', run); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, zipCentroidsReady]);

  const reloadPolygons = async () => {
    try {
      const res = await bulkPolygonService.list();
      setPolygons(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  // Sync zip overlays.
  useEffect(() => {
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps) return;
    const selectedSet = new Set(selected.map((s) => s.zipPolygonId));
    const loadedIds = new Set(loadedShapes.map((s) => s.zipPolygonId));

    zipOverlaysRef.current.forEach((poly, id) => {
      if (!loadedIds.has(id)) { poly.setMap(null); zipOverlaysRef.current.delete(id); }
    });

    const bounds = new g.maps.LatLngBounds();
    let boundsCount = 0;
    loadedShapes.forEach((s) => {
      const path = parseWktPolygon(s.wkt);
      if (!path || path.length < 3) return;
      const isSelected = selectedSet.has(s.zipPolygonId);
      let poly = zipOverlaysRef.current.get(s.zipPolygonId);
      if (!poly) {
        poly = new g.maps.Polygon({
          paths: path,
          strokeColor: '#00A3FF', strokeOpacity: 0.9, strokeWeight: 1.5,
          fillColor: '#00A3FF', fillOpacity: 0.15,
          map: mapRef.current, clickable: mode === 'view',
        });
        poly.addListener('click', () => toggleZip(s));
        poly.addListener('rightclick', (e: any) => {
          if (!e.domEvent) return;
          setContextMenu({
            x: (e.domEvent as MouseEvent).clientX,
            y: (e.domEvent as MouseEvent).clientY,
            target: { kind: 'zipShape', shape: s },
          });
        });
        zipOverlaysRef.current.set(s.zipPolygonId, poly);
      }
      poly.setOptions({
        clickable: mode === 'view',
        ...(isSelected
          ? { strokeColor: '#F2994A', fillColor: '#F2994A', fillOpacity: 0.4, strokeWeight: 2 }
          : { strokeColor: '#00A3FF', fillColor: '#00A3FF', fillOpacity: 0.15, strokeWeight: 1.5 }),
      });
      path.forEach((pt) => { bounds.extend(pt); boundsCount++; });
    });
    if (boundsCount > 0 && loadedShapes.length <= 15) {
      mapRef.current.fitBounds(bounds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedShapes, selected]);

  // Sync coverage-polygon overlays.
  useEffect(() => {
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps) return;
    const editingId = typeof mode === 'object' ? mode.edit : null;
    const activeIds = new Set(polygons.map((p) => p.polygonId));

    polygonOverlaysRef.current.forEach((poly, id) => {
      if (!activeIds.has(id) || id === editingId) {
        poly.setMap(null);
        polygonOverlaysRef.current.delete(id);
      }
    });

    polygons.forEach((p, idx) => {
      if (p.polygonId === editingId) return;
      const path = pointsToLatLngPath(p.points);
      if (path.length < 3) return;
      const color = POLYGON_PALETTE[idx % POLYGON_PALETTE.length];
      const isSelected = selectedPolygons.has(p.polygonId);
      let poly = polygonOverlaysRef.current.get(p.polygonId);
      if (!poly) {
        poly = new g.maps.Polygon({
          paths: path, map: mapRef.current, clickable: mode === 'view',
        });
        poly.addListener('click', () => togglePolygonSelected(p.polygonId));
        poly.addListener('rightclick', (e: any) => {
          if (!e.domEvent) return;
          setContextMenu({
            x: (e.domEvent as MouseEvent).clientX,
            y: (e.domEvent as MouseEvent).clientY,
            target: { kind: 'polygon', polygon: p },
          });
        });
        polygonOverlaysRef.current.set(p.polygonId, poly);
      } else {
        poly.setPath(path);
      }
      poly.setOptions({
        clickable: mode === 'view',
        strokeColor: color,
        strokeOpacity: isSelected ? 1 : 0.85,
        strokeWeight: isSelected ? 3 : 2,
        fillColor: color,
        fillOpacity: isSelected ? 0.35 : 0.18,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polygons, selectedPolygons, mode]);

  const toggleZip = (shape: ZipPolygonShape) => {
    setSelected((prev) =>
      prev.some((z) => z.zipPolygonId === shape.zipPolygonId)
        ? prev.filter((z) => z.zipPolygonId !== shape.zipPolygonId)
        : [...prev, {
            zipPolygonId: shape.zipPolygonId, zip: shape.zip,
            latitude: shape.latitude, longitude: shape.longitude,
          }]);
  };

  /** No-op kept for the load-effect signature; markers are created lazily
   *  by syncCentroidMarkersToViewport on the first pan/zoom event so the
   *  clusterer only ever holds in-viewport instances (creating 33k
   *  Marker objects up-front proved too heavy in practice). */
  const ensureAllCentroidMarkers = () => {
    syncCentroidMarkersToViewport();
  };

  /** Sync the centroid marker layer to the current viewport. Runs after
   *  bounds_changed (debounced), zoom changes, or centroid cache load.
   *  Creates Marker instances for centroids that entered the viewport,
   *  removes ones that left. Feeds through MarkerClusterer so clusters
   *  form at low zoom + individual pills show at high zoom.
   *
   *  When more than MAX_VIEWPORT_MARKERS centroids are in the viewport
   *  (continental zoom), uses a spatial STRIDE to pick a uniform sample
   *  across the viewport (NOT the alphabetical first N, which is why
   *  earlier versions only ever showed New England US zips). Counter
   *  still reflects the TRUE in-view total. */
  const syncCentroidMarkersToViewport = () => {
    const map = mapRef.current;
    const g = (window as any).google;
    const clusterer = clustererRef.current;
    if (!map || !g?.maps || !clusterer) return;
    const bounds = map.getBounds();
    if (!bounds) { setVisibleCentroidCount(0); return; }

    const selectedIds = new Set(selected.map((z) => z.zipPolygonId));
    const loadedIds = new Set(loadedShapes.map((s) => s.zipPolygonId));

    // Filter centroids to those in the current viewport.
    const inViewport: ZipcodeLookup[] = [];
    for (const c of zipCentroidsRef.current) {
      if (c.latitude == null || c.longitude == null) continue;
      if (bounds.contains(new g.maps.LatLng(c.latitude, c.longitude))) inViewport.push(c);
    }
    // Counter reflects the true total (not the sampled count).
    setVisibleCentroidCount(inViewport.length);

    // Uniform-stride sample when over the cap so the visible markers are
    // spread across the whole viewport, not clustered at one alphabetical
    // corner (previous bug: alphabetical cap = 00xxx-01xxx = New England).
    let sample = inViewport;
    if (inViewport.length > MAX_VIEWPORT_MARKERS) {
      const stride = Math.ceil(inViewport.length / MAX_VIEWPORT_MARKERS);
      sample = inViewport.filter((_, i) => i % stride === 0);
    }

    // Diff against currently-rendered markers.
    const wantedIds = new Set(sample.map((c) => c.zipPolygonId));
    const toRemove: any[] = [];
    centroidMarkersRef.current.forEach((marker, id) => {
      if (!wantedIds.has(id)) {
        toRemove.push(marker);
        centroidMarkersRef.current.delete(id);
      }
    });
    if (toRemove.length > 0) clusterer.removeMarkers(toRemove, true);

    const toAdd: any[] = [];
    for (const c of sample) {
      let marker = centroidMarkersRef.current.get(c.zipPolygonId);
      const isSelected = selectedIds.has(c.zipPolygonId);
      const isLoaded = loadedIds.has(c.zipPolygonId);
      const colour = isSelected ? '#F2994A' : isLoaded ? '#606db4' : '#00A3FF';
      const icon = zipLabelIcon(c.zip, colour, isSelected);
      if (!marker) {
        marker = new g.maps.Marker({
          position: { lat: Number(c.latitude), lng: Number(c.longitude) },
          title: c.zip,
          icon,
          zIndex: isSelected ? 30 : isLoaded ? 25 : 20,
          clickable: mode === 'view',
        });
        marker.addListener('click', () => { void loadZip(c); });
        marker.addListener('rightclick', (e: any) => {
          if (!e.domEvent) return;
          setContextMenu({
            x: (e.domEvent as MouseEvent).clientX,
            y: (e.domEvent as MouseEvent).clientY,
            target: { kind: 'zipCentroid', zip: c },
          });
        });
        centroidMarkersRef.current.set(c.zipPolygonId, marker);
        toAdd.push(marker);
      } else {
        marker.setIcon(icon);
        marker.setZIndex(isSelected ? 30 : isLoaded ? 25 : 20);
        marker.setClickable(mode === 'view');
      }
    }
    if (toAdd.length > 0) clusterer.addMarkers(toAdd, true);
    // Single cluster redraw after batched add/remove.
    clusterer.render();
  };

  /** Update icons for markers whose selection / loaded state changed.
   *  Runs when `selected` or `loadedShapes` diff. */
  const refreshCentroidMarkerIcons = () => {
    const g = (window as any).google;
    if (!g?.maps || centroidMarkersRef.current.size === 0) return;
    const selectedIds = new Set(selected.map((z) => z.zipPolygonId));
    const loadedIds = new Set(loadedShapes.map((s) => s.zipPolygonId));
    centroidMarkersRef.current.forEach((marker, id) => {
      const isSelected = selectedIds.has(id);
      const isLoaded = loadedIds.has(id);
      const colour = isSelected ? '#F2994A' : isLoaded ? '#606db4' : '#00A3FF';
      const zip = marker.getTitle?.() ?? '';
      marker.setIcon(zipLabelIcon(zip, colour, isSelected));
      marker.setZIndex(isSelected ? 30 : isLoaded ? 25 : 20);
      marker.setClickable(mode === 'view');
    });
  };

  const clearLassoPreview = () => {
    lassoBufferRef.current = [];
    lassoPreviewRef.current?.setMap(null);
    lassoPreviewRef.current = null;
    if (lassoRafRef.current != null) {
      cancelAnimationFrame(lassoRafRef.current);
      lassoRafRef.current = null;
    }
  };
  const clearRectPreview = () => {
    rectStartRef.current = null;
    rectPreviewRef.current?.setMap(null);
    rectPreviewRef.current = null;
  };
  const clearCirclePreview = () => {
    circleCentreRef.current = null;
    circlePreviewRef.current?.setMap(null);
    circlePreviewRef.current = null;
  };

  // Recolour centroid markers when selection / loaded set changes.
  // Sync-counter recomputes cheaply on zoom change.
  useEffect(() => {
    if (ready && zipCentroidsReady && mapRef.current) refreshCentroidMarkerIcons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, loadedShapes, mode]);
  useEffect(() => {
    if (ready && zipCentroidsReady && mapRef.current) syncCentroidMarkersToViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentZoom]);

  const togglePolygonSelected = (id: number) => {
    setSelectedPolygons((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!zipSearch.trim()) { setZipResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await recurringRouteService.searchZipcodes(zipSearch.trim(), 15);
        setZipResults(res.response ?? []);
      } catch { /* silent */ }
    }, 250);
    return () => clearTimeout(t);
  }, [zipSearch]);

  const loadZip = async (z: ZipcodeLookup) => {
    setZipSearch('');
    setZipResults([]);
    try {
      const res = await recurringRouteService.getPolygonShapes([z.zipPolygonId]);
      const shapes = res.response ?? [];
      setLoadedShapes((prev) => {
        const map = new Map(prev.map((s) => [s.zipPolygonId, s]));
        shapes.forEach((s) => map.set(s.zipPolygonId, s));
        return Array.from(map.values());
      });
      setSelected((prev) =>
        prev.some((x) => x.zipPolygonId === z.zipPolygonId) ? prev : [...prev, z]);
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const removeSelection = (id: number) => {
    setSelected((prev) => prev.filter((z) => z.zipPolygonId !== id));
  };

  const clearAll = () => {
    setSelected([]);
    setSelectedPolygons(new Set());
    setLoadedShapes([]);
    zipOverlaysRef.current.forEach((p) => p.setMap(null));
    zipOverlaysRef.current.clear();
  };

  /** ZIP-to-coverage conversion. Copies the loaded ZIP shape into a new
   *  bulk polygon (SourceType=1) and auto-enters edit mode. Source ZIP
   *  polygon is not touched. */
  const useZipAsStartingShape = async (z: ZipcodeLookup) => {
    const shape = loadedShapes.find((s) => s.zipPolygonId === z.zipPolygonId);
    if (!shape || !shape.wkt) {
      toast.show(`No shape loaded for ${zipShortLower} ${z.zip}.`, 'error');
      return;
    }
    const path = parseWktPolygon(shape.wkt);
    if (!path || path.length < 3) {
      toast.show(`${zipShortLower} ${z.zip} has no usable boundary.`, 'error');
      return;
    }
    setConverting(z);
    try {
      // Simplify the raw ZIP outline before saving. Coastal ZIPs often have
      // hundreds of vertices tracing every rock; that shape kills edit-mode
      // performance (one draggable Marker per vertex + midpoint). Coverage
      // polygons are dispatch geometry, not cartography, so knock the vertex
      // count down to something an operator can actually manipulate.
      const simplifiedPath = simplifyToMax(path, ZIP_TO_COVERAGE_MAX_VERTICES);
      if (simplifiedPath.length < path.length) {
        toast.show(
          `Simplified ${path.length} -> ${simplifiedPath.length} vertices for editability.`,
          'success',
        );
      }
      const points: PolygonPoint[] = simplifiedPath.map((pt, i) => ({
        orderIndex: i, lat: pt.lat, lng: pt.lng,
      }));
      const centroid = polygonCentroid(path);
      const res = await bulkPolygonService.create({
        name: `Zip ${z.zip} copy`,
        centroidLatitude: centroid.lat,
        centroidLongitude: centroid.lng,
        points,
        sourceType: 1,
        sourceCode: z.zip,
      });
      setPolygons((prev) => [...prev, res.response]);
      setMode({ edit: res.response.polygonId });
      toast.show(`Coverage polygon created from ${zipShortLower} ${z.zip}. Drag to reshape.`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setConverting(null); }
  };

  // ─── Snap helpers ────────────────────────────────────────────────────
  const latLngToPixel = (lat: number, lng: number): { x: number; y: number } | null => {
    const g = (window as any).google;
    const helper = projectionHelperRef.current;
    const proj = helper?.getProjection?.();
    if (!proj || !g?.maps) return null;
    const p = proj.fromLatLngToContainerPixel(new g.maps.LatLng(lat, lng));
    return p ? { x: p.x, y: p.y } : null;
  };

  const snapTo = (raw: LatLng): { point: LatLng; kind: 'vertex' | 'edge' | null } => {
    const clickPx = latLngToPixel(raw.lat, raw.lng);
    if (!clickPx) return { point: raw, kind: null };

    const shapes: LatLng[][] = [];
    loadedShapes.forEach((s) => {
      const p = parseWktPolygon(s.wkt);
      if (p && p.length >= 3) shapes.push(p);
    });
    polygons.forEach((poly) => {
      const editingId = typeof mode === 'object' ? mode.edit : null;
      if (poly.polygonId === editingId) return;
      const p = pointsToLatLngPath(poly.points);
      if (p.length >= 3) shapes.push(p);
    });
    if (drawingVertices.length > 0) shapes.push(drawingVertices);

    for (const ring of shapes) {
      for (const v of ring) {
        const px = latLngToPixel(v.lat, v.lng);
        if (!px) continue;
        const d = Math.hypot(px.x - clickPx.x, px.y - clickPx.y);
        if (d < SNAP_PIXELS) return { point: v, kind: 'vertex' };
      }
    }
    if (drawingVertices.length >= 3) {
      const first = drawingVertices[0];
      const px = latLngToPixel(first.lat, first.lng);
      if (px) {
        const d = Math.hypot(px.x - clickPx.x, px.y - clickPx.y);
        if (d < SNAP_PIXELS) return { point: first, kind: 'vertex' };
      }
    }

    let best: { point: LatLng; dist: number } | null = null;
    for (const ring of shapes) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const aPx = latLngToPixel(a.lat, a.lng);
        const bPx = latLngToPixel(b.lat, b.lng);
        if (!aPx || !bPx) continue;
        const proj = projectPointOnSegment(clickPx, aPx, bPx);
        const d = Math.hypot(clickPx.x - proj.x, clickPx.y - proj.y);
        if (d < SNAP_PIXELS && (!best || d < best.dist)) {
          const t = segmentT(aPx, bPx, proj);
          const lat = a.lat + (b.lat - a.lat) * t;
          const lng = a.lng + (b.lng - a.lng) * t;
          best = { point: { lat, lng }, dist: d };
        }
      }
    }
    if (best) return { point: best.point, kind: 'edge' };
    return { point: raw, kind: null };
  };

  // Freehand lasso: mousedown starts recording, mousemove appends (RAF-
  // throttled), mouseup OR approach-back-to-start closes the ring,
  // simplifies, opens save modal.
  useEffect(() => {
    const map = mapRef.current;
    const g = (window as any).google;
    if (!map || !g?.maps || mode !== 'lassoing') return;

    // Prevent map from panning during a lasso stroke.
    map.setOptions({ draggable: false, disableDoubleClickZoom: true });

    // Pixel distance from the start point at which the stroke auto-closes.
    // Only kicks in after the stroke has some length so a jitter on the
    // first pixel doesn't close it instantly.
    const AUTO_CLOSE_PX = 18;
    const MIN_LEN_BEFORE_AUTOCLOSE = 20;
    let recording = false;
    let startPx: { x: number; y: number } | null = null;

    const finishStroke = () => {
      recording = false;
      const raw = lassoBufferRef.current.slice();
      clearLassoPreview();
      if (raw.length < 3) {
        toast.show('Lasso stroke too short - needs at least a few points.', 'error');
        setMode('view');
        return;
      }
      const simplified = simplifyToMax(raw, ZIP_TO_COVERAGE_MAX_VERTICES);
      setPendingPolygon(simplified);
      setMode('pending');
    };

    const startListener = map.addListener('mousedown', (e: any) => {
      recording = true;
      clearLassoPreview();
      const start = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      lassoBufferRef.current = [start];
      startPx = latLngToPixel(start.lat, start.lng);
      lassoPreviewRef.current = new g.maps.Polyline({
        path: lassoBufferRef.current,
        map,
        strokeColor: '#f2994a', strokeOpacity: 0.9, strokeWeight: 2,
      });
    });
    const moveListener = map.addListener('mousemove', (e: any) => {
      if (!recording) return;
      if (lassoRafRef.current != null) return;
      const latLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      lassoRafRef.current = requestAnimationFrame(() => {
        lassoRafRef.current = null;
        lassoBufferRef.current.push(latLng);
        lassoPreviewRef.current?.setPath(lassoBufferRef.current);
        // Auto-close when the pen approaches the start point (after
        // enough vertices so a jitter on entry doesn't fire this).
        if (lassoBufferRef.current.length >= MIN_LEN_BEFORE_AUTOCLOSE && startPx) {
          const curPx = latLngToPixel(latLng.lat, latLng.lng);
          if (curPx) {
            const d = Math.hypot(curPx.x - startPx.x, curPx.y - startPx.y);
            if (d < AUTO_CLOSE_PX) finishStroke();
          }
        }
      });
    });
    const endListener = map.addListener('mouseup', () => {
      if (!recording) return;
      finishStroke();
    });
    // Fallback: mouse released outside the map (over toolbar / rail) still
    // ends the stroke. Otherwise the user's next click would re-enter draw.
    const docMouseUp = () => { if (recording) finishStroke(); };
    document.addEventListener('mouseup', docMouseUp);

    return () => {
      map.setOptions({ draggable: true, disableDoubleClickZoom: false });
      g.maps.event.removeListener(startListener);
      g.maps.event.removeListener(moveListener);
      g.maps.event.removeListener(endListener);
      document.removeEventListener('mouseup', docMouseUp);
      clearLassoPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Rectangle: mousedown records first corner, mousemove live-previews via
  // google.maps.Rectangle, mouseup converts bounds to a 4-vertex polygon.
  useEffect(() => {
    const map = mapRef.current;
    const g = (window as any).google;
    if (!map || !g?.maps || mode !== 'rectangling') return;
    map.setOptions({ draggable: false, disableDoubleClickZoom: true });

    let recording = false;
    const startListener = map.addListener('mousedown', (e: any) => {
      recording = true;
      clearRectPreview();
      rectStartRef.current = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      rectPreviewRef.current = new g.maps.Rectangle({
        bounds: { north: rectStartRef.current.lat, south: rectStartRef.current.lat, east: rectStartRef.current.lng, west: rectStartRef.current.lng },
        map,
        strokeColor: '#f2994a', strokeOpacity: 0.9, strokeWeight: 2,
        fillColor: '#f2994a', fillOpacity: 0.15,
        clickable: false,
      });
    });
    const moveListener = map.addListener('mousemove', (e: any) => {
      if (!recording || !rectStartRef.current || !rectPreviewRef.current) return;
      const s = rectStartRef.current;
      const cur = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      rectPreviewRef.current.setBounds({
        north: Math.max(s.lat, cur.lat), south: Math.min(s.lat, cur.lat),
        east: Math.max(s.lng, cur.lng),  west: Math.min(s.lng, cur.lng),
      });
    });
    const endListener = map.addListener('mouseup', (e: any) => {
      if (!recording || !rectStartRef.current) return;
      recording = false;
      const s = rectStartRef.current;
      const cur = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      clearRectPreview();
      const n = Math.max(s.lat, cur.lat), sLat = Math.min(s.lat, cur.lat);
      const eLng = Math.max(s.lng, cur.lng), wLng = Math.min(s.lng, cur.lng);
      if (n === sLat || eLng === wLng) {
        toast.show('Rectangle needs some width and height. Try again.', 'error');
        return;
      }
      const pts: LatLng[] = [
        { lat: n,    lng: wLng }, // NW
        { lat: n,    lng: eLng }, // NE
        { lat: sLat, lng: eLng }, // SE
        { lat: sLat, lng: wLng }, // SW
      ];
      setPendingPolygon(pts);
      setMode('pending');
    });

    return () => {
      map.setOptions({ draggable: true, disableDoubleClickZoom: false });
      g.maps.event.removeListener(startListener);
      g.maps.event.removeListener(moveListener);
      g.maps.event.removeListener(endListener);
      clearRectPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Circle: mousedown records centre, mousemove live-previews via
  // google.maps.Circle (radius = flat-approx distance to cursor in metres),
  // mouseup approximates to a CIRCLE_APPROX_SIDES-vertex polygon.
  useEffect(() => {
    const map = mapRef.current;
    const g = (window as any).google;
    if (!map || !g?.maps || mode !== 'circling') return;
    map.setOptions({ draggable: false, disableDoubleClickZoom: true });

    let recording = false;
    const flatMetres = (a: LatLng, b: LatLng) => {
      // Small-distance flat approximation. 111,320m per degree lat; longitude
      // shrinks by cos(lat). Good enough for a drawn coverage circle.
      const dLat = (b.lat - a.lat) * 111320;
      const dLng = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
      return Math.hypot(dLat, dLng);
    };
    const startListener = map.addListener('mousedown', (e: any) => {
      recording = true;
      clearCirclePreview();
      circleCentreRef.current = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      circlePreviewRef.current = new g.maps.Circle({
        center: circleCentreRef.current, radius: 1, map,
        strokeColor: '#f2994a', strokeOpacity: 0.9, strokeWeight: 2,
        fillColor: '#f2994a', fillOpacity: 0.15,
        clickable: false,
      });
    });
    const moveListener = map.addListener('mousemove', (e: any) => {
      if (!recording || !circleCentreRef.current || !circlePreviewRef.current) return;
      const r = flatMetres(circleCentreRef.current, { lat: e.latLng.lat(), lng: e.latLng.lng() });
      circlePreviewRef.current.setRadius(Math.max(r, 1));
    });
    const endListener = map.addListener('mouseup', (e: any) => {
      if (!recording || !circleCentreRef.current) return;
      recording = false;
      const centre = circleCentreRef.current;
      const radiusM = flatMetres(centre, { lat: e.latLng.lat(), lng: e.latLng.lng() });
      clearCirclePreview();
      if (radiusM < 50) {
        toast.show('Circle radius too small (< 50m). Drag further from the centre.', 'error');
        return;
      }
      // Convert metres back to a per-axis degree offset for the polygon
      // approximation. Same flat approx as above, reversed.
      const radiusLatDeg = radiusM / 111320;
      const radiusLngDeg = radiusM / (111320 * Math.cos((centre.lat * Math.PI) / 180));
      const pts: LatLng[] = [];
      for (let i = 0; i < CIRCLE_APPROX_SIDES; i++) {
        const t = (i / CIRCLE_APPROX_SIDES) * 2 * Math.PI;
        pts.push({
          lat: centre.lat + Math.sin(t) * radiusLatDeg,
          lng: centre.lng + Math.cos(t) * radiusLngDeg,
        });
      }
      setPendingPolygon(pts);
      setMode('pending');
    });

    return () => {
      map.setOptions({ draggable: true, disableDoubleClickZoom: false });
      g.maps.event.removeListener(startListener);
      g.maps.event.removeListener(moveListener);
      g.maps.event.removeListener(endListener);
      clearCirclePreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mode !== 'drawing') return;

    const clickListener = map.addListener('click', (e: any) => {
      const raw = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const snap = snapTo(raw);
      setDrawingVertices((p) => [...p, snap.point]);
    });
    const moveListener = map.addListener('mousemove', (e: any) => {
      snapHintRef.current?.setMap(null);
      snapHintRef.current = null;
      const raw = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const snap = snapTo(raw);
      if (snap.kind) {
        const g = (window as any).google;
        snapHintRef.current = new g.maps.Marker({
          position: snap.point, map,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 8, strokeColor: snap.kind === 'vertex' ? '#ef4444' : '#f59e0b',
            fillColor: '#fff', fillOpacity: 1, strokeWeight: 3,
          },
          clickable: false, zIndex: 999,
        });
      }
    });
    return () => {
      (window as any).google.maps.event.removeListener(clickListener);
      (window as any).google.maps.event.removeListener(moveListener);
      snapHintRef.current?.setMap(null);
      snapHintRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, drawingVertices, loadedShapes, polygons]);

  useEffect(() => {
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps || mode !== 'drawing') {
      clearDrawPreview();
      return;
    }
    clearDrawPreview();
    if (drawingVertices.length === 0) return;

    if (drawingVertices.length >= 2) {
      drawPreviewPolyRef.current = new g.maps.Polyline({
        path: drawingVertices, map: mapRef.current,
        strokeColor: '#3bc7f4', strokeOpacity: 0.9, strokeWeight: 2,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '10px' }],
      });
    }
    drawingVertices.forEach((v, i) => {
      const m = new g.maps.Marker({
        position: v, map: mapRef.current,
        icon: {
          path: g.maps.SymbolPath.CIRCLE, scale: 5,
          fillColor: '#3bc7f4', fillOpacity: 1, strokeColor: '#0d0c2c', strokeWeight: 2,
        },
        title: `Point ${i + 1}`, clickable: false,
      });
      drawPreviewMarkersRef.current.push(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, drawingVertices]);

  const clearDrawPreview = () => {
    drawPreviewPolyRef.current?.setMap(null);
    drawPreviewPolyRef.current = null;
    drawPreviewMarkersRef.current.forEach((m) => m.setMap(null));
    drawPreviewMarkersRef.current = [];
  };

  const startDraw = () => {
    setMode('drawing');
    setDrawingVertices([]);
  };
  const cancelDraw = () => {
    setDrawingVertices([]);
    setMode('view');
  };
  const undoVertex = () => setDrawingVertices((p) => p.slice(0, -1));
  const finishDraw = () => {
    if (drawingVertices.length < 3) {
      toast.show('A polygon needs at least 3 points.', 'error');
      return;
    }
    setPendingPolygon(drawingVertices);
    setDrawingVertices([]);
    setMode('pending');
  };

  // Stage 4 - lasso mode entry/exit.
  const startLasso = () => { setDrawingVertices([]); setMode('lassoing'); };
  const cancelLasso = () => { clearLassoPreview(); setMode('view'); };
  const startRect = () => { setDrawingVertices([]); setMode('rectangling'); };
  const cancelRect = () => { clearRectPreview(); setMode('view'); };
  const startCircle = () => { setDrawingVertices([]); setMode('circling'); };
  const cancelCircle = () => { clearCirclePreview(); setMode('view'); };

  // Stage 4 - keyboard shortcuts. Bound at window level; skips input/textarea
  // targets so search + name-input fields still get their raw keystrokes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
      const editingId = typeof mode === 'object' ? mode.edit : null;

      if (e.key === 'Escape') {
        if (contextMenu) { setContextMenu(null); return; }
        if (openSaveModal) { setOpenSaveModal(false); return; }
        if (mode === 'drawing') { cancelDraw(); return; }
        if (mode === 'lassoing') { cancelLasso(); return; }
        if (mode === 'rectangling') { cancelRect(); return; }
        if (mode === 'circling') { cancelCircle(); return; }
        if (mode === 'pending') { discardPending(); return; }
        if (editingId != null) { stopEdit(); return; }
      }
      if (e.key === 'Enter' && mode === 'pending') {
        e.preventDefault();
        openSaveForPending();
        return;
      }
      if (e.key === 'Enter' && mode === 'drawing') {
        e.preventDefault();
        finishDraw();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && mode === 'drawing') {
        e.preventDefault();
        undoVertex();
        return;
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && mode === 'drawing') {
        e.preventDefault();
        undoVertex();
        return;
      }
      // Tool shortcuts fire in view OR edit mode (edit-mode operator can
      // jump straight into drawing another polygon without clicking "Done editing" first).
      if (mode === 'view' || editingId != null) {
        if (e.key === 'l' || e.key === 'L') { e.preventDefault(); startLasso(); return; }
        if (e.key === 'p' || e.key === 'P') { e.preventDefault(); startDraw(); return; }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); startRect(); return; }
        if (e.key === 'c' || e.key === 'C') { e.preventDefault(); startCircle(); return; }
        if (e.key === '/') {
          e.preventDefault();
          document.querySelector<HTMLInputElement>('input[placeholder^="Type a"]')?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, contextMenu, drawingVertices]);

  // Pending polygon mode: renders the draft polygon on the map with
  // draggable vertex + midpoint handles so the operator can refine it
  // before saving. Same UX as edit mode but writes back to
  // pendingPolygon state (no server call) instead of updateShape.
  useEffect(() => {
    const g = (window as any).google;
    const map = mapRef.current;
    if (!map || !g?.maps) return;
    // Clean up prior overlays.
    pendingPolyRef.current?.setMap(null);
    pendingPolyRef.current = null;
    pendingHandlesRef.current.forEach((h) => h.setMap(null));
    pendingHandlesRef.current = [];
    pendingMidpointsRef.current.forEach((h) => h.setMap(null));
    pendingMidpointsRef.current = [];
    if (mode !== 'pending' || !pendingPolygon || pendingPolygon.length < 3) return;

    const working: LatLng[] = pendingPolygon.map((p) => ({ lat: p.lat, lng: p.lng }));
    const color = '#8b5cf6'; // purple to distinguish from saved polygons
    pendingPolyRef.current = new g.maps.Polygon({
      paths: working, map,
      strokeColor: color, strokeOpacity: 1, strokeWeight: 2,
      fillColor: color, fillOpacity: 0.25,
      clickable: false,
    });

    const commitPending = () => {
      setPendingPolygon(working.map((p) => ({ lat: p.lat, lng: p.lng })));
    };

    const renderHandles = () => {
      pendingHandlesRef.current.forEach((h) => h.setMap(null));
      pendingMidpointsRef.current.forEach((h) => h.setMap(null));
      pendingHandlesRef.current = [];
      pendingMidpointsRef.current = [];

      working.forEach((pt, i) => {
        const handle = new g.maps.Marker({
          position: pt, map, draggable: true,
          icon: {
            path: 'M -6 -6 L 6 -6 L 6 6 L -6 6 Z',
            fillColor: color, fillOpacity: 1,
            strokeColor: '#fff', strokeWeight: 2, scale: 1,
          },
          title: `Vertex ${i + 1} - drag to move, right-click to delete`,
          zIndex: 500,
        });
        handle.addListener('dragstart', () => {
          map.setOptions({ draggable: false, disableDoubleClickZoom: true });
          pendingMidpointsRef.current.forEach((m) => m.setMap(null));
          pendingMidpointsRef.current = [];
        });
        handle.addListener('drag', (e: any) => {
          working[i] = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          pendingPolyRef.current?.setPath(working);
        });
        handle.addListener('dragend', () => {
          map.setOptions({ draggable: true, disableDoubleClickZoom: false });
          commitPending();
          renderHandles();
        });
        handle.addListener('rightclick', () => {
          if (working.length <= 3) {
            toast.show('A polygon must keep at least 3 vertices.', 'error');
            return;
          }
          working.splice(i, 1);
          pendingPolyRef.current?.setPath(working);
          commitPending();
          renderHandles();
        });
        pendingHandlesRef.current.push(handle);
      });

      working.forEach((a, i) => {
        const b = working[(i + 1) % working.length];
        const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
        const marker = new g.maps.Marker({
          position: mid, map,
          icon: {
            path: g.maps.SymbolPath.CIRCLE, scale: 6,
            fillColor: '#fff', fillOpacity: 1,
            strokeColor: color, strokeWeight: 2,
          },
          title: 'Click to insert a vertex here',
          zIndex: 400,
        });
        marker.addListener('click', () => {
          working.splice(i + 1, 0, mid);
          pendingPolyRef.current?.setPath(working);
          commitPending();
          renderHandles();
        });
        pendingMidpointsRef.current.push(marker);
      });
    };
    renderHandles();

    return () => {
      pendingPolyRef.current?.setMap(null);
      pendingPolyRef.current = null;
      pendingHandlesRef.current.forEach((h) => h.setMap(null));
      pendingHandlesRef.current = [];
      pendingMidpointsRef.current.forEach((h) => h.setMap(null));
      pendingMidpointsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pendingPolygon?.length]);

  // ─── Edit mode ───────────────────────────────────────────────────────
  const startEdit = (id: number) => {
    setDrawingVertices([]);
    setMode({ edit: id });
  };
  const stopEdit = () => setMode('view');

  useEffect(() => {
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps) return;
    clearEditHandles();
    if (typeof mode !== 'object') return;

    const polygon = polygons.find((p) => p.polygonId === mode.edit);
    if (!polygon) return;
    const path = pointsToLatLngPath(polygon.points);
    if (path.length < 3) return;

    const working: LatLng[] = path.map((p) => ({ lat: p.lat, lng: p.lng }));
    const color = POLYGON_PALETTE[
      polygons.findIndex((p) => p.polygonId === mode.edit) % POLYGON_PALETTE.length
    ];

    editPolyRef.current = new g.maps.Polygon({
      paths: working, map: mapRef.current,
      strokeColor: color, strokeOpacity: 1, strokeWeight: 2,
      fillColor: color, fillOpacity: 0.3,
      clickable: false,
    });

    // Guard: drawing thousands of draggable Marker + midpoint pairs freezes
    // the browser. Above the cap, skip handles and let the operator hit
    // "Simplify shape" from the right-rail row.
    if (working.length > MAX_EDIT_HANDLE_VERTICES) {
      toast.show(
        `${working.length} vertices is too many to edit safely. Click "Simplify shape" in the right rail to reduce.`,
        'error',
      );
      return;
    }

    const renderHandles = () => {
      editHandlesRef.current.forEach((h) => h.setMap(null));
      editMidpointsRef.current.forEach((h) => h.setMap(null));
      editHandlesRef.current = [];
      editMidpointsRef.current = [];

      working.forEach((pt, i) => {
        const handle = new g.maps.Marker({
          position: pt, map: mapRef.current, draggable: true,
          icon: {
            path: 'M -6 -6 L 6 -6 L 6 6 L -6 6 Z',
            fillColor: color, fillOpacity: 1,
            strokeColor: '#fff', strokeWeight: 2, scale: 1,
          },
          title: `Vertex ${i + 1} - drag to move, right-click to delete`,
          zIndex: 500,
        });
        handle.addListener('dragstart', () => {
          mapRef.current.setOptions({ draggable: false, disableDoubleClickZoom: true });
          editMidpointsRef.current.forEach((m) => m.setMap(null));
          editMidpointsRef.current = [];
        });
        handle.addListener('drag', (e: any) => {
          working[i] = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          editPolyRef.current?.setPath(working);
        });
        handle.addListener('dragend', async () => {
          mapRef.current.setOptions({ draggable: true, disableDoubleClickZoom: false });
          await commitShape(mode.edit, working);
          renderHandles();
        });
        handle.addListener('rightclick', async () => {
          if (working.length <= 3) {
            toast.show('A polygon must keep at least 3 vertices.', 'error');
            return;
          }
          working.splice(i, 1);
          editPolyRef.current?.setPath(working);
          await commitShape(mode.edit, working);
          renderHandles();
        });
        editHandlesRef.current.push(handle);
      });

      working.forEach((a, i) => {
        const b = working[(i + 1) % working.length];
        const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
        const marker = new g.maps.Marker({
          position: mid, map: mapRef.current,
          icon: {
            path: g.maps.SymbolPath.CIRCLE, scale: 6,
            fillColor: '#fff', fillOpacity: 1,
            strokeColor: color, strokeWeight: 2,
          },
          title: 'Click to insert a vertex here',
          zIndex: 400,
        });
        marker.addListener('click', async () => {
          working.splice(i + 1, 0, mid);
          editPolyRef.current?.setPath(working);
          await commitShape(mode.edit, working);
          renderHandles();
        });
        editMidpointsRef.current.push(marker);
      });
    };

    renderHandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const commitShape = async (id: number, working: LatLng[]) => {
    try {
      const points: PolygonPoint[] = working.map((pt, i) => ({
        orderIndex: i, lat: pt.lat, lng: pt.lng,
      }));
      const centroid = polygonCentroid(working);
      const res = await bulkPolygonService.updateShape(id, {
        points, centroidLatitude: centroid.lat, centroidLongitude: centroid.lng,
      });
      setPolygons((prev) => prev.map((p) =>
        p.polygonId === id ? res.response : p));
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const clearEditHandles = () => {
    editHandlesRef.current.forEach((h) => h.setMap(null));
    editHandlesRef.current = [];
    editMidpointsRef.current.forEach((h) => h.setMap(null));
    editMidpointsRef.current = [];
    editPolyRef.current?.setMap(null);
    editPolyRef.current = null;
  };

  /** Reduce a polygon's vertex count in place. Reads the current points,
   *  runs Douglas-Peucker to hit ZIP_TO_COVERAGE_MAX_VERTICES, PUTs the
   *  simplified shape back. Used to unblock edit mode on polygons that got
   *  saved with a raw ZIP outline before the on-conversion simplification
   *  landed. */
  const simplifyPolygonInPlace = async (p: BulkPolygon) => {
    const path: LatLng[] = pointsToLatLngPath(p.points);
    const simplified = simplifyToMax(path, ZIP_TO_COVERAGE_MAX_VERTICES);
    if (simplified.length >= p.points.length) {
      toast.show(`"${p.name}" already has ${p.points.length} vertices; no simplification possible at the target tolerance.`, 'error');
      return;
    }
    if (!confirm(`Simplify "${p.name}" from ${p.points.length} to ${simplified.length} vertices? Shape will be preserved approximately. Cannot be undone.`)) return;
    try {
      const newPoints: PolygonPoint[] = simplified.map((pt, i) => ({
        orderIndex: i, lat: pt.lat, lng: pt.lng,
      }));
      const centroid = polygonCentroid(simplified);
      const res = await bulkPolygonService.updateShape(p.polygonId, {
        points: newPoints,
        centroidLatitude: centroid.lat,
        centroidLongitude: centroid.lng,
      });
      setPolygons((prev) => prev.map((x) => x.polygonId === p.polygonId ? res.response : x));
      toast.show(`Simplified "${p.name}" to ${simplified.length} vertices.`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  /** Pan + fit the map to a coverage polygon's bounds. Used when the
   *  operator clicks a polygon name in the right rail, or "Zoom to fit"
   *  from the context menu. Guarded when points list is empty. */
  const zoomToPolygon = (p: BulkPolygon) => {
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps || p.points.length === 0) return;
    const bounds = new g.maps.LatLngBounds();
    p.points.forEach((pt) => bounds.extend({ lat: pt.lat, lng: pt.lng }));
    mapRef.current.fitBounds(bounds);
  };

  const removePolygon = async (p: BulkPolygon) => {
    const msg = p.attachedRouteCount > 0
      ? `"${p.name}" is attached to ${p.attachedRouteCount} active route(s). Remove anyway?`
      : `Remove "${p.name}"?`;
    if (!confirm(msg)) return;
    try {
      await bulkPolygonService.remove(p.polygonId);
      setPolygons((prev) => prev.filter((x) => x.polygonId !== p.polygonId));
      setSelectedPolygons((prev) => {
        const next = new Set(prev);
        next.delete(p.polygonId);
        return next;
      });
      toast.show('Coverage polygon removed.', 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const onPolygonCreated = (created: BulkPolygon) => {
    setPolygons((prev) => [...prev, created]);
    setPendingPolygon(null);
    setOpenSaveModal(false);
    setMode('view');
  };

  // Explicit "Finish drawing" click from pending mode -> open save modal.
  const openSaveForPending = () => {
    if (!pendingPolygon || pendingPolygon.length < 3) {
      toast.show('Nothing to finish - draw a shape first.', 'error');
      return;
    }
    setOpenSaveModal(true);
  };
  const discardPending = () => {
    setPendingPolygon(null);
    setOpenSaveModal(false);
    setMode('view');
  };

  if (!apiKey) {
    return (
      <div className="h-full p-6">
        <h1 className="text-2xl font-semibold text-text-primary mb-4">Polygon Builder</h1>
        <div className="text-error text-sm">
          Google Maps API key is not set (GoogleMapsKey env var).
        </div>
      </div>
    );
  }

  const editingId = typeof mode === 'object' ? mode.edit : null;
  const selectedPolygonList = polygons.filter((p) => selectedPolygons.has(p.polygonId));

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-white border-b border-border text-xs">
        <h1 className="text-base font-semibold text-text-primary">Polygon Builder</h1>
        <span className="text-text-muted">
          - {(() => {
            const total = zipCentroidsRef.current.length;
            if (!zipCentroidsReady) return `loading ${zipLongLower}s...`;
            if (total === 0) return `no ${zipLongLower}s on this tenant`;
            const totalFmt = total.toLocaleString();
            if (currentZoom < INDIVIDUAL_PILL_MIN_ZOOM) {
              return `${totalFmt} ${zipLongLower}s available (clustered - zoom in for detail)`;
            }
            return `${visibleCentroidCount.toLocaleString()} of ${totalFmt} ${zipLongLower}s in view`;
          })()}
          , {loadedShapes.length} loaded, {selected.length} selected, {polygons.length} coverage, {selectedPolygons.size} coverage selected
        </span>
        <div className="flex-1" />
        {mode === 'drawing' ? (
          <>
            <span className="text-text-muted">
              Click to add points ({drawingVertices.length}). Esc cancels, Enter finishes, Del undoes last vertex.
            </span>
            <Button variant="neutral" size="sm" onClick={undoVertex} disabled={drawingVertices.length === 0}>Undo</Button>
            <Button variant="neutral" size="sm" onClick={cancelDraw}>Cancel</Button>
            <Button variant="secondary" size="sm" onClick={finishDraw} disabled={drawingVertices.length < 3}>
              Finish ({drawingVertices.length})
            </Button>
          </>
        ) : mode === 'lassoing' ? (
          <>
            <span className="text-text-muted">
              Hold mouse and drag around an area, release to save. Esc cancels.
            </span>
            <Button variant="neutral" size="sm" onClick={cancelLasso}>Cancel</Button>
          </>
        ) : mode === 'rectangling' ? (
          <>
            <span className="text-text-muted">
              Click and drag to draw a rectangle. Release to save. Esc cancels.
            </span>
            <Button variant="neutral" size="sm" onClick={cancelRect}>Cancel</Button>
          </>
        ) : mode === 'circling' ? (
          <>
            <span className="text-text-muted">
              Click the centre and drag out to set the radius. Release to save. Esc cancels.
            </span>
            <Button variant="neutral" size="sm" onClick={cancelCircle}>Cancel</Button>
          </>
        ) : mode === 'pending' ? (
          <>
            <span className="text-text-muted">
              Drag the purple squares to refine ({pendingPolygon?.length ?? 0} vertices). Click white circles to insert, right-click a square to delete. Click "Finish drawing" to name + save.
            </span>
            <DrawingToolsMenu
              onStartDraw={startDraw}
              onStartLasso={startLasso}
              onStartRect={startRect}
              onStartCircle={startCircle}
            />
            <Button variant="neutral" size="sm" onClick={discardPending}>Discard</Button>
            <Button variant="secondary" size="sm" onClick={openSaveForPending}
              disabled={!pendingPolygon || pendingPolygon.length < 3}>
              Finish drawing
            </Button>
          </>
        ) : editingId != null ? (
          <>
            <span className="text-text-muted">
              Drag the coloured squares to reshape; click a white circle to insert a vertex; right-click a square to delete it.
            </span>
            <DrawingToolsMenu
              onStartDraw={startDraw}
              onStartLasso={startLasso}
              onStartRect={startRect}
              onStartCircle={startCircle}
            />
            <Button variant="secondary" size="sm" onClick={stopEdit}>Done editing</Button>
          </>
        ) : (
          <>
            <Button variant="neutral" size="sm" onClick={clearAll}
              disabled={loadedShapes.length === 0 && selected.length === 0}>
              Clear {zipShortLower}s
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setZipSaveOpen(true)} disabled={selected.length === 0}
              title={selected.length === 0 ? `Select some ${zipLongLower}s first` : 'Persist the selection as a recurring route'}>
              Save as Route ({selected.length})
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPolygonSaveOpen(true)} disabled={selectedPolygons.size === 0}
              title={selectedPolygons.size === 0 ? 'Select some coverage polygons first' : 'Persist the coverage-polygon selection as a recurring route'}>
              Save coverage as Route ({selectedPolygons.size})
            </Button>
            <DrawingToolsMenu
              onStartDraw={startDraw}
              onStartLasso={startLasso}
              onStartRect={startRect}
              onStartCircle={startCircle}
            />
          </>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-72 border-r border-border overflow-y-auto">
          <div className="p-3 space-y-4 text-xs">
            <div>
              <div className="text-text-secondary text-[10px] uppercase tracking-wide mb-1">
                Search {zipLongLower}s
              </div>
              <input
                type="text" value={zipSearch} onChange={(e) => setZipSearch(e.target.value)}
                className="w-full border border-border rounded px-2 py-1 text-xs"
                placeholder={`Type a ${zipShortLower} prefix...`}
              />
              {zipResults.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-auto border border-border-light rounded bg-surface-white">
                  {zipResults.map((z) => (
                    <li key={z.zipPolygonId}>
                      <button type="button" onClick={() => loadZip(z)}
                        className="w-full text-left px-2 py-1 hover:bg-surface-cream">
                        {z.zip}
                        {z.latitude != null && <span className="text-[10px] text-text-muted ml-1">
                          ({Number(z.latitude).toFixed(2)}, {Number(z.longitude).toFixed(2)})
                        </span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="text-text-secondary text-[10px] uppercase tracking-wide mb-1">
                Selected {zipLongLower}s ({selected.length})
              </div>
              {selected.length === 0 && (
                <div className="text-text-muted italic text-[10px]">No {zipShortLower}s selected yet.</div>
              )}
              <ul className="space-y-1">
                {selected.map((z) => (
                  <li key={z.zipPolygonId} className="px-2 py-1 rounded bg-brand-cyan/10 space-y-1">
                    <div className="flex items-center gap-1">
                      <span className="flex-1 truncate">{z.zip}</span>
                      <button type="button" onClick={() => removeSelection(z.zipPolygonId)}
                        className="text-text-muted hover:text-error text-xs" title="Remove">x</button>
                    </div>
                    <button
                      type="button"
                      onClick={() => useZipAsStartingShape(z)}
                      disabled={converting?.zipPolygonId === z.zipPolygonId || mode === 'drawing' || editingId != null}
                      className="w-full text-[10px] font-semibold text-brand-purple hover:underline disabled:opacity-40 disabled:no-underline text-left"
                      title="Copy this ZIP boundary into a new editable coverage polygon. The source ZIP is not modified."
                    >
                      {converting?.zipPolygonId === z.zipPolygonId
                        ? 'Creating coverage polygon...'
                        : 'Use as starting shape ->'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="text-text-secondary text-[10px] uppercase tracking-wide mb-1">
                Coverage polygons ({polygons.length})
              </div>
              {polygons.length === 0 && (
                <div className="text-text-muted italic text-[10px]">
                  None yet. Click "+ Draw new polygon" or "Use as starting shape" on a loaded {zipShortLower}.
                </div>
              )}
              <ul className="space-y-1">
                {polygons.map((p, idx) => {
                  const color = POLYGON_PALETTE[idx % POLYGON_PALETTE.length];
                  const isChecked = selectedPolygons.has(p.polygonId);
                  const isEditing = editingId === p.polygonId;
                  return (
                    <li key={p.polygonId}
                      className={`px-2 py-1 rounded border ${isEditing ? 'border-warning bg-warning/10' : 'border-border-light'}`}>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={isChecked}
                          onChange={() => togglePolygonSelected(p.polygonId)} />
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            // Select the polygon (adds to selection if not already selected).
                            setSelectedPolygons((prev) => {
                              if (prev.has(p.polygonId)) return prev;
                              const next = new Set(prev);
                              next.add(p.polygonId);
                              return next;
                            });
                            // Also pan / zoom the map to bring the shape into view.
                            zoomToPolygon(p);
                          }}
                          className="flex-1 truncate font-medium text-left hover:underline"
                          title="Click to select this polygon and zoom the map to it"
                        >{p.name}</button>
                      </label>
                      {p.sourceType === 1 && p.sourceCode && (
                        <div className="ml-5 mt-0.5">
                          <span className="inline-block px-1.5 py-0.5 rounded bg-brand-cyan/20 text-brand-dark text-[9px] font-semibold">
                            from ZIP {p.sourceCode}
                          </span>
                        </div>
                      )}
                      <div className="ml-5 mt-0.5 text-[10px] text-text-muted">
                        {p.attachedRouteCount > 0
                          ? `attached to ${p.attachedRouteCount} route(s)`
                          : 'not attached to any route'}
                      </div>
                      <div
                        className="ml-5 mt-0.5 text-[10px] text-text-muted"
                        title={
                          `Created by ${p.createdBy} on ${formatAuditDate(p.createdUtc)}`
                          + (p.lastModifiedUtc
                            ? `\nLast updated by ${p.updatedBy ?? '(unknown)'} on ${formatAuditDate(p.lastModifiedUtc)}`
                            : '\nNever updated since creation')
                        }
                      >
                        {p.lastModifiedUtc
                          ? `updated by ${p.updatedBy ?? '(unknown)'} - ${formatAuditDate(p.lastModifiedUtc)}`
                          : `created by ${p.createdBy} - ${formatAuditDate(p.createdUtc)}`}
                      </div>
                      {p.points.length > MAX_EDIT_HANDLE_VERTICES && (
                        <div className="ml-5 mt-0.5 text-[10px] text-warning italic">
                          {p.points.length} vertices - too many for direct edit. Simplify first.
                        </div>
                      )}
                      <div className="ml-5 mt-1 flex flex-wrap gap-1">
                        {isEditing
                          ? <button className="text-[10px] font-semibold text-success"
                              onClick={stopEdit}>Done editing</button>
                          : <button className="text-[10px] font-semibold text-brand-purple hover:underline"
                              onClick={() => startEdit(p.polygonId)}
                              disabled={mode === 'drawing' || p.points.length > MAX_EDIT_HANDLE_VERTICES}
                              title={p.points.length > MAX_EDIT_HANDLE_VERTICES ? 'Too many vertices - simplify first' : undefined}>Edit shape</button>}
                        {p.points.length > ZIP_TO_COVERAGE_MAX_VERTICES && (
                          <button className="text-[10px] font-semibold text-warning hover:underline"
                            onClick={() => simplifyPolygonInPlace(p)}
                            disabled={mode !== 'view'}
                            title={`Reduce ${p.points.length} vertices via Douglas-Peucker to ~${ZIP_TO_COVERAGE_MAX_VERTICES}`}>Simplify shape</button>
                        )}
                        <button className="text-[10px] text-error hover:underline"
                          onClick={() => removePolygon(p)}>Remove</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>
      </div>

      {contextMenu && (
        <PolygonContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onSelectZipShape={(s) => { toggleZip(s); setContextMenu(null); }}
          onUseZipAsStartingShape={(z) => { setContextMenu(null); void useZipAsStartingShape(z); }}
          onLoadZip={(z) => { setContextMenu(null); void loadZip(z); }}
          onZoomToShape={(s) => {
            const path = parseWktPolygon(s.wkt);
            if (!path || !mapRef.current) return;
            const g = (window as any).google;
            const b = new g.maps.LatLngBounds();
            path.forEach((p) => b.extend(p));
            mapRef.current.fitBounds(b);
            setContextMenu(null);
          }}
          onZoomToPolygon={(p) => { setContextMenu(null); zoomToPolygon(p); }}
          onEditPolygon={(p) => { setContextMenu(null); startEdit(p.polygonId); }}
          onSimplifyPolygon={(p) => { setContextMenu(null); void simplifyPolygonInPlace(p); }}
          onRemovePolygon={(p) => { setContextMenu(null); void removePolygon(p); }}
          onStartDraw={() => { setContextMenu(null); startDraw(); }}
          onStartLasso={() => { setContextMenu(null); startLasso(); }}
          onStartRect={() => { setContextMenu(null); startRect(); }}
          onStartCircle={() => { setContextMenu(null); startCircle(); }}
          maxEditVertices={MAX_EDIT_HANDLE_VERTICES}
          simplifyThreshold={ZIP_TO_COVERAGE_MAX_VERTICES}
        />
      )}

      {openSaveModal && pendingPolygon && (
        <SaveNewPolygonModal vertices={pendingPolygon}
          onCancel={() => setOpenSaveModal(false)}
          onCreated={onPolygonCreated} />
      )}

      {zipSaveOpen && (
        <SaveAsRouteModal
          zipSelection={selected} polygonSelection={[]}
          onClose={() => setZipSaveOpen(false)}
          onSaved={() => {
            setZipSaveOpen(false);
            toast.show('Route saved. Manage it under Scheduled Routes.', 'success');
            clearAll();
          }}
        />
      )}

      {polygonSaveOpen && (
        <SaveAsRouteModal
          zipSelection={[]} polygonSelection={selectedPolygonList}
          onClose={() => setPolygonSaveOpen(false)}
          onSaved={() => {
            setPolygonSaveOpen(false);
            toast.show('Route saved. Manage it under Scheduled Routes.', 'success');
            setSelectedPolygons(new Set());
          }}
        />
      )}
    </div>
  );
}

// ─── SaveNewPolygonModal ────────────────────────────────────────────────

interface SaveNewPolygonProps {
  vertices: LatLng[];
  onCancel: () => void;
  onCreated: (created: BulkPolygon) => void;
}

function SaveNewPolygonModal({ vertices, onCancel, onCreated }: SaveNewPolygonProps) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.show('Coverage polygon name is required.', 'error'); return; }
    setSaving(true);
    try {
      const points: PolygonPoint[] = vertices.map((v, i) => ({
        orderIndex: i, lat: v.lat, lng: v.lng,
      }));
      const centroid = polygonCentroid(vertices);
      const res = await bulkPolygonService.create({
        name: trimmed,
        centroidLatitude: centroid.lat, centroidLongitude: centroid.lng,
        points,
        sourceType: 0,
        sourceCode: null,
      });
      onCreated(res.response);
      toast.show(`Coverage polygon "${trimmed}" saved. Use "Save coverage as Route" to attach it to a schedule.`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={true} onClose={onCancel} title="Save coverage polygon"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onCancel}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={commit} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : `Save (${vertices.length} vertices)`}
          </Button>
        </div>
      }>
      <div className="space-y-3 text-sm">
        <Field label="Name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS} autoFocus placeholder="e.g. Zimmer AM Med Auckland" />
        </Field>
        <p className="text-[11px] text-text-muted italic">
          The shape is saved to tblBulkRunPolygon and can be attached to one or more Routes later.
          Bookings whose pickup falls inside this shape will auto-assign to those Routes via the
          prebook geometry fallback.
        </p>
      </div>
    </Modal>
  );
}

// ─── SaveAsRouteModal ───────────────────────────────────────────────────

interface SaveAsRouteProps {
  zipSelection: ZipcodeLookup[];
  polygonSelection: BulkPolygon[];
  onClose: () => void;
  onSaved: () => void;
}

function SaveAsRouteModal({ zipSelection, polygonSelection, onClose, onSaved }: SaveAsRouteProps) {
  const toast = useToast();
  const user = useAuth();
  const zipShortLower = postcodeLabel(user.isUsTenant, true).toLowerCase();
  const zipLongLower = postcodeLabel(user.isUsTenant, false).toLowerCase();
  const isPolygon = polygonSelection.length > 0;
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [targetType, setTargetType] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<ScheduleLookup[]>([]);
  const [targets, setTargets] = useState<AssignableTargets | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [t, s] = await Promise.all([
          recurringRouteService.getAssignableTargets(),
          recurringRouteService.getSchedules(),
        ]);
        setTargets(t.response);
        setSchedules(s.response);
      } catch (e) { toast.show((e as Error).message, 'error'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = useMemo<AssignableTarget[]>(() => {
    if (!targets) return [];
    return targetType === 1 ? targets.couriers
      : targetType === 2 ? targets.agents
      : targetType === 3 ? targets.nps
      : [];
  }, [targets, targetType]);

  const commit = async () => {
    if (!name.trim()) { toast.show('Route name is required', 'error'); return; }
    setSaving(true);
    try {
      await recurringRouteService.create({
        name: name.trim(),
        area: area.trim(),
        defaultTargetType: targetType,
        defaultTargetId: targetType ? targetId : null,
        scheduleId,
        active: true,
        zipPolygonIds: zipSelection.map((z) => z.zipPolygonId),
        bulkPolygonIds: polygonSelection.map((p) => p.polygonId),
      });
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  const count = isPolygon ? polygonSelection.length : zipSelection.length;
  const noun = isPolygon ? 'coverage polygon' : zipShortLower;

  return (
    <Modal open={true} onClose={onClose} title={`Save ${isPolygon ? 'coverage polygons' : 'zip selection'} as recurring route`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={commit} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : `Create with ${count} ${noun}${count === 1 ? '' : 's'}`}
          </Button>
        </div>
      }>
      <div className="space-y-3 text-sm">
        <Field label="Name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS} autoFocus placeholder="e.g. Central Valley Pick up Route" />
        </Field>
        <Field label="Area / description">
          <input type="text" value={area} onChange={(e) => setArea(e.target.value)}
            className={INPUT_CLASS} placeholder="e.g. NeoGenomics Stockton / Modesto / Turlock evening wave" />
        </Field>
        <Field label="Schedule (optional)">
          <select value={scheduleId ?? ''} onChange={(e) => setScheduleId(e.target.value ? Number(e.target.value) : null)}
            className={INPUT_CLASS}>
            <option value="">- No schedule -</option>
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} - {s.startTime}-{s.endTime}
                {s.days.length > 0 && ` (${s.days.map((d) => DAYS_OF_WEEK[d - 1] ?? d).join(',')})`}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Default target type">
            <select value={targetType ?? ''}
              onChange={(e) => { setTargetType(e.target.value ? Number(e.target.value) : null); setTargetId(null); }}
              className={INPUT_CLASS}>
              <option value="">- None -</option>
              <option value="1">Courier</option>
              <option value="2">Agent</option>
              <option value="3">Network Partner</option>
            </select>
          </Field>
          <Field label="Default target">
            <select value={targetId ?? ''} onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
              className={INPUT_CLASS} disabled={!targetType}>
              <option value="">- Pick target -</option>
              {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="border border-border-light rounded p-2 bg-surface-cream text-xs">
          <div className="font-medium mb-1">
            {isPolygon ? `${polygonSelection.length} coverage polygon(s)` : `${zipSelection.length} ${zipLongLower}s`} will be attached:
          </div>
          <div className="flex flex-wrap gap-1">
            {isPolygon
              ? polygonSelection.map((p) => (
                  <span key={p.polygonId} className="px-2 py-0.5 rounded bg-warning/15 text-brand-dark">
                    {p.name}
                  </span>))
              : zipSelection.map((z) => (
                  <span key={z.zipPolygonId} className="px-2 py-0.5 rounded bg-brand-cyan/15 text-brand-dark">
                    {z.zip}
                  </span>))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Geometry helpers ──────────────────────────────────────────────────

/** Parse WKT "POLYGON((lng lat, ...))" or "MULTIPOLYGON(((lng lat, ...)))" into a lat/lng ring. Used for reading ZipPolygon source shapes. */
function parseWktPolygon(wkt: string | null): LatLng[] | null {
  if (!wkt) return null;
  const upper = wkt.toUpperCase();
  const start = upper.indexOf('((');
  const end = upper.indexOf('))');
  if (start < 0 || end < 0) return null;
  const body = wkt.substring(start + 2, end);
  const firstRing = body.split(')')[0].replace(/\(/g, '').trim();
  const pairs = firstRing.split(',').map((p) => p.trim());
  const path: LatLng[] = [];
  for (const pair of pairs) {
    const [lng, lat] = pair.split(/\s+/).map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) path.push({ lat, lng });
  }
  return path;
}

/** Convert a bulk polygon's points list into an ordered LatLng path. */
function pointsToLatLngPath(points: PolygonPoint[]): LatLng[] {
  return points
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((p) => ({ lat: p.lat, lng: p.lng }));
}

function polygonCentroid(ring: LatLng[]): LatLng {
  const sum = ring.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
}

/** MarkerClusterer renderer: emits a pill-shaped marker showing the
 *  cluster count. Colour scales with size (blue -> orange -> red) so
 *  operators can spot the dense areas at a glance. */
function buildClusterRenderer(): Renderer {
  return {
    render: ({ count, position }) => {
      const g = (window as any).google;
      const label = count.toLocaleString();
      // Colour ramp: 1..49 = brand cyan, 50..199 = brand orange, 200+ = red.
      const fill = count >= 200 ? '#ef4444' : count >= 50 ? '#f2994a' : '#00A3FF';
      const width = Math.max(38, label.length * 8 + 16);
      const height = 22;
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
        `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" ry="10"` +
        ` fill="${fill}" fill-opacity="0.92" stroke="#0d0c2c" stroke-width="1.2"/>` +
        `<text x="${width / 2}" y="${height / 2 + 4.5}" text-anchor="middle"` +
        ` font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="12" font-weight="700" fill="#0d0c2c">${label}</text>` +
        `</svg>`;
      const url = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
      return new g.maps.Marker({
        position,
        icon: {
          url,
          anchor: new g.maps.Point(width / 2, height / 2),
          scaledSize: new g.maps.Size(width, height),
        },
        // High zIndex so cluster bubbles sit above overlapping polygon fills.
        zIndex: Number(g.maps.Marker.MAX_ZINDEX ?? 1000) + count,
        title: `${label} postcodes here - click to zoom in`,
      });
    },
  };
}

/** Build an inline-SVG pill icon for a zip centroid marker. Shows the zip
 *  code as text inside a rounded rect coloured by selection state. Sized
 *  to accommodate 4-6 char labels (NZ 4-digit + US 5-digit + optional US
 *  ZIP+4 with hyphen).
 *  Returns an object shaped for google.maps.Marker.icon so setIcon works
 *  cleanly on both create + update. Anchor is the centre so the icon sits
 *  on top of the real centroid coordinate. */
function zipLabelIcon(
  zip: string,
  fillColour: string,
  isSelected: boolean,
): { url: string; anchor: { x: number; y: number } | null; scaledSize: { width: number; height: number } | null } {
  const textColour = isSelected ? '#0d0c2c' : '#0d0c2c';
  const strokeColour = isSelected ? '#0d0c2c' : '#0d0c2c';
  const bgOpacity = isSelected ? 1 : 0.92;
  const label = (zip || '').slice(0, 10);
  // Approx char width at 10px monospace-ish sans = 6px; padding 6px each side.
  const width = Math.max(30, label.length * 6 + 12);
  const height = 16;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="7" ry="7"` +
    ` fill="${fillColour}" fill-opacity="${bgOpacity}" stroke="${strokeColour}" stroke-width="1"/>` +
    `<text x="${width / 2}" y="${height / 2 + 3.5}" text-anchor="middle"` +
    ` font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="10" font-weight="600" fill="${textColour}">${label}</text>` +
    `</svg>`;
  const url = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  const g = (window as any).google;
  // Type-narrow via `any` because google.maps.Size / Point are runtime types.
  return {
    url,
    anchor: g?.maps ? (new g.maps.Point(width / 2, height / 2) as any) : null,
    scaledSize: g?.maps ? (new g.maps.Size(width, height) as any) : null,
  };
}

/** Standard Ramer-Douglas-Peucker line simplification. Tolerance is in
 *  degrees (lat/lng), which is a small distortion at NZ latitudes but fine
 *  for dispatch-scale coverage polygons. Preserves the first + last vertex
 *  (which for a closed ring are typically distinct as we don't repeat the
 *  closing vertex client-side). */
function douglasPeucker(points: LatLng[], tolerance: number): LatLng[] {
  if (points.length < 3) return points;
  const sqTol = tolerance * tolerance;

  const perpSqDist = (p: LatLng, a: LatLng, b: LatLng): number => {
    let x = a.lng, y = a.lat, dx = b.lng - x, dy = b.lat - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p.lng - x) * dx + (p.lat - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b.lng; y = b.lat; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = p.lng - x; dy = p.lat - y;
    return dx * dx + dy * dy;
  };

  // Iterative implementation to avoid stack blow-up on huge inputs.
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDist = 0, index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpSqDist(points[i], points[first], points[last]);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > sqTol && index !== -1) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Repeatedly Douglas-Peucker with a growing tolerance until the vertex
 *  count is at or under `maxVertices`. Starts at ~11m tolerance (0.0001 deg
 *  at the equator) and doubles until the target is met or tolerance blows
 *  past a sanity ceiling. Returns the input unchanged if it's already
 *  under the cap. */
function simplifyToMax(points: LatLng[], maxVertices: number): LatLng[] {
  if (points.length <= maxVertices) return points;
  let tolerance = 0.0001;
  let simplified = points;
  for (let i = 0; i < 24 && tolerance < 1; i++) {
    simplified = douglasPeucker(points, tolerance);
    if (simplified.length <= maxVertices) return simplified;
    tolerance *= 1.6;
  }
  return simplified;
}

/** Compact audit date rendered in the user's local timezone. The API returns
 *  UTC without a timezone marker (e.g. "2026-07-30T00:29:32.02"), which
 *  JavaScript would otherwise misread as local time - so we force a Z suffix
 *  when it's missing before parsing, then let toLocaleString convert to
 *  local zone. Zone abbreviation included so the display is unambiguous. */
function formatAuditDate(iso: string): string {
  if (!iso) return '';
  const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso);
  const utcIso = hasTz ? iso : iso + 'Z';
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
}

function projectPointOnSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return a;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

function segmentT(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

const INPUT_CLASS = 'w-full border border-border rounded-lg px-3 py-1.5 text-sm bg-surface-white text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 focus:border-brand-cyan';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-text-secondary text-xs mb-1">{label}</span>
      {children}
    </label>
  );
}

// ─── PolygonContextMenu ─────────────────────────────────────────────────
// Positioned overlay rendered at (x, y) with items tailored to the target
// kind. Dismisses on outside-click or Escape (Escape handled by the page-
// level keyboard effect). Constrains position so the menu doesn't overflow
// the right / bottom edge.

interface PolygonContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onSelectZipShape: (s: ZipPolygonShape) => void;
  onUseZipAsStartingShape: (z: ZipcodeLookup) => void;
  onLoadZip: (z: ZipcodeLookup) => void;
  onZoomToShape: (s: ZipPolygonShape) => void;
  onZoomToPolygon: (p: BulkPolygon) => void;
  onEditPolygon: (p: BulkPolygon) => void;
  onSimplifyPolygon: (p: BulkPolygon) => void;
  onRemovePolygon: (p: BulkPolygon) => void;
  onStartDraw: () => void;
  onStartLasso: () => void;
  onStartRect: () => void;
  onStartCircle: () => void;
  maxEditVertices: number;
  simplifyThreshold: number;
}

function PolygonContextMenu(props: PolygonContextMenuProps) {
  const { state, onClose } = props;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    // Delay-add so the same right-click that opened the menu doesn't dismiss it.
    const t = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onClick); };
  }, [onClose]);

  const clamped = {
    left: Math.min(state.x, window.innerWidth - 240),
    top: Math.min(state.y, window.innerHeight - 220),
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[3000] min-w-[200px] bg-surface-white border border-border rounded shadow-lg py-1 text-xs"
      style={{ left: clamped.left, top: clamped.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.target.kind === 'zipCentroid' && (
        <>
          <MenuItem label={`Load boundary for ${state.target.zip.zip}`}
            onClick={() => props.onLoadZip((state.target as { kind: 'zipCentroid'; zip: ZipcodeLookup }).zip)} />
          <MenuItem label="Use as starting shape"
            onClick={() => props.onUseZipAsStartingShape((state.target as { kind: 'zipCentroid'; zip: ZipcodeLookup }).zip)} />
        </>
      )}
      {state.target.kind === 'zipShape' && (
        <>
          <MenuItem label="Toggle selection"
            onClick={() => props.onSelectZipShape((state.target as { kind: 'zipShape'; shape: ZipPolygonShape }).shape)} />
          <MenuItem label="Use as starting shape"
            onClick={() => props.onUseZipAsStartingShape({
              zipPolygonId: (state.target as { kind: 'zipShape'; shape: ZipPolygonShape }).shape.zipPolygonId,
              zip: (state.target as { kind: 'zipShape'; shape: ZipPolygonShape }).shape.zip,
              latitude: (state.target as { kind: 'zipShape'; shape: ZipPolygonShape }).shape.latitude,
              longitude: (state.target as { kind: 'zipShape'; shape: ZipPolygonShape }).shape.longitude,
            })} />
          <MenuItem label="Zoom to fit"
            onClick={() => props.onZoomToShape((state.target as { kind: 'zipShape'; shape: ZipPolygonShape }).shape)} />
        </>
      )}
      {state.target.kind === 'polygon' && (
        <>
          <MenuItem label="Zoom to fit"
            onClick={() => props.onZoomToPolygon((state.target as { kind: 'polygon'; polygon: BulkPolygon }).polygon)} />
          <MenuItem
            label={state.target.polygon.points.length > props.maxEditVertices
              ? `Edit shape (disabled: ${state.target.polygon.points.length} vertices, simplify first)`
              : 'Edit shape'}
            disabled={state.target.polygon.points.length > props.maxEditVertices}
            onClick={() => props.onEditPolygon((state.target as { kind: 'polygon'; polygon: BulkPolygon }).polygon)} />
          {state.target.polygon.points.length > props.simplifyThreshold && (
            <MenuItem label="Simplify shape"
              onClick={() => props.onSimplifyPolygon((state.target as { kind: 'polygon'; polygon: BulkPolygon }).polygon)} />
          )}
          <MenuItem label="Remove" danger
            onClick={() => props.onRemovePolygon((state.target as { kind: 'polygon'; polygon: BulkPolygon }).polygon)} />
        </>
      )}
      {state.target.kind === 'mapBackground' && (
        <>
          <MenuItem label="Draw new polygon (P)" onClick={props.onStartDraw} />
          <MenuItem label="Freehand lasso (L)" onClick={props.onStartLasso} />
          <MenuItem label="Draw rectangle (R)" onClick={props.onStartRect} />
          <MenuItem label="Draw circle (C)" onClick={props.onStartCircle} />
        </>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, disabled, danger }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 ${disabled ? 'text-text-muted cursor-not-allowed' : danger ? 'text-error hover:bg-error/10' : 'text-text-primary hover:bg-surface-cream'}`}
    >
      {label}
    </button>
  );
}

// ─── DrawingToolsMenu ───────────────────────────────────────────────────
// Consolidates the 4 draw modes (Lasso, Rect, Circle, Vertex-draw) behind
// a single "Drawing Tools" button + dropdown, each with an inline-SVG
// glyph so the operator can pick a tool at a glance. Click-outside + Esc
// dismiss. Keyboard shortcuts (L / R / C / P) still fire independently.

interface DrawingToolsMenuProps {
  onStartDraw: () => void;
  onStartLasso: () => void;
  onStartRect: () => void;
  onStartCircle: () => void;
}

function DrawingToolsMenu({ onStartDraw, onStartLasso, onStartRect, onStartCircle }: DrawingToolsMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Delay-add so the same click that opened the dropdown doesn't dismiss it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const fire = (fn: () => void) => { setOpen(false); fn(); };

  const items: Array<{ label: string; shortcut: string; onClick: () => void; icon: React.ReactNode; primary?: boolean }> = [
    { label: 'Freehand lasso', shortcut: 'L', onClick: onStartLasso, icon: <IconLasso /> },
    { label: 'Rectangle',      shortcut: 'R', onClick: onStartRect,   icon: <IconRect /> },
    { label: 'Circle',         shortcut: 'C', onClick: onStartCircle, icon: <IconCircle /> },
    { label: 'Vertex polygon', shortcut: 'P', onClick: onStartDraw,   icon: <IconPolygon />, primary: true },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <Button variant="primary" size="sm" onClick={() => setOpen((o) => !o)}
        title="Choose a drawing tool">
        <span className="inline-flex items-center gap-1">
          <IconPencil />
          Drawing Tools
          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3 L5 7 L8 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      </Button>
      {open && (
        <div className="absolute right-0 mt-1 z-[3000] min-w-[220px] bg-surface-white border border-border rounded shadow-lg py-1 text-xs">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => fire(it.onClick)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 ${it.primary ? 'text-brand-purple font-semibold' : 'text-text-primary'} hover:bg-surface-cream`}
            >
              <span className="w-5 h-5 flex items-center justify-center text-text-secondary">{it.icon}</span>
              <span className="flex-1">{it.label}</span>
              <span className="text-[10px] text-text-muted font-mono border border-border-light rounded px-1 py-0.5">{it.shortcut}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Inline SVG glyphs. Kept simple (16x16 viewBox, currentColor stroke) so
// they inherit the surrounding text colour without an image asset load.
const IconLasso = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <ellipse cx="8" cy="6.5" rx="5.5" ry="3.5" />
    <path d="M4.5 9.5 Q5 12 7.5 12.5" strokeDasharray="1.5 1.5" />
  </svg>
);
const IconRect = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="2.5" y="3.5" width="11" height="9" />
  </svg>
);
const IconCircle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="8" cy="8" r="5.5" />
  </svg>
);
const IconPolygon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
    <polygon points="8,2 14,6 12,13 4,13 2,6" />
    <circle cx="8" cy="2" r="1.1" fill="currentColor" />
    <circle cx="14" cy="6" r="1.1" fill="currentColor" />
    <circle cx="12" cy="13" r="1.1" fill="currentColor" />
    <circle cx="4" cy="13" r="1.1" fill="currentColor" />
    <circle cx="2" cy="6" r="1.1" fill="currentColor" />
  </svg>
);
const IconPencil = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 14 L3 10 L11 2 L14 5 L6 13 Z" />
    <path d="M10 3 L13 6" />
  </svg>
);
