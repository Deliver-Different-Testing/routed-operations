import { Fragment, useMemo, useState } from 'react';
import type { BulkJob, Courier, Run } from '../../types';
import { CourierCombobox } from './CourierCombobox';
import { Panel } from '../common/Panel';
import { StatusBadge } from '../common/StatusBadge';
import { Button } from '../common/Button';
import type { ListSort } from './CockpitState';
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu';
import { nextSortDirection, sortIndicator } from '../../lib/sortLists';
import { runAreas } from '../../lib/runAreas';
// L2.P3.1 Same palette the map uses for multi-selected run pins - shared
// so the RunList row tint and the map pin colour are identically indexed.
import { MULTI_RUN_COLOURS } from './GoogleMap';

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
  onAssignCourier: (runId: number, courierId: number | null, opts?: { preassign?: boolean }) => void;
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
  // Preassign dialog state for the courier-drop flow (P1.9, legacy
  // homeControl.js:2557-2600). Presents a Status=18 (preassign) vs Status=0
  // (assign only) choice before the update fires.
  const [preassignPrompt, setPreassignPrompt] = useState<
    { runId: number; courierId: number; courierName: string } | null
  >(null);

  // Phase 5 perf: memoize the Set so it doesn't rebuild on every render;
  // state-based allSelected so this stays O(1) (also lays groundwork for
  // future virtualization per the risk-audit recommendation).
  const selectedRunSet = useMemo(() => new Set(selectedRunIds), [selectedRunIds]);
  const allSelected = runs.length > 0 && runs.length === selectedRunSet.size;
  const locked = runs.filter((r) => r.status && r.status > 0);

  // L2.P3.1 Row tint palette that matches the map-pin colouring for multi-
  // selected runs (GoogleMap.tsx buildPins() -> multiRunColourByJobId). We
  // iterate the runs in the SAME order the map does (`state.runs` order,
  // filtered by selection) so palette index N here is the same colour on
  // the map. The currently-focused `selectedRunId` is excluded from the
  // palette (matches GoogleMap: sequenced orange wins for that run's pins)
  // and continues to render with `bg-brand-cyan/10` below.
  const multiRunColourByRunId = new Map<number, string>();
  if (selectedRunIds.length > 1) {
    let colourIdx = 0;
    for (const r of runs) {
      if (!selectedRunSet.has(r.id)) continue;
      if (selectedRunId === r.id) continue;
      multiRunColourByRunId.set(r.id, MULTI_RUN_COLOURS[colourIdx % MULTI_RUN_COLOURS.length]);
      colourIdx += 1;
    }
  }

  // Legacy runList.tpl splits runs into two ng-repeats: unlocked first
  // (filter:{locked:'!1'}), then locked (filter:{locked:'1'}). Preserves the
  // user's chosen sort WITHIN each group. Operators rely on this to see at a
  // glance what's still editable vs already sent for lock/dispatch.
  const unlockedRuns = runs.filter((r) => !(r.status && r.status > 0));
  const lockedRuns = runs.filter((r) => r.status && r.status > 0);
  const hasBothGroups = unlockedRuns.length > 0 && lockedRuns.length > 0;

  /**
   * Synthesise "Run N" where N is the next unused sequential integer across
   * the existing runs for the current bookdate. Legacy newRun did the same
   * in-memory (homeControl.js:2652-2672). Only inspects names that already
   * match /^Run \d+$/ so operators with a custom naming scheme aren't
   * clobbered by the auto-numbering.
   */
  const nextRunAutoName = (): string => {
    let n = 1;
    const taken = new Set<number>();
    for (const r of runs) {
      const m = (r.name ?? '').match(/^Run\s+(\d+)$/i);
      if (m) taken.add(Number(m[1]));
    }
    while (taken.has(n)) n++;
    return `Run ${n}`;
  };

  const submitCreateRun = () => {
    const name = newRunName.trim() || nextRunAutoName();
    onCreateRun(name);
    setNewRunName('');
  };

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
    // Courier drop wins if present - opens the preassign confirm dialog so
    // the operator can pick Status 18 (preassigned) vs Status 0 (assign only).
    // Legacy homeControl.js:2557-2600 shows the same picker inline.
    const courierRaw = e.dataTransfer.getData('application/x-courier-id');
    if (courierRaw) {
      const cid = Number(courierRaw);
      if (Number.isFinite(cid)) {
        const cour = couriers.find((c) => c.courierId === cid);
        setPreassignPrompt({ runId, courierId: cid, courierName: cour?.displayName ?? `Courier #${cid}` });
      }
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
            if (e.key === 'Enter') submitCreateRun();
          }}
          placeholder={`New run name... (blank = auto-named "${nextRunAutoName()}")`}
          className="flex-1 border border-border rounded px-2 py-1 text-xs"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={submitCreateRun}
          title={newRunName.trim() ? undefined : `Blank name auto-generates "${nextRunAutoName()}"`}
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
              // L2.P3.1 Inline tint from the multi-run palette. Kept out of
              // the className string above because Tailwind can't compile an
              // arbitrary hex-code list; ~25% alpha (40 hex) keeps the row
              // text legible while matching the map pin colour intent.
              style={
                multiRunColourByRunId.has(r.id)
                  ? { backgroundColor: multiRunColourByRunId.get(r.id) + '40' }
                  : undefined
              }
              title={r.isVoidRun
                ? 'Void Jobs run - locked, cannot be dispatched. Right-click to un-void jobs.'
                : multiRunColourByRunId.has(r.id)
                  ? 'Multi-selected. Same colour on the map.'
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
                    <CourierCombobox
                      value={r.courierId ?? null}
                      couriers={couriers}
                      onChange={(id) => onAssignCourier(r.id, id)}
                    />
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

      {/* Preassign vs Assign choice for courier drops (P1.9, legacy
          homeControl.js:2557-2600). Status=18 marks a preassigned run - the
          courier is provisionally attached but the run is not yet dispatched
          to Live. Status=0 leaves the courier on the run without any lock. */}
      {preassignPrompt && (
        <div
          className="fixed inset-0 bg-brand-dark/40 flex items-center justify-center z-40"
          onClick={() => setPreassignPrompt(null)}
          data-modal-open="true"
        >
          <div
            className="bg-surface-white rounded-lg shadow-lg max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border-light">
              <h3 className="text-base font-semibold text-text-primary">Assign courier</h3>
            </div>
            <div className="px-4 py-3 text-sm">
              Attach <b>{preassignPrompt.courierName}</b> to this run as:
              <ul className="mt-2 text-xs text-text-muted list-disc list-inside space-y-1">
                <li><b>Preassigned</b> tags the run with Status 18 (amber badge) so
                    dispatchers see it's earmarked for this courier ahead of lock.</li>
                <li><b>Assign only</b> leaves the courier attached at Status 0
                    (Ready) with no preassign tag.</li>
              </ul>
            </div>
            <div className="px-4 py-3 border-t border-border-light bg-surface-cream flex justify-end gap-2">
              <Button variant="neutral" size="sm" onClick={() => setPreassignPrompt(null)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onAssignCourier(preassignPrompt.runId, preassignPrompt.courierId);
                  setPreassignPrompt(null);
                }}
              >
                Assign only
              </Button>
              <Button
                variant="warning"
                size="sm"
                data-primary="true"
                onClick={() => {
                  onAssignCourier(preassignPrompt.runId, preassignPrompt.courierId, { preassign: true });
                  setPreassignPrompt(null);
                }}
              >
                Preassign (Status 18)
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
