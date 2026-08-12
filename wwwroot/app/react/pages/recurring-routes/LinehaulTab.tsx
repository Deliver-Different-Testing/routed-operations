import { useCallback, useEffect, useMemo, useState } from 'react';
import { RouteTypeChip } from '@/components/tenant/RouteTypeChip';
import { RowActionsMenu } from '@/components/tenant/RowActionsMenu';
import { TargetTypeChip } from '@/components/tenant/TargetTypeChip';
import { AssignTargetPicker, AssignTargetValue } from '@/components/common/AssignTargetPicker';
import { ModalCloseButton } from '@/components/common/ModalCloseButton';
import { TimeField } from '@/components/common/TimeField';
import { MappedStopsDrilldown } from './MappedStopsDrilldown';
import { AssignableTargets } from '@/services/recurringRouteService';
import { useAuth } from '@/context/AuthContext';
import { rateScheduleService, ReportingSpeed } from '@/services/rateScheduleService';
import { useSharedTargets } from './SharedTargetsContext';
import {
  linehaulService,
  extractLinehaulError,
  TenantLinehaulRun,
  TenantLinehaulRunUpsert,
  TenantLinehaulBookingLookup,
  LinehaulLookups,
  LinehaulScheduleBinding,
  LinehaulMode,
  LinehaulModeValue,
} from '@/services/linehaulService';

