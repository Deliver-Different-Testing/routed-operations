import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { routeViewerService } from '../../services/routeViewerService';
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
  courierId: number | null;
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
  // Audit 7.4: courier filter. Fetch active couriers for the day so
  // operators can narrow the Run List to jobs assigned to a specific
  // courier. Only shown to admin (NP operators can't see other NPs).
  const courierList = useQuery({
    queryKey: ['rv-filter-couriers', value.runDate],
    queryFn: () => routeViewerService.getActiveCouriers(value.runDate),
    enabled: !user.isNetworkPartner && !!value.runDate,
    staleTime: 30_000,
  });

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
          {/* Tier-3 item 17: Region is single-select per master spec.
              Native <select> instead of MultiSelect so operators can't
              stack multiple regions (breaks the "one region view at a
              time" invariant that downstream metrics assume). */}
          <label className="flex items-center gap-1 text-xs text-text-muted">
            <span>Region</span>
            <select
              value={value.regionIds[0] != null ? String(value.regionIds[0]) : ''}
              onChange={(e) => onChange({
                ...value,
                regionIds: e.target.value ? [Number(e.target.value)] : [],
              })}
              className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white"
            >
              <option value="">All regions</option>
              {regions.map((r) => (
                <option key={r.id} value={String(r.id)}>{r.label}</option>
              ))}
            </select>
          </label>
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

      {!user.isNetworkPartner && (
        <label className="flex items-center gap-1 text-xs text-text-muted">
          <span>Courier</span>
          <select
            value={value.courierId != null ? String(value.courierId) : ''}
            onChange={(e) => onChange({
              ...value,
              courierId: e.target.value ? Number(e.target.value) : null,
            })}
            className="border border-border rounded px-2 py-0.5 text-xs bg-surface-white"
          >
            <option value="">All couriers</option>
            {(courierList.data ?? []).map((c) => (
              <option key={c.courierId} value={String(c.courierId)}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </label>
      )}

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
