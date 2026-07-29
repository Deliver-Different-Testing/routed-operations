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
  customPolygonService,
  type CustomPolygon,
} from '../services/customPolygonService';

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CUSTOM_PALETTE = ['#f2994a', '#3bc7f4', '#606db4', '#10b981', '#ef4444', '#8b5cf6', '#eab308'];
const SNAP_PIXELS = 14;

type Mode = 'view' | 'drawing' | { edit: number };
interface LatLng { lat: number; lng: number; }

/**
 * Polygon Builder page.
 *
 * TWO features share the same map:
 *   1. Zip picker (existing) - search a real ZipPolygon row, load its shape,
 *      click to select. Save-as-route writes a Route + RouteZipcodes entry.
 *   2. Custom polygon draw + edit (Stage 2 - 2026-07-29) - click to draw an
 *      arbitrary shape, save to CustomZipPolygon, later attach to a Route
 *      that participates in prebook auto-assign via the geometry fallback in
 *      UTL_stpRouteAutoAssign_ResolveOneSide.
 *
 * Snap-to-vertex + snap-to-edge fire against BOTH loaded zip shapes AND
 * existing custom shapes so adjacent polygons can share exact borders.
 */
export default function PolygonBuilder() {
  const user = useAuth();
  const toast = useToast();
  const zipShortLower = postcodeLabel(user.isUsTenant, true).toLowerCase();
  const zipLongLower = postcodeLabel(user.isUsTenant, false).toLowerCase();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const zipOverlaysRef = useRef<Map<number, any>>(new Map());
  const customOverlaysRef = useRef<Map<number, any>>(new Map());
  const drawPreviewPolyRef = useRef<any>(null);
  const drawPreviewMarkersRef = useRef<any[]>([]);
  const editHandlesRef = useRef<any[]>([]);
  const editMidpointsRef = useRef<any[]>([]);
  const editPolyRef = useRef<any>(null);
  const snapHintRef = useRef<any>(null);
  const projectionHelperRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // Existing zip picker state.
  const [loadedShapes, setLoadedShapes] = useState<ZipPolygonShape[]>([]);
  const [selected, setSelected] = useState<ZipcodeLookup[]>([]);
  const [zipSearch, setZipSearch] = useState('');
  const [zipResults, setZipResults] = useState<ZipcodeLookup[]>([]);

  // Custom polygon state (Stage 2).
  const [customs, setCustoms] = useState<CustomPolygon[]>([]);
  const [mode, setMode] = useState<Mode>('view');
  const [drawingVertices, setDrawingVertices] = useState<LatLng[]>([]);
  const [selectedCustom, setSelectedCustom] = useState<Set<number>>(new Set());

  // Save modals: either "save selected zips as route" or "save selected customs as route".
  const [zipSaveOpen, setZipSaveOpen] = useState(false);
  const [customSaveOpen, setCustomSaveOpen] = useState(false);

  // Two-step draw persistence: after Finish, ask for a name then POST /api/custom-polygons.
  const [pendingDraw, setPendingDraw] = useState<LatLng[] | null>(null);

  const apiKey = user.googleMapsKey;
  const google = typeof window !== 'undefined' ? (window as any).google : undefined;

  // Wait for the Google Maps SDK.
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

  // Init map + a hidden OverlayView so we can convert LatLng -> container pixels
  // for pixel-accurate snap detection at any zoom.
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

    // Testing hook: Playwright + manual browser sessions can call
    // google.maps.event.trigger(window.__pbMap, 'click', { latLng: ... })
    // to drive the draw / edit flow without a source change. Leaving this
    // always-on is harmless - the map instance was already reachable via
    // React refs to anyone with devtools access.
    (window as any).__pbMap = map;

    return () => {
      zipOverlaysRef.current.forEach((p) => p.setMap(null));
      customOverlaysRef.current.forEach((p) => p.setMap(null));
      clearDrawPreview();
      clearEditHandles();
      snapHintRef.current?.setMap(null);
      helper.setMap(null);
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Load custom polygons on mount.
  useEffect(() => {
    void (async () => {
      try {
        const res = await customPolygonService.list();
        setCustoms(res.response ?? []);
      } catch (e) { toast.show((e as Error).message, 'error'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          map: mapRef.current, clickable: true,
        });
        poly.addListener('click', () => toggleZip(s));
        zipOverlaysRef.current.set(s.zipPolygonId, poly);
      }
      poly.setOptions(isSelected
        ? { strokeColor: '#F2994A', fillColor: '#F2994A', fillOpacity: 0.4, strokeWeight: 2 }
        : { strokeColor: '#00A3FF', fillColor: '#00A3FF', fillOpacity: 0.15, strokeWeight: 1.5 });
      path.forEach((pt) => { bounds.extend(pt); boundsCount++; });
    });
    if (boundsCount > 0 && loadedShapes.length <= 15) {
      mapRef.current.fitBounds(bounds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedShapes, selected]);

  // Sync custom overlays. The one currently being edited is skipped (it
  // lives on editPolyRef so vertex drag mutates it directly without a rebuild).
  useEffect(() => {
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps) return;
    const editingId = typeof mode === 'object' ? mode.edit : null;
    const activeIds = new Set(customs.map((c) => c.customZipPolygonId));

    customOverlaysRef.current.forEach((poly, id) => {
      if (!activeIds.has(id) || id === editingId) {
        poly.setMap(null);
        customOverlaysRef.current.delete(id);
      }
    });

    customs.forEach((c, idx) => {
      if (c.customZipPolygonId === editingId) return;
      const path = parseWktPolygon(c.wkt);
      if (!path || path.length < 3) return;
      const color = CUSTOM_PALETTE[idx % CUSTOM_PALETTE.length];
      const isSelected = selectedCustom.has(c.customZipPolygonId);
      let poly = customOverlaysRef.current.get(c.customZipPolygonId);
      if (!poly) {
        poly = new g.maps.Polygon({
          paths: path, map: mapRef.current, clickable: true,
        });
        poly.addListener('click', () => toggleCustomSelected(c.customZipPolygonId));
        customOverlaysRef.current.set(c.customZipPolygonId, poly);
      } else {
        poly.setPath(path);
      }
      poly.setOptions({
        strokeColor: color,
        strokeOpacity: isSelected ? 1 : 0.85,
        strokeWeight: isSelected ? 3 : 2,
        fillColor: color,
        fillOpacity: isSelected ? 0.35 : 0.18,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customs, selectedCustom, mode]);

  const toggleZip = (shape: ZipPolygonShape) => {
    setSelected((prev) =>
      prev.some((z) => z.zipPolygonId === shape.zipPolygonId)
        ? prev.filter((z) => z.zipPolygonId !== shape.zipPolygonId)
        : [...prev, {
            zipPolygonId: shape.zipPolygonId, zip: shape.zip,
            latitude: shape.latitude, longitude: shape.longitude,
          }]);
  };

  const toggleCustomSelected = (id: number) => {
    setSelectedCustom((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Zip search - live autocomplete.
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
    setSelectedCustom(new Set());
    setLoadedShapes([]);
    zipOverlaysRef.current.forEach((p) => p.setMap(null));
    zipOverlaysRef.current.clear();
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

  /** Returns nearest vertex OR nearest point on any edge, within SNAP_PIXELS.  */
  const snapTo = (raw: LatLng): { point: LatLng; kind: 'vertex' | 'edge' | null } => {
    const clickPx = latLngToPixel(raw.lat, raw.lng);
    if (!clickPx) return { point: raw, kind: null };

    const shapes: LatLng[][] = [];
    loadedShapes.forEach((s) => {
      const p = parseWktPolygon(s.wkt);
      if (p && p.length >= 3) shapes.push(p);
    });
    customs.forEach((c) => {
      const editingId = typeof mode === 'object' ? mode.edit : null;
      if (c.customZipPolygonId === editingId) return;
      const p = parseWktPolygon(c.wkt);
      if (p && p.length >= 3) shapes.push(p);
    });
    if (drawingVertices.length > 0) shapes.push(drawingVertices);

    // Pass 1: vertex snap (preferred).
    for (const ring of shapes) {
      for (const v of ring) {
        const px = latLngToPixel(v.lat, v.lng);
        if (!px) continue;
        const d = Math.hypot(px.x - clickPx.x, px.y - clickPx.y);
        if (d < SNAP_PIXELS) return { point: v, kind: 'vertex' };
      }
    }
    // Also allow closing the in-progress polygon by snapping to its first point.
    if (drawingVertices.length >= 3) {
      const first = drawingVertices[0];
      const px = latLngToPixel(first.lat, first.lng);
      if (px) {
        const d = Math.hypot(px.x - clickPx.x, px.y - clickPx.y);
        if (d < SNAP_PIXELS) return { point: first, kind: 'vertex' };
      }
    }

    // Pass 2: edge snap.
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
          // Convert projected pixel back to LatLng via linear interpolation on the segment.
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

  // Map click + mousemove hooks (mode-dispatched).
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
  }, [mode, drawingVertices, loadedShapes, customs]);

  // Draw-mode preview render.
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
    setPendingDraw(drawingVertices);
    setDrawingVertices([]);
    setMode('view');
  };

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

    const custom = customs.find((c) => c.customZipPolygonId === mode.edit);
    if (!custom) return;
    const path = parseWktPolygon(custom.wkt);
    if (!path || path.length < 3) return;

    // Mutable working copy - drag mutates in place, commit to server on dragend.
    const working: LatLng[] = path.map((p) => ({ lat: p.lat, lng: p.lng }));
    const color = CUSTOM_PALETTE[
      customs.findIndex((c) => c.customZipPolygonId === mode.edit) % CUSTOM_PALETTE.length
    ];

    editPolyRef.current = new g.maps.Polygon({
      paths: working, map: mapRef.current,
      strokeColor: color, strokeOpacity: 1, strokeWeight: 2,
      fillColor: color, fillOpacity: 0.3,
      clickable: false,
    });

    const renderVertexAndMidHandles = () => {
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
          renderVertexAndMidHandles();
        });
        handle.addListener('rightclick', async () => {
          if (working.length <= 3) {
            toast.show('A polygon must keep at least 3 vertices.', 'error');
            return;
          }
          working.splice(i, 1);
          editPolyRef.current?.setPath(working);
          await commitShape(mode.edit, working);
          renderVertexAndMidHandles();
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
          renderVertexAndMidHandles();
        });
        editMidpointsRef.current.push(marker);
      });
    };

    renderVertexAndMidHandles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const commitShape = async (id: number, working: LatLng[]) => {
    try {
      const wkt = latLngsToWkt(working);
      const centroid = polygonCentroid(working);
      const res = await customPolygonService.updateShape(id, {
        wkt, centroidLatitude: centroid.lat, centroidLongitude: centroid.lng,
      });
      setCustoms((prev) => prev.map((c) =>
        c.customZipPolygonId === id ? res.response : c));
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

  const removeCustom = async (c: CustomPolygon) => {
    const msg = c.attachedRouteCount > 0
      ? `"${c.name}" is attached to ${c.attachedRouteCount} active route(s). Remove anyway?`
      : `Remove "${c.name}"?`;
    if (!confirm(msg)) return;
    try {
      await customPolygonService.remove(c.customZipPolygonId);
      setCustoms((prev) => prev.filter((x) => x.customZipPolygonId !== c.customZipPolygonId));
      setSelectedCustom((prev) => {
        const next = new Set(prev);
        next.delete(c.customZipPolygonId);
        return next;
      });
      toast.show('Custom polygon removed.', 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const onCustomCreated = (created: CustomPolygon) => {
    setCustoms((prev) => [...prev, created]);
    setPendingDraw(null);
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
  const selectedCustomList = customs.filter((c) => selectedCustom.has(c.customZipPolygonId));

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-white border-b border-border text-xs">
        <h1 className="text-base font-semibold text-text-primary">Polygon Builder</h1>
        <span className="text-text-muted">
          - {loadedShapes.length} {zipShortLower}{loadedShapes.length === 1 ? '' : 's'} loaded, {selected.length} selected, {customs.length} custom, {selectedCustom.size} custom selected
        </span>
        <div className="flex-1" />
        {mode === 'drawing' ? (
          <>
            <span className="text-text-muted">
              Click to add points ({drawingVertices.length}). Near a border? red = snap-vertex, amber = snap-edge.
            </span>
            <Button variant="neutral" size="sm" onClick={undoVertex} disabled={drawingVertices.length === 0}>Undo</Button>
            <Button variant="neutral" size="sm" onClick={cancelDraw}>Cancel</Button>
            <Button variant="secondary" size="sm" onClick={finishDraw} disabled={drawingVertices.length < 3}>
              Finish ({drawingVertices.length})
            </Button>
          </>
        ) : editingId != null ? (
          <>
            <span className="text-text-muted">
              Drag the coloured squares to reshape; click a white circle to insert a vertex; right-click a square to delete it.
            </span>
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
            <Button variant="secondary" size="sm" onClick={() => setCustomSaveOpen(true)} disabled={selectedCustom.size === 0}
              title={selectedCustom.size === 0 ? 'Select some custom polygons first' : 'Persist the custom-polygon selection as a recurring route'}>
              Save customs as Route ({selectedCustom.size})
            </Button>
            <Button variant="primary" size="sm" onClick={startDraw}>+ Draw new polygon</Button>
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
              <ul className="space-y-0.5">
                {selected.map((z) => (
                  <li key={z.zipPolygonId} className="flex items-center gap-1 px-2 py-1 rounded bg-brand-cyan/10">
                    <span className="flex-1 truncate">{z.zip}</span>
                    <button type="button" onClick={() => removeSelection(z.zipPolygonId)}
                      className="text-text-muted hover:text-error text-xs" title="Remove">x</button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="text-text-secondary text-[10px] uppercase tracking-wide mb-1">
                Custom polygons ({customs.length})
              </div>
              {customs.length === 0 && (
                <div className="text-text-muted italic text-[10px]">
                  None yet. Click "+ Draw new polygon" to start.
                </div>
              )}
              <ul className="space-y-1">
                {customs.map((c, idx) => {
                  const color = CUSTOM_PALETTE[idx % CUSTOM_PALETTE.length];
                  const isChecked = selectedCustom.has(c.customZipPolygonId);
                  const isEditing = editingId === c.customZipPolygonId;
                  return (
                    <li key={c.customZipPolygonId}
                      className={`px-2 py-1 rounded border ${isEditing ? 'border-warning bg-warning/10' : 'border-border-light'}`}>
                      <label className="flex items-center gap-1.5">
                        <input type="checkbox" checked={isChecked}
                          onChange={() => toggleCustomSelected(c.customZipPolygonId)} />
                        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                        <span className="flex-1 truncate font-medium">{c.name}</span>
                      </label>
                      <div className="ml-5 mt-0.5 text-[10px] text-text-muted">
                        {c.attachedRouteCount > 0
                          ? `attached to ${c.attachedRouteCount} route(s)`
                          : 'not attached to any route'}
                      </div>
                      <div className="ml-5 mt-1 flex flex-wrap gap-1">
                        {isEditing
                          ? <button className="text-[10px] font-semibold text-success"
                              onClick={stopEdit}>Done editing</button>
                          : <button className="text-[10px] font-semibold text-brand-purple hover:underline"
                              onClick={() => startEdit(c.customZipPolygonId)}
                              disabled={mode === 'drawing'}>Edit shape</button>}
                        <button className="text-[10px] text-error hover:underline"
                          onClick={() => removeCustom(c)}>Remove</button>
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

      {pendingDraw && (
        <SaveNewCustomModal vertices={pendingDraw}
          onCancel={() => setPendingDraw(null)}
          onCreated={onCustomCreated} />
      )}

      {zipSaveOpen && (
        <SaveAsRouteModal
          zipSelection={selected} customSelection={[]}
          onClose={() => setZipSaveOpen(false)}
          onSaved={() => {
            setZipSaveOpen(false);
            toast.show('Route saved. Manage it under Scheduled Routes.', 'success');
            clearAll();
          }}
        />
      )}

      {customSaveOpen && (
        <SaveAsRouteModal
          zipSelection={[]} customSelection={selectedCustomList}
          onClose={() => setCustomSaveOpen(false)}
          onSaved={() => {
            setCustomSaveOpen(false);
            toast.show('Route saved. Manage it under Scheduled Routes.', 'success');
            setSelectedCustom(new Set());
          }}
        />
      )}
    </div>
  );
}

// ─── SaveNewCustomModal ────────────────────────────────────────────────

interface SaveNewCustomProps {
  vertices: LatLng[];
  onCancel: () => void;
  onCreated: (created: CustomPolygon) => void;
}

function SaveNewCustomModal({ vertices, onCancel, onCreated }: SaveNewCustomProps) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const commit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { toast.show('Custom polygon name is required.', 'error'); return; }
    setSaving(true);
    try {
      const wkt = latLngsToWkt(vertices);
      const centroid = polygonCentroid(vertices);
      const res = await customPolygonService.create({
        name: trimmed, wkt,
        centroidLatitude: centroid.lat, centroidLongitude: centroid.lng,
      });
      onCreated(res.response);
      toast.show(`Custom polygon "${trimmed}" saved. Use "Save customs as Route" to attach it to a schedule.`, 'success');
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={true} onClose={onCancel} title="Save custom polygon"
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
          The shape is saved to CustomZipPolygon and can be attached to one or more Routes later.
          Bookings whose pickup falls inside this shape will auto-assign to those Routes via the
          prebook geometry fallback.
        </p>
      </div>
    </Modal>
  );
}

// ─── SaveAsRouteModal (extended to handle zip OR custom polygon selection) ──

interface SaveAsRouteProps {
  zipSelection: ZipcodeLookup[];
  customSelection: CustomPolygon[];
  onClose: () => void;
  onSaved: () => void;
}

function SaveAsRouteModal({ zipSelection, customSelection, onClose, onSaved }: SaveAsRouteProps) {
  const toast = useToast();
  const user = useAuth();
  const zipShortLower = postcodeLabel(user.isUsTenant, true).toLowerCase();
  const zipLongLower = postcodeLabel(user.isUsTenant, false).toLowerCase();
  const isCustom = customSelection.length > 0;
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
        customPolygonIds: customSelection.map((c) => c.customZipPolygonId),
      });
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  const count = isCustom ? customSelection.length : zipSelection.length;
  const noun = isCustom ? 'custom polygon' : zipShortLower;

  return (
    <Modal open={true} onClose={onClose} title={`Save ${isCustom ? 'custom polygons' : 'zip selection'} as recurring route`}
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
            {isCustom ? `${customSelection.length} custom polygon(s)` : `${zipSelection.length} ${zipLongLower}s`} will be attached:
          </div>
          <div className="flex flex-wrap gap-1">
            {isCustom
              ? customSelection.map((c) => (
                  <span key={c.customZipPolygonId} className="px-2 py-0.5 rounded bg-warning/15 text-brand-dark">
                    {c.name}
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

/** Parse WKT "POLYGON((lng lat, ...))" or "MULTIPOLYGON(((lng lat, ...)))" into a lat/lng ring. */
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

/** Serialise a lat/lng ring back to WKT POLYGON, auto-closing the ring. */
function latLngsToWkt(ring: LatLng[]): string {
  if (ring.length < 3) throw new Error('Need at least 3 vertices to form a polygon.');
  const closed = [...ring];
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (first.lat !== last.lat || first.lng !== last.lng) closed.push(first);
  const coords = closed.map((p) => `${p.lng} ${p.lat}`).join(', ');
  return `POLYGON((${coords}))`;
}

/** Simple average-vertex centroid. Not a true area centroid, but good enough for map centering + zoom-to.  */
function polygonCentroid(ring: LatLng[]): LatLng {
  const sum = ring.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
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
