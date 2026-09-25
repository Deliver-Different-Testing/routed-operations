import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { tenantMapCentre } from '../lib/mapDefaults';
import { postcodeLabel } from '../lib/tenantLabels';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
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
  parsePartiallyIncludedZips,
  type BulkPolygon,
  type PolygonPoint,
} from '../services/bulkPolygonService';
import { ZonesDrawer } from '../components/polygon/ZonesDrawer';
import { zoneService, type RatingZoneDepot } from '../services/zoneService';
import { unionShapes, addRegion, cutRegion, keepRegion, splitByLine } from '../lib/polygonOps';
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
/** Cap on how many postal-polygon SHAPES we auto-load into the map at
 *  once. Each WKT can be 100KB+ and rendering a Google Maps Polygon per
 *  postcode is expensive; above this cap we skip auto-load and let the
 *  operator click individual centroids instead. */
const MAX_AUTO_SHAPES_IN_VIEWPORT = 300;
/** Batch size for the per-viewport shape fetch. Kept small enough that a
 *  single response stays under a few MB even on tenants with rich WKT. */
const AUTO_SHAPE_FETCH_BATCH_SIZE = 50;

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
  const askConfirm = useConfirm();
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

  // ── PERF: state mirror refs ──────────────────────────────────────────
  // The drawing hot-path (snapTo, mousemove listener) reads loadedShapes,
  // polygons, and drawingVertices on every event fire. If we let the
  // drawing effect depend on those state atoms, every zip-shape auto-load
  // or vertex click tears down + re-adds the map click/mousemove listeners
  // (many times/second during draw). Mirror the three state atoms into
  // refs so the drawing effect stays mounted with `[mode]` deps only, and
  // snapTo() reads the current values from refs.
  const loadedShapesRef = useRef<ZipPolygonShape[]>([]);
  const polygonsListRef = useRef<BulkPolygon[]>([]);
  const drawingVerticesRef = useRef<LatLng[]>([]);
  const modeRef = useRef<Mode>('view');

  // ── PERF: pre-parsed snap-target cache ───────────────────────────────
  // Vertex draw was the laggiest tool because snapTo() parsed every WKT
  // string on every mousemove (300 shapes x ~100 vertices = ~30k
  // parseFloat calls per event, at 60Hz). The parsed geometry only
  // changes when loadedShapes or polygons change, so cache it in refs
  // and rebuild on those state deltas via a dedicated effect (see
  // below). snapTo now iterates cached LatLng[][] arrays with zero
  // parsing on the hot path.
  const parsedZipShapesRef = useRef<LatLng[][]>([]);
  const parsedCoverageShapesRef = useRef<{ id: number; path: LatLng[] }[]>([]);

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
  // finishes (mouseup / auto-close / +Finish), rings land here and mode
  // switches to 'pending' - the polygon becomes editable in place with
  // the SAME toolbar as edit-mode (Shape picker + Add / Cut / Clip /
  // Split + Undo). The save-name modal only opens when the operator
  // explicitly clicks "Finish drawing" (which sets openSaveModal true).
  //
  // Shape: LatLng[][] to match saved polygons (multi-ring, winding-
  // order encoded: CCW = new piece, CW = hole). Fresh draws land as a
  // single ring `[ring]`; subsequent Cut / Split ops may grow the array.
  // 2026-08-06 (user request): unified with edit-mode so operators see
  // the same tools whether the shape is new or saved.
  const [pendingPolygon, setPendingPolygon] = useState<LatLng[][] | null>(null);
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

  // Auto-shape-load tracking. Auto-loaded shapes render on the map by
  // default but are NOT added to the "selected" set - they are read-only
  // boundaries the operator can see, click, or use as a starting shape.
  // Refs (not state) so bounds_changed can dedupe against in-flight ids
  // without re-renders churning the effect chain.
  const inFlightShapeIdsRef = useRef<Set<number>>(new Set());
  const shapeAutoLoadFailedRef = useRef<Set<number>>(new Set());
  // Tracks the previous selected-count so the zip overlay sync effect
  // only fitBounds when the operator explicitly added a selection
  // (search / marker click). Auto-loaded shapes grow loadedShapes
  // without growing selected, so their arrival must not fit-bounds and
  // wipe out the operator's current pan/zoom.
  const prevSelectedCountRef = useRef<number>(0);
  // Flag consumed by the zip overlay effect on the next render: when set,
  // fitBounds fires unconditionally against the current `selected` shapes
  // (bypasses the "selection just grew" gate). Used by the "click a zone
  // to focus" affordances in ZonesDrawer and coverage polygon rows, which
  // REPLACE the selection wholesale (may shrink it) but still want the map
  // to snap to the new shapes.
  const pendingFocusRef = useRef<boolean>(false);

  // Stage 4: right-click context menu (see ContextMenuState type).
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // View Zones drawer open state. Fetches lazily on first open (see
  // ZonesDrawer). Keeps state at the page level so re-opens after a
  // save/reshape read the same cached payload.
  const [zonesDrawerOpen, setZonesDrawerOpen] = useState(false);
  // 2026-08-05 (George feedback): prefetch the zones payload in the
  // background right after the page settles so the first click on
  // "View Zones" opens the drawer with data already in hand instead
  // of showing a "Fetching…" spinner. Fetch fires from the map's
  // first idle so it competes with nothing on the critical path.
  const [prefetchedZones, setPrefetchedZones] = useState<RatingZoneDepot[] | null>(null);
  const zonesPrefetchStartedRef = useRef(false);

  // Stage 4: freehand lasso in-progress buffer + live polyline ref.
  const lassoBufferRef = useRef<LatLng[]>([]);

  // ── Edit-mode boolean-op state (2026-08-06 Add / Cut / Keep) ────────
  // When the operator clicks Add / Cut / Keep from the edit-mode
  // toolbar, we capture the pending op + the polygon being edited into
  // this ref, then flip mode to 'lassoing' so the operator can trace
  // the region on the map. The lasso's finishStroke consults this ref:
  // if set, it applies the boolean op (via polygon-clipping) instead of
  // creating a fresh pending polygon.
  //
  // Sentinel for the pending (unsaved) polygon. applyBooleanOp +
  // undoLastBooleanOp branch on this to skip the server round-trip
  // (pendingPolygon lives in local state only until Save).
  const PENDING_ID = -1;
  const pendingBooleanOpRef = useRef<{
    op: 'add' | 'cut' | 'keep' | 'split';
    // Which drawing tool the operator picked to specify the region /
    // line for this op. Freehand for lasso, rect for rectangle, circle
    // for circle. Split always uses freehand (rect / circle don't yield
    // a polyline that can meaningfully split a polygon).
    shape: 'freehand' | 'rect' | 'circle';
    polygonId: number;
  } | null>(null);
  // Which drawing tool the boolean-op buttons use in edit mode. Persists
  // across ops so an operator carving multiple rectangular chunks picks
  // "Rectangle" once and keeps clicking Cut. Freehand is the default -
  // it's the most flexible and covers the widest range of shapes.
  const [editShapeInput, setEditShapeInput] = useState<'freehand' | 'rect' | 'circle'>('freehand');
  // Multi-step undo STACK: pushes a snapshot of the polygon's ring set
  // BEFORE each edit op (vertex drag / midpoint insert / vertex delete /
  // Add / Cut / Clip). Undo pops the top entry and restores it, so
  // repeated Undo clicks walk backwards through the whole edit session
  // one step at a time. Capped at MAX_UNDO_STACK to bound memory (a
  // large multi-ring polygon can be ~50KB per snapshot); when the cap
  // is hit, the OLDEST entry is dropped rather than refusing new ops.
  // Cleared on stopEdit - undo is a within-session concept only.
  const MAX_UNDO_STACK = 20;
  const editUndoStackRef = useRef<Array<{ polygonId: number; rings: LatLng[][] }>>([]);
  // Version counter to force re-render of the Undo button's disabled
  // state when the stack changes. The ref itself doesn't trigger
  // renders; bumping this on every push / pop does.
  const [undoVersion, setUndoVersion] = useState(0);
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
        // PERF: intentionally do NOT call autoLoadShapesInViewport()
        // here. WKT body fetch + parse + Polygon render for the first
        // viewport was the biggest single load-lag contributor on NZ
        // Urgent Staging (George feedback 2026-08-05). Shape auto-load
        // now waits for the user's first pan / zoom - the bounds
        // `idle` listener below picks it up naturally.
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

    // Viewport sync for zip centroid markers + auto-loaded postal polygon
    // shapes. PERF: fires on `idle` (Google's recommended event for
    // heavy overlay work - fires once when the user stops panning /
    // zooming, versus `bounds_changed` which fires on every frame during
    // an active drag). Kept a small debounce as an extra safety net for
    // rapid zoom-in / zoom-out sequences that fire idle back-to-back.
    // See https://developers.google.com/maps/optimization-guide.
    //
    // PERF: skip the first idle event entirely. The addListenerOnce
    // above (marker population) already handles the first idle for
    // centroid rendering; scheduling ANOTHER sync + shape-load on the
    // same first idle just duplicates work and pulls WKT bodies before
    // the user has expressed intent to look at the map. From the second
    // idle onwards (any user pan / zoom), the full sync runs normally.
    let firstIdleSeen = false;
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSync = () => {
      if (!firstIdleSeen) { firstIdleSeen = true; return; }
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncCentroidMarkersToViewport();
        autoLoadShapesInViewport();
      }, VIEWPORT_SYNC_DEBOUNCE_MS);
    };
    const boundsListener = map.addListener('idle', scheduleSync);

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

  // ── PERF: mirror state into refs on every render so the drawing
  // hot-path can read current values without triggering listener re-wire.
  loadedShapesRef.current = loadedShapes;
  polygonsListRef.current = polygons;
  drawingVerticesRef.current = drawingVertices;
  modeRef.current = mode;

  // ── PERF: rebuild the pre-parsed snap-target cache when either input
  // dataset changes. This runs O(N vertices) once per dataset change
  // instead of once per mousemove (~60Hz). The cache is the single
  // biggest reason vertex draw feels laggy without this - before caching,
  // each mousemove was parsing 300 WKT strings and re-materialising
  // ~30k LatLng objects.
  useEffect(() => {
    const parsed: LatLng[][] = [];
    loadedShapes.forEach((s) => {
      const p = parseWktPolygon(s.wkt);
      if (p && p.length >= 3) parsed.push(p);
    });
    parsedZipShapesRef.current = parsed;
  }, [loadedShapes]);

  useEffect(() => {
    // Cache flattens multi-ring polygons into per-ring entries so snap
    // targets include holes and disjoint pieces, not just the outer.
    // Same `id` may repeat if a polygon has multiple rings - snapTo
    // treats them all as candidate snap targets against the current
    // cursor, which is what we want.
    parsedCoverageShapesRef.current = polygons.flatMap((poly) =>
      pointsToLatLngRings(poly.points)
        .filter((ring) => ring.length >= 3)
        .map((path) => ({ id: poly.polygonId, path })),
    );
  }, [polygons]);

  // Load bulk polygons on mount.
  useEffect(() => {
    void reloadPolygons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── PERF: prefetch View Zones data in the background so the drawer
  // opens instantly when the operator clicks View Zones. Fires 800ms
  // after mount to yield the critical path to the map load + centroid
  // fetch + polygon list. Ref guard prevents duplicate fetches under
  // React StrictMode double-mount in dev.
  useEffect(() => {
    if (zonesPrefetchStartedRef.current) return;
    zonesPrefetchStartedRef.current = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await zoneService.getRatingZones();
          setPrefetchedZones(res.response ?? []);
        } catch {
          // Silent - the drawer will fall back to its own on-open fetch
          // and surface the error via toast at that point.
        }
      })();
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load ALL zip centroids on mount (one call, cached in ref).
  // Mount-guard prevents "window is not defined" unhandled rejections
  // in vitest: the fetch can resolve AFTER the test tears down jsdom,
  // at which point toast.show -> setState -> React scheduler tries to
  // read `window` and blows up. Bailing out early on unmount also
  // avoids a React "set state on unmounted component" warning under
  // StrictMode.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await recurringRouteService.getAllZipcodeCentroids();
        if (!mounted) return;
        zipCentroidsRef.current = res.response ?? [];
        setZipCentroidsReady(true);
      } catch (e) {
        if (!mounted) return;
        toast.show((e as Error).message, 'error');
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build all markers + do initial counter sync when both centroids +
  // map are ready. Also wait for the map to be idle so the clusterer's
  // projection is available (see the idle listener in map-init above
  // for why this matters).
  //
  // PERF: intentionally does NOT call autoLoadShapesInViewport() on the
  // first paint. Loading the WKT bodies for every zip in the initial
  // viewport was the biggest single contributor to "click Polygon
  // Builder -> sits there for seconds" - one batch of 50 shapes can
  // pull 250KB-2.5MB of coordinate strings, then each has to be parsed
  // + rendered as a Google Maps Polygon. Now the first shape batch
  // fires on the first `idle` after the user pans / zooms (the
  // boundsListener wired up in map-init already handles this), which
  // (a) gets the operator onto the page immediately and (b) means the
  // shape load happens in the background while they orient themselves.
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
    // Fit-bounds triggers when the operator either just added a selection
    // (search / centroid click) OR explicitly clicked a "focus this zone /
    // polygon" affordance that sets pendingFocusRef. The focus flag is a
    // one-shot: pending overrides the growth check and always refits.
    const selectionJustGrew = selected.length > prevSelectedCountRef.current;
    const focusRequested = pendingFocusRef.current;
    prevSelectedCountRef.current = selected.length;
    if (focusRequested) pendingFocusRef.current = false;
    if ((selectionJustGrew || focusRequested)
        && boundsCount > 0
        && selected.length > 0
        && selected.length <= 15) {
      const selectedBounds = new g.maps.LatLngBounds();
      let selectedBoundsCount = 0;
      loadedShapes.forEach((s) => {
        if (!selectedSet.has(s.zipPolygonId)) return;
        const path = parseWktPolygon(s.wkt);
        if (!path || path.length < 3) return;
        path.forEach((pt) => { selectedBounds.extend(pt); selectedBoundsCount++; });
      });
      if (selectedBoundsCount > 0) mapRef.current.fitBounds(selectedBounds);
    }
    // BUGFIX 2026-08-05 (George): `mode` MUST be in the deps so this effect
    // re-runs when the operator switches from 'view' to 'drawing' /
    // 'lasso' / 'circling' / 'edit'. The `clickable: mode === 'view'`
    // update at the poly.setOptions call above only lands on existing
    // overlays if the effect re-fires. Without this dep, zip polygons
    // kept their `clickable: true` from creation-time, so Google Maps
    // consumed the vertex-add click at the polygon layer (firing
    // toggleZip) and the map's click handler never received it -> user
    // couldn't add a vertex when the cursor was over an existing zip
    // polygon. Coverage-polygon effect below already has `mode` in deps
    // and works correctly; this is the counterpart fix for zip overlays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedShapes, selected, mode]);

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
      // Multi-ring aware: setPaths accepts LatLng[][] for both single- and
      // multi-piece polygons (Google Maps infers hole vs new piece from
      // winding order). Single-ring polygons come out as [outer].
      const rings = pointsToLatLngRings(p.points);
      if (rings.length === 0 || rings[0].length < 3) return;
      const color = POLYGON_PALETTE[idx % POLYGON_PALETTE.length];
      const isSelected = selectedPolygons.has(p.polygonId);
      let poly = polygonOverlaysRef.current.get(p.polygonId);
      if (!poly) {
        poly = new g.maps.Polygon({
          paths: rings, map: mapRef.current, clickable: mode === 'view',
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
        poly.setPaths(rings);
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

  /** Auto-load postal polygon SHAPES for postcodes in the current
   *  viewport so operators see boundaries by default without clicking
   *  each centroid. Only fires when zoom is high enough for individual
   *  pills (below that, we're showing cluster bubbles and shapes would
   *  overwhelm the map). Skips when the viewport contains more than
   *  MAX_AUTO_SHAPES_IN_VIEWPORT postcodes to protect memory / render
   *  budget. Failed fetches are quarantined so we don't retry-storm. */
  const autoLoadShapesInViewport = () => {
    const map = mapRef.current;
    const g = (window as any).google;
    if (!map || !g?.maps) return;
    if (currentZoom < INDIVIDUAL_PILL_MIN_ZOOM) return;
    const bounds = map.getBounds();
    if (!bounds) return;

    const alreadyLoaded = new Set(loadedShapes.map((s) => s.zipPolygonId));
    const wanted: number[] = [];
    for (const c of zipCentroidsRef.current) {
      if (c.latitude == null || c.longitude == null) continue;
      if (alreadyLoaded.has(c.zipPolygonId)) continue;
      if (inFlightShapeIdsRef.current.has(c.zipPolygonId)) continue;
      if (shapeAutoLoadFailedRef.current.has(c.zipPolygonId)) continue;
      if (!bounds.contains(new g.maps.LatLng(c.latitude, c.longitude))) continue;
      wanted.push(c.zipPolygonId);
      if (wanted.length > MAX_AUTO_SHAPES_IN_VIEWPORT) return;
    }
    if (wanted.length === 0) return;

    const batch = wanted.slice(0, AUTO_SHAPE_FETCH_BATCH_SIZE);
    batch.forEach((id) => inFlightShapeIdsRef.current.add(id));
    void (async () => {
      try {
        const res = await recurringRouteService.getPolygonShapes(batch);
        const shapes = res.response ?? [];
        setLoadedShapes((prev) => {
          const map = new Map(prev.map((s) => [s.zipPolygonId, s]));
          shapes.forEach((s) => map.set(s.zipPolygonId, s));
          return Array.from(map.values());
        });
      } catch {
        batch.forEach((id) => shapeAutoLoadFailedRef.current.add(id));
      } finally {
        batch.forEach((id) => inFlightShapeIdsRef.current.delete(id));
      }
    })();
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

  /** Format a "derived N postcode(s)" trailer for the post-save toast.
   *  Called after every polygon create/reshape so operators can see what
   *  the auto-overlay computed. Truncates long lists to 6 postcodes + " +N
   *  more" so a big shape doesn't blow past the toast width. */
  const derivedZipsToastTrailer = (polygon: BulkPolygon): string => {
    const zips = parsePartiallyIncludedZips(polygon.partiallyIncludedZips);
    if (zips.length === 0) return ' (no overlapping postcodes)';
    const head = zips.slice(0, 6).join(', ');
    const tail = zips.length > 6 ? `, +${zips.length - 6} more` : '';
    return ` Derived ${zips.length} postcode${zips.length === 1 ? '' : 's'}: ${head}${tail}.`;
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
    if (ready && zipCentroidsReady && mapRef.current) {
      syncCentroidMarkersToViewport();
      autoLoadShapesInViewport();
    }
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

  /** Load the ZipPolygon shapes for a set of zip strings onto the map,
   *  highlighting them in the "selected" orange colour so they visually
   *  pop against the ~200 blue auto-loaded viewport shapes. Reused by:
   *    - "Show on map" on a coverage polygon's sidebar entry (from
   *      PartiallyIncludedZips)
   *    - a click on a zone row inside the VIEW Zones drawer
   *
   *  Selection is REPLACED wholesale (not merged) so each click is a
   *  clean "focus my attention on these zips" gesture and previously-
   *  highlighted zips fall back to the default blue. pendingFocusRef is
   *  set so the overlay effect refits bounds even when the new selection
   *  is smaller than the previous. Side effect: the highlighted zips
   *  count toward the "Save as Route (N)" button, which is the natural
   *  next step for both flows. */
  const showZipStringsOnMap = async (zipStrings: string[], contextLabel: string) => {
    if (zipStrings.length === 0) {
      toast.show(`${contextLabel} has no zips to show.`, 'error');
      return;
    }
    const zipToLookup = new Map<string, ZipcodeLookup>();
    for (const c of zipCentroidsRef.current) {
      if (c.zip) zipToLookup.set(c.zip, c);
    }
    const resolved: ZipcodeLookup[] = [];
    const missing: string[] = [];
    for (const zs of zipStrings) {
      const hit = zipToLookup.get(zs);
      if (hit) resolved.push(hit);
      else missing.push(zs);
    }
    if (resolved.length === 0) {
      toast.show(`Could not resolve any of the ${zipStrings.length} zip(s) to shapes.`, 'error');
      return;
    }
    try {
      const res = await recurringRouteService.getPolygonShapes(
        resolved.map((z) => z.zipPolygonId));
      const shapes = res.response ?? [];
      setLoadedShapes((prev) => {
        const map = new Map(prev.map((s) => [s.zipPolygonId, s]));
        shapes.forEach((s) => map.set(s.zipPolygonId, s));
        return Array.from(map.values());
      });
      // Replace selection wholesale + request an unconditional fitBounds
      // so the map snaps to the clicked zone even when the new selection
      // is smaller than the previous one.
      pendingFocusRef.current = true;
      setSelected(resolved);
      const msg = missing.length > 0
        ? `Focused ${shapes.length} zip(s) on the map. ${missing.length} zip(s) could not be resolved.`
        : `Focused ${shapes.length} zip(s) on the map.`;
      toast.show(msg, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const showIncludedZipsOnMap = (polygon: BulkPolygon) =>
    showZipStringsOnMap(
      parsePartiallyIncludedZips(polygon.partiallyIncludedZips),
      `Coverage polygon "${polygon.name}"`);

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
        ringIndex: 0, orderIndex: i, lat: pt.lat, lng: pt.lng,
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
      toast.show(
        `Coverage polygon created from ${zipShortLower} ${z.zip}. Drag to reshape.${derivedZipsToastTrailer(res.response)}`,
        'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setConverting(null); }
  };

  /** Combine {N} selected zip polygons into a single coverage shape and
   *  drop the operator into edit mode on the result. Adjacent zips union
   *  into one merged piece; disjoint zips produce a multi-piece shape
   *  (persisted via the RingIndex column added 2026-08-06). Requires
   *  all selected zip shapes to be loaded in `loadedShapes` (auto-
   *  loaded when they enter the viewport at high zoom, or clicked).
   *  Any selected zips without a loaded WKT get skipped with a toast
   *  telling the operator to pan to them first. */
  const [combining, setCombining] = useState(false);
  const combineSelectedAsShape = async () => {
    if (selected.length < 2) return;

    // Gather rings from loaded shapes; each zip becomes [outerRing] (a
    // single-ring shape passed to unionShapes as one item).
    const shapes: LatLng[][][] = [];
    const missing: string[] = [];
    for (const z of selected) {
      const loaded = loadedShapes.find((s) => s.zipPolygonId === z.zipPolygonId);
      const path = loaded ? parseWktPolygon(loaded.wkt) : null;
      if (!path || path.length < 3) {
        missing.push(z.zip);
        continue;
      }
      shapes.push([path]);
    }
    if (shapes.length < 2) {
      toast.show(
        missing.length > 0
          ? `Load shapes for ${missing.join(', ')} first (pan to them at zoom ${INDIVIDUAL_PILL_MIN_ZOOM}+).`
          : `Need at least 2 loaded ${zipShortLower} shapes to combine.`,
        'error',
      );
      return;
    }
    if (missing.length > 0) {
      toast.show(
        `Skipped ${missing.length} ${missing.length === 1 ? zipShortLower : `${zipShortLower}s`} without a loaded shape (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}). Combining the remaining ${shapes.length}.`,
        'error',
      );
    }

    setCombining(true);
    try {
      // Union all loaded zip shapes. Adjacent ones merge; disjoint stay
      // as separate pieces in the returned ring list (encoded via
      // winding order that Google Maps + our RingIndex storage both
      // consume directly).
      const unionedRings = unionShapes(shapes);
      if (unionedRings.length === 0 || unionedRings[0].length < 3) {
        toast.show('Union produced an empty shape - selected zips do not overlap or touch cleanly.', 'error');
        return;
      }

      // Simplify each ring if over the edit-mode vertex cap. Coastal
      // zips can have 500+ vertices tracing every rock; the union
      // inherits all of them and edit-mode falls over.
      const simplifiedRings = unionedRings.map((ring) =>
        ring.length > ZIP_TO_COVERAGE_MAX_VERTICES
          ? simplifyToMax(ring, ZIP_TO_COVERAGE_MAX_VERTICES)
          : ring,
      );
      const totalVertsBefore = unionedRings.reduce((n, r) => n + r.length, 0);
      const totalVertsAfter = simplifiedRings.reduce((n, r) => n + r.length, 0);
      if (totalVertsAfter < totalVertsBefore) {
        toast.show(
          `Simplified ${totalVertsBefore} -> ${totalVertsAfter} vertices for editability.`,
          'success',
        );
      }

      // Flatten rings to the single PolygonPoint[] the API expects, with
      // ringIndex encoding piece / hole membership.
      const points: PolygonPoint[] = [];
      simplifiedRings.forEach((ring, ringIndex) => {
        ring.forEach((pt, orderIndex) => {
          points.push({ ringIndex, orderIndex, lat: pt.lat, lng: pt.lng });
        });
      });
      // Centroid stamped from the first (outer) ring - accurate enough
      // for the map centre pin and matches the single-ring convention.
      const centroid = polygonCentroid(simplifiedRings[0]);

      const zipsSummary = selected.length <= 4
        ? selected.map((z) => z.zip).join(', ')
        : `${selected.length} ${zipShortLower}s`;
      const res = await bulkPolygonService.create({
        name: `Combined ${zipsSummary}`,
        centroidLatitude: centroid.lat,
        centroidLongitude: centroid.lng,
        points,
        sourceType: 0, // Manual - not a single-zip copy.
        sourceCode: null,
      });
      setPolygons((prev) => [...prev, res.response]);
      setSelected([]); // Clear selection - the operator is now editing the combined shape.
      setMode({ edit: res.response.polygonId });
      const pieceCount = simplifiedRings.filter((r, i) =>
        i === 0 || signedRingArea(r) > 0,
      ).length;
      toast.show(
        `Combined ${shapes.length} ${zipShortLower}s into ${pieceCount === 1 ? 'a single shape' : `${pieceCount} disjoint pieces`}. Drag the handles to refine.${derivedZipsToastTrailer(res.response)}`,
        'success',
      );
    } catch (e) {
      toast.show((e as Error).message, 'error');
    } finally {
      setCombining(false);
    }
  };

  // ── Edit-mode Add / Cut / Keep tools (2026-08-06) ────────────────────
  // Each button captures the target polygon + the pending op into
  // pendingBooleanOpRef, then flips mode to 'lassoing'. The lasso
  // finishStroke below consults the ref and routes to applyBooleanOp
  // when set; otherwise falls back to the normal "new pending polygon"
  // flow. Escape / cancel-lasso clears the ref so a stray Esc doesn't
  // leak an op into the operator's next lasso.
  /** After a boolean-op stroke completes (or cancels), return to the
   *  source mode that started the op. Saved polygons resume edit; the
   *  pending draft resumes pending. Centralized so every finish-stroke
   *  / cancel-stroke site routes identically. */
  const returnToTargetMode = (polygonId: number) => {
    if (polygonId === PENDING_ID) setMode('pending');
    else setMode({ edit: polygonId });
  };

  const startBooleanOp = (op: 'add' | 'cut' | 'keep' | 'split') => {
    // Boolean ops fire from either edit mode (saved polygon) or pending
    // mode (unsaved draft). Route to the correct target via the
    // PENDING_ID sentinel; downstream applyBooleanOp branches on it.
    const editingId = typeof mode === 'object' ? mode.edit : null;
    const targetId = editingId ?? (mode === 'pending' ? PENDING_ID : null);
    if (targetId == null) return;
    // Split always uses freehand - a rectangle or circle doesn't
    // produce a polyline that can split a polygon into two pieces.
    const shape = op === 'split' ? 'freehand' : editShapeInput;
    pendingBooleanOpRef.current = { op, shape, polygonId: targetId };
    if (shape === 'freehand') setMode('lassoing');
    else if (shape === 'rect') setMode('rectangling');
    else setMode('circling');
  };

  /** Apply a boolean op (union / difference / intersection) to the
   *  polygon being edited, PUT the new shape, snapshot the prior state
   *  for undo, and re-enter edit mode. */
  const applyBooleanOp = async (
    op: 'add' | 'cut' | 'keep' | 'split',
    polygonId: number,
    drawn: LatLng[],
  ) => {
    // Two flavours: saved (polygonId > 0, hits the server) vs pending
    // (polygonId === PENDING_ID, local state only). Snapshot source
    // rings differs; everything downstream (ops, undo, toast) is shared.
    const isPending = polygonId === PENDING_ID;
    let currentRings: LatLng[][];
    if (isPending) {
      if (!pendingPolygon || pendingPolygon.length === 0) {
        toast.show('No pending shape to modify.', 'error');
        return;
      }
      currentRings = pendingPolygon.map((r) => r.map((p) => ({ lat: p.lat, lng: p.lng })));
    } else {
      const target = polygons.find((p) => p.polygonId === polygonId);
      if (!target) {
        toast.show('Target polygon vanished mid-op.', 'error');
        return;
      }
      currentRings = pointsToLatLngRings(target.points);
    }
    if (currentRings.length === 0 || currentRings[0].length < 3) {
      toast.show('Target polygon has no valid geometry to modify.', 'error');
      return;
    }
    // Split needs 2+ points (a polyline); the other ops need 3+ (a
    // closed region). Enforce per-op so a short freehand split line
    // doesn't get rejected as "region too small".
    if (op === 'split' ? drawn.length < 2 : drawn.length < 3) {
      toast.show(
        op === 'split'
          ? 'Split line too short - drag across the polygon boundary.'
          : 'Drawn region too small.',
        'error',
      );
      return;
    }

    let resultRings: LatLng[][];
    try {
      if (op === 'add') resultRings = addRegion(currentRings, drawn);
      else if (op === 'cut') resultRings = cutRegion(currentRings, drawn);
      else if (op === 'keep') resultRings = keepRegion(currentRings, drawn);
      else {
        const split = splitByLine(currentRings, drawn);
        if (!split.wasSplit) {
          toast.show(
            'Split line must cross the polygon boundary at 2+ points. Try again.',
            'error',
          );
          return;
        }
        resultRings = split.rings;
      }
    } catch (e) {
      toast.show(`Boolean op failed: ${(e as Error).message}`, 'error');
      return;
    }

    if (resultRings.length === 0 || resultRings[0].length < 3) {
      toast.show(
        op === 'keep'
          ? 'Clip region does not overlap the polygon - no change applied.'
          : op === 'cut'
          ? 'Cut region would erase the entire polygon - no change applied.'
          : op === 'split'
          ? 'Split produced no valid geometry - no change applied.'
          : 'Add op produced an empty result - no change applied.',
        'error',
      );
      return;
    }

    // Push the PRIOR shape onto the undo stack BEFORE we mutate. Same
    // stack for pending + saved (keyed by polygonId or PENDING_ID). Cap
    // at MAX_UNDO_STACK; oldest entry drops when full so ops never fail
    // because of undo storage.
    pushUndoSnapshot({ polygonId, rings: currentRings });

    // Cap vertex explosion. Boolean ops can double or triple the vertex
    // count on complex shapes. Simplify per-ring to keep edit handles
    // sane. Toast when simplification actually kicks in.
    const totalBefore = resultRings.reduce((n, r) => n + r.length, 0);
    const simplifiedRings = resultRings.map((r) =>
      r.length > MAX_EDIT_HANDLE_VERTICES
        ? simplifyToMax(r, MAX_EDIT_HANDLE_VERTICES)
        : r,
    );
    const totalAfter = simplifiedRings.reduce((n, r) => n + r.length, 0);
    if (totalAfter < totalBefore) {
      toast.show(
        `Simplified ${totalBefore} -> ${totalAfter} vertices for editability.`,
        'success',
      );
    }

    const pieceCount = simplifiedRings.filter((r) => signedRingArea(r) > 0).length;
    const opLabel =
      op === 'add'
        ? 'Added to'
        : op === 'cut'
        ? 'Cut from'
        : op === 'split'
        ? 'Split'
        : 'Clipped';

    if (isPending) {
      // Pending mode: update local state only, no server round-trip
      // (the polygon doesn't exist server-side yet). Derived-zip
      // trailer is only meaningful after save, so omit it here.
      setPendingPolygon(simplifiedRings.map((r) => r.map((p) => ({ lat: p.lat, lng: p.lng }))));
      toast.show(
        `${opLabel} shape. ${pieceCount === 1 ? '1 piece' : `${pieceCount} pieces`}. Save when ready.`,
        'success',
      );
      return;
    }

    const points: PolygonPoint[] = [];
    simplifiedRings.forEach((ring, ringIndex) => {
      ring.forEach((pt, orderIndex) => {
        points.push({ ringIndex, orderIndex, lat: pt.lat, lng: pt.lng });
      });
    });
    const centroid = polygonCentroid(simplifiedRings[0]);

    try {
      const res = await bulkPolygonService.updateShape(polygonId, {
        centroidLatitude: centroid.lat,
        centroidLongitude: centroid.lng,
        points,
      });
      setPolygons((prev) => prev.map((p) =>
        p.polygonId === polygonId ? res.response : p,
      ));
      toast.show(
        `${opLabel} shape. ${pieceCount === 1 ? '1 piece' : `${pieceCount} pieces`}${derivedZipsToastTrailer(res.response)}`,
        'success',
      );
    } catch (e) {
      // Roll back the client-side undo snapshot on server failure - the
      // op didn't actually happen so we shouldn't offer an undo of a
      // change that never landed.
      popUndoSnapshot();
      toast.show(`Save failed: ${(e as Error).message}`, 'error');
    }
  };

  /** Push a new snapshot onto the undo stack. Enforces the depth cap by
   *  dropping the oldest entry when full - never refuses a snapshot,
   *  since refusing would silently break future undos. */
  const pushUndoSnapshot = (snap: { polygonId: number; rings: LatLng[][] }) => {
    editUndoStackRef.current.push(snap);
    if (editUndoStackRef.current.length > MAX_UNDO_STACK) {
      editUndoStackRef.current.shift();
    }
    setUndoVersion((v) => v + 1);
  };

  /** Pop the top snapshot without applying it. Used to roll back an
   *  undo push after the server rejected the op. */
  const popUndoSnapshot = () => {
    editUndoStackRef.current.pop();
    setUndoVersion((v) => v + 1);
  };

  /** Revert the polygon one step by popping the top snapshot and
   *  applying it. Repeatable - click multiple times to walk all the way
   *  back to the state at edit-mode / pending-mode entry. */
  const undoLastBooleanOp = async () => {
    // Same routing as startBooleanOp: saved (editingId > 0) or pending
    // (PENDING_ID). Undo stack entries carry their target polygonId so
    // orphans from a prior target are discarded harmlessly.
    const editingId = typeof mode === 'object' ? mode.edit : null;
    const targetId = editingId ?? (mode === 'pending' ? PENDING_ID : null);
    if (targetId == null) return;

    // Discard any orphan snapshots pointing at a different polygon (can
    // happen if the operator hops between edit targets in one session).
    while (editUndoStackRef.current.length > 0
        && editUndoStackRef.current[editUndoStackRef.current.length - 1].polygonId !== targetId) {
      editUndoStackRef.current.pop();
    }
    const snap = editUndoStackRef.current.pop();
    setUndoVersion((v) => v + 1);
    if (!snap) return;

    // Pending undo: local state only, no server round-trip.
    if (snap.polygonId === PENDING_ID) {
      setPendingPolygon(snap.rings.map((r) => r.map((p) => ({ lat: p.lat, lng: p.lng }))));
      const remaining = editUndoStackRef.current.length;
      toast.show(
        remaining > 0
          ? `Reverted one step. ${remaining} more step${remaining === 1 ? '' : 's'} available.`
          : 'Reverted to the start of this drawing session.',
        'success',
      );
      return;
    }

    const points: PolygonPoint[] = [];
    snap.rings.forEach((ring, ringIndex) => {
      ring.forEach((pt, orderIndex) => {
        points.push({ ringIndex, orderIndex, lat: pt.lat, lng: pt.lng });
      });
    });
    const centroid = polygonCentroid(snap.rings[0]);

    try {
      const res = await bulkPolygonService.updateShape(snap.polygonId, {
        centroidLatitude: centroid.lat,
        centroidLongitude: centroid.lng,
        points,
      });
      setPolygons((prev) => prev.map((p) =>
        p.polygonId === snap.polygonId ? res.response : p,
      ));
      const remaining = editUndoStackRef.current.length;
      toast.show(
        remaining > 0
          ? `Reverted one step. ${remaining} more step${remaining === 1 ? '' : 's'} available.`
          : 'Reverted to the start of this edit session.',
        'success',
      );
    } catch (e) {
      // Put the snapshot back so the operator can retry.
      editUndoStackRef.current.push(snap);
      setUndoVersion((v) => v + 1);
      toast.show(`Undo failed: ${(e as Error).message}`, 'error');
    }
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

    // PERF: read PRE-PARSED shapes from the cache refs. WKT parsing +
    // point-to-LatLng conversion happens once per state change in the
    // cache-build effects above, not per mousemove event. This is the
    // biggest single win for vertex-draw smoothness on tenants with
    // many loaded zip boundaries in the viewport.
    const currentDrawingVertices = drawingVerticesRef.current;
    const currentMode = modeRef.current;
    const editingId = typeof currentMode === 'object' ? currentMode.edit : null;

    const shapes: LatLng[][] = [];
    // Zip boundary shapes - all get snapped to.
    for (const ring of parsedZipShapesRef.current) shapes.push(ring);
    // Coverage polygons - skip the one currently being edited so its own
    // vertices don't act as snap targets for themselves.
    for (const entry of parsedCoverageShapesRef.current) {
      if (entry.id === editingId) continue;
      shapes.push(entry.path);
    }
    // In-progress polygon vertices are snap targets too (close-the-loop).
    if (currentDrawingVertices.length > 0) shapes.push(currentDrawingVertices);

    for (const ring of shapes) {
      for (const v of ring) {
        const px = latLngToPixel(v.lat, v.lng);
        if (!px) continue;
        const d = Math.hypot(px.x - clickPx.x, px.y - clickPx.y);
        if (d < SNAP_PIXELS) return { point: v, kind: 'vertex' };
      }
    }
    if (currentDrawingVertices.length >= 3) {
      const first = currentDrawingVertices[0];
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

      // Boolean-op sub-flow: the operator entered lasso via an Add /
      // Cut / Keep / Split button while editing a polygon. Route to
      // applyBooleanOp, then re-enter edit mode. Clearing the pending ref
      // FIRST so a failure in applyBooleanOp doesn't leave a stale op
      // queued for the operator's next lasso stroke.
      const pendingOp = pendingBooleanOpRef.current;
      if (pendingOp) {
        pendingBooleanOpRef.current = null;
        // Split needs at least 2 points (a line); Add / Cut / Clip need
        // 3+ (a closed region).
        const minPts = pendingOp.op === 'split' ? 2 : 3;
        if (raw.length < minPts) {
          toast.show(
            pendingOp.op === 'split'
              ? 'Split line too short - drag across the polygon boundary.'
              : 'Region too small - needs at least a few points.',
            'error',
          );
          returnToTargetMode(pendingOp.polygonId);
          return;
        }
        // Simplify the drawn stroke before feeding polygon-clipping /
        // polygon-splitter. Douglas-Peucker is fine on polylines too.
        const simplifiedDrawn = simplifyToMax(raw, ZIP_TO_COVERAGE_MAX_VERTICES);
        void applyBooleanOp(pendingOp.op, pendingOp.polygonId, simplifiedDrawn)
          .finally(() => returnToTargetMode(pendingOp.polygonId));
        return;
      }

      if (raw.length < 3) {
        toast.show('Lasso stroke too short - needs at least a few points.', 'error');
        setMode('view');
        return;
      }
      const simplified = simplifyToMax(raw, ZIP_TO_COVERAGE_MAX_VERTICES);
      // Wrap the single drawn ring in [ring] to match the multi-ring
      // pendingPolygon shape. Cut / Split in pending mode may grow this
      // into multiple pieces later.
      setPendingPolygon([simplified]);
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
        // Skipped when the pending op is 'split' - split needs an OPEN
        // polyline, so returning near the start must not close-and-finish
        // the stroke as a polygon.
        const pendingOp = pendingBooleanOpRef.current;
        if (
          pendingOp?.op !== 'split'
          && lassoBufferRef.current.length >= MIN_LEN_BEFORE_AUTOCLOSE
          && startPx
        ) {
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
      // Boolean-op sub-flow: if the operator entered rectangle mode via
      // an Add / Cut / Clip button while editing, route the rectangle
      // into applyBooleanOp instead of opening the save modal. Clear
      // the pending ref FIRST so a failure doesn't leak into the next
      // stroke.
      const pendingOp = pendingBooleanOpRef.current;
      if (pendingOp) {
        pendingBooleanOpRef.current = null;
        if (n === sLat || eLng === wLng) {
          toast.show('Rectangle needs some width and height. Try again.', 'error');
          returnToTargetMode(pendingOp.polygonId);
          return;
        }
        const pts: LatLng[] = [
          { lat: n,    lng: wLng },
          { lat: n,    lng: eLng },
          { lat: sLat, lng: eLng },
          { lat: sLat, lng: wLng },
        ];
        void applyBooleanOp(pendingOp.op, pendingOp.polygonId, pts)
          .finally(() => returnToTargetMode(pendingOp.polygonId));
        return;
      }
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
      setPendingPolygon([pts]);
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
      // Boolean-op sub-flow: if entered via Add / Cut / Clip in edit
      // mode, route the circle-approximated polygon into applyBooleanOp
      // and re-enter edit mode. Clear the pending ref FIRST.
      const pendingOp = pendingBooleanOpRef.current;
      if (pendingOp) {
        pendingBooleanOpRef.current = null;
        if (radiusM < 50) {
          toast.show('Circle radius too small (< 50m). Drag further from the centre.', 'error');
          returnToTargetMode(pendingOp.polygonId);
          return;
        }
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
        void applyBooleanOp(pendingOp.op, pendingOp.polygonId, pts)
          .finally(() => returnToTargetMode(pendingOp.polygonId));
        return;
      }
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
      setPendingPolygon([pts]);
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
    const g = (window as any).google;
    if (!map || !g?.maps || mode !== 'drawing') return;

    // PERF: reuse a single hint marker across mousemove events. Prior
    // impl destroyed + reallocated the Marker on every event (~60Hz
    // during active drawing), which starved the main thread on lower-
    // spec devices. Now the marker lives for the entire draw session and
    // just moves via setPosition + setMap(null|map) toggles.
    let lastKind: 'vertex' | 'edge' | null = null;

    // PERF: rAF-throttle the snap work. Google Maps mousemove fires very
    // frequently (per pointer sample - up to 240Hz on high-refresh mice /
    // trackpads). Snap logic, even with the pre-parsed cache, projects
    // every candidate vertex to pixels to test proximity - 300 shapes x
    // 100 vertices = 30k projections per call. Storing only the latest
    // event and processing it inside a scheduled rAF collapses N events
    // per frame into a single snap query, capped at the display refresh
    // rate (60-120Hz). The visible cursor hint still tracks smoothly
    // because rAF fires just before paint.
    let pendingRaw: LatLng | null = null;
    let rafId: number | null = null;

    const updateSnapHint = () => {
      rafId = null;
      const raw = pendingRaw;
      pendingRaw = null;
      if (!raw) return;
      const snap = snapTo(raw);
      if (!snap.kind) {
        if (snapHintRef.current) snapHintRef.current.setMap(null);
        lastKind = null;
        return;
      }
      if (!snapHintRef.current) {
        snapHintRef.current = new g.maps.Marker({
          position: snap.point, map,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 8, strokeColor: snap.kind === 'vertex' ? '#ef4444' : '#f59e0b',
            fillColor: '#fff', fillOpacity: 1, strokeWeight: 3,
          },
          clickable: false, zIndex: 999,
        });
        lastKind = snap.kind;
      } else {
        snapHintRef.current.setPosition(snap.point);
        snapHintRef.current.setMap(map);
        // Icon changes are relatively expensive (allocates a new symbol
        // options object). Only re-set when the snap kind actually flips
        // between vertex and edge, not on every event.
        if (snap.kind !== lastKind) {
          snapHintRef.current.setIcon({
            path: g.maps.SymbolPath.CIRCLE,
            scale: 8, strokeColor: snap.kind === 'vertex' ? '#ef4444' : '#f59e0b',
            fillColor: '#fff', fillOpacity: 1, strokeWeight: 3,
          });
          lastKind = snap.kind;
        }
      }
    };

    const clickListener = map.addListener('click', (e: any) => {
      // Click MUST snap synchronously (the vertex we commit needs to
      // reflect the current snap target). Only mousemove is rAF-throttled.
      const raw = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const snap = snapTo(raw);
      setDrawingVertices((p) => [...p, snap.point]);
    });
    const moveListener = map.addListener('mousemove', (e: any) => {
      pendingRaw = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      if (rafId === null) rafId = window.requestAnimationFrame(updateSnapHint);
    });
    return () => {
      g.maps.event.removeListener(clickListener);
      g.maps.event.removeListener(moveListener);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      snapHintRef.current?.setMap(null);
      snapHintRef.current = null;
    };
    // PERF: deps intentionally narrowed to [mode]. Prior deps
    // (drawingVertices + loadedShapes + polygons) caused the listeners
    // to unmount + remount on every vertex click and every zip auto-load
    // during a draw session. snapTo now reads those atoms from mirror
    // refs, so this effect only fires when the user enters / leaves
    // drawing mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

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

  // startDraw (click-to-add-vertex flow) removed 2026-08-05. Toolbar +
  // right-click menu + keyboard shortcut all dropped. The mode ===
  // 'drawing' effect below stays in the file as dead code because
  // nothing sets the mode anymore, but it's cheap to leave for a
  // possible future re-enable and removing it would balloon the diff.
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
    setPendingPolygon([drawingVertices]);
    setDrawingVertices([]);
    setMode('pending');
  };

  // Stage 4 - lasso mode entry/exit.
  const startLasso = () => { setDrawingVertices([]); setMode('lassoing'); };
  const cancelLasso = () => {
    clearLassoPreview();
    // If the operator was mid-Add/Cut/Keep, bounce back to edit mode
    // instead of view. Clear the pending op so it doesn't leak into a
    // subsequent fresh lasso.
    const pendingOp = pendingBooleanOpRef.current;
    pendingBooleanOpRef.current = null;
    if (pendingOp) returnToTargetMode(pendingOp.polygonId);
    else setMode('view');
  };
  const startRect = () => { setDrawingVertices([]); setMode('rectangling'); };
  const cancelRect = () => {
    clearRectPreview();
    // Same bounce-back-to-edit rule as cancelLasso: if the operator was
    // mid-Add / Cut / Clip via the Rectangle input tool, Escape should
    // land them back in edit mode - not the view mode which would drop
    // them out of the polygon they were reshaping.
    const pendingOp = pendingBooleanOpRef.current;
    pendingBooleanOpRef.current = null;
    if (pendingOp) returnToTargetMode(pendingOp.polygonId);
    else setMode('view');
  };
  const startCircle = () => { setDrawingVertices([]); setMode('circling'); };
  const cancelCircle = () => {
    clearCirclePreview();
    const pendingOp = pendingBooleanOpRef.current;
    pendingBooleanOpRef.current = null;
    if (pendingOp) returnToTargetMode(pendingOp.polygonId);
    else setMode('view');
  };

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
      // Tool shortcuts.
      // View mode: L / R / C start a new polygon in that drawing mode.
      // Edit mode: L / R / C flip the boolean-op input shape (picker) -
      // they do NOT drop the operator into a fresh-polygon session,
      // which was the confusing pre-2026-08-06 behaviour.
      // 'P' (vertex polygon) shortcut removed 2026-08-05 alongside the
      // toolbar item; the drag-based tools cover the same use cases.
      if (mode === 'view') {
        if (e.key === 'l' || e.key === 'L') { e.preventDefault(); startLasso(); return; }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); startRect(); return; }
        if (e.key === 'c' || e.key === 'C') { e.preventDefault(); startCircle(); return; }
      } else if (editingId != null) {
        if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setEditShapeInput('freehand'); return; }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setEditShapeInput('rect'); return; }
        if (e.key === 'c' || e.key === 'C') { e.preventDefault(); setEditShapeInput('circle'); return; }
      }
      if (mode === 'view' || editingId != null) {
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
  // before saving. Same visual + edit UX as edit mode, but writes back
  // to pendingPolygon state (no server call) instead of updateShape.
  // 2026-08-06: multi-ring support so boolean-op splits (Cut / Split)
  // performed in pending mode keep every piece drawn + editable, and
  // toolbar reuses the same tools as edit mode.
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
    if (mode !== 'pending' || !pendingPolygon || pendingPolygon.length === 0) return;

    // Deep-clone rings into a mutable working set. All drag / insert /
    // delete handlers mutate workingRings then push a fresh snapshot
    // to pendingPolygon state.
    const workingRings: LatLng[][] = pendingPolygon
      .filter((r) => r.length >= 3)
      .map((r) => r.map((p) => ({ lat: p.lat, lng: p.lng })));
    if (workingRings.length === 0) return;

    const color = '#8b5cf6'; // purple to distinguish from saved polygons
    const currentPaths = (): LatLng[][] => workingRings;

    pendingPolyRef.current = new g.maps.Polygon({
      paths: currentPaths(), map,
      strokeColor: color, strokeOpacity: 1, strokeWeight: 2,
      fillColor: color, fillOpacity: 0.25,
      clickable: false,
    });

    // Guard against handle-storm on a huge multi-ring shape. Same cap
    // as edit mode - drawing thousands of draggable Markers freezes
    // the browser.
    const totalVerts = workingRings.reduce((n, r) => n + r.length, 0);
    if (totalVerts > MAX_EDIT_HANDLE_VERTICES) {
      toast.show(
        `${totalVerts} vertices across ${workingRings.length} ring${workingRings.length === 1 ? '' : 's'} is too many to edit safely. Use Cut / Clip to shrink first, or discard + re-draw.`,
        'error',
      );
      return;
    }

    const commitPending = () => {
      // Push a fresh deep-clone into state so pendingPolygon.length dep
      // fires and React re-renders anything watching the ring count.
      setPendingPolygon(
        workingRings.map((r) => r.map((p) => ({ lat: p.lat, lng: p.lng }))),
      );
    };

    const renderHandles = () => {
      pendingHandlesRef.current.forEach((h) => h.setMap(null));
      pendingMidpointsRef.current.forEach((h) => h.setMap(null));
      pendingHandlesRef.current = [];
      pendingMidpointsRef.current = [];

      workingRings.forEach((ring, ri) => {
        ring.forEach((pt, vi) => {
          const handle = new g.maps.Marker({
            position: pt, map, draggable: true,
            icon: {
              path: 'M -6 -6 L 6 -6 L 6 6 L -6 6 Z',
              fillColor: color, fillOpacity: 1,
              strokeColor: '#fff', strokeWeight: 2, scale: 1,
            },
            title: workingRings.length > 1
              ? `Ring ${ri + 1} vertex ${vi + 1} - drag to move, right-click to delete`
              : `Vertex ${vi + 1} - drag to move, right-click to delete`,
            zIndex: 500,
          });
          handle.addListener('dragstart', () => {
            map.setOptions({ draggable: false, disableDoubleClickZoom: true });
            pendingMidpointsRef.current.forEach((m) => m.setMap(null));
            pendingMidpointsRef.current = [];
          });
          handle.addListener('drag', (e: any) => {
            workingRings[ri][vi] = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            pendingPolyRef.current?.setPaths(currentPaths());
          });
          handle.addListener('dragend', () => {
            map.setOptions({ draggable: true, disableDoubleClickZoom: false });
            pushPendingUndoSnapshot();
            commitPending();
            renderHandles();
          });
          handle.addListener('rightclick', () => {
            if (workingRings[ri].length <= 3) {
              // Would leave THIS ring with < 3 verts. Drop the whole
              // ring if there are others; block if it's the only ring
              // (an empty pending polygon has no meaning).
              if (workingRings.length > 1) {
                pushPendingUndoSnapshot();
                workingRings.splice(ri, 1);
                pendingPolyRef.current?.setPaths(currentPaths());
                commitPending();
                renderHandles();
                return;
              }
              toast.show('A polygon must keep at least 3 vertices.', 'error');
              return;
            }
            pushPendingUndoSnapshot();
            workingRings[ri].splice(vi, 1);
            pendingPolyRef.current?.setPaths(currentPaths());
            commitPending();
            renderHandles();
          });
          pendingHandlesRef.current.push(handle);
        });
      });

      workingRings.forEach((ring, ri) => {
        ring.forEach((a, vi) => {
          const b = ring[(vi + 1) % ring.length];
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
            pushPendingUndoSnapshot();
            workingRings[ri].splice(vi + 1, 0, mid);
            pendingPolyRef.current?.setPaths(currentPaths());
            commitPending();
            renderHandles();
          });
          pendingMidpointsRef.current.push(marker);
        });
      });
    };

    /** Snapshot the PRE-mutation ring set onto the shared undo stack
     *  under the PENDING_ID sentinel. Callers invoke this before any
     *  destructive edit (drag / insert / delete) so Undo can walk back
     *  through the whole session. */
    const pushPendingUndoSnapshot = () => {
      pushUndoSnapshot({
        polygonId: PENDING_ID,
        rings: workingRings.map((r) => r.map((p) => ({ lat: p.lat, lng: p.lng }))),
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
    // Structural signature only: total vertex count + ring count. Drags
    // mutate vertex positions in place (workingRings) without changing
    // either, so this dep skips the effect on drag - saving handle
    // recreation churn on every dragend. Fires on insert / delete /
    // Add / Cut / Clip / Split / Undo which DO change the structure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    (pendingPolygon ?? []).length,
    (pendingPolygon ?? []).reduce((n, r) => n + r.length, 0),
  ]);

  // ─── Edit mode ───────────────────────────────────────────────────────
  const startEdit = (id: number) => {
    setDrawingVertices([]);
    setMode({ edit: id });
    // 2026-08-06 (George): auto-zoom the map to the polygon so the
    // operator doesn't have to hunt for it after clicking Edit shape.
    // fitBounds fires ASYNC via requestAnimationFrame so it lands
    // AFTER the edit-mode overlay renders (rings are drawn on the
    // effect fire that comes from the setMode above); without the RAF
    // the fit sometimes measured against the pre-edit polygon and
    // undershot on multi-piece shapes.
    const p = polygons.find((x) => x.polygonId === id);
    if (p) requestAnimationFrame(() => zoomToPolygon(p));
  };
  const stopEdit = () => {
    // Discard the whole undo stack when the operator exits edit mode -
    // undo is a within-session concept only.
    editUndoStackRef.current = [];
    setUndoVersion((v) => v + 1);
    setMode('view');
  };

  useEffect(() => {
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps) return;
    clearEditHandles();
    if (typeof mode !== 'object') return;

    const polygon = polygons.find((p) => p.polygonId === mode.edit);
    if (!polygon) return;
    // 2026-08-06 (George): ALL rings editable. `workingRings` holds
    // every ring's mutable vertex list; handles + midpoints are
    // generated per-ring per-vertex. Each handler knows its
    // (ringIndex, vertexIndex) so drag / insert / delete mutates the
    // right ring without touching the others. commitShape(id, rings)
    // then sends the whole ring set back to the server so every piece
    // stays intact through the round-trip.
    const workingRings: LatLng[][] = pointsToLatLngRings(polygon.points)
      .filter((r) => r.length >= 3)
      .map((r) => r.map((p) => ({ lat: p.lat, lng: p.lng })));
    if (workingRings.length === 0) return;
    const color = POLYGON_PALETTE[
      polygons.findIndex((p) => p.polygonId === mode.edit) % POLYGON_PALETTE.length
    ];

    // Helper: current paths for the overlay = every ring, in order.
    const currentPaths = (): LatLng[][] => workingRings;

    editPolyRef.current = new g.maps.Polygon({
      paths: currentPaths(), map: mapRef.current,
      strokeColor: color, strokeOpacity: 1, strokeWeight: 2,
      fillColor: color, fillOpacity: 0.3,
      clickable: false,
    });

    // Guard: drawing thousands of draggable Markers freezes the browser.
    // Sum across ALL rings against the cap so multi-piece polygons don't
    // sneak past by having each piece under-cap.
    const totalVerts = workingRings.reduce((n, r) => n + r.length, 0);
    if (totalVerts > MAX_EDIT_HANDLE_VERTICES) {
      toast.show(
        `${totalVerts} vertices across ${workingRings.length} ring${workingRings.length === 1 ? '' : 's'} is too many to edit safely. Use Cut / Clip to shrink first, or delete + re-create the polygon.`,
        'error',
      );
      return;
    }

    const renderHandles = () => {
      editHandlesRef.current.forEach((h) => h.setMap(null));
      editMidpointsRef.current.forEach((h) => h.setMap(null));
      editHandlesRef.current = [];
      editMidpointsRef.current = [];

      // Vertex handles - one per ring per vertex, keyed by (ri, vi) in
      // the closures so mutations land on the right ring.
      workingRings.forEach((ring, ri) => {
        ring.forEach((pt, vi) => {
          const handle = new g.maps.Marker({
            position: pt, map: mapRef.current, draggable: true,
            icon: {
              path: 'M -6 -6 L 6 -6 L 6 6 L -6 6 Z',
              fillColor: color, fillOpacity: 1,
              strokeColor: '#fff', strokeWeight: 2, scale: 1,
            },
            title: workingRings.length > 1
              ? `Ring ${ri + 1} vertex ${vi + 1} - drag to move, right-click to delete`
              : `Vertex ${vi + 1} - drag to move, right-click to delete`,
            zIndex: 500,
          });
          handle.addListener('dragstart', () => {
            mapRef.current.setOptions({ draggable: false, disableDoubleClickZoom: true });
            editMidpointsRef.current.forEach((m) => m.setMap(null));
            editMidpointsRef.current = [];
          });
          handle.addListener('drag', (e: any) => {
            workingRings[ri][vi] = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            editPolyRef.current?.setPaths(currentPaths());
          });
          handle.addListener('dragend', async () => {
            mapRef.current.setOptions({ draggable: true, disableDoubleClickZoom: false });
            await commitShape(mode.edit, workingRings);
            renderHandles();
          });
          handle.addListener('rightclick', async () => {
            if (workingRings[ri].length <= 3) {
              // Would leave this ring with < 3 verts. If it's not the
              // only ring, drop the whole ring instead of blocking; if
              // it IS the only ring, block (a polygon needs 3 verts).
              if (workingRings.length > 1) {
                workingRings.splice(ri, 1);
                editPolyRef.current?.setPaths(currentPaths());
                await commitShape(mode.edit, workingRings);
                renderHandles();
                return;
              }
              toast.show('A polygon must keep at least 3 vertices.', 'error');
              return;
            }
            workingRings[ri].splice(vi, 1);
            editPolyRef.current?.setPaths(currentPaths());
            await commitShape(mode.edit, workingRings);
            renderHandles();
          });
          editHandlesRef.current.push(handle);
        });
      });

      // Testing hook - Playwright grabs the current handle array and
      // triggers events (dragend / rightclick) via
      // google.maps.event.trigger(handle, 'dragend'). Cheap enough at
      // runtime that we don't bother stripping in prod builds.
      (window as any).__pbEditHandles = editHandlesRef.current;
      (window as any).__pbEditMidpoints = editMidpointsRef.current;

      // Midpoint insert markers - between each consecutive vertex pair
      // in each ring. Click inserts a new vertex at the midpoint.
      workingRings.forEach((ring, ri) => {
        ring.forEach((a, vi) => {
          const b = ring[(vi + 1) % ring.length];
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
            workingRings[ri].splice(vi + 1, 0, mid);
            editPolyRef.current?.setPaths(currentPaths());
            await commitShape(mode.edit, workingRings);
            renderHandles();
          });
          editMidpointsRef.current.push(marker);
        });
      });
    };

    renderHandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    // BUGFIX 2026-08-06 (George): re-fire the edit effect whenever the
    // polygon being edited gets a server-side shape update. Undo /
    // Add / Cut / Clip all round-trip to the server and set a fresh
    // lastModifiedUtc via bulkPolygonService.updateShape. Without this
    // dep the edit-mode effect kept the stale `working` ring + handles
    // from the initial mount, so an Undo would land on the server + in
    // React state but leave the visible edit overlay unchanged. Note:
    // vertex-drag / midpoint-insert / vertex-delete ALSO trigger this
    // via commitShape -> setPolygons; the manual renderHandles() calls
    // in those handlers become redundant but stay in place as a safety
    // net so an in-flight PUT failure still leaves handles usable.
    typeof mode === 'object'
      ? polygons.find((p) => p.polygonId === mode.edit)?.lastModifiedUtc
      : null,
  ]);

  /** Persist a full ring set for the polygon under edit. 2026-08-06:
   *  signature widened from single ring (LatLng[]) to all rings
   *  (LatLng[][]) so multi-piece polygons round-trip through vertex
   *  edits without losing pieces. Caller passes workingRings which
   *  already includes every editable ring; commitShape flattens to
   *  the PolygonPointDto structure the API expects, snapshots the
   *  prior state onto the undo stack after server-accept, and updates
   *  local polygon state from the response. */
  const commitShape = async (id: number, workingRings: LatLng[][]) => {
    // Snapshot the current state BEFORE the API round-trip so Undo can
    // revert the change (single stack entry per commit, across all
    // ops - vertex drag / midpoint insert / vertex delete / boolean).
    const current = polygons.find((p) => p.polygonId === id);
    const currentRings = current ? pointsToLatLngRings(current.points) : [];
    const priorSnapshot = currentRings.length > 0
      ? { polygonId: id, rings: currentRings }
      : null;

    try {
      const points: PolygonPoint[] = [];
      workingRings.forEach((ring, ringIndex) => {
        ring.forEach((pt, orderIndex) => {
          points.push({ ringIndex, orderIndex, lat: pt.lat, lng: pt.lng });
        });
      });
      // Centroid stamped from ring 0 - accurate enough for the map
      // centre pin and matches the single-outer-ring convention.
      const centroid = polygonCentroid(workingRings[0]);
      const res = await bulkPolygonService.updateShape(id, {
        points, centroidLatitude: centroid.lat, centroidLongitude: centroid.lng,
      });
      setPolygons((prev) => prev.map((p) =>
        p.polygonId === id ? res.response : p));
      // Push the pre-op snapshot onto the undo stack only after the
      // server accepted the change - a failure below leaves the prior
      // undo state intact.
      if (priorSnapshot) {
        pushUndoSnapshot(priorSnapshot);
      }
      toast.show(`Shape saved.${derivedZipsToastTrailer(res.response)}`, 'success');
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

  // simplifyPolygonInPlace + the "Simplify shape" affordances removed
  // 2026-08-06 (George). The Douglas-Peucker simplification flattens
  // every ring's outer path but treats the polygon as one shape, so
  // multi-piece coverage polygons produced by Combine {N} or by a
  // Cut-that-split lost every piece beyond ring 0 whenever the operator
  // tried to simplify. Auto-simplification on ingest still runs (the
  // Combine flow caps rings to ZIP_TO_COVERAGE_MAX_VERTICES at create
  // time), so operators shouldn't need this manual button in practice.
  // If a legacy pre-cap polygon needs shrinking, delete + re-create it.

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
    if (!(await askConfirm({
      title: 'Remove coverage polygon',
      message: msg,
      confirmLabel: 'Remove',
      danger: true,
    }))) return;
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
    // Clear the pending draft's undo stack - the session is over.
    editUndoStackRef.current = editUndoStackRef.current.filter(
      (s) => s.polygonId !== PENDING_ID,
    );
    setUndoVersion((v) => v + 1);
    setMode('view');
  };

  // Explicit "Finish drawing" click from pending mode -> open save modal.
  const openSaveForPending = () => {
    if (!pendingPolygon || pendingPolygon.length === 0 || pendingPolygon[0].length < 3) {
      toast.show('Nothing to finish - draw a shape first.', 'error');
      return;
    }
    setOpenSaveModal(true);
  };
  const discardPending = () => {
    setPendingPolygon(null);
    setOpenSaveModal(false);
    // Wipe pending undo entries so the next new-draft session starts clean.
    editUndoStackRef.current = editUndoStackRef.current.filter(
      (s) => s.polygonId !== PENDING_ID,
    );
    setUndoVersion((v) => v + 1);
    setMode('view');
  };

  if (!apiKey) {
    return (
      <div className="h-full p-6">
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
        <span className="text-text-muted">
          {(() => {
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
              {(() => {
                const totalVerts = (pendingPolygon ?? []).reduce((n, r) => n + r.length, 0);
                const pieceCount = (pendingPolygon ?? []).filter((r) => signedRingArea(r) > 0).length || 1;
                const pieceLabel = pieceCount === 1 ? '1 piece' : `${pieceCount} pieces`;
                return `Drag the purple squares to refine (${totalVerts} vertices, ${pieceLabel}). Click white circles to insert, right-click a square to delete. Pick a shape below to Add / Cut / Clip / Split. Click "Finish drawing" to name + save.`;
              })()}
            </span>
            {/* Same tool-set as edit mode - Shape picker + Add / Cut /
                Clip / Split + Undo. Both surfaces share applyBooleanOp
                and the undo stack; the pending draft is targeted via
                the PENDING_ID sentinel so no server round-trips happen
                until the operator clicks "Finish drawing". */}
            <ShapeInputPicker
              value={editShapeInput}
              onChange={setEditShapeInput}
            />
            <div className="inline-flex items-center gap-1">
              {(() => {
                const shapeLabel = editShapeInput === 'freehand'
                  ? 'freehand region'
                  : editShapeInput === 'rect'
                  ? 'rectangle'
                  : 'circle';
                return (
                  <>
                    <Button variant="neutral" size="sm" onClick={() => startBooleanOp('add')}
                      title={`Draw a ${shapeLabel} to grow the polygon into it (union).`}>
                      Add
                    </Button>
                    <Button variant="neutral" size="sm" onClick={() => startBooleanOp('cut')}
                      title={`Draw a ${shapeLabel} to subtract from the polygon (may split it into pieces or carve a hole).`}>
                      Cut
                    </Button>
                    <Button variant="neutral" size="sm" onClick={() => startBooleanOp('keep')}
                      title={`Draw a ${shapeLabel} to trim the polygon down to only the parts inside it (intersection).`}>
                      Clip
                    </Button>
                  </>
                );
              })()}
              <Button variant="neutral" size="sm" onClick={() => startBooleanOp('split')}
                title="Drag a freehand line that crosses the polygon boundary at both ends to split it into two pieces. Always uses freehand (rectangle / circle can't split a polygon).">
                Split
              </Button>
              {(() => {
                const undoableCount = editUndoStackRef.current.filter(
                  (s) => s.polygonId === PENDING_ID,
                ).length;
                return (
                  <Button variant="neutral" size="sm" onClick={undoLastBooleanOp}
                    disabled={undoableCount === 0}
                    title={undoableCount === 0
                      ? 'Nothing to undo yet - make an edit first.'
                      : `Revert the last edit (Add / Cut / Clip / Split / drag / insert / delete). ${undoableCount} step${undoableCount === 1 ? '' : 's'} available.`}
                    data-undo-version={undoVersion}>
                    {undoableCount > 1 ? `Undo (${undoableCount})` : 'Undo'}
                  </Button>
                );
              })()}
            </div>
            <Button variant="neutral" size="sm" onClick={discardPending}>Discard</Button>
            <Button variant="secondary" size="sm" onClick={openSaveForPending}
              disabled={!pendingPolygon || pendingPolygon.length === 0 || pendingPolygon[0].length < 3}>
              Finish drawing
            </Button>
          </>
        ) : editingId != null ? (
          <>
            <span className="text-text-muted">
              Drag squares to reshape; click a white circle to insert a vertex; right-click a square to delete it. Pick a shape below, then use Add / Cut / Clip to reshape by drawn region; Split cuts the polygon in two with a freehand line.
            </span>
            {/* Shape-input picker: the boolean-op buttons below use this
                to decide what tool to hand the operator when they click
                Add / Cut / Clip. Freehand covers the widest range; the
                picker persists across ops so an operator carving multiple
                rectangular chunks doesn't have to re-pick each time.
                Split always overrides to freehand (rect / circle don't
                yield a polyline that can split a polygon in two). */}
            <ShapeInputPicker
              value={editShapeInput}
              onChange={setEditShapeInput}
            />
            <div className="inline-flex items-center gap-1">
              {(() => {
                const shapeLabel = editShapeInput === 'freehand'
                  ? 'freehand region'
                  : editShapeInput === 'rect'
                  ? 'rectangle'
                  : 'circle';
                return (
                  <>
                    <Button variant="neutral" size="sm" onClick={() => startBooleanOp('add')}
                      title={`Draw a ${shapeLabel} to grow the polygon into it (union).`}>
                      Add
                    </Button>
                    <Button variant="neutral" size="sm" onClick={() => startBooleanOp('cut')}
                      title={`Draw a ${shapeLabel} to subtract from the polygon (may split it into pieces or carve a hole).`}>
                      Cut
                    </Button>
                    <Button variant="neutral" size="sm" onClick={() => startBooleanOp('keep')}
                      title={`Draw a ${shapeLabel} to trim the polygon down to only the parts inside it (intersection).`}>
                      Clip
                    </Button>
                  </>
                );
              })()}
              <Button variant="neutral" size="sm" onClick={() => startBooleanOp('split')}
                title="Drag a freehand line that crosses the polygon boundary at both ends to split it into two pieces. Always uses freehand (rectangle / circle can't split a polygon).">
                Split
              </Button>
              {/* Multi-step Undo. Depth is refreshed via undoVersion so
                  React re-evaluates disabled + label when the stack
                  changes (ref updates don't trigger renders on their
                  own). Stack only counts entries pointing at the
                  current polygon; orphan entries from a prior edit
                  target are silently discarded on click. */}
              {(() => {
                const undoableCount = editUndoStackRef.current.filter(
                  (s) => s.polygonId === editingId,
                ).length;
                return (
                  <Button variant="neutral" size="sm" onClick={undoLastBooleanOp}
                    disabled={undoableCount === 0}
                    title={undoableCount === 0
                      ? 'Nothing to undo yet - make an edit first.'
                      : `Revert the last edit (Add / Cut / Clip / drag / insert / delete). ${undoableCount} step${undoableCount === 1 ? '' : 's'} available.`}
                    data-undo-version={undoVersion}>
                    {undoableCount > 1 ? `Undo (${undoableCount})` : 'Undo'}
                  </Button>
                );
              })()}
            </div>
            <Button variant="secondary" size="sm" onClick={stopEdit}>Done editing</Button>
          </>
        ) : (
          <>
            <Button variant="neutral" size="sm" onClick={() => setZonesDrawerOpen(true)}
              title="Open the rating postcode / ZIP drawer (read-only Client Manager data).">
              View Zones
            </Button>
            <Button variant="neutral" size="sm" onClick={clearAll}
              disabled={loadedShapes.length === 0 && selected.length === 0}>
              Clear {zipShortLower}s
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setZipSaveOpen(true)} disabled={selected.length === 0}
              title={selected.length === 0 ? `Select some ${zipLongLower}s first` : 'Persist the selection as a recurring route'}>
              Save as Route ({selected.length})
            </Button>
            <Button variant="secondary" size="sm" onClick={combineSelectedAsShape}
              disabled={selected.length < 2 || combining}
              title={selected.length < 2
                ? `Select 2+ ${zipShortLower}s to combine them into a single editable coverage shape`
                : 'Union the selected zip polygons into one coverage shape (adjacent zips merge; disjoint ones become multi-piece) and open it in edit mode'}>
              {combining ? 'Combining…' : `Combine ${selected.length} as shape`}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPolygonSaveOpen(true)} disabled={selectedPolygons.size === 0}
              title={selectedPolygons.size === 0 ? 'Select some coverage polygons first' : 'Persist the coverage-polygon selection as a recurring route'}>
              Save coverage as Route ({selectedPolygons.size})
            </Button>
            <DrawingToolsMenu
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
                        {p.attachedRoutes && p.attachedRoutes.length > 0 ? (
                          <>
                            <span>attached to </span>
                            {p.attachedRoutes.map((r, i) => (
                              <span key={r.routeId}>
                                {i > 0 && <span>, </span>}
                                {/* Click jumps to the Recurring Routes page
                                    with the route's edit modal auto-opened
                                    via the ?edit=<id> URL param. */}
                                <a
                                  href={`/recurring-routes?edit=${r.routeId}`}
                                  className="text-brand-purple hover:underline font-semibold"
                                  title={`Open route "${r.routeName}" in the Recurring Routes editor`}
                                >
                                  {r.routeName || `Route #${r.routeId}`}
                                </a>
                              </span>
                            ))}
                          </>
                        ) : p.attachedRouteCount > 0 ? (
                          // Fallback for pre-2026-08-06 payloads that only
                          // carried the count. Should not fire once every
                          // pod is on the new build.
                          <span>attached to {p.attachedRouteCount} route(s)</span>
                        ) : (
                          <span>not attached to any route</span>
                        )}
                      </div>
                      {/* Zone / postcode-group / schedule bindings.
                          Populated by BulkPolygonService.GetAllAsync
                          (Phase 5 zoneNameId/postcodeGroupId +
                          Phase 8 schedule junction). Chips let the
                          operator see every binding at a glance
                          without opening the Zone Groups tab. Fields
                          are defensively defaulted because existing
                          test fixtures (pre-Phase-8) omit them. */}
                      {(p.zoneNameId != null || p.postcodeGroupId != null || (p.attachedScheduleNames?.length ?? 0) > 0) && (
                        <div className="ml-5 mt-0.5 flex flex-wrap gap-1">
                          {p.zoneNameId != null && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-brand-cyan/15 text-brand-cyan"
                              title={`Bound to zone: ${p.zoneNameName ?? `#${p.zoneNameId}`}`}>
                              zone {p.zoneNameName ?? `#${p.zoneNameId}`}
                            </span>
                          )}
                          {p.postcodeGroupId != null && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-brand-orange/15 text-brand-orange"
                              title={`Bound to group: ${p.postcodeGroupName ?? `#${p.postcodeGroupId}`}`}>
                              group {p.postcodeGroupName ?? `#${p.postcodeGroupId}`}
                            </span>
                          )}
                          {(p.attachedScheduleNames?.length ?? 0) > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-brand-purple/15 text-brand-purple"
                              title={`Bound to schedules: ${p.attachedScheduleNames.join(', ')}`}>
                              {p.attachedScheduleNames.length} schedule{p.attachedScheduleNames.length === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                      )}
                      {(() => {
                        const includedZips = parsePartiallyIncludedZips(p.partiallyIncludedZips);
                        if (includedZips.length === 0) return null;
                        return (
                          <div className="ml-5 mt-1">
                            <div className="flex items-center gap-1 mb-0.5">
                              <span className="text-[9px] uppercase tracking-wide text-text-muted">
                                Covers {includedZips.length} {zipShortLower}{includedZips.length === 1 ? '' : 's'}
                              </span>
                              <button type="button"
                                onClick={() => showIncludedZipsOnMap(p)}
                                className="text-[9px] font-semibold text-brand-purple hover:underline"
                                title={`Load the ${includedZips.length} ${zipShortLower} boundar${includedZips.length === 1 ? 'y' : 'ies'} onto the map for visual confirmation`}>
                                Show on map
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-0.5">
                              {includedZips.slice(0, 12).map((z) => (
                                <span key={z}
                                  className="inline-block px-1 py-0.5 rounded bg-brand-cyan/15 text-brand-dark text-[9px]"
                                >{z}</span>
                              ))}
                              {includedZips.length > 12 && (
                                <span className="inline-block px-1 py-0.5 text-text-muted text-[9px]"
                                  title={includedZips.slice(12).join(', ')}
                                >+{includedZips.length - 12} more</span>
                              )}
                            </div>
                          </div>
                        );
                      })()}
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
                          {p.points.length} vertices - too many for direct edit. Reshape via Cut / Add / Clip.
                        </div>
                      )}
                      <div className="ml-5 mt-1 flex flex-wrap gap-1">
                        {isEditing
                          ? <button className="text-[10px] font-semibold text-success"
                              onClick={stopEdit}>Done editing</button>
                          : <button className="text-[10px] font-semibold text-brand-purple hover:underline"
                              onClick={() => startEdit(p.polygonId)}
                              disabled={mode === 'drawing' || p.points.length > MAX_EDIT_HANDLE_VERTICES}
                              title={p.points.length > MAX_EDIT_HANDLE_VERTICES ? 'Too many vertices - use Cut/Add/Clip in edit mode instead' : undefined}>Edit shape</button>}
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
          onRemovePolygon={(p) => { setContextMenu(null); void removePolygon(p); }}
          onStartLasso={() => { setContextMenu(null); startLasso(); }}
          onStartRect={() => { setContextMenu(null); startRect(); }}
          onStartCircle={() => { setContextMenu(null); startCircle(); }}
          maxEditVertices={MAX_EDIT_HANDLE_VERTICES}
        />
      )}

      {openSaveModal && pendingPolygon && pendingPolygon.length > 0 && (
        <SaveNewPolygonModal rings={pendingPolygon}
          onCancel={() => setOpenSaveModal(false)}
          onCreated={onPolygonCreated} />
      )}

      {zipSaveOpen && (
        <SaveAsRouteModal
          zipSelection={selected} polygonSelection={[]}
          onClose={() => setZipSaveOpen(false)}
          onSaved={() => {
            setZipSaveOpen(false);
            toast.show('Route saved. Manage it under Recurring Routes.', 'success');
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
            toast.show('Route saved. Manage it under Recurring Routes.', 'success');
            setSelectedPolygons(new Set());
          }}
        />
      )}

      <ZonesDrawer
        open={zonesDrawerOpen}
        onClose={() => setZonesDrawerOpen(false)}
        onShowZipsOnMap={(zips, ctx) => showZipStringsOnMap(zips, ctx)}
        prefetchedDepots={prefetchedZones}
      />
    </div>
  );
}

// ─── SaveNewPolygonModal ────────────────────────────────────────────────

interface SaveNewPolygonProps {
  // 2026-08-06: widened from single ring (vertices: LatLng[]) to multi-
  // ring (rings: LatLng[][]) so pending-mode boolean ops (Cut / Split
  // producing multiple pieces) round-trip through save with every piece
  // intact. Fresh single-drag polygons come in as [oneRing].
  rings: LatLng[][];
  onCancel: () => void;
  onCreated: (created: BulkPolygon) => void;
}

function SaveNewPolygonModal({ rings, onCancel, onCreated }: SaveNewPolygonProps) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const totalVerts = rings.reduce((n, r) => n + r.length, 0);

  const commit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.show('Coverage polygon name is required.', 'error'); return; }
    setSaving(true);
    try {
      const points: PolygonPoint[] = [];
      rings.forEach((ring, ringIndex) => {
        ring.forEach((pt, orderIndex) => {
          points.push({ ringIndex, orderIndex, lat: pt.lat, lng: pt.lng });
        });
      });
      // Centroid is stamped off ring 0 - matches the single-outer-ring
      // convention used by saved polygons + edit-mode commitShape.
      const centroid = polygonCentroid(rings[0]);
      const res = await bulkPolygonService.create({
        name: trimmed,
        centroidLatitude: centroid.lat, centroidLongitude: centroid.lng,
        points,
        sourceType: 0,
        sourceCode: null,
      });
      onCreated(res.response);
      const zips = parsePartiallyIncludedZips(res.response.partiallyIncludedZips);
      const zipTrailer = zips.length === 0
        ? ' (no overlapping postcodes)'
        : ` Derived ${zips.length} postcode${zips.length === 1 ? '' : 's'}: ${zips.slice(0, 6).join(', ')}${zips.length > 6 ? `, +${zips.length - 6} more` : ''}.`;
      toast.show(`Coverage polygon "${trimmed}" saved.${zipTrailer}`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={true} onClose={onCancel} title="Save coverage polygon"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onCancel}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={commit} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : `Save (${totalVerts} vertices)`}
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
  // Save-as-route is a quick path from Polygon Builder that supports a
  // single schedule pick; wrapped into a 1-element scheduleIds list at
  // commit time. Multi-schedule editing lives on the ScheduledRoutes page.

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
        scheduleIds: scheduleId != null ? [scheduleId] : [],
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

/** Convert a bulk polygon's points list into an ordered array of rings,
 *  each ring an ordered LatLng list. Ring 0 is always first. Winding
 *  order distinguishes outer (CCW) from hole (CW); Google Maps'
 *  Polygon.setPaths() consumes this directly. Multi-ring polygons are
 *  handled by grouping on ringIndex. */
function pointsToLatLngRings(points: PolygonPoint[]): LatLng[][] {
  const byRing = new Map<number, PolygonPoint[]>();
  for (const p of points) {
    const ri = p.ringIndex ?? 0;
    const list = byRing.get(ri);
    if (list) list.push(p);
    else byRing.set(ri, [p]);
  }
  return [...byRing.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, pts]) =>
      pts
        .slice()
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((p) => ({ lat: p.lat, lng: p.lng })),
    );
}

