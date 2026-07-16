import type { JobFilters, Region, Speed } from '../../types';

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
    <div className="flex items-center gap-3 px-3 py-2 bg-surface-white border-b border-border flex-wrap">
      <label className="text-sm text-text-secondary flex items-center gap-1">
        Date
        <input
          type="date"
          value={filters.date}
          onChange={(e) => onChange({ date: e.target.value })}
          className="border border-border rounded px-2 py-1 text-sm"
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

      <button
        type="button"
        onClick={onRefresh}
        className="px-3 py-1 text-sm bg-brand-cyan text-brand-dark font-medium rounded hover:shadow-cyan-glow"
      >
        Refresh
      </button>
      <button
        type="button"
        onClick={onSyncHd}
        className="px-3 py-1 text-sm bg-brand-purple text-white font-medium rounded hover:bg-brand-purple/90"
      >
        Sync EH/HD
      </button>
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label className="text-sm text-text-secondary flex items-center gap-1">
      {label}
      <select
        multiple
        value={selected}
        onChange={(e) =>
          onChange(Array.from(e.target.selectedOptions).map((o) => o.value))
        }
        className="border border-border rounded px-2 py-1 text-sm min-w-[8rem] h-8"
        title={selected.length ? `${selected.length} selected` : `All ${label.toLowerCase()}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
