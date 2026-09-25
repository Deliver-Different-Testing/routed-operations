import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { useRouteViewerLookups } from '../../hooks/queries/useRouteViewerLookups';
import { routeViewerService } from '../../services/routeViewerService';
import { MultiSelect } from '../common/MultiSelect';
import { SingleSelect } from '../common/SingleSelect';
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
  /** Legacy pickDate.tpl `onlyAvailableCouriers`. When true, the
   *  Couriers box narrows its list to drivers whose isAvailable flag
   *  is set for the day. Client-side filter over the loaded feed - no
   *  backend round-trip. Admin-only affordance (NP doesn't see the
   *  Couriers box). */
  availableCouriersOnly: boolean;
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
  // Tenant id in the key (2026-09-04) so a hub tenant-switch on the
  // shared cookie can't leak one tenant's courier list into another.
  // See useRouteViewerLookups for the full rationale.
  const courierList = useQuery({
    queryKey: ['rv-filter-couriers', user.currentTenantId ?? 0, value.runDate],
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
          {/* Region is single-select per master spec (downstream metrics
              assume the "one region view at a time" invariant).
              SingleSelect matches the MultiSelect trigger styling so the
              whole filter row reads as a set. */}
          <SingleSelect
            label="Region"
            options={regions.map((r) => ({ value: String(r.id), label: r.label }))}
            selected={value.regionIds[0] != null ? String(value.regionIds[0]) : null}
            onChange={(v) => onChange({
              ...value,
              regionIds: v ? [Number(v)] : [],
            })}
            clearLabel="All regions"
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

      {!user.isNetworkPartner && (
        <SingleSelect
          label="Courier"
          options={(courierList.data ?? []).map((c) => ({
            value: String(c.courierId),
            label: `${c.name} (${c.code})`,
          }))}
          selected={value.courierId != null ? String(value.courierId) : null}
          onChange={(v) => onChange({
            ...value,
            courierId: v ? Number(v) : null,
          })}
          clearLabel="All couriers"
        />
      )}

      {!user.isNetworkPartner && (
        <label className="flex items-center gap-1 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={value.availableCouriersOnly}
            onChange={(e) => onChange({ ...value, availableCouriersOnly: e.target.checked })}
            className="accent-brand-cyan"
          />
          Available Couriers Only
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
