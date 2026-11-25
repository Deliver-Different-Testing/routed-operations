import { useMemo } from 'react';
import { POLYGON_APPS } from '../../services/bulkPolygonService';
import {
  APP_META, NOT_USED, QUICK_LINKS,
  appCounts, clearFilters, isFilterActive, layerCounts, layerPillText, toggleValue, usedByPillText,
  type PolygonFilterState,
} from '../../lib/polygonFilters';
import { NO_LAYER } from '../../lib/polygonLayers';
import { DropdownCheckRow, FilterDropdown } from './FilterDropdown';

interface FilterablePolygon {
  polygonId: number;
  name: string;
  layer?: string | null;
}

interface PolygonFilterBarProps<T extends FilterablePolygon> {
  polygons: T[];
  filters: PolygonFilterState;
  onChange: (next: PolygonFilterState) => void;
  /** How many polygons pass the filter. */
  matchCount: number;
  onZoomToResults: () => void;
  /** "postcode" / "zip" for the Postcode lines toggle label. */
  zipShortLower: string;
}

/** Filter bar across the top of the Polygon Builder (perimeter spec 4.4.1,
 *  Design B). Left to right: Search, Used by, Layer, Quick links, Others,
 *  Postcode lines, "N of M", Zoom to results, Clear. Wraps on narrow
 *  screens. */
export function PolygonFilterBar<T extends FilterablePolygon>({
  polygons, filters, onChange, matchCount, onZoomToResults, zipShortLower,
}: PolygonFilterBarProps<T>) {
  const counts = useMemo(() => appCounts(polygons, filters.search), [polygons, filters.search]);
  const layers = useMemo(() => layerCounts(polygons, filters), [polygons, filters]);
  const set = (patch: Partial<PolygonFilterState>) => onChange({ ...filters, ...patch });
  const postcodeLabel = `${zipShortLower.charAt(0).toUpperCase()}${zipShortLower.slice(1)} lines`;

  return (
    <div data-testid="pb-filter-bar"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-1.5 bg-surface-white border-b border-border text-xs">
      <input type="search" value={filters.search}
        onChange={(e) => set({ search: e.target.value })}
        aria-label="Search polygons"
        placeholder="Search polygons, zones or layers"
        className="w-56 border border-border rounded-lg px-2 py-1 text-xs" />

      <FilterDropdown caption="Used by" value={usedByPillText(filters.apps)}
        active={filters.apps.length > 0} width={300} testId="pb-filter-usedby">
        {() => (
          <>
            <DropdownCheckRow label="Any app" checked={filters.apps.length === 0}
              onChange={() => set({ apps: [] })} />
            <div className="border-t border-border-light my-1" />
            {POLYGON_APPS.map((a) => (
              <DropdownCheckRow key={a} label={APP_META[a].label} hint={APP_META[a].hint}
                colour={APP_META[a].colour} count={counts[a]}
                checked={filters.apps.includes(a)}
                onChange={() => set({ apps: toggleValue(filters.apps, a) })} />
            ))}
            <div className="border-t border-border-light my-1" />
            <DropdownCheckRow label="Not used by any app" count={counts[NOT_USED]}
              checked={filters.apps.includes(NOT_USED)}
              onChange={() => set({ apps: toggleValue(filters.apps, NOT_USED) })} />
          </>
        )}
      </FilterDropdown>

      <FilterDropdown caption="Layer" value={layerPillText(filters.layers)}
        active={filters.layers.length > 0} width={220} testId="pb-filter-layer">
        {() => (
          <>
            <DropdownCheckRow label="All layers" checked={filters.layers.length === 0}
              onChange={() => set({ layers: [] })} />
            <div className="border-t border-border-light my-1" />
            {layers.map(({ layer, count }) => (
              <DropdownCheckRow key={layer === NO_LAYER ? '\u0000no-layer' : layer}
                label={layer === NO_LAYER ? 'No layer' : layer} count={count}
                checked={filters.layers.includes(layer)}
                onChange={() => set({ layers: toggleValue(filters.layers, layer) })} />
            ))}
          </>
        )}
      </FilterDropdown>

      <span className="inline-flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Quick</span>
        {QUICK_LINKS.map((q) => (
          <button key={q.app} type="button"
            onClick={() => set({ apps: [q.app] })}
            className={`font-semibold hover:underline ${filters.apps.length === 1 && filters.apps[0] === q.app ? 'text-brand-dark underline' : 'text-brand-cyan'}`}
            title={`Show only polygons used by ${APP_META[q.app].label}`}>
            {q.label}
          </button>
        ))}
      </span>

      <div className="flex-1" />

      <span className="inline-flex items-center rounded-lg border border-border overflow-hidden" role="group" aria-label="Others">
        <span className="px-2 text-[10px] uppercase tracking-wide text-text-muted">Others</span>
        {(['faded', 'hidden'] as const).map((m) => (
          <button key={m} type="button" aria-pressed={filters.others === m}
            onClick={() => set({ others: m })}
            className={`px-2 py-1 ${filters.others === m ? 'bg-brand-cyan text-brand-dark font-semibold' : 'text-text-secondary hover:bg-surface-cream'}`}
            title={m === 'faded'
              ? 'Draw polygons that do not match as thin grey outlines you cannot click'
              : 'Do not draw polygons that do not match'}>
            {m === 'faded' ? 'Faded' : 'Hidden'}
          </button>
        ))}
      </span>

      <button type="button" aria-pressed={filters.showPostcodes}
        onClick={() => set({ showPostcodes: !filters.showPostcodes })}
        className={`px-2 py-1 rounded-lg border ${filters.showPostcodes
          ? 'border-brand-cyan bg-brand-cyan/15 text-brand-dark font-semibold'
          : 'border-border text-text-secondary hover:border-brand-cyan'}`}
        title={filters.showPostcodes
          ? `${zipShortLower} boundaries are shown and auto-load as you pan. Click to hide them and stop loading more.`
          : `${zipShortLower} boundaries are hidden. Click to show them again.`}>
        {filters.showPostcodes ? '✓ ' : ''}{postcodeLabel}
      </button>

      <span data-testid="pb-filter-count" className="text-text-secondary whitespace-nowrap">
        <strong className="text-text-primary">{matchCount}</strong> of {polygons.length}
      </span>
      <button type="button" onClick={onZoomToResults} disabled={matchCount === 0}
        className="font-semibold text-brand-cyan hover:underline disabled:opacity-40 disabled:no-underline">
        {/* Same wording as the Design B mock: nothing narrowed = "all". */}
        {isFilterActive(filters) ? 'Zoom to results' : 'Zoom to all'}
      </button>
      {isFilterActive(filters) && (
        <button type="button" onClick={() => onChange(clearFilters(filters))}
          className="font-semibold text-brand-purple hover:underline"
          title="Reset search, Used by and Layer (keeps Others and the postcode lines switch)">
          Clear
        </button>
      )}
    </div>
  );
}
