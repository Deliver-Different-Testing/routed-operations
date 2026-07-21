import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/common/Button';
import { Panel } from '../components/common/Panel';
import { Modal } from '../components/common/Modal';
import {
  recurringRouteService,
  type RecurringRoute,
  type UpsertRouteBody,
  type ZipcodeLookup,
  type AssignableTargets,
  type AssignableTarget,
  type ScheduleLookup,
  type RouteRosterEntry,
  type UpsertRosterBody,
} from '../services/recurringRouteService';

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
        scheduleId: r.scheduleId,
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
                <th className="px-2 py-1 w-20 text-right">Zip Codes</th>
                <th className="px-2 py-1 w-20 text-right">Roster</th>
                <th className="px-2 py-1 w-20">Status</th>
                <th className="px-2 py-1 w-48"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.routeId} className="border-t border-border-light hover:bg-surface-cream">
                  <td className="px-2 py-1 font-medium">{r.name}</td>
                  <td className="px-2 py-1">
                    <span className="inline-block px-2 py-0.5 rounded text-[10px] bg-brand-cyan/15 text-brand-dark">
                      First/Final Mile
                    </span>
                  </td>
                  <td className="px-2 py-1 text-text-secondary">{r.area || '-'}</td>
                  <td className="px-2 py-1">
                    {r.scheduleName ? (
                      <div>
                        <div className="text-text-primary">{r.scheduleName}</div>
                        {r.scheduleWindow && <div className="text-[10px] text-text-muted">{r.scheduleWindow}</div>}
                      </div>
                    ) : <span className="text-text-muted">-</span>}
                  </td>
                  <td className="px-2 py-1">
                    {r.defaultTargetName ? (
                      <div>
                        <div className="text-text-primary truncate">{r.defaultTargetName}</div>
                        {r.defaultTargetType != null && (
                          <div className="text-[10px] text-text-muted">
                            {TARGET_TYPES[r.defaultTargetType] ?? ''}
                          </div>
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
                      onClick={() => setRosterOpen(r)}
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
                      <Button variant="neutral" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => doToggleActive(r)}>
                        {r.active ? 'Pause' : 'Resume'}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => doDelete(r)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
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
  const isNew = initial === null;
  const [name, setName] = useState(initial?.name ?? '');
  const [area, setArea] = useState(initial?.area ?? '');
  const [scheduleId, setScheduleId] = useState<number | null>(initial?.scheduleId ?? null);
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
        scheduleId,
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

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={isNew ? 'New route' : `Edit "${initial?.name}"`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="neutral" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" data-primary="true" onClick={commit} disabled={saving}>
            {saving ? 'Saving...' : (isNew ? 'Create' : 'Save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <Field label="Name">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS} autoFocus placeholder="e.g. RNO200" />
        </Field>
        <Field label="Area / description">
          <input type="text" value={area} onChange={(e) => setArea(e.target.value)}
            className={INPUT_CLASS} placeholder="e.g. NeoGenomics medical corridor" />
        </Field>
        <Field label="Schedule">
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
        <Field label={`Zip codes (${zips.length})`}>
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
              className={INPUT_CLASS + ' text-xs'} placeholder="Type to search zip codes..." />
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
    </Modal>
  );
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
