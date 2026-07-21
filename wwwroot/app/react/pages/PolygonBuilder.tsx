import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
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

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Zip picker on a Google Map. Search a zip (or pan/zoom), click the shape
 * to add it to the selection, click again to remove. Uses existing
 * ZipPolygon.Wkt shapes - never creates new polygon rows.
 *
 * "Save as recurring route" writes a Route + RouteZipcodes entry via
 * recurringRouteService.create, so a polygon-drawn route surfaces cleanly
 * in DF Admin + drives the downstream prebook cron.
 */
export default function PolygonBuilder() {
  const user = useAuth();
  const toast = useToast();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<Map<number, any>>(new Map()); // zipPolygonId -> Polygon overlay
  const [ready, setReady] = useState(false);

  // Loaded zip shapes (rendered on the map) + operator's current selection.
  const [loadedShapes, setLoadedShapes] = useState<ZipPolygonShape[]>([]);
  const [selected, setSelected] = useState<ZipcodeLookup[]>([]);
  const [zipSearch, setZipSearch] = useState('');
  const [zipResults, setZipResults] = useState<ZipcodeLookup[]>([]);

  const [saveOpen, setSaveOpen] = useState(false);

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

  // Init map once SDK ready.
  useEffect(() => {
    if (!ready || !mapContainerRef.current || mapRef.current) return;
    const g = (window as any).google;
    const map = new g.maps.Map(mapContainerRef.current, {
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 5,
      mapTypeId: g.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
      clickableIcons: false,
    });
    mapRef.current = map;
    return () => {
      overlaysRef.current.forEach((p) => p.setMap(null));
      overlaysRef.current.clear();
      mapRef.current = null;
    };
  }, [ready]);

  // Sync overlays: (a) remove ones whose shape is no longer loaded, (b) add
  // new ones for freshly-loaded shapes, (c) restyle to reflect selection.
  useEffect(() => {
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps) return;
    const selectedSet = new Set(selected.map((s) => s.zipPolygonId));
    const loadedIds = new Set(loadedShapes.map((s) => s.zipPolygonId));

    overlaysRef.current.forEach((poly, id) => {
      if (!loadedIds.has(id)) { poly.setMap(null); overlaysRef.current.delete(id); }
    });

    const bounds = new g.maps.LatLngBounds();
    let boundsCount = 0;
    loadedShapes.forEach((s) => {
      const path = parseWktPolygon(s.wkt);
      if (!path || path.length < 3) return;
      const isSelected = selectedSet.has(s.zipPolygonId);
      let poly = overlaysRef.current.get(s.zipPolygonId);
      if (!poly) {
        poly = new g.maps.Polygon({
          paths: path,
          strokeColor: '#00A3FF',
          strokeOpacity: 0.9,
          strokeWeight: 1.5,
          fillColor: '#00A3FF',
          fillOpacity: 0.15,
          map: mapRef.current,
          clickable: true,
        });
        poly.addListener('click', () => toggleZip(s));
        overlaysRef.current.set(s.zipPolygonId, poly);
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

  const toggleZip = (shape: ZipPolygonShape) => {
    setSelected((prev) => {
      if (prev.some((z) => z.zipPolygonId === shape.zipPolygonId)) {
        return prev.filter((z) => z.zipPolygonId !== shape.zipPolygonId);
      }
      return [...prev, {
        zipPolygonId: shape.zipPolygonId,
        zip: shape.zip,
        latitude: shape.latitude,
        longitude: shape.longitude,
      }];
    });
  };

  // Zip search - live autocomplete against /recurring-routes/zipcodes/search.
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
      setSelected((prev) => prev.some((x) => x.zipPolygonId === z.zipPolygonId) ? prev : [...prev, z]);
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const removeSelection = (id: number) => {
    setSelected((prev) => prev.filter((z) => z.zipPolygonId !== id));
  };

  const clearAll = () => {
    setSelected([]);
    setLoadedShapes([]);
    overlaysRef.current.forEach((p) => p.setMap(null));
    overlaysRef.current.clear();
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

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-white border-b border-border text-xs">
        <h1 className="text-base font-semibold text-text-primary">Polygon Builder</h1>
        <span className="text-text-muted">
          - {loadedShapes.length} zip{loadedShapes.length === 1 ? '' : 's'} loaded, {selected.length} selected
        </span>
        <div className="flex-1" />
        <Button variant="neutral" size="sm" onClick={clearAll} disabled={loadedShapes.length === 0 && selected.length === 0}>
          Clear
        </Button>
        <Button
          variant="secondary" size="sm"
          onClick={() => setSaveOpen(true)}
          disabled={selected.length === 0}
          title={selected.length === 0 ? 'Select some zip codes first' : 'Persist the selection as a recurring route'}
        >
          Save as Route ({selected.length})
        </Button>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-72 border-r border-border overflow-y-auto">
          <div className="p-3 space-y-3 text-xs">
            <div>
              <div className="text-text-secondary text-[10px] uppercase tracking-wide mb-1">
                Search zip codes
              </div>
              <input
                type="text"
                value={zipSearch}
                onChange={(e) => setZipSearch(e.target.value)}
                className="w-full border border-border rounded px-2 py-1 text-xs"
                placeholder="Type a zip prefix..."
              />
              {zipResults.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-auto border border-border-light rounded bg-surface-white">
                  {zipResults.map((z) => (
                    <li key={z.zipPolygonId}>
                      <button
                        type="button"
                        onClick={() => loadZip(z)}
                        className="w-full text-left px-2 py-1 hover:bg-surface-cream"
                      >
                        {z.zip}
                        {z.latitude != null && <span className="text-[10px] text-text-muted ml-1">
                          ({Number(z.latitude).toFixed(2)}, {Number(z.longitude).toFixed(2)})
                        </span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-1 text-[10px] text-text-muted">
                Load a zip to render its boundary; click the shape on the map to toggle selection.
              </div>
            </div>

            <div>
              <div className="text-text-secondary text-[10px] uppercase tracking-wide mb-1">
                Selected ({selected.length})
              </div>
              {selected.length === 0 && (
                <div className="text-text-muted italic text-[10px]">
                  No zips selected yet.
                </div>
              )}
              <ul className="space-y-0.5">
                {selected.map((z) => (
                  <li key={z.zipPolygonId} className="flex items-center gap-1 px-2 py-1 rounded bg-brand-cyan/10">
                    <span className="flex-1 truncate">{z.zip}</span>
                    <button type="button" onClick={() => removeSelection(z.zipPolygonId)}
                      className="text-text-muted hover:text-error text-xs" title="Remove">×</button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="flex-1">
          <div ref={mapContainerRef} className="h-full w-full" />
        </div>
      </div>

      {saveOpen && (
        <SaveAsRouteModal
          selected={selected}
          onClose={() => setSaveOpen(false)}
          onSaved={() => {
            setSaveOpen(false);
            toast.show('Route saved. Manage it under Scheduled Routes.', 'success');
            clearAll();
          }}
        />
      )}
    </div>
  );
}

interface SaveProps {
  selected: ZipcodeLookup[];
  onClose: () => void;
  onSaved: () => void;
}

function SaveAsRouteModal({ selected, onClose, onSaved }: SaveProps) {
  const toast = useToast();
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
        zipPolygonIds: selected.map((z) => z.zipPolygonId),
      });
      onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <Modal open={true} onClose={onClose} title="Save as recurring route"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={commit} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : `Create with ${selected.length} zip(s)`}
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
          <div className="font-medium mb-1">{selected.length} zip codes will be attached:</div>
          <div className="flex flex-wrap gap-1">
            {selected.map((z) => (
              <span key={z.zipPolygonId} className="px-2 py-0.5 rounded bg-brand-cyan/15 text-brand-dark">
                {z.zip}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Parse a WKT POLYGON string into a lat/lng list. Supports "POLYGON((lng lat, ...))"
 * and "MULTIPOLYGON(((lng lat, ...)))"; for multi-polys we take only the first
 * ring of the first polygon (sufficient for zip boundaries).
 */
function parseWktPolygon(wkt: string | null): Array<{ lat: number; lng: number }> | null {
  if (!wkt) return null;
  const upper = wkt.toUpperCase();
  const start = upper.indexOf('((');
  const end = upper.indexOf('))');
  if (start < 0 || end < 0) return null;
  const body = wkt.substring(start + 2, end);
  const firstRing = body.split(')')[0].replace(/\(/g, '').trim();
  const pairs = firstRing.split(',').map((p) => p.trim());
  const path: Array<{ lat: number; lng: number }> = [];
  for (const pair of pairs) {
    const [lng, lat] = pair.split(/\s+/).map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lng)) path.push({ lat, lng });
  }
  return path;
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
