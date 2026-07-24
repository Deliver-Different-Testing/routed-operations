import { useMemo, useState } from 'react';
import type { Run, RunJob } from '../../types';
import { Panel } from '../common/Panel';
import { Button } from '../common/Button';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';
import { runBuilderTotals } from '../../lib/runFinancials';
import { useAuth } from '../../context/AuthContext';
import { postcodeLabel } from '../../lib/tenantLabels';

interface Props {
  run: Run | null;
  selectedJobId?: number | null;
  onSelectJob?: (jobId: number) => void;
  onRemoveJob: (jobId: number) => void;
  onOptimize: () => void;
  onToggleStart?: (job: RunJob, run: Run) => void;
  onToggleEnd?: (job: RunJob, run: Run) => void;
  onVoidJob?: (job: RunJob, run: Run) => void;
  onUnvoidJob?: (job: RunJob, run: Run) => void;
  // Persist a manually re-ordered set of jobs (P1.10, legacy homeControl.js:
  // 891-916 activateRunDrop). The array is in the order the operator wants;
  // callers assign builderIndex = index + 1 during persist.
  onReorderJobs?: (run: Run, orderedJobs: RunJob[]) => void;
}

/**
 * Run Builder pane. Direct port of the legacy runBuilder.tpl (columns) +
 * runBuilderTotals (calculator strip) + the runBuilderMenu context items.
 *
 * Columns (legacy runBuilder.tpl:50-65):
 *   icons  (isStart play / isEnd flag-checkered)
 *   Client
 *   Job #
 *   D Date
 *   R Time
 *   To (address, red if !toLat)
 *   Suburb
 *   ZipCode
 *   Courier
 *   Speed
 *   Order (BuilderIndex)
 *
 * Calculator strip (legacy runBuilder.tpl:18-41):
 *   Total Mins | Total KMs | Total Drops | Hour % | Revenue | Total Exp |
 *   Courier %  (green <=65, orange 66-75, red >75) | Hourly Rate ($25 hardcoded) |
 *   Total Payout
 *
 * Row context menu (legacy runBuilderMenu, homeControl.js:1120-1178):
 *   Toggle end point | Toggle start point | Remove | Void  (regular run)
 *   Un-void                                                  (Void Jobs run)
 */
