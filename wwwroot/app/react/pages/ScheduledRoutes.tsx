import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { useAuth } from '../context/AuthContext';
import { postcodeLabel } from '../lib/tenantLabels';
import { tenantMapCentre } from '../lib/mapDefaults';
import { parseWktPolygon } from '../lib/wktPolygon';
import { Button } from '../components/common/Button';
import { Panel } from '../components/common/Panel';
import { Modal } from '../components/common/Modal';
import { RowActionsMenu } from '../components/tenant/RowActionsMenu';
import { MappedStopsDrilldown } from './recurring-routes/MappedStopsDrilldown';
import {
  recurringRouteService,
  type RecurringRoute,
  type UpsertRouteBody,
  type ZipcodeLookup,
  type ZipPolygonShape,
  type AssignableTargets,
  type AssignableTarget,
  type ScheduleLookup,
  type RouteRosterEntry,
  type UpsertRosterBody,
  type RouteBooking,
} from '../services/recurringRouteService';
import { bulkPolygonService, type BulkPolygon } from '../services/bulkPolygonService';
import { MarkerClusterer, SuperClusterAlgorithm, type Renderer } from '@googlemaps/markerclusterer';

/** Zoom threshold at which we render INDIVIDUAL zip pills. Below this the
 *  MarkerClusterer collapses them into count bubbles. Matches PolygonBuilder
 *  so operator behaviour is consistent across the two map surfaces. */
const INDIVIDUAL_PILL_MIN_ZOOM = 10;

const TARGET_TYPES: Record<number, string> = { 1: 'Courier', 2: 'Agent', 3: 'Network Partner' };
const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Recurring Routes board. Backed by the Configurator Route table + its
 * Dispatch_RouteRoster / ZipPolygon relationships - same rows visible in
 * DF Admin > Operations > Recurring Routes.
 *
 * Columns follow the Configurator screenshot: Name / Type / Area / Schedule
 * / Default / Zip Codes / Roster / Status / Actions.
 */