/** Backward-compat single-ring accessor. Returns the outer (ring 0) path
 *  only. Multi-ring polygons will have their additional rings ignored by
 *  callers still using this - migrate them to pointsToLatLngRings when the
 *  feature calls for it. */
function pointsToLatLngPath(points: PolygonPoint[]): LatLng[] {
  const rings = pointsToLatLngRings(points);
  return rings[0] ?? [];
}

function polygonCentroid(ring: LatLng[]): LatLng {
  const sum = ring.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
}

/** Signed area (shoelace) of a ring. Positive = counter-clockwise
 *  (outer ring in Google Maps convention), negative = clockwise (hole).
 *  Used to count how many disjoint pieces a multi-ring polygon has. */
function signedRingArea(ring: LatLng[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += (b.lng - a.lng) * (b.lat + a.lat);
  }
  return -sum / 2;
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
  onRemovePolygon: (p: BulkPolygon) => void;
  onStartLasso: () => void;
  onStartRect: () => void;
  onStartCircle: () => void;
  maxEditVertices: number;
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
          <MenuItem label="Remove" danger
            onClick={() => props.onRemovePolygon((state.target as { kind: 'polygon'; polygon: BulkPolygon }).polygon)} />
        </>
      )}
      {state.target.kind === 'mapBackground' && (
        <>
          {/* "Draw new polygon (P)" entry removed 2026-08-05 with the
              Vertex Polygon tool. Lasso is now the primary freehand
              polygon tool. */}
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

// ─── ShapeInputPicker (edit-mode) ───────────────────────────────────────
// Segmented button row that picks which drawing tool the boolean-op
// buttons (Add / Cut / Clip) hand to the operator. Only rendered inside
// edit mode - view mode uses DrawingToolsMenu below for creating new
// polygons. Split doesn't consult this picker: rect / circle can't
// yield a polyline, so Split always uses freehand.
interface ShapeInputPickerProps {
  value: 'freehand' | 'rect' | 'circle';
  onChange: (v: 'freehand' | 'rect' | 'circle') => void;
}

function ShapeInputPicker({ value, onChange }: ShapeInputPickerProps) {
  const options: Array<{
    key: 'freehand' | 'rect' | 'circle';
    label: string;
    hint: string;
    icon: React.ReactNode;
  }> = [
    { key: 'freehand', label: 'Freehand', hint: 'Freehand lasso - drag to trace any shape (L).', icon: <IconLasso /> },
    { key: 'rect',     label: 'Rectangle', hint: 'Rectangle - drag from corner to corner (R).',    icon: <IconRect /> },
    { key: 'circle',   label: 'Circle',    hint: 'Circle - drag from centre outward (C).',         icon: <IconCircle /> },
  ];
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="Input shape">
      <span className="text-text-muted mr-1">Shape:</span>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.key)}
            title={opt.hint}
            className={`px-2 py-1 rounded border inline-flex items-center gap-1 text-xs transition-colors ${
              active
                ? 'border-brand-purple bg-brand-purple text-surface-white'
                : 'border-border bg-surface-white text-text-secondary hover:bg-surface-cream'
            }`}
          >
            <span className="w-4 h-4 inline-flex items-center justify-center">{opt.icon}</span>
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── DrawingToolsMenu ("New Drawing") ───────────────────────────────────
// Consolidates the 3 drag-based draw modes (Lasso, Rect, Circle) behind
// a single "New Drawing" button + dropdown - each option starts a fresh
// coverage polygon. Once the initial shape is drawn the operator can
// refine it in pending mode using the same Add / Cut / Clip / Split
// tools that saved polygons offer. Click-outside + Esc dismiss the
// dropdown. Keyboard shortcuts (L / R / C) still fire independently.
// Renamed 2026-08-06 from "Drawing Tools" (unclear to first-time users).

interface DrawingToolsMenuProps {
  onStartLasso: () => void;
  onStartRect: () => void;
  onStartCircle: () => void;
}

function DrawingToolsMenu({ onStartLasso, onStartRect, onStartCircle }: DrawingToolsMenuProps) {
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

  // 2026-08-05 (George feedback): "Vertex polygon" (click-to-add-vertex)
  // dropped from the toolbar. It felt unusable compared to the drag-based
  // tools even after the snap-cache + rAF perf fixes - the click-to-add
  // UX is fundamentally slower than lasso/rect/circle. Operators can
  // still get per-vertex precision by drawing with any of the three
  // remaining tools and then reshaping in edit mode (every vertex is a
  // draggable handle there). The `mode === 'drawing'` code path stays
  // in the file for now in case a future affordance re-enables it.
  const items: Array<{ label: string; shortcut: string; onClick: () => void; icon: React.ReactNode; primary?: boolean }> = [
    { label: 'Freehand lasso', shortcut: 'L', onClick: onStartLasso, icon: <IconLasso />, primary: true },
    { label: 'Rectangle',      shortcut: 'R', onClick: onStartRect,   icon: <IconRect /> },
    { label: 'Circle',         shortcut: 'C', onClick: onStartCircle, icon: <IconCircle /> },
  ];
  return (
    <div ref={wrapRef} className="relative">
      <Button variant="primary" size="sm" onClick={() => setOpen((o) => !o)}
        title="Start a new coverage polygon - pick a drawing tool to lay down the initial shape, then refine with Add / Cut / Clip / Split before saving.">
        <span className="inline-flex items-center gap-1">
          <IconNewDrawing />
          New Drawing
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
// Icon for the "New Drawing" toolbar button: a coverage-polygon outline
// with a small filled "+" badge in the top-right corner. Reads as
// "start a new shape" at a glance without needing to squint at the
// label. Uses currentColor so it inherits the surrounding button
// palette (primary variant = light on dark).
const IconNewDrawing = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <polygon
      points="6,4 10.5,4.5 11.5,9.5 8.5,13 3.5,11 3.5,6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <circle cx="12.5" cy="3.5" r="2.75" fill="currentColor" />
    <path
      d="M 12.5 2 L 12.5 5 M 11 3.5 L 14 3.5"
      stroke="#fff"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);
