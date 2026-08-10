import { useAuth } from '../../context/AuthContext';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { MultiSelect } from '../common/MultiSelect';
import { Button } from '../common/Button';

// Route Viewer Home pickDate filter row. Matches the Routes cockpit
// FiltersBar exactly (2026-08-08 standardisation): plural labels,
// shared MultiSelect dropdown with Search + Select all + Clear, matching
// `size="sm"` on every affordance so date input + dropdowns + buttons
// all sit at the same height.
//
// Admin-only fields (Client / Region + Active regions only) are hidden
// for NP users per master Section 7.4. NP sees Speed + Refresh only.

interface FilterState {
  runDate: string;
  clientIds: number[];
  regionIds: number[];
  speedIds: number[];
  activeRegionsOnly: boolean;
}

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  /** Right-side utility buttons (Print / Top Up / Layout menu). Rendered
   *  after Refresh on the far right so the whole chrome sits on one row. */
  extraActions?: React.ReactNode;
}

export function RvFilterBar({ value, onChange, onRefresh, isRefreshing, extraActions }: Props) {
  const user = useAuth();
  const { clients, regions, speeds, isLoading } = useRouteViewerLookups(value.runDate);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-border bg-surface-white">
      <label className="flex items-center gap-1 text-xs text-text-secondary">
        <span>Date</span>
        <input
          type="date"
          value={value.runDate}
          onChange={(e) => onChange({ ...value, runDate: e.target.value })}
          className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white"
        />
      </label>

      {!user.isNetworkPartner && (
        <>
          <MultiSelect
            label="Clients"
            options={clients.map((c) => ({ value: String(c.id), label: c.label ?? '(unnamed)' }))}
            selected={value.clientIds.map(String)}
            onChange={(vs) => onChange({ ...value, clientIds: vs.map(Number) })}
          />
          <MultiSelect
            label="Regions"
            options={regions.map((r) => ({ value: String(r.id), label: r.label }))}
            selected={value.regionIds.map(String)}
            onChange={(vs) => onChange({ ...value, regionIds: vs.map(Number) })}
          />
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={value.activeRegionsOnly}
              onChange={(e) => onChange({ ...value, activeRegionsOnly: e.target.checked })}
              className="accent-brand-cyan"
            />
            Active regions only
          </label>
        </>
      )}

      <MultiSelect
        label="Speeds"
        options={speeds.map((s) => ({ value: String(s.id), label: s.label }))}
        selected={value.speedIds.map(String)}
        onChange={(vs) => onChange({ ...value, speedIds: vs.map(Number) })}
      />

      <div className="ml-auto flex items-center gap-2">
        {isLoading && <span className="text-xs text-text-muted">Loading lookups...</span>}
        <Button
          variant="primary"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
        {extraActions}
      </div>
    </div>
  );
}

export type { FilterState };