export function RunBuilder({
  run,
  selectedJobId,
  onSelectJob,
  onRemoveJob,
  onOptimize,
  onToggleStart,
  onToggleEnd,
  onVoidJob,
  onUnvoidJob,
  onReorderJobs,
}: Props) {
  const { isUsTenant } = useAuth();
  const zipLabel = postcodeLabel(isUsTenant, true);
  const [ctx, setCtx] = useState<{ x: number; y: number; job: RunJob } | null>(null);
  // Drag-to-reorder state (P1.10). We only track the id being dragged; the
  // ordering is applied on drop against the current run.jobs snapshot.
  const [dragJobId, setDragJobId] = useState<number | null>(null);
  const [dropTargetJobId, setDropTargetJobId] = useState<number | null>(null);

  const totals = useMemo(() => run ? runBuilderTotals(run) : null, [run]);

  const canReorder = !!onReorderJobs && !!run && !run.isVoidRun;

  const commitReorder = (targetJobId: number) => {
    if (!canReorder || !run || dragJobId == null || dragJobId === targetJobId) {
      setDragJobId(null);
      setDropTargetJobId(null);
      return;
    }
    const src = run.jobs.findIndex((j) => j.bulkJobId === dragJobId);
    const dst = run.jobs.findIndex((j) => j.bulkJobId === targetJobId);
    if (src < 0 || dst < 0) {
      setDragJobId(null);
      setDropTargetJobId(null);
      return;
    }
    const next = [...run.jobs];
    const [moved] = next.splice(src, 1);
    next.splice(dst, 0, moved);
    onReorderJobs!(run, next);
    setDragJobId(null);
    setDropTargetJobId(null);
  };

  if (!run) {
    return (
      <Panel title="Run builder">
        <div className="p-4 text-sm text-text-muted">
          Select a run to see the jobs assigned to it.
        </div>
      </Panel>
    );
  }

  const contextItems = (job: RunJob): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (run.isVoidRun) {
      if (onUnvoidJob) items.push({ label: 'Un-void job', onClick: () => onUnvoidJob(job, run) });
    } else {
      if (onToggleEnd) items.push({
        label: job.isEnd ? 'Clear end point' : 'Set as end point',
        onClick: () => onToggleEnd(job, run),
      });
      if (onToggleStart) items.push({
        label: job.isStart ? 'Clear start point' : 'Set as start point',
        onClick: () => onToggleStart(job, run),
      });
      items.push({ label: 'Remove from run', onClick: () => onRemoveJob(job.bulkJobId), danger: true, separatorAfter: true });
      if (onVoidJob) items.push({ label: 'Void job', onClick: () => onVoidJob(job, run), danger: true });
    }
    return items;
  };

  const courierPctClass =
    totals && totals.courierPct != null
      ? totals.courierPct > 75
        ? 'text-error'
        : totals.courierPct > 65
        ? 'text-warning'
        : 'text-success'
      : 'text-text-muted';

  return (
    <Panel
      title={run.isVoidRun ? `Run: ${run.name}` : `Run: ${run.name}`}
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={onOptimize}
          disabled={run.jobs.length < 2 || run.isVoidRun}
          title={
            run.isVoidRun ? 'Cannot optimise a Void Jobs run'
              : run.jobs.length < 2 ? 'Need 2+ jobs to optimise'
              : 'Optimise sequence via HERE / RouteSavvy'
          }
        >
          Optimise
        </Button>
      }
    >
      {/* Calculator strip (legacy runBuilder.tpl:18-41) */}
      {totals && !run.isVoidRun && (
        <div className="grid grid-cols-9 gap-1 px-2 py-1 bg-surface-cream border-b border-border-light text-[11px]">
          <Stat label="Mins" value={String(run.mins ?? 0)} />
          <Stat label="Kms" value={(run.kms ?? 0).toFixed(1)} />
          <Stat label="Drops" value={String(run.jobs.length)} />
          <Stat label="Hour %" value={`${totals.hourPct.toFixed(0)}%`} />
          <Stat label="Revenue" value={`$${totals.revenue.toFixed(0)}`} />
          <Stat label="Exp" value={`$${totals.exp.toFixed(0)}`} />
          <Stat
            label="Cour %"
            value={totals.courierPct != null ? `${totals.courierPct.toFixed(0)}%` : '-'}
            valueClass={courierPctClass}
          />
          <Stat label="Rate" value="$25.00" />
          <Stat label="Payout" value={`$${totals.payout.toFixed(0)}`} />
        </div>
      )}

      <table className="w-full text-xs">
        <thead className="bg-surface-cream sticky top-0">
          <tr className="text-left text-text-muted">
            {canReorder && <th className="px-1 py-1 w-6" title="Drag rows to re-order"></th>}
            <th className="px-1 py-1 w-6"></th>
            <th className="px-1 py-1 w-8">#</th>
            <th className="px-1 py-1">Client</th>
            <th className="px-1 py-1">Job #</th>
            <th className="px-1 py-1">Time</th>
            <th className="px-1 py-1">To</th>
            <th className="px-1 py-1">Suburb</th>
            <th className="px-1 py-1">{zipLabel}</th>
            <th className="px-1 py-1">Courier</th>
            <th className="px-1 py-1">Speed</th>
            <th className="px-1 py-1 w-12"></th>
          </tr>
        </thead>
        <tbody>
          {run.jobs.map((j) => {
            const missingGps = !j.deliveryLatitude;
            const isDragging = dragJobId === j.bulkJobId;
            const isDropTarget = dropTargetJobId === j.bulkJobId && dragJobId != null && dragJobId !== j.bulkJobId;
            return (
              <tr
                key={j.bulkJobId}
                className={`cursor-pointer border-t border-border-light hover:bg-surface-cream ${
                  missingGps ? 'text-error' : ''
                } ${selectedJobId === j.bulkJobId ? 'bg-brand-cyan/20' : ''} ${
                  isDragging ? 'opacity-40' : ''
                } ${isDropTarget ? 'ring-2 ring-brand-cyan' : ''}`}
                onClick={() => onSelectJob?.(j.bulkJobId)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCtx({ x: e.clientX, y: e.clientY, job: j });
                }}
                onDragOver={canReorder && dragJobId != null ? (e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dropTargetJobId !== j.bulkJobId) setDropTargetJobId(j.bulkJobId);
                } : undefined}
                onDragLeave={canReorder ? () => {
                  if (dropTargetJobId === j.bulkJobId) setDropTargetJobId(null);
                } : undefined}
                onDrop={canReorder ? (e) => {
                  e.preventDefault();
                  commitReorder(j.bulkJobId);
                } : undefined}
                title={canReorder
                  ? 'Click to select. Grab the handle on the left to drag re-order. Right-click for more.'
                  : 'Click to select. Right-click for more actions. Del to remove.'}
              >
                {canReorder && (
                  <td
                    className="px-1 py-1 text-center text-text-muted cursor-grab active:cursor-grabbing select-none"
                    draggable
                    onDragStart={(e) => {
                      setDragJobId(j.bulkJobId);
                      // Payload keeps a marker so external drop targets (RunList)
                      // don't confuse this with a job-move drop. Not consumed by
                      // the receiver but keeps browsers from cancelling the drag.
                      e.dataTransfer.setData('application/x-run-reorder', String(j.bulkJobId));
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => { setDragJobId(null); setDropTargetJobId(null); }}
                    title="Drag to re-order"
                  >
                    ::
                  </td>
                )}
                <td className="px-1 py-1">
                  {j.isStart && <span title="Start point" className="text-brand-cyan">▶</span>}
                  {j.isEnd && <span title="End point" className="text-brand-orange">⚑</span>}
                </td>
                <td className="px-1 py-1">{j.builderIndex ?? '-'}</td>
                <td className="px-1 py-1">{j.clientCode ?? ''}</td>
                <td className="px-1 py-1 font-medium">
                  {j.jobNumber}
                  {missingGps && <span title="Missing GPS coordinates" className="ml-1">!</span>}
                </td>
                <td className="px-1 py-1">{formatTime(j.bookTime)}</td>
                <td className="px-1 py-1 truncate max-w-32">{j.toAddress ?? ''}</td>
                <td className="px-1 py-1">{j.toSuburb ?? ''}</td>
                <td className="px-1 py-1">{j.toPostCode ?? ''}</td>
                <td className="px-1 py-1 truncate max-w-24">{j.courierName ?? ''}</td>
                <td className="px-1 py-1 truncate max-w-24">{j.speedName ?? ''}</td>
                <td className="px-1 py-1">
                  <button
                    type="button"
                    onClick={() => onRemoveJob(j.bulkJobId)}
                    className="text-xs text-error hover:underline"
                    title="Remove from run"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
          {run.jobs.length === 0 && (
            <tr>
              <td colSpan={canReorder ? 12 : 11} className="px-2 py-4 text-center text-text-muted">
                Run is empty. Select jobs in the Jobs pane and use the "+ job(s)" button on this run.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <RowContextMenu
        clientX={ctx?.x ?? null}
        clientY={ctx?.y ?? null}
        title={ctx ? `Job ${ctx.job.jobNumber}` : undefined}
        items={ctx ? contextItems(ctx.job) : []}
        onClose={() => setCtx(null)}
      />
    </Panel>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-text-muted uppercase tracking-wide text-[9px]">{label}</span>
      <span className={`font-semibold ${valueClass ?? 'text-text-primary'}`}>{value}</span>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  // RunJobDto.BookTime arrives as "HH:MM:SS" (see RunService.cs projection).
  // BulkJobDto.bookTime arrives as an ISO datetime string. Handle both.
  if (/^\d{2}:\d{2}/.test(iso)) return iso.slice(0, 5);
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  } catch { return ''; }
}
