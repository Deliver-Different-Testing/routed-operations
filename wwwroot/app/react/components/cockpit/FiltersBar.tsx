import { useEffect, useMemo, useRef, useState } from 'react';
import type { JobFilters, Region, Speed } from '../../types';
import { Button } from '../common/Button';

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

/**
 * Checkbox-based multi-select dropdown. Replaces the native `<select multiple>`
 * which was too tall to be useful (one option visible at a time) and required
 * Ctrl+click to multi-select - both fatal usability problems the operator
 * flagged.
 *
 * Trigger: pill-style button showing "Label (N)" when values are selected,
 *          "Label" when everything is included (empty = all).
 * Panel: fixed-height scrollable list, search input at top, Select all /
 *        Clear affordances, checkbox next to each option.
 * Close: click outside, Escape, or click the trigger again.
 *
 * Legacy analogue: the multi-select portions of pickDateForm.tpl with the
 * search + checkbox pattern.
 */
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, search]);

  // Click-outside + Escape close the panel.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (v: string) => {
    if (selectedSet.has(v)) onChange(selected.filter((s) => s !== v));
    else onChange([...selected, v]);
  };
  const selectAll = () => onChange(options.map((o) => o.value));
  const clearAll = () => onChange([]);

  const triggerLabel = selected.length === 0
    ? `${label}`
    : `${label} (${selected.length})`;

  return (
    <div className="relative" ref={wrapperRef}>
      <Button
        variant="neutral"
        size="sm"
        active={selected.length > 0}
        onClick={() => setOpen((v) => !v)}
        className="min-w-[8rem] text-left flex items-center justify-between gap-2"
        title={selected.length
          ? selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ')
          : `All ${label.toLowerCase()}`}
      >
        <span>{triggerLabel}</span>
        <span className="text-text-muted text-[10px]">{open ? '▲' : '▼'}</span>
      </Button>

      {open && (
        <div className="absolute z-40 mt-1 min-w-[16rem] max-w-[24rem] bg-surface-white border border-border rounded shadow-lg text-sm">
          <div className="p-2 border-b border-border-light flex gap-1">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="flex-1 border border-border rounded px-2 py-1 text-xs"
            />
          </div>

          <div className="flex gap-2 px-2 py-1 border-b border-border-light bg-surface-cream text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="text-brand-purple hover:underline"
              disabled={filtered.length === 0}
            >
              Select all{search.trim() ? ' (visible)' : ''}
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-text-muted hover:text-error hover:underline ml-auto"
              disabled={selected.length === 0}
            >
              Clear
            </button>
          </div>

          <ul className="max-h-64 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-text-muted italic">
                {options.length === 0 ? 'No options.' : 'No matches.'}
              </li>
            )}
            {filtered.map((o) => (
              <li key={o.value}>
                <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-cream cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(o.value)}
                    onChange={() => toggle(o.value)}
                  />
                  <span className="flex-1 truncate" title={o.label}>{o.label}</span>
                </label>
              </li>
            ))}
          </ul>

          {selected.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border-light bg-surface-cream text-[11px] text-text-muted">
              {selected.length} of {options.length} selected
            </div>
          )}
        </div>
      )}
    </div>
  );
}
