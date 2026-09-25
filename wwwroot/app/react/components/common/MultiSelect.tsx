import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button';

// Shared checkbox multi-select dropdown used by both the Route Builder
// cockpit (FiltersBar) and the Route Viewer filter row so the two
// operator surfaces feel identical. Extracted from FiltersBar in 2026
// -08-08 when Kevin asked for the Route Viewer filters to match Routes'.
//
// Trigger: pill-style button. Empty selection shows the plural label
//   ("Regions"). Any selection shows "Regions (N)" plus the active
//   ring so operators can spot filters at a glance.
// Panel: search input at top, Select all / Clear affordances, checkbox
//   row per option, "N of M selected" footer.
// Close: click outside, Escape, or click the trigger again.
export interface MultiSelectOption { value: string; label: string; }

interface Props {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  /** Optional min-width tweak. Defaults to 8rem (matches Routes). */
  minWidth?: string;
}

export function MultiSelect({ label, options, selected, onChange, minWidth = '8rem' }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle));
  }, [options, search]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
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
  const selectAll = () => onChange(filtered.map((o) => o.value));
  const clearAll = () => onChange([]);

  const triggerLabel = selected.length === 0 ? label : `${label} (${selected.length})`;

  return (
    <div className="relative" ref={wrapperRef}>
      <Button
        variant="neutral"
        size="sm"
        active={selected.length > 0}
        onClick={() => setOpen((v) => !v)}
        className="text-left flex items-center justify-between gap-2"
        style={{ minWidth }}
        title={selected.length
          ? selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ')
          : `All ${label.toLowerCase()}`}
      >
        <span>{triggerLabel}</span>
        <span className="text-text-muted text-[10px]">{open ? '▲' : '▼'}</span>
      </Button>

      {open && (
        <div className="absolute z-40 mt-1 min-w-[16rem] max-w-[24rem] bg-surface-white border border-border rounded shadow-lg text-sm">
          <div className="p-2 border-b border-border-light">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="w-full border border-border rounded px-2 py-1 text-xs"
            />
          </div>

          <div className="flex gap-2 px-2 py-1 border-b border-border-light bg-surface-cream text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="text-brand-purple hover:underline disabled:text-text-muted disabled:no-underline"
              disabled={filtered.length === 0}
            >
              Select all{search.trim() ? ' (visible)' : ''}
            </button>
            <button
              type="button"
              onClick={clearAll}
              className="text-text-muted hover:text-error hover:underline ml-auto disabled:no-underline"
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
