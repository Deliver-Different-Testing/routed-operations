import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { postcodeLabel } from '../lib/tenantLabels';
import { tenantMapCentre } from '../lib/mapDefaults';
import { parseWktPolygon } from '../lib/wktPolygon';
import { Button } from '../components/common/Button';
import { Panel } from '../components/common/Panel';
import { Modal } from '../components/common/Modal';
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
} from '../services/recurringRouteService';
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
  const user = useAuth();
  const zipLongLabel = postcodeLabel(user.isUsTenant, false);
  const [routes, setRoutes] = useState<RecurringRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<RecurringRoute | 'new' | null>(null);
  const [rosterOpen, setRosterOpen] = useState<RecurringRoute | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await recurringRouteService.list();
      setRoutes(res.response ?? []);
    } catch (e) { toast.show((e as Error).message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const visible = useMemo(
    () => showInactive ? routes : routes.filter((r) => r.active),
    [routes, showInactive]);

  const doDelete = async (r: RecurringRoute) => {
    if (!confirm(`Deactivate route "${r.name}"? It stays in the table but stops driving downstream prebook.`)) return;
    try {
      await recurringRouteService.remove(r.routeId);
      toast.show('Route deactivated', 'success');
      await load();
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
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-white border-b border-border text-xs">
        <h1 className="text-base font-semibold text-text-primary">Recurring Routes</h1>
        <span className="text-text-muted">
          - {visible.length} route{visible.length === 1 ? '' : 's'}
        </span>
        <label className="ml-3 inline-flex items-center gap-1 text-text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
        <div className="flex-1" />
        <Button variant="neutral" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
        <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
          + Add Route
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        <Panel title="Routes">
          <table className="w-full text-xs">
            <thead className="bg-surface-cream sticky top-0">
              <tr className="text-left text-text-muted">
                <th className="px-2 py-1">Name</th>
                <th className="px-2 py-1 w-32">Type</th>
                <th className="px-2 py-1">Area</th>
                <th className="px-2 py-1 w-40">Schedule</th>
                <th className="px-2 py-1 w-48">Default</th>
                <th className="px-2 py-1 w-20 text-right">{zipLongLabel}s</th>
                <th className="px-2 py-1 w-20 text-right">Roster</th>
                <th className="px-2 py-1 w-20">Status</th>
                <th className="px-2 py-1 w-48"></th>
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
                    className="border-t border-border-light hover:bg-surface-cream cursor-pointer"
                  >
                    <td className="px-2 py-1 font-medium">{r.name}</td>
                    <td className="px-2 py-1">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] bg-brand-cyan/15 text-brand-dark whitespace-nowrap">
                        First/Final Mile
                      </span>
                    </td>
                    <td className="px-2 py-1 text-text-secondary">{r.area || '-'}</td>
                    <td className="px-2 py-1">
                      {r.schedules.length > 0 ? (
                        // Pills wrap onto new lines when the row has many
                        // schedules. Each individual pill stays on one line
                        // via whitespace-nowrap so name + window never split.
                        <div className="flex flex-wrap gap-1" title={scheduleTitle}>
                          {r.schedules.map((s) => (
                            <span
                              key={s.scheduleId}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-brand-cyan/15 text-brand-dark text-[10px] whitespace-nowrap"
                            >
                              <span className="font-medium">{s.name}</span>
                              {s.window && <span className="text-text-muted">{s.window}</span>}
                            </span>
                          ))}
                        </div>
                      ) : <span className="text-text-muted">-</span>}
                    </td>
                    <td className="px-2 py-1">
                      {r.defaultTargetName ? (
                        <div
                          className="text-text-primary truncate whitespace-nowrap"
                          title={r.defaultTargetType != null
                            ? `${r.defaultTargetName} (${TARGET_TYPES[r.defaultTargetType] ?? ''})`
                            : r.defaultTargetName}
                        >
                          {r.defaultTargetName}
                          {r.defaultTargetType != null && (
                            <span className="text-[10px] text-text-muted ml-1">
                              ({TARGET_TYPES[r.defaultTargetType] ?? ''})
                            </span>
                          )}
                        </div>
                      ) : <span className="text-text-muted">-</span>}
                    </td>
                    <td className="px-2 py-1 text-right" title={r.zipcodes.map((z) => z.zip).join(', ')}>
                      {r.zipcodes.length}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={stop(() => setRosterOpen(r))}
                        className="text-brand-purple hover:underline"
                        title="Manage roster"
                      >
                        {r.rosterEntryCount}
                      </button>
                    </td>
                    <td className="px-2 py-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        r.active ? 'bg-success-bg text-success' : 'bg-surface-light text-text-muted'
                      }`}>
                        {r.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex gap-1 justify-end">
                        <Button variant="neutral" size="sm" onClick={stop(() => setEditing(r))}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={stop(() => doToggleActive(r))}>
                          {r.active ? 'Pause' : 'Resume'}
                        </Button>
                        <Button variant="danger" size="sm" onClick={stop(() => doDelete(r))}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-2 py-6 text-center text-text-muted italic">
                    {loading ? 'Loading...' : 'No routes yet. Click "+ Add Route" to create one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
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
  });
  const isDirty = useMemo(() => {
    const snap = initialSnapshotRef.current;
    const currentScheduleIds = [...scheduleIds].sort((a, b) => a - b);
    const currentZipIds = [...zips.map((z) => z.zipPolygonId)].sort((a, b) => a - b);
    const arraysEqual = (a: number[], b: number[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    return (
      name.trim() !== snap.name ||
      area.trim() !== snap.area ||
      !arraysEqual(currentScheduleIds, snap.scheduleIds) ||
      targetType !== snap.targetType ||
      (targetType ? targetId : null) !== snap.targetId ||
      active !== snap.active ||
      !arraysEqual(currentZipIds, snap.zipIds)
    );
  }, [name, area, scheduleIds, targetType, targetId, active, zips]);

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
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-brand-cyan/15 text-brand-dark text-xs">
                      {z.zip}
                      <button type="button" onClick={() => removeZip(z.zipPolygonId)}
                        className="hover:text-error font-bold">×</button>
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
          <div className="text-xs text-text-secondary mb-1">
            Coverage map - {routeZipShapes.length} of {zips.length} {zipLongLabel.toLowerCase()}s drawn.
            <span className="text-text-muted ml-1">
              Click a pill to add / remove a {zipLongLabel.toLowerCase()}. Click a shape to remove it.
            </span>
          </div>
          <RouteCoverageMap
            shapes={routeZipShapes}
            boundZipIds={new Set(zips.map((z) => z.zipPolygonId))}
            onAddZip={addZip}
            onRemoveZip={removeZip}
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
  isUsTenant,
  googleMapsKey,
}: {
  shapes: ZipPolygonShape[];
  boundZipIds: Set<number>;
  onAddZip: (z: ZipcodeLookup) => void;
  onRemoveZip: (id: number) => void;
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
        poly = new g.maps.Polygon({
          paths: path,
          strokeColor: '#F2994A', strokeOpacity: 0.9, strokeWeight: 2,
          fillColor: '#F2994A', fillOpacity: 0.35,
          map, clickable: true,
        });
        poly.addListener('click', () => {
          // Bound polygon click = remove from route. Confirms via toast so
          // an accidental map click doesn't silently drop coverage.
          onRemoveRef.current(s.zipPolygonId);
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
    if (!confirm('Deactivate this roster entry?')) return;
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