// Linehaul tab (Recurring Routes spec 3). Full inline CRUD over depot-to-depot
// middle-mile runs. Mirrors the Routes tab's table/lozenge/modal chrome. No
// DespatchWeb / ClientManager hops.
export function LinehaulTab() {
  const [runs, setRuns] = useState<TenantLinehaulRun[]>([]);
  const [lookups, setLookups] = useState<LinehaulLookups | null>(null);
  // Shared across tabs - avoids 3 duplicate assignable-target fetches on
  // first Route Roster / Linehaul / Linehaul Roster mount.
  const { targets } = useSharedTargets();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TenantLinehaulRun | 'new' | null>(null);
  const [drillRun, setDrillRun] = useState<TenantLinehaulRun | null>(null);
  const [schedRun, setSchedRun] = useState<TenantLinehaulRun | null>(null);
  // Match Routes tab: hide `Inactive` runs (no active schedule binding) by
  // default; operator can flip on to see everything.
  const [showInactive, setShowInactive] = useState(false);
  const visible = useMemo(
    () => (showInactive ? runs : runs.filter((r) => r.active)),
    [runs, showInactive],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r, l] = await Promise.all([
        linehaulService.list(),
        linehaulService.lookups(),
      ]);
      setRuns(r);
      setLookups(l);
    } catch (e: unknown) {
      setError(extractLinehaulError(e, 'Failed to load linehaul runs'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Optimistic in-place update: patch the row (or prepend for new / copy)
  // rather than re-fetching the whole list. Cuts perceived latency after a
  // mutation from ~1s (list + enrichment round trips) to instant.
  const applyUpdated = (updated: TenantLinehaulRun) => {
    setRuns((prev) => {
      const idx = prev.findIndex((r) => r.id === updated.id);
      if (idx === -1) return [updated, ...prev];   // new run
      const next = prev.slice();
      next[idx] = updated;
      return next;
    });
  };

  const handleCopy = async (run: TenantLinehaulRun) => {
    try {
      const copy = await linehaulService.copy(run.id);
      applyUpdated(copy);
      setEditing(copy);
    } catch (e: unknown) {
      setError(extractLinehaulError(e, 'Copy failed'));
    }
  };

  // Row-level delete. Confirms first so a mis-click on the kebab doesn't
  // wipe a run; the server-side guard blocks the delete if the run is
  // bound to an active schedule and surfaces the message as a red banner.
  const handleDelete = async (run: TenantLinehaulRun) => {
    if (!confirm(`Delete linehaul run "${run.runName}"? This cannot be undone.`)) return;
    try {
      await linehaulService.remove(run.id);
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
    } catch (e: unknown) {
      setError(extractLinehaulError(e, 'Delete failed'));
    }
  };

  if (loading) {
    return <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-text-secondary">Loading...</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-text-secondary">
          {visible.length} linehaul run{visible.length === 1 ? '' : 's'}
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
            + Add Linehaul Run
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border overflow-x-auto">
        {visible.length === 0 ? (
          <div className="p-10 text-center text-sm text-text-secondary">
            No middle-mile runs yet - click <strong>+ Add Linehaul Run</strong> to create your first.
          </div>
        ) : (
          <table className="w-full text-xs min-w-[900px]">
            <thead className="bg-surface-cream border-b border-border">
              <tr className="text-left text-[11px] font-semibold text-text-muted">
                <th className="px-2 py-1.5">Name</th>
                <th className="px-2 py-1.5">Type</th>
                <th className="px-2 py-1.5">Origin {'→'} Destination</th>
                <th className="px-2 py-1.5">Start</th>
                <th className="px-2 py-1.5">Despatch</th>
                <th className="px-2 py-1.5">Default</th>
                <th className="px-2 py-1.5">Used by Schedules</th>
                <th className="px-2 py-1.5">Mapped Stops</th>
                <th className="px-2 py-1.5">Status</th>
                <th className="px-2 py-1.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setEditing(r)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(r); } }}
                  role="button"
                  tabIndex={0}
                  className="border-b border-border-light last:border-b-0 cursor-pointer hover:bg-surface-cream focus:bg-surface-cream focus:outline-none"
                >
                  <td className="px-2 py-1.5 font-medium text-text-primary">{r.runName}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <RouteTypeChip kind="middle" />
                      {r.mode === LinehaulMode.Flight && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-cyan/10 text-brand-cyan text-[10px] font-medium px-1.5 py-0.5" title="Flight-mode run">
                          <span aria-hidden>{'✈'}</span>Flight
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-text-primary">
                    {r.fromDepotName || '-'} <span className="text-text-muted">{'→'}</span> {r.toDepotName || '-'}
                  </td>
                  <td className="px-2 py-1.5 text-text-secondary">{r.startTime || '-'}</td>
                  <td className="px-2 py-1.5 text-text-secondary">{r.despatchTime || '-'}</td>
                  <td className="px-2 py-1.5">
                    {r.defaultTargetName ? (
                      <div>
                        <div className="text-text-primary flex items-center gap-1">
                          {r.defaultTargetName}
                          {r.defaultTargetType && <TargetTypeChip type={r.defaultTargetType} />}
                        </div>
                        {r.defaultTargetHint && <div className="text-[10px] text-text-muted">{r.defaultTargetHint}</div>}
                      </div>
                    ) : <span className="text-text-muted">- Unbound -</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); setSchedRun(r); }}
                      disabled={r.usedBySchedulesCount === 0}
                      className="text-text-secondary enabled:hover:text-brand-cyan disabled:cursor-default"
                      title={r.usedBySchedulesCount === 0 ? 'Not bound to any schedule' : 'View schedules using this run'}
                    >
                      <span className="text-text-primary font-semibold">{r.usedBySchedulesCount}</span>
                      <span className="text-[10px] ml-1">schedule{r.usedBySchedulesCount === 1 ? '' : 's'}</span>
                    </button>
                  </td>
                  <td className="px-2 py-1.5">
                    <button onClick={(e) => { e.stopPropagation(); setDrillRun(r); }} className="text-text-secondary hover:text-brand-cyan" title="View mapped stops">
                      <span className="text-text-primary font-semibold">{r.mappedStopsCount}</span>
                      <span className="text-[10px] ml-1">stop{r.mappedStopsCount === 1 ? '' : 's'}</span>
                    </button>
                  </td>
                  <td className="px-2 py-1.5">
                    {r.active
                      ? <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800">Active</span>
                      : <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-200 text-slate-700">Inactive</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <RowActionsMenu
                      actions={[
                        { label: 'Edit', onClick: () => setEditing(r) },
                        { label: 'Copy', onClick: () => handleCopy(r) },
                        { label: 'Delete', onClick: () => handleDelete(r), danger: true },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && lookups && (
        <LinehaulEditModal
          run={editing === 'new' ? null : editing}
          lookups={lookups}
          targets={targets}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            if ('deletedId' in saved) {
              setRuns((prev) => prev.filter((r) => r.id !== saved.deletedId));
            } else {
              applyUpdated(saved);
            }
          }}
        />
      )}

      {drillRun && (
        <MappedStopsDrilldown
          run={{ id: drillRun.id, runName: drillRun.runName, fromDepotName: drillRun.fromDepotName, toDepotName: drillRun.toDepotName }}
          onClose={() => setDrillRun(null)}
        />
      )}

      {schedRun && (
        <LinehaulSchedulesDrilldown run={schedRun} onClose={() => setSchedRun(null)} />
      )}
    </div>
  );
}

// "Used by Schedules" drill-down (Fix 7). Reusable list rendered both in the
// cell-click side panel and inside the run's edit modal.
function LinehaulSchedulesList({ runId }: { runId: number }) {
  const user = useAuth();
  const [rows, setRows] = useState<LinehaulScheduleBinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scheduleEditorUrl = user.despatchWebBaseUrl ? `${user.despatchWebBaseUrl}/#!/recurringJobs` : null;

  useEffect(() => {
    let alive = true;
    linehaulService.schedulesForRun(runId)
      .then((r) => { if (alive) setRows(r); })
      .catch((e: unknown) => { if (alive) setError(extractLinehaulError(e, 'Failed to load schedules')); });
    return () => { alive = false; };
  }, [runId]);

  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (rows === null) return <div className="py-6 text-center text-sm text-text-secondary">Loading...</div>;
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-text-secondary">Not bound to any schedule.</div>;

  return (
    <ul className="divide-y divide-border">
      {rows.map((s, i) => (
        <li key={`${s.scheduleId ?? 'x'}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm text-[#0d0c2c] truncate">{s.name}</div>
            {s.weekDay && <div className="text-[11px] text-text-secondary">{s.weekDay}</div>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${s.active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'}`}>
              {s.active ? 'Active' : 'Inactive'}
            </span>
            {scheduleEditorUrl && (
              <a href={scheduleEditorUrl} target="_blank" rel="noopener noreferrer"
                className="text-[12px] text-brand-cyan hover:underline whitespace-nowrap" title="Open in DespatchWeb">
                Open {'↗'}
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function LinehaulSchedulesDrilldown({ run, onClose }: { run: TenantLinehaulRun; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full shadow-xl flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#0d0c2c]">Schedules using this run</h2>
            <p className="text-[12px] text-text-secondary mt-0.5">{run.runName}</p>
          </div>
          <ModalCloseButton onClose={onClose} />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-3">
          <LinehaulSchedulesList runId={run.id} />
        </div>
      </div>
    </div>
  );
}

// Edit / create modal.
function LinehaulEditModal({
  run,
  lookups,
  targets,
  onClose,
  onSaved,
}: {
  run: TenantLinehaulRun | null;
  lookups: LinehaulLookups;
  targets: AssignableTargets | null;
  onClose: () => void;
  onSaved: (saved: TenantLinehaulRun | { deletedId: number }) => void;
}) {
  const [runName, setRunName] = useState(run?.runName ?? '');
  const [fromDepotId, setFromDepotId] = useState<number>(run?.fromDepotId ?? 0);
  const [toDepotId, setToDepotId] = useState<number>(run?.toDepotId ?? 0);
  const [startTime, setStartTime] = useState(run?.startTime ?? '');
  const [despatchTime, setDespatchTime] = useState(run?.despatchTime ?? '');
  const [target, setTarget] = useState<AssignTargetValue | null>(
    run?.defaultTargetType && run?.defaultTargetId
      ? { type: run.defaultTargetType, id: run.defaultTargetId }
      : null,
  );
  const [mode, setMode] = useState<LinehaulModeValue>(run?.mode ?? LinehaulMode.Road);
  const [speedId, setSpeedId] = useState<number>(run?.speedId ?? 0);
  const [speeds, setSpeeds] = useState<ReportingSpeed[]>([]);
  const [masterBookingId, setMasterBookingId] = useState<number | null>(run?.masterBookingId ?? null);
  const [masterLabel, setMasterLabel] = useState<string | null>(run?.masterBookingLabel ?? null);
  const [bookingQuery, setBookingQuery] = useState('');
  const [bookingResults, setBookingResults] = useState<TenantLinehaulBookingLookup[]>([]);
  const [searchingBookings, setSearchingBookings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    rateScheduleService.getSpeeds().then((s) => { if (alive) setSpeeds(s.data); }).catch(() => { /* non-fatal */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const term = bookingQuery.trim();
    if (term.length < 2) { setBookingResults([]); setSearchingBookings(false); return; }
    let alive = true;
    setSearchingBookings(true);
    const t = setTimeout(() => {
      linehaulService.searchLinkableBookings(run?.id ?? 0, term)
        .then((r) => { if (alive) setBookingResults(r); })
        .catch(() => { if (alive) setBookingResults([]); })
        .finally(() => { if (alive) setSearchingBookings(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [bookingQuery, run?.id]);

  const isFlight = mode === LinehaulMode.Flight;
  const flightSpeeds = useMemo(
    () => speeds.filter((s) => (s.groupingName ?? '').toLowerCase().includes('flight')),
    [speeds],
  );

  useEffect(() => {
    if (!isFlight || flightSpeeds.length === 0) return;
    if (!flightSpeeds.some((s) => s.id === speedId)) {
      setSpeedId(flightSpeeds.length === 1 ? flightSpeeds[0].id : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlight, speeds]);

  const groupedSpeeds = useMemo(() => {
    const src = isFlight ? flightSpeeds : speeds;
    const m = new Map<string, ReportingSpeed[]>();
    for (const s of src) {
      const key = s.groupingName ?? 'Other';
      (m.get(key) ?? m.set(key, []).get(key)!).push(s);
    }
    return [...m.entries()];
  }, [speeds, flightSpeeds, isFlight]);

  const selectedSpeedIsFlight = speedId > 0 && flightSpeeds.some((s) => s.id === speedId);
  const noFlightSpeeds = isFlight && speeds.length > 0 && flightSpeeds.length === 0;
  const flightSpeedMissing = isFlight && !selectedSpeedIsFlight;

  const sameDepot = fromDepotId > 0 && fromDepotId === toDepotId;
  const despatchBeforeStart = !!startTime && !!despatchTime && despatchTime < startTime;
  const valid = runName.trim().length > 0 && fromDepotId > 0 && toDepotId > 0
    && !sameDepot && !despatchBeforeStart && !flightSpeedMissing;

  const blockingReason =
    runName.trim().length === 0 ? 'Enter a run name.'
    : fromDepotId <= 0 || toDepotId <= 0 ? 'Choose both depots.'
    : sameDepot ? 'From and To depots must be different.'
    : despatchBeforeStart ? 'Despatch time must be at or after the start time.'
    : noFlightSpeeds ? 'No Flight service level exists for this tenant - switch to Road or add one.'
    : flightSpeedMissing ? 'Choose a Flight service level.'
    : null;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    setErr(null);
    try {
      const payload: TenantLinehaulRunUpsert = {
        runName: runName.trim(),
        fromDepotId,
        toDepotId,
        startTime: startTime || null,
        despatchTime: despatchTime || null,
        defaultTargetType: target?.type ?? null,
        defaultTargetId: target?.id ?? null,
        speedId: speedId > 0 ? speedId : null,
        mode,
        masterBookingId,
      };
      const saved = run
        ? await linehaulService.update(run.id, payload)
        : await linehaulService.create(payload);
      onSaved(saved);
    } catch (e: unknown) {
      setErr(extractLinehaulError(e, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!run) return;
    if (run.usedBySchedulesCount > 0) {
      setErr(`Remove this run from ${run.usedBySchedulesCount} schedule(s) before deleting.`);
      return;
    }
    if (!confirm(`Delete linehaul run "${run.runName}"? This cannot be undone.`)) return;
    setSaving(true);
    setErr(null);
    try {
      await linehaulService.remove(run.id);
      onSaved({ deletedId: run.id });
    } catch (e: unknown) {
      setErr(extractLinehaulError(e, 'Delete failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#0d0c2c]">{run ? 'Edit Linehaul Run' : 'New Linehaul Run'}</h2>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

          <div>
            <label className="block text-[12.5px] font-medium text-text-secondary mb-1">Run name *</label>
            <input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="e.g. Auckland to Hamilton AM" maxLength={50}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-cyan focus:outline-none" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12.5px] font-medium text-text-secondary mb-1">From depot *</label>
              <select value={fromDepotId} onChange={(e) => setFromDepotId(Number(e.target.value))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-brand-cyan focus:outline-none">
                <option value={0}>- Select -</option>
                {lookups.depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-text-secondary mb-1">To depot *</label>
              <select value={toDepotId} onChange={(e) => setToDepotId(Number(e.target.value))}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-brand-cyan focus:outline-none">
                <option value={0}>- Select -</option>
                {lookups.depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          {sameDepot && <p className="text-[11px] text-amber-600">From and To depots must be different.</p>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[12.5px] font-medium text-text-secondary mb-1">Start time</label>
              <TimeField value={startTime} onChange={setStartTime} ariaLabel="Start time" />
            </div>
            <div>
              <label className="block text-[12.5px] font-medium text-text-secondary mb-1">Despatch time</label>
              <TimeField value={despatchTime} onChange={setDespatchTime} ariaLabel="Despatch time" />
            </div>
          </div>
          {despatchBeforeStart && <p className="text-[11px] text-amber-600">Despatch time must be at or after the start time.</p>}

          <div>
            <label className="block text-[12.5px] font-medium text-text-secondary mb-1">Mode</label>
            <div className="inline-flex rounded-lg border border-border p-0.5 bg-slate-50" role="group" aria-label="Linehaul mode">
              {([
                { value: LinehaulMode.Road, label: 'Road', icon: '\u{1F69A}' },
                { value: LinehaulMode.Flight, label: 'Flight', icon: '✈' },
              ] as const).map((opt) => (
                <button key={opt.value} type="button" onClick={() => setMode(opt.value)}
                  aria-pressed={mode === opt.value}
                  className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                    mode === opt.value
                      ? 'bg-white shadow-sm font-medium text-[#0d0c2c]'
                      : 'text-text-secondary hover:text-[#0d0c2c]'
                  }`}>
                  <span className="mr-1" aria-hidden>{opt.icon}</span>{opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-text-secondary mt-1">
              {isFlight
                ? "Flight - this run's master linehaul job books through the existing domestic/nationwide flight flow. Choose a Flight service level below; no other flight details are entered here."
                : 'Road - books as a normal linehaul run.'}
            </p>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-text-secondary mb-1">Default assigned to</label>
            <AssignTargetPicker targets={targets} value={target} onChange={setTarget} />
            <p className="text-[11px] text-text-secondary mt-1">The run's default Courier, Agent, or Network Partner. Day-by-day overrides live on the Linehaul Roster.</p>
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-text-secondary mb-1">
              {isFlight ? 'Flight service level' : 'Speed (service level)'}
              {isFlight && <span className="text-red-600"> *</span>}
            </label>
            <select value={speedId} onChange={(e) => setSpeedId(Number(e.target.value))}
              disabled={noFlightSpeeds}
              className={`w-full border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:outline-none disabled:bg-slate-50 disabled:text-text-secondary ${
                flightSpeedMissing ? 'border-red-400 focus:ring-red-400' : 'border-border focus:ring-brand-cyan'
              }`}>
              <option value={0} disabled={isFlight}>
                {isFlight ? '- Select a Flight speed -' : '- Use schedule default -'}
              </option>
              {groupedSpeeds.map(([groupName, items]) => (
                <optgroup key={groupName} label={groupName}>
                  {items.map((s) => <option key={s.id} value={s.id}>{s.shortName} - {s.name}</option>)}
                </optgroup>
              ))}
            </select>
            {noFlightSpeeds ? (
              <p className="text-[11px] text-red-600 mt-1">No Flight service levels are configured for this tenant, so this run can't be saved as Flight. Switch to Road or add a Flight-grouped speed.</p>
            ) : isFlight ? (
              <p className="text-[11px] text-text-secondary mt-1">A Flight run must ride a Flight service level - this is what routes its master job through the domestic/nationwide flight flow. Only Flight-grouped speeds are shown.</p>
            ) : (
              <p className="text-[11px] text-text-secondary mt-1">Default service class for legs riding this run - individual schedules can override it per leg. Leave on default to inherit from the schedule.</p>
            )}
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-text-secondary mb-1">Master job</label>
            {masterBookingId ? (
              <div className="flex items-center justify-between gap-2 border border-border rounded-lg px-3 py-2 text-sm">
                <span className="truncate font-medium text-[#0d0c2c]">{masterLabel ?? `Booking #${masterBookingId}`}</span>
                <button type="button" onClick={() => { setMasterBookingId(null); setMasterLabel(null); }}
                  className="text-[12px] text-red-600 hover:underline shrink-0">Clear</button>
              </div>
            ) : (
              <>
                <input value={bookingQuery} onChange={(e) => setBookingQuery(e.target.value)}
                  placeholder="Search by job number, name, client, or address..."
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-cyan focus:outline-none" />
                {bookingQuery.trim().length >= 2 && (
                  <div className="mt-1 border border-border rounded-lg divide-y divide-border max-h-48 overflow-y-auto">
                    {searchingBookings && <div className="px-3 py-2 text-[12px] text-text-secondary">Searching...</div>}
                    {!searchingBookings && bookingResults.length === 0 && <div className="px-3 py-2 text-[12px] text-text-secondary">No matching bookings.</div>}
                    {!searchingBookings && bookingResults.map((b) => {
                      const linkedElsewhere = b.linkedRunId != null && !b.linkedToThisRun;
                      return (
                        <button key={b.bookingId} type="button"
                          onClick={() => {
                            if (linkedElsewhere && !confirm(`Booking ${b.jobNumber} is already the master of another run. Move it to this run?`)) return;
                            setMasterBookingId(b.bookingId);
                            setMasterLabel(b.jobName ? `${b.jobNumber} - ${b.jobName}` : b.clientName ? `${b.jobNumber} - ${b.clientName}` : b.jobNumber);
                            setBookingQuery('');
                            setBookingResults([]);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2">
                          <span className="truncate">
                            <span className="font-medium text-[#0d0c2c]">{b.jobNumber}</span>
                            {(b.jobName || b.clientName) && <span className="text-text-secondary"> - {b.jobName ?? b.clientName}</span>}
                          </span>
                          {linkedElsewhere && <span className="text-[10.5px] text-amber-600 shrink-0 rounded-full bg-amber-50 px-2 py-0.5">linked elsewhere</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
            <p className="text-[11px] text-text-secondary mt-1">The booking that represents this run's master job. Search by job number (most reliable), name, client, or address.</p>
          </div>

          {run && (
            <div>
              <label className="block text-[12.5px] font-medium text-text-secondary mb-1">Used by schedules</label>
              <div className="border border-border rounded-lg px-3">
                <LinehaulSchedulesList runId={run.id} />
              </div>
              <p className="text-[11px] text-text-secondary mt-1">Bindings are managed in the Schedule editor (DespatchWeb).</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-slate-50 flex items-center justify-between gap-2">
          <div>
            {run && (
              <button onClick={remove} disabled={saving || run.usedBySchedulesCount > 0}
                title={run.usedBySchedulesCount > 0 ? 'Remove this run from its schedule(s) before deleting' : undefined}
                className="px-5 py-2 text-[13px] text-red-600 hover:bg-red-50 rounded-full font-medium disabled:text-slate-400 disabled:cursor-not-allowed disabled:hover:bg-transparent">
                Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!valid && blockingReason && (
              <span className="text-[11px] text-amber-600 max-w-[220px] text-right">{blockingReason}</span>
            )}
            <button onClick={onClose} className="px-5 py-2 text-[13px] text-text-secondary hover:text-[#0d0c2c] hover:bg-white rounded-full font-medium">Cancel</button>
            <button onClick={save} disabled={!valid || saving}
              className="bg-brand-cyan text-[#0d0c2c] font-medium text-[13px] px-5 py-2 rounded-full disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed hover:shadow-cyan-glow transition-shadow">
              {saving ? 'Saving...' : run ? 'Save Changes' : 'Create Run'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
