import { useEffect, useMemo, useRef, useState } from 'react';
import type { BulkRun } from '../../services/routeViewerService';
import { RvBox } from './RvBox';

// Slimmed 6-column run-list variant used by Pre Assigned / Returns /
// Exceptions boxes (master Sections 7.6 / 7.7 / 7.8). Same row shape
// (Run / Area / To / Jobs / Status / Courier) as the primary Run List.
//
// Legacy preRunList / returnList / exceptions .tpl each expose header
// click-to-sort per column - a real UX regression if we drop it. Sort
// is per-instance (state lives in this component) so each slim box
// remembers its own column + direction independently.
//
// The filter that produces each variant is applied client-side against
// the same BulkRun[] the parent already has - the SP does not have a
// dedicated preAssign / returns / exceptions branch. Reasonable given
// tenants of the current size; if the row count on any run-date gets
// >5,000 we push the filter into the SP.

type Variant = 'preAssigned' | 'returns' | 'exceptions';

interface Props {
  variant: Variant;
  runs: BulkRun[];
  selectedIds: number[];
  onSelect: (id: number, mods: { ctrl: boolean; shift: boolean }) => void;
  onContextMenu?: (e: React.MouseEvent, id: number) => void;
  /** Audit item 19: per-run tint keyed by run id, populated only when
   *  the operator has 2+ runs selected. Matches the primary Run List
   *  tint behaviour (RvRunList) so rows across Pre Assigned / Returns /
   *  Exceptions line up with the same-coloured map pins. */
  runColorMap?: Record<number, string>;
  /** Reports the filtered id list every time it changes so the parent
   *  can drive Up/Down arrow-key navigation over the same rows the
   *  operator sees. */
  onVisibleRunsChange?: (ids: number[]) => void;
}

const TITLES: Record<Variant, string> = {
  preAssigned: 'Pre Assigned List',
  returns: 'Returns / Redeliveries List',
  exceptions: 'Exceptions List',
};

function filterRuns(runs: BulkRun[], variant: Variant): BulkRun[] {
  switch (variant) {
    case 'preAssigned':
      // preAssigned flag on the row (SP emits 0/1 int, not bool).
      return runs.filter((r) => r.preAssigned === 1);
    case 'returns':
      return runs.filter((r) => r.hasReturns);
    case 'exceptions':
      // "Missing" marker or 0-active runs land here. Kept broad because
      // the legacy exception definition is fuzzy (Section 7.8 has no
      // strict predicate); operator can right-click to reset.
      return runs.filter((r) => r.isMissing || r.status === 'V');
  }
}

type SortKey = 'name' | 'area' | 'to' | 'jobs' | 'status' | 'courier';

/** Extract the sort value for a run under the given column. Keeps the
 *  same fallback shape the cells render (first suburb for `to`,
 *  jobs-remaining-percent for `jobs`) so the sorted order lines up with
 *  what the operator sees on screen. */
function sortValue(r: BulkRun, key: SortKey): string | number {
  switch (key) {
    case 'name':    return (r.name ?? '').toLowerCase();
    case 'area':    return (r.area ?? '').toLowerCase();
    case 'to':      return ((r.suburbs ?? '').split(/[;,]/)[0].trim() || '').toLowerCase();
    case 'jobs':    return r.jobs;
    case 'status':  return (r.status ?? '').toLowerCase();
    case 'courier': return (r.courierName ?? '').toLowerCase();
  }
}

export function RvRunListLite({ variant, runs, selectedIds, onSelect, onContextMenu, runColorMap, onVisibleRunsChange }: Props) {
  // Per-instance sort state. Each slim box remembers its own column +
  // direction so an operator sorting Preassigned by Courier does not
  // scramble Returns' default alphabetical order.
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  };

  const filtered = filterRuns(runs, variant);
  const sorted = useMemo(() => {
    const copy = filtered.slice();
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const lastVisibleKey = useRef<string>('');
  useEffect(() => {
    if (!onVisibleRunsChange) return;
    const ids = sorted.map((r) => r.id);
    const key = ids.join(',');
    if (key === lastVisibleKey.current) return;
    lastVisibleKey.current = key;
    onVisibleRunsChange(ids);
    // sorted is recomputed each render; the key check above debounces
    // callback churn to when the id list actually changes.
  });

  const arrow = (k: SortKey) => (sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const thClass = 'px-2 py-1 cursor-pointer select-none hover:text-text-primary';

  return (
    <RvBox title={TITLES[variant]}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-white border-b border-border">
          <tr className="text-left text-text-muted">
            <th className={thClass} onClick={() => toggleSort('name')}>Run{arrow('name')}</th>
            <th className={thClass} onClick={() => toggleSort('area')}>Area{arrow('area')}</th>
            <th className={thClass} onClick={() => toggleSort('to')}>To{arrow('to')}</th>
            <th className={thClass} onClick={() => toggleSort('jobs')}>Jobs{arrow('jobs')}</th>
            <th className={thClass} onClick={() => toggleSort('status')}>Status{arrow('status')}</th>
            <th className={thClass} onClick={() => toggleSort('courier')}>Courier{arrow('courier')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const selected = selectedIds.includes(r.id);
            // Only tint when the row is one of the currently-selected
            // runs; unselected rows keep the default hover behaviour so
            // the operator can still tell which extra rows exist.
            const tint = selected ? runColorMap?.[r.id] : undefined;
            return (
              <tr
                key={r.id}
                onClick={(e) => onSelect(r.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
                onContextMenu={onContextMenu ? (e) => onContextMenu(e, r.id) : undefined}
                style={tint ? { backgroundColor: tint + '33' /* 20% alpha */, borderLeft: `4px solid ${tint}` } : undefined}
                className={`cursor-pointer border-b border-border/50 ${
                  tint ? '' : selected ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60'
                }`}
              >
                <td className="px-2 py-1 font-medium">{r.name ?? '-'}</td>
                <td className="px-2 py-1">{r.area ?? '-'}</td>
                <td className="px-2 py-1 max-w-[6rem] truncate" title={r.suburbs ?? undefined}>
                  {r.suburbs?.split(/[;,]/)[0].trim() || '-'}
                </td>
                <td className="px-2 py-1">{r.jobs - r.incompleteJobs}/{r.jobs}</td>
                <td className="px-2 py-1">{r.status ?? '-'}</td>
                <td className="px-2 py-1">{r.courierName ?? '-'}</td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td className="px-3 py-4 text-center text-text-muted" colSpan={6}>
                None.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </RvBox>
  );
}
