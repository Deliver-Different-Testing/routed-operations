import { useEffect, useMemo, useRef, useState } from 'react';
import type { BulkRun } from '../../services/routeViewerService';
import { Button } from '../common/Button';

// Run List box for the Route Viewer Home module (master Section 7.5).
// Columns: Run / From / To / Jobs / Status / Velocity / Agent-NP / Courier.
// View-mode toggle (Combined / Inbound / Outbound) is presentational only
// - the parent re-runs the runs query with the `group` param on toggle so
// the SP switches its aggregation branch.
//
// Multi-run selection is Ctrl/Shift-click extension of a single-run
// default (matches master Section 7.5 selection semantics). The click
// handler forwards the modifier keys up so the parent can decide whether
// this is "replace selection" or "extend / toggle in place".

// Owned by wwwroot/app/react/lib/runViewerViewMode.ts as of 2026-09-18;
// re-exported here so existing `import { type ViewMode } from '.../RvRunList'`
// paths keep working (RunViewer.tsx + RvRunList.test.tsx today). Imported
// locally too because this file uses ViewMode in its own type annotations.
import type { ViewMode } from '../../lib/runViewerViewMode';
export type { ViewMode };

interface Props {
  runs: BulkRun[];
  selectedIds: number[];
  onSelect: (id: number, mods: { ctrl: boolean; shift: boolean }) => void;
  onContextMenu?: (e: React.MouseEvent, id: number) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isLoading?: boolean;
  /** Tier-2 item 15: per-run tint colour keyed by run id, populated
   *  only when 2+ runs are selected. Row background uses the tint
   *  instead of the default brand-cyan so operators can match rows
   *  to same-coloured map pins. */
  runColorMap?: Record<number, string>;
  /** Audit item 13: drop handler for the drag-drop courier-onto-run
   *  flow. Called when the operator drags a row out of the Couriers
   *  box and drops it on a run row here. */
  onDropCourier?: (runId: number, courierCode: string) => void;
  /** Audit item 20: drop handler for the drag-drop jobs-onto-run flow.
   *  Called when the operator drags one or more selected rows out of
   *  the middle-pane Run Jobs table and drops them on a run row here.
   *  `fromRunId` is the source run so the caller can no-op when the
   *  drop lands on the same run the jobs already belong to. */
  onDropRunJobs?: (toRunId: number, fromRunId: number, jobIds: number[]) => void;
  /** Fires with the id list in the currently-rendered (sort-applied)
   *  order every time that order changes. Parent uses this to drive
   *  Up/Down arrow-key navigation over the same rows the operator
   *  sees, so arrows stay in sync with column-sort clicks. */
  onVisibleRunsChange?: (ids: number[]) => void;
}

type SortKey = 'Name' | 'area' | 'Jobs' | 'Status' | 'Velocity' | 'AgentName' | 'CourierName';

/** Two-line jobs cell: total on top, incomplete on bottom.
 *  Matches legacy runList.tpl:52-54 which uses `<br/>` between the two.
 *  Inbound = pickup counts; Outbound = total-pickup counts; Combined =
 *  total counts. Defensive max(0, ...) prevents a negative bottom line
 *  on tenants with LHP < DEL edge cases. */
function jobsCell(run: BulkRun, mode: ViewMode): { top: number; bottom: number } {
  const nz = (n: number) => (n < 0 ? 0 : n);
  switch (mode) {
    case 'Inbound':
      return { top: nz(run.totalPickup), bottom: nz(run.incompletePickup) };
    case 'Outbound':
      return {
        top: nz(run.jobs - run.totalPickup),
        bottom: nz(run.incompleteJobs - run.incompletePickup),
      };
    case 'Combined':
    default:
      return { top: nz(run.jobs), bottom: nz(run.incompleteJobs) };
  }
}

/** Velocity dot: legacy renders a coloured FontAwesome icon per
 *  run.velocity string ('red' | 'orange' | 'green' | 'done'). React
 *  port uses an inline SVG dot so we don't need a FA sprite. */
function VelocityDot({ velocity }: { velocity: string | null | undefined }) {
  const v = (velocity ?? '').toLowerCase();
  if (v === 'red') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" className="text-red-500 fill-current" aria-label="Red velocity">
        <path d="M12 2 L22 20 L2 20 Z" />
      </svg>
    );
  }
  if (v === 'orange') {
    return <span className="inline-block w-3 h-3 rounded-full bg-orange-500" title="Orange velocity" />;
  }
  if (v === 'green') {
    return <span className="inline-block w-3 h-3 rounded-full bg-green-500" title="Green velocity" />;
  }
  if (v === 'done') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" className="text-gray-400 fill-current" aria-label="Done">
        <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
      </svg>
    );
  }
  return <span className="text-text-muted">-</span>;
}

