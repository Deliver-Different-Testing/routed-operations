import { Fragment, useState } from 'react';
import type { BulkJob, Courier, Run } from '../../types';
import { Panel } from '../common/Panel';
import { StatusBadge } from '../common/StatusBadge';
import { Button } from '../common/Button';
import type { ListSort } from './CockpitState';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';
import { nextSortDirection, sortIndicator } from '../../lib/sortLists';
import { runAreas } from '../../lib/runAreas';

interface Props {
  runs: Run[];
  allJobs: BulkJob[];
  couriers: Courier[];
  selectedRunId: number | null;
  selectedRunIds: number[];
  sort: ListSort | null;
  search: string;
  onSetSort: (sort: ListSort | null) => void;
  onSetSearch: (search: string) => void;
  onSelectRun: (runId: number) => void;
  onToggleRunMultiselect: (runId: number) => void;
  onToggleAllRunMultiselect: () => void;
  onCreateRun: (name: string) => void;
  onRenameRun: (runId: number, name: string) => void;
  onDeleteRun: (runId: number) => void;
  onAssignCourier: (runId: number, courierId: number | null) => void;
  onLockRun: (runId: number, locked: boolean) => void;
  onDispatch: () => void;
  onPrebook: () => void;
  onAssignSelectedJobs: (runId: number) => void;
  onDropJobs: (runId: number, jobIds: number[]) => void;
  onContextMenuItems: (run: Run, helpers: { startRename: () => void }) => ContextMenuItem[];
  selectedJobCount: number;
}

