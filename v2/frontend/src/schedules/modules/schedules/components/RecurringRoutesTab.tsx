// src/modules/schedules/components/RecurringRoutesTab.tsx
//
// The Recurring Routes page's rows (first / middle / final mile) anchored to schedules:
// same columns as the live page, plus Schedule(s), Clients via schedule, and Master job.
// Row click opens the existing Edit Route / Edit Linehaul Run modal (callbacks); rosters
// are edited on their own pages.

import { useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { SearchInput } from '../../../components/filters/SearchInput';
import type { ClientReference, Schedule } from '../types';
import type { LinehaulRun, RecurringRoute, RouteType } from '../dispatch/types';
import { resolveRoster, schedulesUsingRun } from '../dispatch/dispatchData';
import { clientsViaSchedules, clientLabel } from '../utils/clientLinks';
import { WeekStrip } from './DispatchTab';

export interface RecurringRoutesTabProps {
  schedules: Schedule[];
  clients: ClientReference[];
  routes: RecurringRoute[];
  runs: LinehaulRun[];
  onOpenSchedule: (scheduleId: number) => void;
  onOpenRoute?: (route: RecurringRoute) => void;
  onOpenRun?: (run: LinehaulRun) => void;
  onOpenMasterJob?: (run: LinehaulRun) => void;
}

interface Row {
  kind: 'route' | 'run';
  id: number;
  type: RouteType;
  name: string;
  where: string;
  scheduleIds: number[];
  targetName: string;
  targetType: string;
  targetHint?: string;
  zipCount: number | null;
  mappedStops: number;
  active: boolean;
  route?: RecurringRoute;
  run?: LinehaulRun;
}

const TYPE_LABEL: Record<RouteType, { label: string; variant: 'blue' | 'orange' | 'green' }> = {
  first: { label: 'First mile', variant: 'blue' },
  middle: { label: 'Middle mile', variant: 'orange' },
  final: { label: 'Final mile', variant: 'green' },
};

function windowText(s: Schedule): string {
  const days = Object.values(s.operatingSchedule.days).filter((d) => d.enabled);
  const first = days[0];
  return first ? `${first.startTime}–${first.endTime}` : '';
}

export function RecurringRoutesTab({
  schedules,
  clients,
  routes,
  runs,
  onOpenSchedule,
  onOpenRoute,
  onOpenRun,
  onOpenMasterJob,
}: RecurringRoutesTabProps) {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'all' | RouteType>('all');

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = routes.map((r) => ({
      kind: 'route', id: r.id, type: r.type, name: r.name, where: r.area, scheduleIds: r.scheduleIds,
      targetName: r.defaultTarget.name, targetType: r.defaultTarget.type, targetHint: r.defaultTarget.hint,
      zipCount: r.zipCount, mappedStops: r.mappedStops, active: r.active, route: r,
    }));
    runs.forEach((run) => {
      out.push({
        kind: 'run', id: run.id, type: 'middle', name: run.name, where: `${run.fromDepot} → ${run.toDepot}`,
        scheduleIds: schedulesUsingRun(schedules, run.id).map((s) => s.id),
        targetName: run.defaultTarget.name, targetType: run.defaultTarget.type,
        targetHint: `${run.mode} · despatch ${run.despatchTime} · depart ${run.departTime}`,
        zipCount: null, mappedStops: run.mappedStops, active: run.active, run,
      });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [routes, runs, schedules]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (type !== 'all' && r.type !== type) return false;
      if (!q) return true;
      const via = clientsViaSchedules(schedules, r.scheduleIds);
      return (
        r.name.toLowerCase().includes(q) ||
        r.where.toLowerCase().includes(q) ||
        r.scheduleIds.some((id) => schedules.find((s) => s.id === id)?.name.toLowerCase().includes(q)) ||
        via.clientIds.some((id) => clientLabel(clients, id).toLowerCase().includes(q))
      );
    });
  }, [rows, search, type, schedules, clients]);

  const seg = (value: 'all' | RouteType, label: string) => (
    <button
      type="button"
      key={value}
      onClick={() => setType(value)}
      className={`px-3 py-1.5 text-xs font-medium transition-colors ${type === value ? 'bg-brand-cyan/15 text-brand-dark' : 'text-text-secondary hover:bg-surface-cream'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col" data-testid="recurring-routes-tab" aria-label="recurring routes tab">
      <div className="p-3 border-b border-border bg-surface-light space-y-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search routes by name, area, schedule or client…" />
        <div className="flex items-center gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-border overflow-hidden bg-white">
            {seg('all', 'All types')}{seg('first', 'First mile')}{seg('middle', 'Middle mile')}{seg('final', 'Final mile')}
          </div>
          <span className="text-xs text-text-muted">
            Same rows as the Recurring Routes page, anchored to the schedules that give them their window. Rosters are edited on the Route Roster / Linehaul Roster pages.
          </span>
          <span className="ml-auto text-xs text-text-muted">Showing {visible.length} of {rows.length}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="recurring-routes-table">
          <thead className="bg-surface-light sticky top-0 z-10">
            <tr className="border-b border-border">
              {['Name', 'Type', 'Area / From → To', 'Schedule(s)', 'Clients via schedule', 'Default target', 'Master job', 'This week', 'Stops', 'Status'].map((h) => (
                <th key={h} className="text-left py-2 px-2 font-medium text-text-muted uppercase text-xs whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const via = clientsViaSchedules(schedules, r.scheduleIds);
              const bound = r.scheduleIds.map((id) => schedules.find((s) => s.id === id)).filter((s): s is Schedule => !!s);
              const bases = bound.filter((s) => !s.isOverride);
              const t = TYPE_LABEL[r.type];
              const days = r.run
                ? resolveRoster(r.run.roster, r.run.defaultTarget.name, { runDays: r.run.days })
                : resolveRoster(r.route!.roster, r.route!.defaultTarget.name);
              return (
                <tr
                  key={`${r.kind}-${r.id}`}
                  onClick={() => (r.run ? onOpenRun?.(r.run) : onOpenRoute?.(r.route!))}
                  className="border-b border-border cursor-pointer hover:bg-surface-cream transition-colors"
                >
                  <td className="py-1.5 px-2">
                    <div className="font-medium text-text-primary">{r.name}</div>
                    <div className="text-[11px] text-text-muted">{r.kind === 'run' ? 'run' : 'route'} {r.id}{r.zipCount != null ? ` · ${r.zipCount} zips` : ''}</div>
                  </td>
                  <td className="py-1.5 px-2"><Badge variant={t.variant} size="sm">{t.label}</Badge></td>
                  <td className="py-1.5 px-2 text-xs text-text-secondary">{r.where}</td>
                  <td className="py-1.5 px-2">
                    <div className="flex flex-col gap-1">
                      {bases.slice(0, 2).map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onOpenSchedule(s.id); }}
                          className="inline-flex w-fit items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-brand-cyan/15 text-brand-dark hover:bg-brand-cyan/30"
                        >
                          {s.name} · {windowText(s)}
                        </button>
                      ))}
                      {bound.length > 2 && <span className="text-[11px] text-text-muted">+{bound.length - 2} more</span>}
                      {bound.length === 0 && <Badge variant="system" size="sm">Unbound</Badge>}
                    </div>
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="flex flex-wrap gap-1">
                      {via.all && <Badge variant="green" size="sm">All clients</Badge>}
                      {via.clientIds.slice(0, 3).map((id) => <Badge key={id} variant="system" size="sm">{clientLabel(clients, id)}</Badge>)}
                      {via.clientIds.length > 3 && <span className="text-[11px] text-text-muted">+{via.clientIds.length - 3}</span>}
                      {!via.all && via.clientIds.length === 0 && <span className="text-text-muted">—</span>}
                    </div>
                  </td>
                  <td className="py-1.5 px-2">
                    <div className="text-text-primary">{r.targetName} <Badge variant="system" size="sm">{r.targetType}</Badge></div>
                    {r.targetHint && <div className="text-[11px] text-text-muted">{r.targetHint}</div>}
                  </td>
                  <td className="py-1.5 px-2">
                    {r.run ? (
                      r.run.masterJob ? (
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onOpenMasterJob?.(r.run!); }}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-badge-purple-bg text-badge-purple-text hover:underline"
                          >
                            {r.run.masterJob.jobNumber}
                          </button>
                          <div className="text-[11px] text-text-muted">{r.run.masterJob.todayState}</div>
                        </>
                      ) : (
                        <Badge variant="red" size="sm">None</Badge>
                      )
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 min-w-[240px]"><WeekStrip days={days} /></td>
                  <td className="py-1.5 px-2 text-center text-text-secondary">{r.mappedStops}</td>
                  <td className="py-1.5 px-2 text-center">
                    <Badge variant={r.active ? 'green' : 'system'} size="sm">{r.active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={10} className="py-10 text-center text-text-muted">Nothing matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