function firstSuburb(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // SP emits semicolon-joined list; take the first entry for the cell,
  // full list stays in the tooltip.
  const first = trimmed.split(/[;,]/)[0].trim();
  return first || trimmed;
}

function statusClass(status: string | null | undefined): string {
  // Track C Option B (2026-06-24 deploy) added `N` = New (blue). Otherwise
  // green = READY / D / A / P / C, amber = building / in-progress /
  // pending, red = void / cancelled. Keep the mapping in one place so a
  // future palette change is a single-file edit.
  const s = (status ?? '').toUpperCase();
  if (['READY', 'D', 'A', 'P', 'C', 'ASC'].includes(s)) return 'bg-green-100 text-green-800';
  if (['N'].includes(s)) return 'bg-blue-100 text-blue-800';
  if (['V'].includes(s)) return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-800';
}

export function RvRunList({
  runs,
  selectedIds,
  onSelect,
  onContextMenu,
  viewMode,
  onViewModeChange,
  isLoading,
  runColorMap,
  onDropCourier,
  onDropRunJobs,
  onVisibleRunsChange,
}: Props) {
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('Name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sorted = useMemo(() => {
    const copy = runs.slice();
    copy.sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      switch (sortKey) {
        case 'Name':
          av = a.name ?? ''; bv = b.name ?? ''; break;
        case 'area':
          av = a.area ?? ''; bv = b.area ?? ''; break;
        case 'Jobs':
          av = a.jobs; bv = b.jobs; break;
        case 'Status':
          av = a.status ?? ''; bv = b.status ?? ''; break;
        case 'Velocity':
          av = a.velocity ?? ''; bv = b.velocity ?? ''; break;
        case 'AgentName':
          av = a.agentName ?? ''; bv = b.agentName ?? ''; break;
        case 'CourierName':
          av = a.courierName ?? ''; bv = b.courierName ?? ''; break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [runs, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };

  // Report the currently-visible id order whenever the sort output
  // changes. Ref-compared join string so we skip callback churn when
  // the sort is stable but the parent re-renders for other reasons.
  const lastVisibleKey = useRef<string>('');
  useEffect(() => {
    if (!onVisibleRunsChange) return;
    const ids = sorted.map((r) => r.id);
    const key = ids.join(',');
    if (key === lastVisibleKey.current) return;
    lastVisibleKey.current = key;
    onVisibleRunsChange(ids);
  }, [sorted, onVisibleRunsChange]);

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-surface-white">
        <span className="text-xs font-medium text-text-muted mr-2">View:</span>
        {(['Inbound', 'Outbound', 'Combined'] as ViewMode[]).map((m) => (
          <Button
            key={m}
            variant="neutral"
            size="sm"
            active={viewMode === m}
            onClick={() => onViewModeChange(m)}
          >
            {m}
          </Button>
        ))}
        <span className="ml-auto text-xs text-text-muted">
          {isLoading ? 'Loading...' : `${sorted.length} run${sorted.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-surface-white border-b border-border">
            <tr className="text-left text-text-muted">
              <Th onClick={() => toggleSort('Name')}>Run{sortArrow('Name')}</Th>
              <Th>From</Th>
              <Th onClick={() => toggleSort('area')}>To{sortArrow('area')}</Th>
              <Th onClick={() => toggleSort('Jobs')}>Jobs{sortArrow('Jobs')}</Th>
              <Th onClick={() => toggleSort('Status')}>Status{sortArrow('Status')}</Th>
              <Th onClick={() => toggleSort('Velocity')}>Vel{sortArrow('Velocity')}</Th>
              <Th onClick={() => toggleSort('AgentName')}>Agent/NP{sortArrow('AgentName')}</Th>
              <Th onClick={() => toggleSort('CourierName')}>Courier{sortArrow('CourierName')}</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((run) => {
              const selected = selectedIds.includes(run.id);
              const jobs = jobsCell(run, viewMode);
              // Legacy runList.tpl:40-41 column bindings:
              //   From = fromCities || pickupCity || suburbs || ''
              //   To   = toLocationName || area || ''
              // (SP `PickupCity` doesn't exist server-side; legacy
              //  falls straight to suburbs when fromCities is empty.)
              const fromValue = run.fromCities || firstSuburb(run.suburbs) || '';
              const toValue = run.toLocationName || run.area || '';
              const tint = selected ? runColorMap?.[run.id] : undefined;
              const dropHover = dropTargetId === run.id;
              return (
                <tr
                  key={run.id}
                  onClick={(e) => onSelect(run.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
                  onContextMenu={onContextMenu ? (e) => onContextMenu(e, run.id) : undefined}
                  onDragOver={(onDropCourier || onDropRunJobs) ? (e) => {
                    // Only accept a drag when the payload is one we
                    // recognise (courier row from RvCouriersBox, or a
                    // batch of job rows from the middle-pane Run Jobs
                    // table). Prevents unrelated drags (files, browser
                    // images etc.) from firing our onDrop.
                    const types = e.dataTransfer.types;
                    const wantsCourier = onDropCourier && types.includes('application/rv-courier-code');
                    const wantsJobs = onDropRunJobs && types.includes('application/rv-run-jobs');
                    if (wantsCourier || wantsJobs) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropTargetId !== run.id) setDropTargetId(run.id);
                    }
                  } : undefined}
                  onDragLeave={(onDropCourier || onDropRunJobs) ? () => {
                    if (dropTargetId === run.id) setDropTargetId(null);
                  } : undefined}
                  onDrop={(onDropCourier || onDropRunJobs) ? (e) => {
                    e.preventDefault();
                    setDropTargetId(null);
                    // Jobs payload takes precedence if both are present
                    // (shouldn't happen in normal flow but guarding
                    // keeps behaviour predictable).
                    if (onDropRunJobs) {
                      const raw = e.dataTransfer.getData('application/rv-run-jobs');
                      if (raw) {
                        try {
                          const parsed = JSON.parse(raw) as { fromRunId: number; jobIds: number[] };
                          if (parsed && Array.isArray(parsed.jobIds) && parsed.jobIds.length > 0) {
                            onDropRunJobs(run.id, parsed.fromRunId, parsed.jobIds);
                            return;
                          }
                        } catch { /* malformed payload - fall through */ }
                      }
                    }
                    if (onDropCourier) {
                      const code = e.dataTransfer.getData('application/rv-courier-code');
                      if (code) onDropCourier(run.id, code);
                    }
                  } : undefined}
                  style={tint ? { backgroundColor: tint + '33' /* 20% alpha */, borderLeft: `4px solid ${tint}` } : undefined}
                  className={`cursor-pointer border-b border-border/50 ${
                    dropHover ? 'bg-emerald-100 outline outline-2 outline-emerald-400' : ''
                  } ${
                    !dropHover && (tint ? '' : selected ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60')
                  } ${run.isMissing && !tint ? 'border-l-4 border-l-amber-400' : ''}`}
                  title={run.suburbs ?? undefined}
                >
                  <td className="px-2 py-1 font-medium">
                    {run.name ?? '-'}
                    {run.preAssigned === 1 && (
                      <span className="ml-1 inline-block bg-brand-purple text-white text-[10px] px-1 rounded">P</span>
                    )}
                  </td>
                  <td className="px-2 py-1 max-w-[10rem] truncate" title={fromValue || undefined}>
                    {fromValue || <span className="text-text-muted">-</span>}
                  </td>
                  <td className="px-2 py-1 max-w-[10rem] truncate" title={toValue || undefined}>
                    {toValue || <span className="text-text-muted">-</span>}
                  </td>
                  {/* Jobs cell stacks total on top of incomplete
                      (matches legacy runList.tpl:52-54 <br/>). */}
                  <td className="px-2 py-1 leading-tight">
                    <div>{jobs.top}</div>
                    <div className="text-text-muted">{jobs.bottom}</div>
                  </td>
                  <td className="px-2 py-1">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${statusClass(run.status)}`}>
                      {run.status ?? '-'}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    <VelocityDot velocity={run.velocity} />
                  </td>
                  <td className="px-2 py-1">
                    {run.agentName || <span className="text-text-muted">-</span>}
                    {run.isNpAgent && (
                      <span className="ml-1 inline-block bg-brand-orange text-white text-[10px] px-1 rounded">NP</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {run.courierName?.trim() ? (
                      <>
                        {run.courierName}
                        {run.courierCode && <span className="text-text-muted">:{run.courierCode}</span>}
                        {run.courierPercentageFormatted && (
                          <span className="ml-1 text-text-muted">({run.courierPercentageFormatted})</span>
                        )}
                      </>
                    ) : (
                      <span className="text-text-muted">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && !isLoading && (
              <tr>
                <td className="px-3 py-6 text-center text-text-muted" colSpan={8}>
                  No runs for this date + filter combination.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <th
      className={`px-2 py-1 font-medium ${onClick ? 'cursor-pointer select-none hover:text-text-primary' : ''}`}
      onClick={onClick}
    >
      {children}
    </th>
  );
}
