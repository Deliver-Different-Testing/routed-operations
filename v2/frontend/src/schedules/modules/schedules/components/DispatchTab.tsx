// src/modules/schedules/components/DispatchTab.tsx
//
// Read-only: the recurring routes bound to this schedule and the linehaul runs behind its
// linehaul legs, with the next seven days of roster and the run's master job.
// Edited on the Recurring Routes page (Route Roster / Linehaul Roster); this tab only shows them.

import { ExternalLink } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import type { Schedule } from '../types';
import type { LinehaulRun, RecurringRoute, RosterDay } from '../dispatch/types';
import { resolveRoster, routesForSchedule, runsForSchedule, schedulesUsingRun } from '../dispatch/dispatchData';

export interface DispatchTabProps {
  schedule: Schedule;
  allSchedules: Schedule[];
  routes: RecurringRoute[];
  runs: LinehaulRun[];
  /** Deep links into the Recurring Routes page. Optional in the prototype. */
  onOpenRouteRoster?: (route: RecurringRoute) => void;
  onOpenLinehaulRoster?: (run: LinehaulRun) => void;
  onOpenMasterJob?: (run: LinehaulRun) => void;
}

export function WeekStrip({ days }: { days: RosterDay[] }) {
  return (
    <div className="grid grid-cols-7 gap-1" data-testid="week-strip">
      {days.map((d) => (
        <div
          key={d.date}
          title={d.who ?? 'not running'}
          className={`rounded-md border px-1 py-1 text-center text-[11px] ${
            d.isOverride
              ? 'border-warning bg-warning-bg'
              : d.isToday
                ? 'border-brand-cyan bg-brand-cyan/10'
                : 'border-border'
          } ${d.who ? '' : 'opacity-40'}`}
        >
          <div className="text-[10px] uppercase text-text-muted font-medium">{d.label}{d.isToday ? ' ·' : ''}</div>
          <div className="truncate text-text-primary">{d.who ?? '—'}</div>
        </div>
      ))}
    </div>
  );
}

export function DispatchTab({
  schedule,
  allSchedules,
  routes,
  runs,
  onOpenRouteRoster,
  onOpenLinehaulRoster,
  onOpenMasterJob,
}: DispatchTabProps) {
  const boundRoutes = routesForSchedule(routes, schedule.id);
  const boundRuns = runsForSchedule(runs, schedule);

  return (
    <div className="space-y-6" data-testid="dispatch-tab" aria-label="roster tab">
      <div className="rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 p-3 text-xs text-text-secondary">
        <span className="font-medium text-text-primary">Roster.</span> The schedule owns the time window, days and
        cut-off. Recurring routes own the pickup or delivery geography and who runs it; a middle-mile run owns the trunk
        leg and its <span className="font-medium text-text-primary">master job</span>, the one booking a linehaul driver
        picks up so every item on the run is marked picked up together. Read from the Recurring Routes tables; edited there.
      </div>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
          Recurring routes bound to this schedule <span className="font-normal normal-case tracking-normal">· {boundRoutes.length}</span>
        </h3>
        <div className="space-y-2">
          {boundRoutes.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-text-primary">{r.name}</span>
                <Badge variant="blue" size="sm">{r.area}</Badge>
                <Badge variant={r.type === 'first' ? 'blue' : 'green'} size="sm">{r.type === 'first' ? 'First mile' : 'Final mile'}</Badge>
                {r.scheduleIds.length > 1 && (
                  <Badge variant="purple" size="sm" aria-label={`Also bound to ${r.scheduleIds.filter((id) => id !== schedule.id).join(', ')}`}>
                    shared by {r.scheduleIds.length} schedules
                  </Badge>
                )}
                {!r.active && <Badge variant="system" size="sm">Inactive</Badge>}
                <span className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => onOpenRouteRoster?.(r)}>
                  Roster <ExternalLink className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                <span><span className="text-text-primary font-medium">{r.zipCount}</span> zips</span>
                <span><span className="text-text-primary font-medium">{r.mappedStops}</span> mapped stops</span>
                <span>Default: {r.defaultTarget.name} <Badge variant="system" size="sm">{r.defaultTarget.type}</Badge></span>
              </div>
              <WeekStrip days={resolveRoster(r.roster, r.defaultTarget.name)} />
            </div>
          ))}
          {boundRoutes.length === 0 && (
            <div className="px-3 py-5 text-center text-sm text-text-muted border border-dashed border-border rounded-lg">
              No recurring route is bound to this schedule. Pickups are matched from bookings, not a rostered run.
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
          Linehaul legs <span className="font-normal normal-case tracking-normal">· {boundRuns.length ? `${boundRuns.length} run${boundRuns.length > 1 ? 's' : ''}` : 'none on this route'}</span>
        </h3>
        <div className="space-y-2">
          {boundRuns.map((run) => (
            <div key={run.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-text-primary">{run.name}</span>
                <Badge variant="orange" size="sm">Middle mile · run {run.id}</Badge>
                <Badge variant="system" size="sm">{run.mode === 'Flight' ? '✈ Flight' : '🚚 Road'}</Badge>
                <span className="text-xs text-text-secondary">{run.fromDepot} → {run.toDepot}</span>
                <span className="flex-1" />
                <Button variant="ghost" size="sm" onClick={() => onOpenLinehaulRoster?.(run)}>
                  Roster <ExternalLink className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
                <span>Despatch <span className="text-text-primary font-medium">{run.despatchTime}</span> · depart <span className="text-text-primary font-medium">{run.departTime}</span></span>
                <span>Default: {run.defaultTarget.name} <Badge variant="system" size="sm">{run.defaultTarget.type}</Badge></span>
                <span>Speed: {run.speed}</span>
                <span>Used by {schedulesUsingRun(allSchedules, run.id).length} schedules</span>
              </div>
              <div className="text-xs text-text-secondary">
                {run.masterJob ? (
                  <>
                    <span className="font-medium text-text-primary">Master job</span>{' '}
                    <button
                      type="button"
                      onClick={() => onOpenMasterJob?.(run)}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-badge-purple-bg text-badge-purple-text hover:underline"
                    >
                      {run.masterJob.jobNumber}
                    </button>{' '}
                    {run.masterJob.todayState}
                  </>
                ) : (
                  <>
                    <Badge variant="red" size="sm">No master job</Badge>{' '}
                    the driver will see every item as its own job
                  </>
                )}
              </div>
              <WeekStrip days={resolveRoster(run.roster, run.defaultTarget.name, { runDays: run.days })} />
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-text-muted">
        Binding today is one schedule per route (<code>Routes.ScheduleId</code>). "Shared by n schedules" shows the
        multi-binding proposal of 2026-08-03; the effective window is the tightest across the bound schedules.
      </p>
    </div>
  );
}
