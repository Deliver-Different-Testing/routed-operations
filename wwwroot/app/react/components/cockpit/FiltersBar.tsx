import type { JobFilters, Region, Speed } from '../../types';
import { Button } from '../common/Button';
import { MultiSelect } from '../common/MultiSelect';

interface ClientOption { id: number; label: string; }

interface Props {
  filters: JobFilters;
  regions: Region[];
  speeds: Speed[];
  clients: ClientOption[];
  ourRefs: string[];
  onChange: (patch: Partial<JobFilters>) => void;
  onRefresh: () => void;
  onSyncHd: () => void;
}

export function FiltersBar({ filters, regions, speeds, clients, ourRefs, onChange, onRefresh, onSyncHd }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-white border-b border-border flex-wrap text-xs">
      <label className="text-text-secondary flex items-center gap-1">
        Date
        <input
          type="date"
          value={filters.date}
          onChange={(e) => onChange({ date: e.target.value })}
          className="border border-border rounded px-2 py-0.5 text-xs"
        />
      </label>

      <MultiSelect
        label="Regions"
        options={regions.map((r) => ({ value: String(r.id), label: r.label }))}
        selected={filters.regionIds.map(String)}
        onChange={(vs) => onChange({ regionIds: vs.map(Number) })}
      />

      <MultiSelect
        label="Speeds"
        options={speeds.map((s) => ({ value: String(s.id), label: s.label }))}
        selected={filters.speeds.map(String)}
        onChange={(vs) => onChange({ speeds: vs.map(Number) })}
      />

      <MultiSelect
        label="Clients"
        options={clients.map((c) => ({ value: String(c.id), label: c.label ?? '(unnamed)' }))}
        selected={filters.clientIds.map(String)}
        onChange={(vs) => onChange({ clientIds: vs.map(Number) })}
      />

      <MultiSelect
        label="Our Ref"
        options={ourRefs.map((r) => ({ value: r, label: r }))}
        selected={filters.ourRefs}
        onChange={(vs) => onChange({ ourRefs: vs })}
      />

      <div className="flex-1" />

      <Button variant="primary" size="sm" onClick={onRefresh}>Refresh</Button>
      <Button variant="secondary" size="sm" onClick={onSyncHd}>Sync EH/HD</Button>
    </div>
  );
}

// Local MultiSelect implementation removed 2026-08-27 - it drifted from
// the shared common/MultiSelect (selectAll called options.map instead of
// filtered.map, so "Select all (visible)" selected every option regardless
// of the search filter). All four dropdowns above now use the single
// shared component that Route Viewer already uses.
