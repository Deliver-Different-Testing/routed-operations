import type { BulkRun } from '../../services/routeViewerService';
import { RvBox } from './RvBox';

// Slimmed 6-column run-list variant used by Pre Assigned / Returns /
// Exceptions boxes (master Sections 7.6 / 7.7 / 7.8). Same row shape
// (Run / Area / To / Jobs / Status / Courier) but no view-mode toggle,
// no column sort, no selection - each box has ONE purpose. Rows are
// still clickable so the operator can drill through into the run's
// jobs middle-pane like the primary Run List does.
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

export function RvRunListLite({ variant, runs, selectedIds, onSelect, onContextMenu }: Props) {
  const filtered = filterRuns(runs, variant);
  return (
    <RvBox title={TITLES[variant]}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-white border-b border-border">
          <tr className="text-left text-text-muted">
            <th className="px-2 py-1">Run</th>
            <th className="px-2 py-1">Area</th>
            <th className="px-2 py-1">To</th>
            <th className="px-2 py-1">Jobs</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1">Courier</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {
            const selected = selectedIds.includes(r.id);
            return (
              <tr
                key={r.id}
                onClick={(e) => onSelect(r.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
                onContextMenu={onContextMenu ? (e) => onContextMenu(e, r.id) : undefined}
                className={`cursor-pointer border-b border-border/50 ${
                  selected ? 'bg-brand-cyan/20' : 'hover:bg-surface-cream/60'
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
          {filtered.length === 0 && (
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
