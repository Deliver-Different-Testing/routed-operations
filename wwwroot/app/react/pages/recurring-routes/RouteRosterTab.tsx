import { useCallback, useEffect, useMemo, useState } from 'react';
import { RosterPickerModal } from '@/components/tenant/RosterPickerModal';
import { TargetTypeChip } from '@/components/tenant/TargetTypeChip';
import { AssignTargetPicker, AssignTargetValue } from '@/components/common/AssignTargetPicker';
import {
  recurringRouteService,
  type AssignableTargets,
  type AssignTargetType,
  type RecurringRoute,
  type RouteRosterEntry,
} from '@/services/recurringRouteService';
import { useSharedTargets } from './SharedTargetsContext';

// Route Roster tab (Recurring Routes spec 4). Per-route weekly DOW pattern +
// date overrides + 14-day preview. Ported from Configurator's inline RosterTab.
// Backs the existing /api/recurring-routes/{routeId}/roster endpoint.

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function typeName(t: number | null): AssignTargetType | null {
  return t === 1 ? 'Courier' : t === 2 ? 'Agent' : t === 3 ? 'NetworkPartner' : null;
}
function typeCode(t: AssignTargetType): number {
  return t === 'Courier' ? 1 : t === 'Agent' ? 2 : 3;
}

export function RouteRosterTab() {
  const [routes, setRoutes] = useState<RecurringRoute[]>([]);
  // Shared with the other tabs - one fetch per page load.
  const { targets } = useSharedTargets();
  const [bootLoading, setBootLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await recurringRouteService.list();
        if (!alive) return;
        setRoutes(r.response ?? []);
      } finally {
        if (alive) setBootLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const activeRoutes = useMemo(() => routes.filter((r) => r.active), [routes]);
  const [selectedRouteId, setSelectedRouteId] = useState<number | null>(activeRoutes[0]?.routeId ?? null);
  const [entries, setEntries] = useState<RouteRosterEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (selectedRouteId == null && activeRoutes.length) setSelectedRouteId(activeRoutes[0].routeId);
  }, [activeRoutes, selectedRouteId]);

  const refresh = useCallback(async () => {
    if (selectedRouteId == null) { setEntries([]); return; }
    setLoading(true); setErr(null);
    try {
      const res = await recurringRouteService.getRoster(selectedRouteId);
      setEntries(res.response ?? []);
    } catch (e: unknown) {
      setErr((e as Error).message ?? 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  }, [selectedRouteId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (bootLoading) {
    return <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-text-secondary">Loading routes...</div>;
  }

  if (activeRoutes.length === 0) {
    return <div className="rounded-xl border border-border bg-white p-10 text-center text-sm text-text-secondary">No active routes. Activate one on the Routes tab first.</div>;
  }

  const route = activeRoutes.find((r) => r.routeId === selectedRouteId) ?? activeRoutes[0];

  const weekly = entries.filter((e) => e.rosterDate === null);
  const overrides = entries.filter((e) => e.rosterDate !== null).sort((a, b) => (a.rosterDate ?? '').localeCompare(b.rosterDate ?? ''));
  const dowEntry: Record<number, RouteRosterEntry> = {};
  weekly.forEach((e) => { if (e.dayOfWeek != null) dowEntry[e.dayOfWeek] = e; });

  const setDow = async (dow: number, value: AssignTargetValue | null) => {
    const existing = weekly.find((e) => e.dayOfWeek === dow);
    if (value === null) {
      if (existing) await recurringRouteService.removeRoster(route.routeId, existing.routeRosterId);
    } else {
      await recurringRouteService.addRoster(route.routeId, {
        targetType: typeCode(value.type),
        targetId: value.id,
        rosterDate: null,
        dayOfWeek: dow,
      });
    }
    refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-text-secondary">Route:</span>
        <select value={selectedRouteId ?? ''} onChange={(e) => setSelectedRouteId(parseInt(e.target.value, 10))}
          className="border border-border rounded px-2 py-1 text-xs focus:ring-2 focus:ring-brand-cyan focus:outline-none min-w-[240px]">
          {activeRoutes.map((r) => <option key={r.routeId} value={r.routeId}>{r.name}</option>)}
        </select>
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {loading && <div className="text-sm text-text-secondary">Loading roster...</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          <Card title="Default Weekly Pattern" subtitle="Courier / Agent / NP rostered on each day of week. Leave blank to fall back to the route's default.">
            <div className="space-y-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
                <WeeklyDayRow
                  key={dow}
                  dow={dow}
                  entry={dowEntry[dow] ?? null}
                  route={route}
                  targets={targets}
                  onSet={(v) => setDow(dow, v)}
                />
              ))}
            </div>
          </Card>

          <DateOverrides
            route={route}
            overrides={overrides}
            targets={targets}
            onChanged={refresh}
          />
        </div>

        <div>
          <Card title="14-Day Preview" subtitle="Who's rostered for this route over the next 14 days. Date overrides > weekly pattern > default.">
            <FourteenDayPreview route={route} entries={entries} />
          </Card>
          <div className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-[12.5px] text-[#0d0c2c]">
            <div className="font-semibold mb-1">How this is used downstream</div>
            The same precedence logic (date override, then DOW pattern, then default) runs in <code className="bg-white px-1.5 py-0.5 rounded text-[11.5px] font-mono">uspPrebookSet</code> each night.
            For <strong>Courier</strong> assignments the picked courier is written to <code className="bg-white px-1.5 py-0.5 rounded text-[11.5px] font-mono">tucJob.ucjbCourierID</code> for every materialised recurring job, and RunViewer displays each day's run with that courier.
            <div className="mt-2 text-[12px]">
              <strong>Agent / NP</strong> assignments are recorded here for configuration, but are <strong>not yet materialised into jobs</strong> - prebook still resolves a courier only. Use a Courier target for any day that must dispatch today.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeeklyDayRow({
  dow,
  entry,
  route,
  targets,
  onSet,
}: {
  dow: number;
  entry: RouteRosterEntry | null;
  route: RecurringRoute;
  targets: AssignableTargets | null;
  onSet: (v: AssignTargetValue | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const currentType = typeName(entry?.targetType ?? null);
  const current: AssignTargetValue | null =
    currentType && entry?.targetId ? { type: currentType, id: entry.targetId } : null;

  return (
    <div className="flex items-center gap-3">
      <div className="w-10 text-[12.5px] font-medium text-[#0d0c2c]">{DOW_LABELS[dow]}</div>
      <div className="flex-1 flex items-center justify-between border border-border rounded-lg px-3 py-2">
        {entry?.targetName ? (
          <span className="text-sm text-[#0d0c2c] flex items-center gap-1.5">
            {entry.targetName}
            {typeName(entry.targetType) && <TargetTypeChip type={typeName(entry.targetType)!} />}
          </span>
        ) : (
          <span className="text-sm text-text-secondary">- Use default ({route.defaultTargetName || '-'}) -</span>
        )}
        <button onClick={() => setEditing(true)} className="text-[12px] text-text-secondary hover:text-brand-cyan font-medium">Edit</button>
      </div>
      {editing && (
        <RosterPickerModal
          title={`${DOW_LABELS[dow]} assignment`}
          targets={targets}
          value={current}
          onClose={() => setEditing(false)}
          onSave={(v) => { setEditing(false); onSet(v); }}
        />
      )}
    </div>
  );
}

function DateOverrides({
  route,
  overrides,
  targets,
  onChanged,
}: {
  route: RecurringRoute;
  overrides: RouteRosterEntry[];
  targets: AssignableTargets | null;
  onChanged: () => void;
}) {
  const [date, setDate] = useState('');
  const [target, setTarget] = useState<AssignTargetValue | null>(null);

  const add = async () => {
    if (!date || !target) return;
    await recurringRouteService.addRoster(route.routeId, {
      targetType: typeCode(target.type),
      targetId: target.id,
      rosterDate: date,
      dayOfWeek: null,
    });
    setDate('');
    setTarget(null);
    onChanged();
  };
  const remove = async (id: number) => {
    await recurringRouteService.removeRoster(route.routeId, id);
    onChanged();
  };

  return (
    <Card title="Date Overrides" subtitle="Specific-date assignments. Wins over the weekly pattern when both exist for the same date.">
      <div className="space-y-2 mb-4">
        {overrides.length === 0
          ? <div className="text-[12px] text-text-secondary py-2">No date overrides yet.</div>
          : overrides.map((o) => {
              const d = o.rosterDate ? new Date(o.rosterDate) : null;
              return (
                <div key={o.routeRosterId} className="flex items-center justify-between bg-orange-50 border border-orange-200 px-3 py-2 rounded-lg">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-medium text-[#0d0c2c]">
                      {d ? d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }) : '-'}
                    </span>
                    <span className="text-[13px] text-[#0d0c2c] ml-2">{'→'} {o.targetName || '-'}</span>
                    {typeName(o.targetType) && <TargetTypeChip type={typeName(o.targetType)!} />}
                  </div>
                  <button onClick={() => remove(o.routeRosterId)} className="text-text-secondary hover:text-red-600 text-[12px] font-medium">Remove</button>
                </div>
              );
            })}
      </div>
      <div className="pt-3 border-t border-border space-y-2">
        <div className="flex gap-2">
          <div className="w-44">
            <label className="block text-[12px] font-medium text-text-secondary mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-cyan focus:outline-none" />
          </div>
          <div className="flex-1">
            <label className="block text-[12px] font-medium text-text-secondary mb-1">Assignment</label>
            <AssignTargetPicker targets={targets} value={target} onChange={setTarget} />
          </div>
        </div>
        <div className="flex justify-end">
          <button onClick={add} disabled={!date || !target}
            className="bg-brand-cyan text-[#0d0c2c] font-medium text-[13px] px-4 py-2 rounded-full disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed hover:shadow-cyan-glow transition-shadow">
            Add Override
          </button>
        </div>
      </div>
    </Card>
  );
}

function FourteenDayPreview({
  route,
  entries,
}: {
  route: RecurringRoute;
  entries: RouteRosterEntry[];
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    const dateOverride = entries.find((e) => e.rosterDate?.slice(0, 10) === iso);
    const dowPattern = entries.find((e) => e.rosterDate === null && e.dayOfWeek === dow);
    let name = route.defaultTargetName || 'Unassigned';
    let type: AssignTargetType | null = typeName(route.defaultTargetType);
    let source: 'override' | 'pattern' | 'default' = 'default';
    if (dateOverride) { name = dateOverride.targetName || name; type = typeName(dateOverride.targetType); source = 'override'; }
    else if (dowPattern) { name = dowPattern.targetName || name; type = typeName(dowPattern.targetType); source = 'pattern'; }
    return { date: d, source, name, type };
  });

  return (
    <div className="space-y-1">
      {days.map((p, i) => {
        const tone = p.source === 'override' ? 'bg-orange-50' : i === 0 ? 'bg-cyan-50' : 'hover:bg-slate-50';
        const badgeTone = p.source === 'override'
          ? 'bg-orange-100 text-orange-800'
          : p.source === 'pattern' ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-500';
        return (
          <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg text-[13px] ${tone}`}>
            <div className="flex items-center gap-3">
              <div className="w-20 text-text-secondary">
                {p.date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
              </div>
              {i === 0 && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-100 text-[#0d0c2c]">Today</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[#0d0c2c]">{p.name}</div>
              {p.type && <TargetTypeChip type={p.type} />}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${badgeTone}`}>{p.source}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-[#0d0c2c]">{title}</h3>
        {subtitle && <p className="text-[12px] text-text-secondary mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
