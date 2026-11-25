import { POLYGON_APPS, type PolygonAppCode } from '../../services/bulkPolygonService';
import { APP_META, everyHasApp, someHaveApp } from '../../lib/polygonFilters';
import { DropdownCheckRow, FilterDropdown } from './FilterDropdown';

interface BulkHeaderProps {
  /** Polygons that pass the filter (what "Select all" ticks). */
  matchingIds: number[];
  /** Ticked polygons the filter shows, with their apps. Bulk Used by acts
   *  on these only. */
  selected: { polygonId: number; apps?: PolygonAppCode[] | null }[];
  /** Ticked polygons the filter hides. Counted in the header, never written. */
  hiddenCount?: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** Add (on) or remove (off) one app on every selected polygon. */
  onSetApp: (app: PolygonAppCode, on: boolean) => void;
  busy?: boolean;
}

/** List header (spec 4.4.2): "Select all N", or with one or more ticked,
 *  "N selected · Used by: Set… ▾ · Clear". Each app is a tick box that is
 *  on when every selected polygon has it. The same tick boxes feed
 *  "Save coverage as Route". */
export function PolygonBulkHeader({ matchingIds, selected, hiddenCount = 0, onSelectAll, onClearSelection, onSetApp, busy = false }: BulkHeaderProps) {
  const total = selected.length + hiddenCount;
  if (total === 0) {
    return (
      <div className="flex items-center justify-end" data-testid="pb-bulk-header">
        <button type="button" onClick={onSelectAll} disabled={matchingIds.length === 0}
          className="text-[10px] font-semibold text-brand-cyan hover:underline disabled:opacity-40 disabled:no-underline">
          Select all {matchingIds.length}
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 py-1 rounded bg-brand-cyan/10" data-testid="pb-bulk-header">
      <span className="font-semibold text-[11px]">
        {hiddenCount > 0 ? `${total} selected (${hiddenCount} hidden by filters)` : `${total} selected`}
      </span>
      {/* With every ticked row hidden there is nothing Used by could act on. */}
      {selected.length > 0 && (
        <>
          <span aria-hidden="true" className="text-text-muted">·</span>
          <FilterDropdown caption="Used by" value={busy ? 'Saving…' : 'Set…'} width={220} testId="pb-bulk-usedby">
            {() => (
              <>
                {POLYGON_APPS.map((a) => {
                  const all = everyHasApp(selected, a);
                  return (
                    <DropdownCheckRow key={a} label={APP_META[a].label} colour={APP_META[a].colour}
                      checked={all} indeterminate={!all && someHaveApp(selected, a)}
                      onChange={() => { if (!busy) onSetApp(a, !all); }} />
                  );
                })}
              </>
            )}
          </FilterDropdown>
        </>
      )}
      <span aria-hidden="true" className="text-text-muted">·</span>
      <button type="button" onClick={onClearSelection}
        className="text-[10px] font-semibold text-brand-purple hover:underline">
        Clear
      </button>
    </div>
  );
}

/** Map legend, bottom left (spec 4.4.4). */
export function PolygonMapLegend() {
  return (
    <div data-testid="pb-map-legend"
      className="absolute left-3 bottom-6 z-10 rounded-lg border border-border bg-surface-white/95 shadow px-2.5 py-1.5 text-[10px] text-text-secondary space-y-0.5 pointer-events-none">
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-2.5 rounded-sm border-2" style={{ borderColor: '#3bc7f4', background: 'rgba(59,199,244,0.2)' }} />
        Matches filter
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-2.5 rounded-sm border" style={{ borderColor: '#9ca3af' }} />
        Doesn't match (faded)
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-4 h-2.5 rounded-sm border-2 border-dashed" style={{ borderColor: '#ef4444' }} />
        City boundary
      </div>
    </div>
  );
}