export function RunList({
  runs,
  allJobs,
  couriers,
  selectedRunId,
  selectedRunIds,
  sort,
  search,
  onSetSort,
  onSetSearch,
  onSelectRun,
  onToggleRunMultiselect,
  onToggleAllRunMultiselect,
  onCreateRun,
  onRenameRun,
  onDeleteRun,
  onAssignCourier,
  onLockRun,
  onDispatch,
  onPrebook,
  onAssignSelectedJobs,
  onDropJobs,
  onContextMenuItems,
  selectedJobCount,
}: Props) {
  const [newRunName, setNewRunName] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; run: Run } | null>(null);

  const selectedRunSet = new Set(selectedRunIds);
  const allSelected = runs.length > 0 && runs.every((r) => selectedRunSet.has(r.id));
  const locked = runs.filter((r) => r.status && r.status > 0);

  // Legacy runList.tpl splits runs into two ng-repeats: unlocked first
  // (filter:{locked:'!1'}), then locked (filter:{locked:'1'}). Preserves the
  // user's chosen sort WITHIN each group. Operators rely on this to see at a
  // glance what's still editable vs already sent for lock/dispatch.
  const unlockedRuns = runs.filter((r) => !(r.status && r.status > 0));
  const lockedRuns = runs.filter((r) => r.status && r.status > 0);
  const hasBothGroups = unlockedRuns.length > 0 && lockedRuns.length > 0;

  const startRename = (r: Run) => {
    setRenamingId(r.id);
    setRenameValue(r.name ?? '');
  };
  const commitRename = () => {
    if (renamingId != null && renameValue.trim()) {
      onRenameRun(renamingId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  };

  const handleDragOver = (e: React.DragEvent, runId: number) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('application/x-bulk-job-ids') || types.includes('application/x-courier-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = types.includes('application/x-courier-id') ? 'copy' : 'move';
      setDropTargetId(runId);
    }
  };
  const handleDragLeave = () => setDropTargetId(null);
  const handleDrop = (e: React.DragEvent, runId: number) => {
    e.preventDefault();
    setDropTargetId(null);
    // Courier drop wins if present - assigns the courier to this run.
    const courierRaw = e.dataTransfer.getData('application/x-courier-id');
    if (courierRaw) {
      const cid = Number(courierRaw);
      if (Number.isFinite(cid)) onAssignCourier(runId, cid);
      return;
    }
    const raw = e.dataTransfer.getData('application/x-bulk-job-ids');
    if (!raw) return;
    try {
      const ids = JSON.parse(raw) as number[];
      if (Array.isArray(ids) && ids.length > 0) onDropJobs(runId, ids);
    } catch { /* invalid payload */ }
  };

  const columns: { field: string; label: string; width?: string }[] = [
    { field: 'name', label: 'Run', width: 'w-40' },
    { field: 'area', label: 'Area' },
    { field: 'jobs', label: 'Jobs', width: 'w-14' },
    { field: 'mins', label: 'Min', width: 'w-14' },
    { field: 'kms', label: 'Km', width: 'w-14' },
    { field: 'courierPercentage', label: '%', width: 'w-12' },
    { field: 'courierName', label: 'Courier' },
    { field: 'status', label: 'Status', width: 'w-16' },
  ];

  return (
    <Panel
      title={`Runs (${runs.length}) - ${selectedRunIds.length} selected`}
      actions={
        <div className="flex gap-1 items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => onSetSearch(e.target.value)}
            placeholder="Filter..."
            className="border border-border rounded px-2 py-0.5 text-xs w-24"
          />
          {/* Prebook button hidden pending real spec. Legacy sendTo('prebook')
              POSTed to a dead endpoint; the existing Status=2 staging path is
              retained on the backend but not surfaced in the UI until the
              proper tucJobBooking + cron contract is defined. Set env flag or
              re-enable when spec lands. */}
          {false && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onPrebook}
              disabled={locked.length === 0}
              title="Prebook staging - not yet spec'd"
            >
              Prebook
            </Button>
          )}
          <Button
            variant="warning"
            size="sm"
            onClick={onDispatch}
            disabled={locked.length === 0}
            title={locked.length === 0 ? 'Lock a run first' : `Dispatch ${locked.length} locked run(s)`}
          >
            Send to Live ({locked.length})
          </Button>
        </div>
      }
    >
      <div className="p-2 border-b border-border-light bg-surface-cream flex gap-2">
        <input
          type="text"
          value={newRunName}
          onChange={(e) => setNewRunName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newRunName.trim()) {
              onCreateRun(newRunName.trim());
              setNewRunName('');
            }
          }}
          placeholder="New run name..."
          className="flex-1 border border-border rounded px-2 py-1 text-xs"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            if (newRunName.trim()) {
              onCreateRun(newRunName.trim());
              setNewRunName('');
            }
          }}
        >
          + Create
        </Button>
      </div>

      <table className="w-full text-xs">
        <thead className="bg-surface-cream sticky top-0">
          <tr className="text-left text-text-muted">
            <th className="px-2 py-1 w-8">
              <input
                type="checkbox"
                aria-label="Select all runs"
                checked={allSelected}
                onChange={onToggleAllRunMultiselect}
              />
            </th>
            {columns.map((c) => (
              <th
                key={c.field}
                onClick={() => c.field !== 'area' && onSetSort(nextSortDirection(sort, c.field))}
                className={`px-2 py-1 select-none ${c.width ?? ''} ${
                  c.field !== 'area' ? 'cursor-pointer hover:bg-surface-light' : ''
                }`}
                title={c.field !== 'area' ? 'Click to sort' : ''}
              >
                {c.label}{c.field !== 'area' ? sortIndicator(sort, c.field) : ''}
              </th>
            ))}
            <th className="px-2 py-1 w-32"></th>
          </tr>
        </thead>
        <tbody>
          {/* Section headers only render when both groups have members - a
              single-group day should not waste the operator's screen space. */}
          {hasBothGroups && (
            <tr className="bg-surface-cream">
              <td colSpan={columns.length + 2} className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted font-semibold">
                Ready ({unlockedRuns.length})
              </td>
            </tr>
          )}
          {[...unlockedRuns, ...lockedRuns].map((r, idx) => (
            <Fragment key={r.id}>
            {hasBothGroups && idx === unlockedRuns.length && (
              <tr className="bg-success-bg">
                <td colSpan={columns.length + 2} className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-success font-semibold">
                  Locked ({lockedRuns.length}) - queued for dispatch
                </td>
              </tr>
            )}
            <tr
              onClick={() => onSelectRun(r.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCtx({ x: e.clientX, y: e.clientY, run: r });
              }}
              onDragOver={r.isVoidRun ? undefined : (e) => handleDragOver(e, r.id)}
              onDragLeave={r.isVoidRun ? undefined : handleDragLeave}
              onDrop={r.isVoidRun ? undefined : (e) => handleDrop(e, r.id)}
              className={`cursor-pointer border-t border-border-light hover:bg-surface-cream ${
                selectedRunId === r.id ? 'bg-brand-cyan/10' : ''
              } ${dropTargetId === r.id ? 'ring-2 ring-brand-cyan bg-brand-cyan/20' : ''} ${
                r.isVoidRun ? 'bg-error/5 text-text-muted' : ''
              }`}
              title={r.isVoidRun
                ? 'Void Jobs run - locked, cannot be dispatched. Right-click to un-void jobs.'
                : 'Right-click for more actions'}
            >
              <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select run ${r.name}`}
                  checked={selectedRunSet.has(r.id)}
                  onChange={() => onToggleRunMultiselect(r.id)}
                />
              </td>
              <td className="px-2 py-1 font-medium">
                {renamingId === r.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs px-1 py-0 border border-brand-cyan rounded w-full"
                  />
                ) : (
                  <span className="inline-flex items-center gap-1">
                    {r.isVoidRun && (
                      <span
                        className="text-error"
                        title="Void Jobs run - operators cannot dispatch or modify"
                      >⊘</span>
                    )}
                    <span>{r.name}</span>
                    {/* Routing-mode + no-reroute indicator badges. Tooltips
                        spell out the meaning; icons stay compact. */}
                    {r.routingMode === 1 && (
                      <span
                        className="text-[9px] px-1 rounded bg-brand-purple/15 text-brand-purple font-semibold"
                        title="Circuit route (A-A): returns to depot"
                      >A-A</span>
                    )}
                    {r.routingMode === 2 && (
                      <span
                        className="text-[9px] px-1 rounded bg-brand-purple/15 text-brand-purple font-semibold"
                        title={`Finish at nominated stop${r.finishAtBulkJobId ? ` (job #${r.finishAtBulkJobId})` : ''}`}
                      >FA</span>
                    )}
                    {r.noReroute && (
                      <span
                        className="text-[9px] px-1 rounded bg-error/15 text-error font-semibold"
                        title="Route locked - driver app cannot reroute"
                      >NR</span>
                    )}
                  </span>
                )}
              </td>
              <td className="px-2 py-1 truncate max-w-40 text-text-muted">{runAreas(r, allJobs)}</td>
              <td className="px-2 py-1">{r.jobs.length}</td>
              <td className="px-2 py-1">{r.mins ?? 0}</td>
              <td className="px-2 py-1">{r.kms?.toFixed(1) ?? '0.0'}</td>
              <td className={`px-2 py-1 ${
                r.courierPercentage != null && r.courierPercentage * 100 > 75 ? 'text-error font-medium'
                  : r.courierPercentage != null && r.courierPercentage * 100 > 65 ? 'text-warning font-medium'
                  : r.courierPercentage != null ? 'text-success font-medium'
                  : 'text-text-muted'
              }`}>
                {r.courierPercentage != null ? `${(r.courierPercentage * 100).toFixed(0)}%` : '-'}
              </td>
              {/* Preassigned CSS class per legacy runList.tpl:31 - a light amber
                  background when the run's Status = 18 (dispatcher has pre-
                  attached a courier before the operator locked the run). */}
              <td className={`px-2 py-1 truncate max-w-32 ${r.status === 18 ? 'bg-warning-bg' : ''}`}>
                <div className="truncate">{r.courierName ?? ''}</div>
                {r.fleet && (
                  <div className="text-[10px] text-text-muted truncate" title={`Fleet: ${r.fleet}`}>
                    {r.fleet}
                  </div>
                )}
              </td>
              <td className="px-2 py-1">
                <StatusBadge
                  label={r.isVoidRun ? 'Void' : r.status && r.status > 0 ? 'Locked' : 'Ready'}
                  kind={r.isVoidRun ? 'error' : r.status && r.status > 0 ? 'success' : 'info'}
                />
              </td>
              <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                {r.isVoidRun ? (
                  <span className="text-[10px] text-text-muted italic">no courier</span>
                ) : (
                  <div className="flex gap-1 flex-wrap">
                    <select
                      value={r.courierId ?? ''}
                      onChange={(e) => onAssignCourier(r.id, e.target.value ? Number(e.target.value) : null)}
                      className="text-xs border border-border rounded px-1 py-0.5 max-w-24"
                      title="Assign courier"
                    >
                      <option value="">-</option>
                      {couriers.map((c) => (
                        <option key={c.courierId} value={c.courierId}>{c.displayName}</option>
                      ))}
                    </select>
                    {selectedJobCount > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onAssignSelectedJobs(r.id)}
                        title={`Move ${selectedJobCount} selected job(s) to this run`}
                      >
                        + {selectedJobCount}
                      </Button>
                    )}
                  </div>
                )}
              </td>
            </tr>
            </Fragment>
          ))}
          {runs.length === 0 && (
            <tr>
              <td colSpan={columns.length + 2} className="px-2 py-4 text-center text-text-muted">
                No runs yet. Enter a name above and click Create.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <RowContextMenu
        clientX={ctx?.x ?? null}
        clientY={ctx?.y ?? null}
        title={ctx ? `Run ${ctx.run.name}` : undefined}
        items={ctx ? onContextMenuItems(ctx.run, { startRename: () => startRename(ctx.run) }) : []}
        onClose={() => setCtx(null)}
      />
    </Panel>
  );
}