export default function ScheduledRoutes() {
  const toast = useToast();
  const askConfirm = useConfirm();
  const user = useAuth();
  const zipLongLabel = postcodeLabel(user.isUsTenant, false);
  const [routes, setRoutes] = useState<RecurringRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<RecurringRoute | 'new' | null>(null);
  const [rosterOpen, setRosterOpen] = useState<RecurringRoute | null>(null);
  const [drillRoute, setDrillRoute] = useState<RecurringRoute | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await recurringRouteService.list();
      setRoutes(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  // URL param handler: `?edit=<routeId>` auto-opens that route's edit
  // modal after the route list loads. Set by Polygon Builder's route
  // link so the operator jumps directly into the coverage-polygon
  // route's editor. Consumes the param after opening so a refresh
  // doesn't re-open unexpectedly.
  useEffect(() => {
    if (routes.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const editIdRaw = params.get('edit');
    if (!editIdRaw) return;
    const editId = Number(editIdRaw);
    if (!Number.isFinite(editId)) return;
    const target = routes.find((r) => r.routeId === editId);
    if (target) {
      setEditing(target);
      // Clear the param so a refresh doesn't re-open + so subsequent
      // deep-links can be re-fired without a full page load.
      params.delete('edit');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
    } else {
      toast.show(`Route #${editId} not found or inactive - can't open editor.`, 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes]);

  const visible = useMemo(
    () => showInactive ? routes : routes.filter((r) => r.active),
    [routes, showInactive]);

  const doDelete = async (r: RecurringRoute) => {
    if (!(await askConfirm({
      title: 'Deactivate route',
      message: `Deactivate route "${r.name}"? It stays in the table but stops driving downstream prebook.`,
      confirmLabel: 'Deactivate',
      danger: true,
    }))) return;
    try {
      await recurringRouteService.remove(r.routeId);
      toast.show('Route deactivated', 'success');
      await load();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  // Deep-copy the route (name auto-suffixed with "(copy)") + copy zip
  // codes. Mirrors the Configurator "Copy" row action - the copy inherits
  // the source route's geometry + default target; roster + bookings start
  // empty so the operator can wire them fresh.
  const doCopy = async (r: RecurringRoute) => {
    try {
      const res = await recurringRouteService.copy(r.routeId, {
        name: `${r.name} (copy)`,
        defaultTargetType: r.defaultTargetType,
        defaultTargetId: r.defaultTargetId,
        scheduleIds: r.schedules.map((s) => s.scheduleId),
        copyZipcodes: true,
      });
      toast.show('Route copied', 'success');
      await load();
      if (res.response) setEditing(res.response);   // open the clone in edit mode
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const doToggleActive = async (r: RecurringRoute) => {
    try {
      await recurringRouteService.update(r.routeId, {
        name: r.name,
        area: r.area,
        defaultTargetType: r.defaultTargetType,
        defaultTargetId: r.defaultTargetId,
        scheduleIds: r.schedules.map((s) => s.scheduleId),
        active: !r.active,
        zipPolygonIds: r.zipcodes.map((z) => z.zipPolygonId),
      });
      toast.show(r.active ? 'Route paused' : 'Route reactivated', 'success');
      await load();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  return (
    <div>
      {/* Configurator-style header row: route count left, cyan Add Route
          button right. The outer RecurringRoutes shell already renders the
          page title + tab bar, so no separate app-header stripe here. */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-text-secondary">
          {visible.length} route{visible.length === 1 ? '' : 's'} configured
        </p>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-1 text-[11px] text-text-secondary">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="w-3.5 h-3.5" />
            Show inactive
          </label>
          <button
            onClick={() => setEditing('new')}
            className="bg-brand-cyan text-[#0d0c2c] font-medium px-3 py-1.5 rounded-full text-xs hover:shadow-cyan-glow transition-shadow"
          >
            + Add Route
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="bg-surface-cream border-b border-border">
              <tr className="text-left text-[11px] font-semibold text-text-muted">
                <th className="px-2 py-1.5">Name</th>
                <th className="px-2 py-1.5">Type</th>
                <th className="px-2 py-1.5">Area</th>
                <th className="px-2 py-1.5">Schedule</th>
                <th className="px-2 py-1.5">Default</th>
                <th className="px-2 py-1.5">{zipLongLabel}s</th>
                <th className="px-2 py-1.5">Roster</th>
                <th className="px-2 py-1.5">Mapped Stops</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                // Row-level click opens the edit modal. Inline action buttons
                // (Roster, Edit, Pause, Delete) stopPropagation so they don't
                // double-fire. Text inside cells stays selectable via drag.
                const openEdit = () => setEditing(r);
                const stop = (fn: () => void) => (e: React.MouseEvent) => {
                  e.stopPropagation();
                  fn();
                };
                const scheduleTitle = r.schedules
                  .map((s) => `${s.name} ${s.window}${s.days.length > 0
                    ? ` (${s.days.map((d) => DAYS_OF_WEEK[d - 1] ?? d).join(',')})`
                    : ''}`)
                  .join(' | ');
                return (
                  <tr
                    key={r.routeId}
                    onClick={openEdit}
                    className="border-b border-border-light last:border-b-0 hover:bg-surface-cream cursor-pointer"
                  >
                    <td className="px-2 py-1.5 font-medium text-text-primary">{r.name}</td>
                    <td className="px-2 py-1.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan whitespace-nowrap">
                        First/Final Mile
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary">{r.area || '-'}</td>
                    <td className="px-2 py-1.5">
                      {r.schedules.length > 0 ? (
                        <div className="flex flex-wrap gap-1" title={scheduleTitle}>
                          {r.schedules.map((s) => (
                            // Chip click jumps to /schedules?edit=<name>
                            // which the Schedules page consumes to auto-
                            // open the group's edit modal.
                            // stopPropagation so the row's own openEdit
                            // does not also fire.
                            <a
                              key={s.scheduleId}
                              href={`/schedules?edit=${encodeURIComponent(s.name)}`}
                              onClick={(e) => e.stopPropagation()}
                              title={`Open schedule "${s.name}" in the Schedules editor`}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-brand-cyan/15 text-brand-cyan whitespace-nowrap hover:brightness-95"
                            >
                              <span className="font-medium">{s.name}</span>
                              {s.window && <span className="text-text-muted">{s.window}</span>}
                            </a>
                          ))}
                        </div>
                      ) : <span className="text-text-muted">-</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.defaultTargetName ? (
                        <div className="text-text-primary flex items-center gap-1">
                          {r.defaultTargetName}
                          {r.defaultTargetType != null && (
                            <span className="text-[10px] text-text-muted">
                              ({TARGET_TYPES[r.defaultTargetType] ?? ''})
                            </span>
                          )}
                        </div>
                      ) : <span className="text-text-muted">-</span>}
                    </td>
                    <td className="px-2 py-1.5 text-text-secondary" title={r.zipcodes.map((z) => z.zip).join(', ')}>
                      <span className="text-text-primary font-semibold">{r.zipcodes.length}</span>
                      <span className="text-[10px] ml-1">codes</span>
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={stop(() => setRosterOpen(r))}
                        className="text-text-secondary hover:text-brand-cyan"
                        title="Manage roster"
                      >
                        <span className="text-text-primary font-semibold">{r.rosterEntryCount}</span>
                        <span className="text-[10px] ml-1">entries</span>
                      </button>
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        type="button"
                        onClick={stop(() => setDrillRoute(r))}
                        disabled={r.mappedStopsCount === 0}
                        className="text-text-secondary enabled:hover:text-brand-cyan disabled:cursor-default"
                        title={r.mappedStopsCount === 0 ? 'No mapped stops on this route yet' : 'View mapped stops'}
                      >
                        <span className="text-text-primary font-semibold">{r.mappedStopsCount}</span>
                        <span className="text-[10px] ml-1">stop{r.mappedStopsCount === 1 ? '' : 's'}</span>
                      </button>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                        r.active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'
                      }`}>
                        {r.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <RowActionsMenu
                        actions={[
                          { label: 'Edit', onClick: () => setEditing(r) },
                          { label: 'Copy', onClick: () => doCopy(r) },
                          { label: r.active ? 'Pause' : 'Resume', onClick: () => doToggleActive(r) },
                          { label: 'Delete', onClick: () => doDelete(r), danger: true },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-6 text-center text-xs text-text-muted italic">
                    {loading ? 'Loading...' : 'No routes yet. Click "+ Add Route" to create one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
      </div>

      {editing && (
        <RouteEditor
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}

      {rosterOpen && (
        <RosterModal
          route={rosterOpen}
          onClose={() => setRosterOpen(null)}
          onChanged={async () => { await load(); }}
        />
      )}

      {drillRoute && (
        <MappedStopsDrilldown
          source="route"
          run={{ id: drillRoute.routeId, runName: drillRoute.name, fromDepotName: drillRoute.area || '-', toDepotName: '' }}
          onClose={() => setDrillRoute(null)}
        />
      )}
    </div>
  );
}

interface EditorProps {
  initial: RecurringRoute | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function RouteEditor({ initial, onClose, onSaved }: EditorProps) {
  const toast = useToast();
  const askConfirm = useConfirm();
  const user = useAuth();
  const zipLongLabel = postcodeLabel(user.isUsTenant, false);
  const isNew = initial === null;
  const [name, setName] = useState(initial?.name ?? '');
  const [area, setArea] = useState(initial?.area ?? '');
  // Multi-select set of bound schedule ids (2026-08-03 M:N migration).
  const [scheduleIds, setScheduleIds] = useState<Set<number>>(
    new Set(initial?.schedules.map((s) => s.scheduleId) ?? []));
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [targetType, setTargetType] = useState<number | null>(initial?.defaultTargetType ?? null);
  const [targetId, setTargetId] = useState<number | null>(initial?.defaultTargetId ?? null);
  const [active, setActive] = useState(initial?.active ?? true);
  const [zips, setZips] = useState<ZipcodeLookup[]>(
    initial?.zipcodes.map((z) => ({ zipPolygonId: z.zipPolygonId, zip: z.zip, latitude: null, longitude: null })) ?? []);
  const [zipSearch, setZipSearch] = useState('');
  const [zipResults, setZipResults] = useState<ZipcodeLookup[]>([]);
  const [targets, setTargets] = useState<AssignableTargets | null>(null);
  const [schedules, setSchedules] = useState<ScheduleLookup[]>([]);
  const [saving, setSaving] = useState(false);

  // Loaded ZIP polygon shapes for the map preview. Populated on demand as
  // the operator adds zips to the route; cached by id so removing + re-adding
  // doesn't re-fetch.
  const [zipShapes, setZipShapes] = useState<Map<number, ZipPolygonShape>>(new Map());

  // Coverage (bulk) polygons attached to this route via Polygon Builder's
  // "Save coverage as Route" flow. The route DTO carries just the polygon
  // id + name + centroid, so full shapes are fetched lazily and cached.
  // Local state tracks add / remove within the editor - persisted to the
  // route on Save via UpsertRouteBody.bulkPolygonIds.
  const [bulkPolygonIds, setBulkPolygonIds] = useState<Set<number>>(
    new Set(initial?.bulkPolygons.map((p) => p.polygonId) ?? []));
  const [bulkPolygonShapes, setBulkPolygonShapes] = useState<Map<number, BulkPolygon>>(new Map());

  // Snapshot of the form's initial state, taken on mount. Compared field by
  // field on every render to compute isDirty for the "unsaved changes" close
  // guard below. Ref (not state) because we never want the snapshot itself
  // to trigger a re-render.
  const initialSnapshotRef = useRef({
    name: initial?.name ?? '',
    area: initial?.area ?? '',
    scheduleIds: [...(initial?.schedules.map((s) => s.scheduleId) ?? [])].sort((a, b) => a - b),
    targetType: initial?.defaultTargetType ?? null,
    targetId: initial?.defaultTargetId ?? null,
    active: initial?.active ?? true,
    zipIds: [...(initial?.zipcodes.map((z) => z.zipPolygonId) ?? [])].sort((a, b) => a - b),
    bulkPolygonIds: [...(initial?.bulkPolygons.map((p) => p.polygonId) ?? [])].sort((a, b) => a - b),
  });
  const isDirty = useMemo(() => {
    const snap = initialSnapshotRef.current;
    const currentScheduleIds = [...scheduleIds].sort((a, b) => a - b);
    const currentZipIds = [...zips.map((z) => z.zipPolygonId)].sort((a, b) => a - b);
    const currentBulkPolygonIds = [...bulkPolygonIds].sort((a, b) => a - b);
    const arraysEqual = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    return (
      name.trim() !== snap.name ||
      area.trim() !== snap.area ||
      !arraysEqual(currentScheduleIds, snap.scheduleIds) ||
      targetType !== snap.targetType ||
      (targetType ? targetId : null) !== snap.targetId ||
      active !== snap.active ||
      !arraysEqual(currentZipIds, snap.zipIds) ||
      !arraysEqual(currentBulkPolygonIds, snap.bulkPolygonIds)
    );
  }, [name, area, scheduleIds, targetType, targetId, active, zips, bulkPolygonIds]);

  // Confirmation dialog when the operator tries to close with unsaved changes.
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const handleCloseAttempt = () => {
    if (isDirty) setShowCloseConfirm(true);
    else onClose();
  };

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

  const addZip = (z: ZipcodeLookup) => {
    if (zips.some((x) => x.zipPolygonId === z.zipPolygonId)) return;
    setZips([...zips, z]);
    setZipSearch('');
    setZipResults([]);
  };
  const removeZip = (id: number) => setZips(zips.filter((z) => z.zipPolygonId !== id));

  const toggleSchedule = (id: number) => {
    setScheduleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Fetch WKT shapes for any zip that appears on the route but isn't yet
  // in the shape cache. Runs whenever zips changes; small (< N * few dozen)
  // per route, so a single batch fetch is fine.
  useEffect(() => {
    const missing = zips
      .map((z) => z.zipPolygonId)
      .filter((id) => !zipShapes.has(id));
    if (missing.length === 0) return;
    void (async () => {
      try {
        const res = await recurringRouteService.getPolygonShapes(missing);
        const shapes = res.response ?? [];
        setZipShapes((prev) => {
          const next = new Map(prev);
          shapes.forEach((s) => next.set(s.zipPolygonId, s));
          return next;
        });
      } catch { /* silent; map just won't render those shapes */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zips]);

  // Fetch full shapes for bulk polygons attached to the route, on demand.
  // One GET per polygon (rare - a route usually has 1-3 attached; N+1 is
  // acceptable here since we cache). Silent on failure - the polygon
  // just won't render, sidebar list will still show the name.
  useEffect(() => {
    const missing = [...bulkPolygonIds].filter((id) => !bulkPolygonShapes.has(id));
    if (missing.length === 0) return;
    void (async () => {
      const fetched: [number, BulkPolygon][] = [];
      for (const id of missing) {
        try {
          const res = await bulkPolygonService.get(id);
          if (res.response) fetched.push([id, res.response]);
        } catch { /* silent */ }
      }
      if (fetched.length > 0) {
        setBulkPolygonShapes((prev) => {
          const next = new Map(prev);
          fetched.forEach(([id, poly]) => next.set(id, poly));
          return next;
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkPolygonIds]);

  const removeBulkPolygon = (polygonId: number) => {
    setBulkPolygonIds((prev) => {
      const next = new Set(prev);
      next.delete(polygonId);
      return next;
    });
  };

  // Pill-click focus: bumping the nonce forces the map's focus effect to
  // re-fire even when the operator clicks the same pill twice (useful
  // after they've panned away from it).
  const [focusRequest, setFocusRequest] = useState<
    { kind: 'zip' | 'bulkPolygon'; id: number; nonce: number } | null
  >(null);
  const focusNonceRef = useRef(0);
  const focusZip = (zipPolygonId: number) => {
    focusNonceRef.current += 1;
    setFocusRequest({ kind: 'zip', id: zipPolygonId, nonce: focusNonceRef.current });
  };
  const focusBulkPolygon = (polygonId: number) => {
    focusNonceRef.current += 1;
    setFocusRequest({ kind: 'bulkPolygon', id: polygonId, nonce: focusNonceRef.current });
  };

  const filteredSchedules = useMemo(() => {
    const needle = scheduleFilter.trim().toLowerCase();
    if (!needle) return schedules;
    return schedules.filter((s) => s.name.toLowerCase().includes(needle));
  }, [schedules, scheduleFilter]);

  const targetOptions = useMemo<AssignableTarget[]>(() => {
    if (!targets) return [];
    return targetType === 1 ? targets.couriers
      : targetType === 2 ? targets.agents
      : targetType === 3 ? targets.nps
      : [];
  }, [targets, targetType]);

  const commit = async () => {
    if (!name.trim()) { toast.show('Route name is required', 'error'); return; }
    if (targetType && !targetId) { toast.show('Pick a default target or clear the type', 'error'); return; }
    setSaving(true);
    try {
      const body: UpsertRouteBody = {
        name: name.trim(),
        area: area.trim(),
        defaultTargetType: targetType,
        defaultTargetId: targetType ? targetId : null,
        scheduleIds: Array.from(scheduleIds),
        active,
        zipPolygonIds: zips.map((z) => z.zipPolygonId),
        // Include the bulk polygon list on every save (empty array clears
        // the M:N binding; omitting would leave the server-side list
        // untouched, which is wrong when the operator has removed all).
        bulkPolygonIds: Array.from(bulkPolygonIds),
      };
      if (isNew) {
        await recurringRouteService.create(body);
        toast.show(`Route "${name}" created`, 'success');
      } else {
        await recurringRouteService.update(initial!.routeId, body);
        toast.show('Route updated', 'success');
      }
      await onSaved();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setSaving(false); }
  };

  const routeZipShapes = useMemo(
    () => zips.map((z) => zipShapes.get(z.zipPolygonId)).filter((s): s is ZipPolygonShape => !!s),
    [zips, zipShapes]);

  return (
    <>
    <Modal
      open={true}
      onClose={handleCloseAttempt}
      size="6xl"
      title={isNew ? 'New route' : `Edit "${initial?.name}"`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={handleCloseAttempt}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={commit} disabled={saving}>
            {saving ? 'Saving...' : (isNew ? 'Create' : 'Save')}
          </Button>
        </div>
      }
    >
      {/* 2026-08-06: warning banner when the route has BOTH zip codes
          and coverage polygons attached. Resolver treats them as OR (a
          job matches this route if EITHER the zip binding or the
          polygon PIP hits), which is fine mechanically but usually
          means the operator defined the same coverage area two ways.
          The banner offers quick-clear buttons so the operator can
          pick one mechanism in one click. Not a hard block - some
          rare cases legitimately want both (e.g. small polygon carve-
          out + big zip catch-all) - but the yellow banner surfaces
          the overlap so it's a choice, not an accident. */}
      {zips.length > 0 && bulkPolygonIds.size > 0 && (
        <div className="mb-3 p-3 rounded border border-warning/40 bg-warning/10 text-xs text-brand-dark flex items-start gap-3">
          <span aria-hidden className="text-warning text-lg leading-none mt-0.5">!</span>
          <div className="flex-1">
            <div className="font-semibold mb-0.5">Route uses both zip codes AND coverage polygons.</div>
            <div className="text-text-secondary">
              The resolver treats them as OR - a job matches if EITHER the {zips.length} zip{zips.length === 1 ? '' : 's'} covers it OR the {bulkPolygonIds.size} coverage polygon{bulkPolygonIds.size === 1 ? '' : 's'} contain{bulkPolygonIds.size === 1 ? 's' : ''} it. Usually you want just one mechanism per route.
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Button variant="neutral" size="sm"
              onClick={async () => {
                if (await askConfirm({
                  title: 'Clear zip codes',
                  message: `Clear all ${zips.length} zip code${zips.length === 1 ? '' : 's'} from this route? The coverage polygon${bulkPolygonIds.size === 1 ? '' : 's'} will stay attached.`,
                  confirmLabel: 'Clear zips',
                  danger: true,
                })) {
                  setZips([]);
                }
              }}
              title="Detach every zip code, keep coverage polygons only">
              Clear zips
            </Button>
            <Button variant="neutral" size="sm"
              onClick={async () => {
                if (await askConfirm({
                  title: 'Detach coverage polygons',
                  message: `Detach all ${bulkPolygonIds.size} coverage polygon${bulkPolygonIds.size === 1 ? '' : 's'} from this route? The zip code${zips.length === 1 ? '' : 's'} will stay attached.`,
                  confirmLabel: 'Detach coverage',
                  danger: true,
                })) {
                  setBulkPolygonIds(new Set());
                }
              }}
              title="Detach every coverage polygon, keep zip codes only">
              Clear coverage
            </Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-sm">
        <div className="space-y-3">
          <Field label="Name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              className={INPUT_CLASS} autoFocus placeholder="e.g. RNO200" />
          </Field>
          <Field label="Area / description">
            <input type="text" value={area} onChange={(e) => setArea(e.target.value)}
              className={INPUT_CLASS} placeholder="e.g. NeoGenomics medical corridor" />
          </Field>
          <Field label={`Schedules (${scheduleIds.size} selected)`}>
            <div className="border border-border rounded-lg bg-surface-white">
              <input type="text" value={scheduleFilter} onChange={(e) => setScheduleFilter(e.target.value)}
                className={INPUT_CLASS + ' text-xs border-0 border-b border-border-light rounded-b-none'}
                placeholder="Filter schedules by name..." />
              <ul className="max-h-56 overflow-auto text-xs divide-y divide-border-light">
                {filteredSchedules.length === 0 && (
                  <li className="px-2 py-3 text-center text-text-muted italic">
                    {schedules.length === 0 ? 'Loading schedules...' : 'No matches'}
                  </li>
                )}
                {filteredSchedules.map((s) => {
                  const checked = scheduleIds.has(s.id);
                  return (
                    <li key={s.id}>
                      <label className={`flex items-start gap-2 px-2 py-1 cursor-pointer hover:bg-surface-cream ${checked ? 'bg-brand-cyan/10' : ''}`}>
                        <input type="checkbox" className="mt-0.5" checked={checked}
                          onChange={() => toggleSchedule(s.id)} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{s.name}</div>
                          <div className="text-[10px] text-text-muted">
                            {s.startTime}-{s.endTime}
                            {s.days.length > 0 && ` (${s.days.map((d) => DAYS_OF_WEEK[d - 1] ?? d).join(',')})`}
                          </div>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Default target type">
              <select value={targetType ?? ''}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  setTargetType(v);
                  setTargetId(null);
                }}
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
                {targetOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={`${zipLongLabel}s (${zips.length})`}>
            <div className="border border-border rounded-lg p-2 bg-surface-white">
              {zips.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {zips.map((z) => (
                    <span key={z.zipPolygonId}
                      className="inline-flex items-center gap-0.5 rounded bg-brand-cyan/15 text-brand-dark text-xs">
                      {/* Label click = zoom map to this shape. Only the ×
                          removes. Two distinct hit targets so a mis-hit
                          on the label doesn't drop coverage. */}
                      <button type="button"
                        onClick={() => focusZip(z.zipPolygonId)}
                        className="pl-2 py-0.5 hover:underline"
                        title={`Zoom map to ${z.zip}`}>
                        {z.zip}
                      </button>
                      <button type="button"
                        onClick={() => removeZip(z.zipPolygonId)}
                        className="px-2 py-0.5 hover:text-error font-bold"
                        title={`Remove ${z.zip} from route`}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input type="text" value={zipSearch} onChange={(e) => setZipSearch(e.target.value)}
                className={INPUT_CLASS + ' text-xs'} placeholder={`Type to search ${zipLongLabel.toLowerCase()}s...`} />
              {zipResults.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-auto border border-border-light rounded bg-surface-white text-xs">
                  {zipResults.map((z) => (
                    <li key={z.zipPolygonId}>
                      <button type="button" onClick={() => addZip(z)}
                        className="w-full text-left px-2 py-1 hover:bg-surface-cream">
                        {z.zip}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
          <Field label={`Coverage polygons (${bulkPolygonIds.size})`}>
            <div className="border border-border rounded-lg p-2 bg-surface-white">
              {bulkPolygonIds.size === 0 ? (
                <div className="text-[10px] text-text-muted italic">
                  No coverage polygons attached. Attach via Polygon Builder -&gt;
                  Save coverage as Route, or via the map on the right.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {[...bulkPolygonIds].map((id) => {
                    const shape = bulkPolygonShapes.get(id);
                    // Fall back to the RouteBulkPolygonRef name from the
                    // initial payload while the full shape is still fetching.
                    const initialRef = initial?.bulkPolygons.find((p) => p.polygonId === id);
                    const label = shape?.name ?? initialRef?.name ?? `Polygon #${id}`;
                    return (
                      <span key={id}
                        className="inline-flex items-center gap-0.5 rounded bg-brand-purple/15 text-brand-dark text-xs">
                        {/* Label click = zoom map to this coverage
                            polygon. × detaches. Two distinct hit
                            targets so a mis-hit on the label doesn't
                            drop coverage. */}
                        <button type="button"
                          onClick={() => focusBulkPolygon(id)}
                          className="pl-2 py-0.5 hover:underline"
                          title={`Zoom map to "${label}"`}>
                          {label}
                        </button>
                        <button type="button"
                          onClick={() => removeBulkPolygon(id)}
                          className="px-2 py-0.5 hover:text-error font-bold"
                          title={`Detach "${label}" from route`}>×</button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </Field>
          {!isNew && initial && <RouteBookingsSection routeId={initial.routeId} count={initial.bookingCount} />}

          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        </div>

        {/* Right column: ZIP polygon map. Shows every zip currently bound
            to the route, drawn from the cached shape store. Fits bounds to
            the loaded shapes so operators see the whole coverage area at a
            glance. */}
        <div className="min-h-[400px] lg:min-h-0">
          <RouteCoverageMap
            shapes={routeZipShapes}
            boundZipIds={new Set(zips.map((z) => z.zipPolygonId))}
            onAddZip={addZip}
            onRemoveZip={removeZip}
            bulkPolygons={[...bulkPolygonIds]
              .map((id) => bulkPolygonShapes.get(id))
              .filter((p): p is BulkPolygon => !!p)}
            onRemoveBulkPolygon={removeBulkPolygon}
            focusRequest={focusRequest}
            isUsTenant={user.isUsTenant}
            googleMapsKey={user.googleMapsKey}
          />
        </div>
      </div>
    </Modal>

    {/* Unsaved-changes guard. Renders on top of the editor modal when the
        operator tries to close (backdrop click, X, Cancel) while dirty.
        Three intentional actions:
          - Save changes: run commit() (which closes on success)
          - Discard: close the editor without saving
          - Keep editing: dismiss the confirmation, editor stays open
        Uses the Modal's own backdrop click as "Keep editing" (safer default). */}
    {showCloseConfirm && (
      <Modal
        open={true}
        onClose={() => setShowCloseConfirm(false)}
        size="md"
        title="Unsaved changes"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={() => setShowCloseConfirm(false)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => { setShowCloseConfirm(false); onClose(); }}
            >
              Discard changes
            </Button>
            <Button
              variant="secondary"
              data-primary="true"
              disabled={saving}
              onClick={async () => {
                await commit();
                setShowCloseConfirm(false);
              }}
            >
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-text-primary">
          You have unsaved changes to
          {' '}<span className="font-semibold">{name.trim() || (isNew ? 'this new route' : initial?.name)}</span>.
        </p>
        <p className="text-sm text-text-secondary mt-2">
          Save your changes before closing, or discard them and lose your edits?
        </p>
      </Modal>
    )}
    </>
  );
}

// ─── Coverage Map ─────────────────────────────────────────────────────────

/** Interactive Google Maps surface for the route editor. Two responsibilities:
 *   1. Draw the route's currently-bound ZIP polygons in orange. Clicking any
 *      bound polygon removes that zip from the route (calls onRemoveZip).
 *   2. Overlay every tenant zip centroid as a MarkerClusterer pill. Clicking
 *      a pill toggles the zip's inclusion in the route (add if unbound, remove
 *      if bound). Bound pills render orange, unbound pills render blue - same
 *      colour convention as PolygonBuilder.
 *
 *  Centroids are fetched once on first mount and cached in a ref (Polygon
 *  Builder does the same; tenant catalogue is ~4.5k US / ~1k NZ, small enough
 *  to load eagerly). Bounds auto-fit only on the FIRST render that has any
 *  bound shapes - subsequent toggles don't re-centre the map. */
function RouteCoverageMap({
  shapes,
  boundZipIds,
  onAddZip,
  onRemoveZip,
  bulkPolygons,
  onRemoveBulkPolygon,
  focusRequest,
  isUsTenant,
  googleMapsKey,
}: {
  shapes: ZipPolygonShape[];
  boundZipIds: Set<number>;
  onAddZip: (z: ZipcodeLookup) => void;
  /** No longer used by the map (map is display-only 2026-08-06) but kept
   *  in the prop list so future unbound-pill-click flows can add + remove
   *  via the same callback ref pair. */
  onRemoveZip: (id: number) => void;
  bulkPolygons: BulkPolygon[];
  /** Symmetrical to onRemoveZip - kept for the same reason. */
  onRemoveBulkPolygon: (id: number) => void;
  /** Focus request from the parent's pill-click handler. Nonce bumps on
   *  every request so the effect re-fires even when the same shape is
   *  clicked twice. Kind + id identifies the target shape. */
  focusRequest: { kind: 'zip' | 'bulkPolygon'; id: number; nonce: number } | null;
  isUsTenant: boolean;
  googleMapsKey: string | null;
}) {
  const toast = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<Map<number, any>>(new Map());
  const centroidsRef = useRef<ZipcodeLookup[]>([]);
  const centroidMarkersRef = useRef<Map<number, any>>(new Map());
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const didInitialFitRef = useRef<boolean>(false);
  const [ready, setReady] = useState(false);
  const [centroidsReady, setCentroidsReady] = useState(false);

  // Unbound viewport shapes (blue boundaries auto-loaded for zips in view
  // that aren't already bound to the route). State so the render effect
  // fires on updates. Ref caches which ids are already loaded / in-flight /
  // failed so we don't re-fetch on every viewport sync.
  const [unboundShapes, setUnboundShapes] = useState<Map<number, ZipPolygonShape>>(new Map());
  const unboundOverlaysRef = useRef<Map<number, any>>(new Map());
  const inFlightUnboundRef = useRef<Set<number>>(new Set());
  const failedUnboundRef = useRef<Set<number>>(new Set());

  // Refs mirror props for use inside event listeners registered once at
  // marker creation time (closures over stale props are the usual bug).
  const boundIdsRef = useRef(boundZipIds);
  boundIdsRef.current = boundZipIds;
  const onAddRef = useRef(onAddZip);
  onAddRef.current = onAddZip;
  const onRemoveRef = useRef(onRemoveZip);
  onRemoveRef.current = onRemoveZip;
  const onRemoveBulkRef = useRef(onRemoveBulkPolygon);
  onRemoveBulkRef.current = onRemoveBulkPolygon;

  // Coverage-polygon overlay store. Renders as purple shapes (distinct
  // from orange zip polygons) so operators can see at a glance where the
  // route's shape-based coverage lives. Click a shape to detach it from
  // the route (calls onRemoveBulkPolygon via ref).
  const bulkOverlaysRef = useRef<Map<number, any>>(new Map());

  // Wait for the Google Maps JS SDK loaded by the Razor host.
  useEffect(() => {
    if (!googleMapsKey) return;
    const g = (window as any).google;
    if (g?.maps) { setReady(true); return; }
    const started = Date.now();
    const t = setInterval(() => {
      const gg = (window as any).google;
      if (gg?.maps) { setReady(true); clearInterval(t); }
      else if (Date.now() - started > 20000) clearInterval(t);
    }, 200);
    return () => clearInterval(t);
  }, [googleMapsKey]);

  // Fetch the tenant zip centroid catalogue once per mount. Fires alongside
  // the SDK wait so the two block-conditions clear in parallel.
  useEffect(() => {
    void (async () => {
      try {
        const res = await recurringRouteService.getAllZipcodeCentroids();
        centroidsRef.current = res.response ?? [];
        setCentroidsReady(true);
      } catch (e) { toast.show((e as Error).message, 'error'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Init map + clusterer once when the SDK is ready. Bounds_changed is
  // debounced to sync markers to the viewport - large tenants (~33k US
  // zips) would DoS the browser if we added every marker up-front.
  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return;
    const g = (window as any).google;
    mapRef.current = new g.maps.Map(containerRef.current, {
      center: tenantMapCentre(isUsTenant),
      zoom: 10,
      mapTypeId: g.maps.MapTypeId.ROADMAP,
      gestureHandling: 'greedy',
      clickableIcons: false,
    });
    clustererRef.current = new MarkerClusterer({
      map: mapRef.current,
      algorithm: new SuperClusterAlgorithm({ radius: 60, maxZoom: INDIVIDUAL_PILL_MIN_ZOOM - 1 }),
      renderer: buildClusterRenderer(),
    });
    // Debounced viewport sync. 300ms is snappy without churning marker
    // instances during pan (same as PolygonBuilder).
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSync = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { syncCentroidsToViewport(); }, 300);
    };
    const boundsListener = mapRef.current.addListener('bounds_changed', scheduleSync);
    // First idle guarantees getProjection() is ready before we hand
    // markers to the clusterer (otherwise MarkerClusterer's render()
    // short-circuits silently and no pills ever appear).
    g.maps.event.addListenerOnce(mapRef.current, 'idle', () => {
      syncCentroidsToViewport();
    });
    return () => {
      if (syncTimer) clearTimeout(syncTimer);
      g.maps.event.removeListener(boundsListener);
      overlaysRef.current.forEach((p) => p.setMap(null));
      overlaysRef.current.clear();
      unboundOverlaysRef.current.forEach((p) => p.setMap(null));
      unboundOverlaysRef.current.clear();
      bulkOverlaysRef.current.forEach((p) => p.setMap(null));
      bulkOverlaysRef.current.clear();
      clustererRef.current?.clearMarkers();
      (clustererRef.current as any)?.setMap(null);
      clustererRef.current = null;
      centroidMarkersRef.current.forEach((m) => m.setMap(null));
      centroidMarkersRef.current.clear();
      mapRef.current = null;
      didInitialFitRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /** Sync centroid markers to the current viewport. Creates markers for
   *  zips that entered view, removes ones that left. Caps the render at
   *  MAX_VIEWPORT_MARKERS with a uniform stride sample when over (matches
   *  PolygonBuilder's stride behaviour so we don't cluster on one corner
   *  when zoomed way out). */
  const syncCentroidsToViewport = () => {
    const g = (window as any).google;
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!map || !g?.maps || !clusterer) return;
    const bounds = map.getBounds();
    if (!bounds) return;

    const MAX_VIEWPORT_MARKERS = 2000;

    const inViewport: ZipcodeLookup[] = [];
    for (const c of centroidsRef.current) {
      if (c.latitude == null || c.longitude == null) continue;
      if (bounds.contains(new g.maps.LatLng(Number(c.latitude), Number(c.longitude)))) {
        inViewport.push(c);
      }
    }
    let sample = inViewport;
    if (inViewport.length > MAX_VIEWPORT_MARKERS) {
      const stride = Math.ceil(inViewport.length / MAX_VIEWPORT_MARKERS);
      sample = inViewport.filter((_, i) => i % stride === 0);
    }

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
      if (centroidMarkersRef.current.has(c.zipPolygonId)) continue;
      const isBound = boundIdsRef.current.has(c.zipPolygonId);
      const colour = isBound ? '#F2994A' : '#00A3FF';
      const marker = new g.maps.Marker({
        position: { lat: Number(c.latitude), lng: Number(c.longitude) },
        title: c.zip,
        icon: zipLabelIcon(c.zip, colour, isBound),
        zIndex: isBound ? 30 : 20,
      });
      marker.addListener('click', () => {
        if (boundIdsRef.current.has(c.zipPolygonId)) {
          onRemoveRef.current(c.zipPolygonId);
        } else {
          onAddRef.current(c);
        }
      });
      centroidMarkersRef.current.set(c.zipPolygonId, marker);
      toAdd.push(marker);
    }
    if (toAdd.length > 0) clusterer.addMarkers(toAdd, true);
    clusterer.render();

    // Second pass: auto-load blue boundary shapes for unbound zips in view.
    // Only fires at INDIVIDUAL_PILL_MIN_ZOOM or above (below that the map
    // shows cluster bubbles and shapes would be visual noise). Batches at
    // 50 per fetch, caps the render at 300 shapes so a wide zoom doesn't
    // drown the map.
    const currentZoom = map.getZoom() ?? 0;
    if (currentZoom < INDIVIDUAL_PILL_MIN_ZOOM) return;

    const MAX_UNBOUND_SHAPES = 300;
    const BATCH = 50;
    const wanted: number[] = [];
    for (const c of sample) {
      if (boundIdsRef.current.has(c.zipPolygonId)) continue;      // bound is drawn from `shapes` prop
      if (unboundShapes.has(c.zipPolygonId)) continue;             // already loaded
      if (inFlightUnboundRef.current.has(c.zipPolygonId)) continue; // in flight
      if (failedUnboundRef.current.has(c.zipPolygonId)) continue;  // gave up
      wanted.push(c.zipPolygonId);
      if (wanted.length > MAX_UNBOUND_SHAPES) break;
    }
    if (wanted.length === 0) return;

    const batch = wanted.slice(0, BATCH);
    batch.forEach((id) => inFlightUnboundRef.current.add(id));
    void (async () => {
      try {
        const res = await recurringRouteService.getPolygonShapes(batch);
        const fetched = res.response ?? [];
        setUnboundShapes((prev) => {
          const next = new Map(prev);
          for (const s of fetched) next.set(s.zipPolygonId, s);
          return next;
        });
      } catch {
        batch.forEach((id) => failedUnboundRef.current.add(id));
      } finally {
        batch.forEach((id) => inFlightUnboundRef.current.delete(id));
      }
    })();
  };

  // Sync bound-zip polygon overlays. Polygons are clickable = remove.
  useEffect(() => {
    const g = (window as any).google;
    const map = mapRef.current;
    if (!map || !g?.maps) return;

    const wantedIds = new Set(shapes.map((s) => s.zipPolygonId));
    overlaysRef.current.forEach((poly, id) => {
      if (!wantedIds.has(id)) { poly.setMap(null); overlaysRef.current.delete(id); }
    });

    const bounds = new g.maps.LatLngBounds();
    let count = 0;
    shapes.forEach((s) => {
      const path = parseWktPolygon(s.wkt);
      if (!path || path.length < 3) return;
      let poly = overlaysRef.current.get(s.zipPolygonId);
      if (!poly) {
        // 2026-08-06 (George): map is display-only. Overlay is not
        // clickable - removal is exclusively via the × on the sidebar
        // pill so an accidental pan-click can't silently drop coverage.
        poly = new g.maps.Polygon({
          paths: path,
          strokeColor: '#F2994A', strokeOpacity: 0.9, strokeWeight: 2,
          fillColor: '#F2994A', fillOpacity: 0.35,
          map, clickable: false,
        });
        overlaysRef.current.set(s.zipPolygonId, poly);
      } else {
        poly.setPath(path);
      }
      path.forEach((pt) => { bounds.extend(pt); count++; });
    });
    // Only fit once on the initial render that has any shapes. Subsequent
    // toggles keep the operator's current viewport steady.
    if (count > 0 && !didInitialFitRef.current) {
      map.fitBounds(bounds);
      didInitialFitRef.current = true;
    }
  }, [shapes]);

  // Sync coverage (bulk) polygon overlays. Renders each attached bulk
  // polygon as a PURPLE multi-ring shape (distinct from the orange zip
  // polygons above). Click a shape to detach it from the route. Uses
  // setPaths(rings) so multi-piece bulk polygons produced by Polygon
  // Builder's Combine flow render every piece.
  useEffect(() => {
    const g = (window as any).google;
    const map = mapRef.current;
    if (!map || !g?.maps) return;

    const wantedIds = new Set(bulkPolygons.map((p) => p.polygonId));
    bulkOverlaysRef.current.forEach((poly, id) => {
      if (!wantedIds.has(id)) { poly.setMap(null); bulkOverlaysRef.current.delete(id); }
    });

    // Local ring-grouping helper (mirrors PolygonBuilder.pointsToLatLngRings).
    // Kept inline to avoid a cross-page import; the shape is small.
    const pointsToRings = (pts: BulkPolygon['points']) => {
      const byRing = new Map<number, typeof pts>();
      for (const p of pts) {
        const ri = p.ringIndex ?? 0;
        const list = byRing.get(ri);
        if (list) list.push(p);
        else byRing.set(ri, [p]);
      }
      return [...byRing.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, list]) =>
          list.slice().sort((a, b) => a.orderIndex - b.orderIndex)
            .map((p) => ({ lat: p.lat, lng: p.lng })));
    };

    const bounds = new g.maps.LatLngBounds();
    let boundsCount = 0;
    bulkPolygons.forEach((bp) => {
      const rings = pointsToRings(bp.points);
      if (rings.length === 0 || rings[0].length < 3) return;
      let poly = bulkOverlaysRef.current.get(bp.polygonId);
      if (!poly) {
        // 2026-08-06 (George): map is display-only. Overlay is not
        // clickable - detach is exclusively via the × on the sidebar
        // pill so an accidental pan-click can't silently drop coverage.
        poly = new g.maps.Polygon({
          paths: rings,
          // 2026-08-06 (George): match Polygon Builder's coverage-polygon
          // colour (#f2994a orange, POLYGON_PALETTE[0]) so the same
          // shape reads the same across both pages. Zip polygons on
          // this map also render orange (#F2994A) - the two overlap
          // visually because they represent the same class of thing
          // (route coverage geometry); the sidebar pill colouring
          // (cyan for zips, purple for coverage) still distinguishes
          // them in the field editor.
          strokeColor: '#f2994a', strokeOpacity: 0.9, strokeWeight: 2,
          fillColor: '#f2994a', fillOpacity: 0.25,
          map, clickable: false,
        });
        bulkOverlaysRef.current.set(bp.polygonId, poly);
      } else {
        poly.setPaths(rings);
      }
      rings.forEach((ring) => ring.forEach((pt) => { bounds.extend(pt); boundsCount++; }));
    });
    // Fit to the coverage polygons on the first render that has any -
    // route-created-from-coverage-polygon flow lands here with no zip
    // shapes to fit to, so this becomes the initial focus.
    if (boundsCount > 0 && !didInitialFitRef.current) {
      map.fitBounds(bounds);
      didInitialFitRef.current = true;
    }
  }, [bulkPolygons]);

  // Focus request handler. Parent bumps focusRequest.nonce on every pill
  // click; this effect resolves the target shape (by kind + id) and
  // fitBounds the map onto it. Overlays stay rendered - only the
  // viewport moves. Effect deps include nonce so consecutive clicks on
  // the same pill still re-fit (useful after the operator pans away).
  useEffect(() => {
    if (!focusRequest) return;
    const g = (window as any).google;
    const map = mapRef.current;
    if (!map || !g?.maps) return;
    const bounds = new g.maps.LatLngBounds();
    let count = 0;
    if (focusRequest.kind === 'zip') {
      const shape = shapes.find((s) => s.zipPolygonId === focusRequest.id);
      const path = shape ? parseWktPolygon(shape.wkt) : null;
      if (path) path.forEach((pt) => { bounds.extend(pt); count++; });
    } else {
      const bp = bulkPolygons.find((p) => p.polygonId === focusRequest.id);
      if (bp) {
        // Same inline ring-grouping used by the bulk overlay sync above.
        const byRing = new Map<number, typeof bp.points>();
        for (const p of bp.points) {
          const ri = p.ringIndex ?? 0;
          const list = byRing.get(ri);
          if (list) list.push(p);
          else byRing.set(ri, [p]);
        }
        byRing.forEach((pts) => {
          pts.forEach((pt) => { bounds.extend({ lat: pt.lat, lng: pt.lng }); count++; });
        });
      }
    }
    if (count > 0) map.fitBounds(bounds);
  }, [focusRequest, shapes, bulkPolygons]);

  // Sync unbound blue-boundary overlays. Renders every fetched unbound
  // shape as a light-blue Google Maps Polygon. Removes overlays for zips
  // that just became bound (they'll re-render in orange from the effect
  // above). Click on a blue boundary adds that zip to the route.
  useEffect(() => {
    const g = (window as any).google;
    const map = mapRef.current;
    if (!map || !g?.maps) return;

    // Prune overlays that either shouldn't be shown anymore (fell out of
    // the unbound cache) or that became bound (they're now drawn orange).
    unboundOverlaysRef.current.forEach((poly, id) => {
      if (!unboundShapes.has(id) || boundZipIds.has(id)) {
        poly.setMap(null);
        unboundOverlaysRef.current.delete(id);
      }
    });

    unboundShapes.forEach((s, id) => {
      if (boundZipIds.has(id)) return; // bound - the other effect draws it
      let poly = unboundOverlaysRef.current.get(id);
      if (!poly) {
        const path = parseWktPolygon(s.wkt);
        if (!path || path.length < 3) return;
        poly = new g.maps.Polygon({
          paths: path,
          strokeColor: '#00A3FF', strokeOpacity: 0.9, strokeWeight: 1.5,
          fillColor: '#00A3FF', fillOpacity: 0.15,
          map, clickable: true,
        });
        poly.addListener('click', () => {
          // Unbound boundary click = add zip to route. Look up the
          // centroid record so the parent's addZip has the right shape.
          const lookup = centroidsRef.current.find((c) => c.zipPolygonId === id);
          if (lookup) onAddRef.current(lookup);
        });
        unboundOverlaysRef.current.set(id, poly);
      }
    });
  }, [unboundShapes, boundZipIds]);

  // When centroids arrive (or the map becomes ready), kick a viewport sync
  // so pills appear without waiting for the user to pan. Guarded by the
  // map's projection state - if not idle yet, the map-init idle listener
  // will handle it.
  useEffect(() => {
    const g = (window as any).google;
    if (!ready || !centroidsReady || !mapRef.current || !g?.maps) return;
    if (mapRef.current.getProjection()) {
      syncCentroidsToViewport();
    } else {
      g.maps.event.addListenerOnce(mapRef.current, 'idle', syncCentroidsToViewport);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, centroidsReady]);

  // Recolour centroid markers when the bound-set changes. Cheap - no marker
  // rebuild, just an icon swap per marker whose state flipped.
  useEffect(() => {
    if (centroidMarkersRef.current.size === 0) return;
    centroidMarkersRef.current.forEach((marker, id) => {
      const isBound = boundZipIds.has(id);
      const colour = isBound ? '#F2994A' : '#00A3FF';
      const zip = marker.getTitle?.() ?? '';
      marker.setIcon(zipLabelIcon(zip, colour, isBound));
      marker.setZIndex(isBound ? 30 : 20);
    });
  }, [boundZipIds]);

  if (!googleMapsKey) {
    return (
      <div className="w-full h-full min-h-[400px] rounded-lg border border-border bg-surface-cream flex items-center justify-center text-xs text-text-muted">
        Google Maps API key is not set (GoogleMapsKey env var).
      </div>
    );
  }

  return (
    <div ref={containerRef}
      className="w-full h-full min-h-[400px] rounded-lg border border-border bg-surface-cream" />
  );
}

// ─── Map helpers (mirrored from PolygonBuilder so the two surfaces render
//     centroid pills + cluster bubbles identically) ────────────────────────

/** SVG data-URI for a small rounded rectangle "pill" carrying the zip
 *  string. Bound pills are orange with a heavier outline; unbound are
 *  smaller blue rounded rects. */
function zipLabelIcon(zip: string, colour: string, bold: boolean): any {
  const w = Math.max(28, zip.length * 6 + 10);
  const h = bold ? 18 : 16;
  const border = bold ? 1.5 : 1;
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>
      <rect x='${border}' y='${border}' rx='6' ry='6'
            width='${w - border * 2}' height='${h - border * 2}'
            fill='${colour}' stroke='#1e293b' stroke-width='${border}'
            fill-opacity='${bold ? 1 : 0.85}' />
      <text x='${w / 2}' y='${h / 2 + 3.5}' text-anchor='middle'
            font-family='sans-serif' font-size='${bold ? 10 : 9}'
            fill='#ffffff' font-weight='${bold ? 700 : 600}'>${zip}</text>
    </svg>`;
  const g = (window as any).google;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: g?.maps ? new g.maps.Size(w, h) : undefined,
    anchor: g?.maps ? new g.maps.Point(w / 2, h / 2) : undefined,
  };
}

function buildClusterRenderer(): Renderer {
  return {
    render: ({ count, position }) => {
      const g = (window as any).google;
      const size = count < 10 ? 32 : count < 100 ? 40 : 48;
      const svg = `
        <svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>
          <circle cx='${size / 2}' cy='${size / 2}' r='${size / 2 - 2}'
                  fill='#00A3FF' fill-opacity='0.9' stroke='#1e293b' stroke-width='1.5' />
          <text x='${size / 2}' y='${size / 2 + 4}' text-anchor='middle'
                font-family='sans-serif' font-size='${size < 40 ? 11 : 13}'
                fill='#ffffff' font-weight='700'>${count}</text>
        </svg>`;
      return new g.maps.Marker({
        position,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
          scaledSize: new g.maps.Size(size, size),
          anchor: new g.maps.Point(size / 2, size / 2),
        },
        zIndex: 100 + count,
      });
    },
  };
}

interface RosterProps {
  route: RecurringRoute;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

function RosterModal({ route, onClose, onChanged }: RosterProps) {
  const toast = useToast();
  const askConfirm = useConfirm();
  const [entries, setEntries] = useState<RouteRosterEntry[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [targets, setTargets] = useState<AssignableTargets | null>(null);
  const [addTargetType, setAddTargetType] = useState<number>(1);
  const [addTargetId, setAddTargetId] = useState<number | null>(null);
  const [addMode, setAddMode] = useState<'dow' | 'date'>('dow');
  const [addDow, setAddDow] = useState<number>(1);
  const [addDate, setAddDate] = useState<string>('');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      const res = await recurringRouteService.getRoster(route.routeId);
      setEntries(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    void (async () => {
      try {
        const t = await recurringRouteService.getAssignableTargets();
        setTargets(t.response);
      } catch (e) { toast.show((e as Error).message, 'error'); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = useMemo<AssignableTarget[]>(() => {
    if (!targets) return [];
    return addTargetType === 1 ? targets.couriers
      : addTargetType === 2 ? targets.agents
      : targets.nps;
  }, [targets, addTargetType]);

  const doAdd = async () => {
    if (!addTargetId) { toast.show('Pick a target', 'error'); return; }
    setAdding(true);
    try {
      const body: UpsertRosterBody = {
        targetType: addTargetType,
        targetId: addTargetId,
        dayOfWeek: addMode === 'dow' ? addDow : null,
        rosterDate: addMode === 'date' ? addDate : null,
      };
      await recurringRouteService.addRoster(route.routeId, body);
      toast.show('Roster entry added', 'success');
      setAddTargetId(null);
      setAddDate('');
      await load();
      await onChanged();
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setAdding(false); }
  };

  const doRemove = async (r: RouteRosterEntry) => {
    if (!(await askConfirm({
      title: 'Deactivate roster entry',
      message: 'Deactivate this roster entry?',
      confirmLabel: 'Deactivate',
      danger: true,
    }))) return;
    try {
      await recurringRouteService.removeRoster(route.routeId, r.routeRosterId);
      toast.show('Roster entry deactivated', 'success');
      await load();
      await onChanged();
    } catch (e) { toast.show((e as Error).message, 'error'); }
  };

  const visible = showInactive ? entries : entries.filter((e) => e.isActive);

  return (
    <Modal open={true} onClose={onClose} title={`Roster - ${route.name}`}
      footer={<Button variant="neutral" onClick={onClose}>Close</Button>}>
      <div className="space-y-3 text-sm">
        <div className="border border-border rounded-lg p-2 bg-surface-cream">
          <div className="text-xs font-semibold mb-2 text-text-secondary">Add roster entry</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Target type">
              <select value={addTargetType}
                onChange={(e) => { setAddTargetType(Number(e.target.value)); setAddTargetId(null); }}
                className={INPUT_CLASS}>
                <option value="1">Courier</option>
                <option value="2">Agent</option>
                <option value="3">Network Partner</option>
              </select>
            </Field>
            <Field label="Target">
              <select value={addTargetId ?? ''}
                onChange={(e) => setAddTargetId(e.target.value ? Number(e.target.value) : null)}
                className={INPUT_CLASS}>
                <option value="">- Pick -</option>
                {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-2 inline-flex border border-border rounded-lg overflow-hidden text-xs">
            <button type="button" onClick={() => setAddMode('dow')}
              className={`px-3 py-1 ${addMode === 'dow' ? 'bg-brand-cyan text-brand-dark font-medium' : 'bg-surface-white'}`}>
              Weekly (Day of Week)
            </button>
            <button type="button" onClick={() => setAddMode('date')}
              className={`px-3 py-1 ${addMode === 'date' ? 'bg-brand-cyan text-brand-dark font-medium' : 'bg-surface-white'}`}>
              One-off date
            </button>
          </div>
          <div className="mt-2">
            {addMode === 'dow' ? (
              <select value={addDow} onChange={(e) => setAddDow(Number(e.target.value))} className={INPUT_CLASS}>
                {DAYS_OF_WEEK.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            ) : (
              <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} className={INPUT_CLASS} />
            )}
          </div>
          <div className="mt-2 flex justify-end">
            <Button variant="secondary" size="sm" onClick={doAdd}
              disabled={adding || !addTargetId || (addMode === 'date' && !addDate)}>
              {adding ? 'Adding...' : 'Add entry'}
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-text-secondary">Existing entries</span>
          <span className="text-text-muted">- {visible.length}</span>
          <div className="flex-1" />
          <label className="inline-flex items-center gap-1 text-text-muted">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
        <ul className="border border-border-light rounded divide-y divide-border-light">
          {visible.map((e) => (
            <li key={e.routeRosterId} className={`p-2 text-xs flex items-center gap-2 ${!e.isActive ? 'opacity-50' : ''}`}>
              <div className="flex-1">
                <div className="font-medium">{e.targetName || '(unknown)'}</div>
                <div className="text-text-muted text-[10px]">
                  {e.targetType != null && TARGET_TYPES[e.targetType]}
                  {' - '}
                  {e.rosterDate
                    ? new Date(e.rosterDate).toLocaleDateString('en-GB')
                    : e.dayOfWeek
                      ? DAYS_OF_WEEK[e.dayOfWeek - 1]
                      : '?'}
                </div>
              </div>
              {e.isActive && (
                <Button variant="danger" size="sm" onClick={() => doRemove(e)}>Remove</Button>
              )}
            </li>
          ))}
          {visible.length === 0 && (
            <li className="p-3 text-center text-text-muted italic text-xs">No roster entries.</li>
          )}
        </ul>
      </div>
    </Modal>
  );
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

// Collapsible read-only summary of live recurring bookings on a route. Lazy-
// loads the detail on first expand (the count is already on the route).
// Re-assignment is operator-driven in the Dispatch app / Route Viewer — this
// is view-only. Mirrors the Configurator RouteBookingsSection component.
function RouteBookingsSection({ routeId, count }: { routeId: number; count: number }) {
  const [open, setOpen] = useState(false);
  const [bookings, setBookings] = useState<RouteBooking[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && bookings === null && !loading) {
      setLoading(true); setErr(null);
      try {
        const res = await recurringRouteService.getBookings(routeId);
        setBookings(res.response ?? []);
      } catch (e: unknown) {
        setErr((e as Error).message ?? 'Failed to load bookings');
      } finally {
        setLoading(false);
      }
    }
  };

  const fmtNextDue = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

  return (
    <div className="border border-border rounded-lg">
      <button type="button" onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left">
        <span className="text-xs font-medium text-text-primary">
          Bookings on this route <span className="text-text-muted">({count})</span>
        </span>
        <span className="text-text-muted text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-border">
          {loading && <div className="text-xs text-text-muted py-3">Loading bookings...</div>}
          {err && <div className="text-xs text-error py-3">{err}</div>}
          {!loading && !err && bookings && bookings.length === 0 && (
            <div className="text-xs text-text-muted py-3">No live recurring bookings on this route.</div>
          )}
          {!loading && !err && bookings && bookings.length > 0 && (
            <table className="w-full text-xs mt-2">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-text-secondary border-b border-border">
                  <th className="py-1.5 pr-2">Client</th>
                  <th className="py-1.5 pr-2">Pickup</th>
                  <th className="py-1.5 pr-2">Days</th>
                  <th className="py-1.5">Next due</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-b-0">
                    <td className="py-1.5 pr-2 text-text-primary">{b.clientName || '-'}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{b.pickupWindow || '-'}</td>
                    <td className="py-1.5 pr-2">{b.days || '-'}</td>
                    <td className="py-1.5 tabular-nums">{fmtNextDue(b.nextDue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-text-muted mt-2">
            Read-only. Re-assign bookings to a different route from the Dispatch app's Recurring list / Route Viewer.
          </p>
        </div>
      )}
    </div>
  );
}
