import { useState } from 'react';
import type { Run, RunJob } from '../../types';
import { Panel } from '../common/Panel';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';

interface Props {
  run: Run | null;
  onRemoveJob: (jobId: number) => void;
  onOptimize: () => void;
  onContextMenuItems?: (job: RunJob, run: Run) => ContextMenuItem[];
}

export function RunBuilder({ run, onRemoveJob, onOptimize, onContextMenuItems }: Props) {
  const [ctx, setCtx] = useState<{ x: number; y: number; job: RunJob } | null>(null);

  if (!run) {
    return (
      <Panel title="Run builder">
        <div className="p-4 text-sm text-text-muted">
          Select a run to see the jobs assigned to it.
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title={`Run: ${run.name}`}
      actions={
        <button
          type="button"
          onClick={onOptimize}
          disabled={run.jobs.length < 2}
          className="px-2 py-0.5 text-xs bg-brand-purple text-white rounded disabled:opacity-50"
          title={run.jobs.length < 2 ? 'Need 2+ jobs to optimise' : 'Optimise sequence via RouteSavvy'}
        >
          Optimise
        </button>
      }
    >
      <table className="w-full text-xs">
        <thead className="bg-surface-cream sticky top-0">
          <tr className="text-left text-text-muted">
            <th className="px-2 py-1 w-10">Order</th>
            <th className="px-2 py-1">Job #</th>
            <th className="px-2 py-1">Job ID</th>
            <th className="px-2 py-1 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {run.jobs.map((j) => (
            <tr
              key={j.bulkJobId}
              className="border-t border-border-light hover:bg-surface-cream"
              onContextMenu={(e) => {
                if (!onContextMenuItems) return;
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, job: j });
              }}
              title={onContextMenuItems ? 'Right-click for more actions' : undefined}
            >
              <td className="px-2 py-1">{j.builderIndex ?? '-'}</td>
              <td className="px-2 py-1 font-medium">{j.jobNumber}</td>
              <td className="px-2 py-1">{j.bulkJobId}</td>
              <td className="px-2 py-1">
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
          ))}
          {run.jobs.length === 0 && (
            <tr>
              <td colSpan={4} className="px-2 py-4 text-center text-text-muted">
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
        items={ctx && onContextMenuItems ? onContextMenuItems(ctx.job, run) : []}
        onClose={() => setCtx(null)}
      />
    </Panel>
  );
}
