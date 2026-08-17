import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './Button';

// Single-select dropdown that visually matches MultiSelect so the two
// affordances read as a set. Used where downstream logic requires
// exactly one selection (Route Viewer Region + Courier per pickDate
// spec) but the operator still expects the same pill-button trigger,
// search, and dropdown panel as the multi-select siblings on the same
// row.
export interface SingleSelectOption { value: string; label: string; }

interface Props {
  label: string;
  options: SingleSelectOption[];
  selected: string | null;
  onChange: (value: string | null) => void;
  /** Text for the "no selection" affordance at the top of the list
   *  (e.g. "All regions" / "All couriers"). Also used as the trigger
   *  title when nothing is selected. */
  clearLabel?: string;
  /** Optional min-width tweak. Defaults to 8rem (matches MultiSelect). */
  minWidth?: string;
}

export function SingleSelect({
  label,
  options,
  selected,
  onChange,
  clearLabel,
  minWidth = '8rem',
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
    setSearch('');
  };

  const selectedOption = options.find((o) => o.value === selected) ?? null;
  const triggerLabel = selectedOption
    ? `${label}: ${selectedOption.label}`
    : label;
  // Default plural: append 's' unless the label already ends in one. Any
  // ambiguous case (Fleet -> Fleets vs Company -> Companies) can pass an
  // explicit clearLabel.
  const defaultClear = `All ${label.toLowerCase()}${label.toLowerCase().endsWith('s') ? '' : 's'}`;
  const clearText = clearLabel ?? defaultClear;

  return (
    <div className="relative" ref={wrapperRef}>
      <Button
        variant="neutral"
        size="sm"
        active={selected != null}
        onClick={() => setOpen((v) => !v)}
        className="text-left flex items-center justify-between gap-2"
        style={{ minWidth }}
        title={selectedOption ? selectedOption.label : clearText}
      >
        <span className="truncate">{triggerLabel}</span>
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

          <ul className="max-h-64 overflow-y-auto">
            <li>
              <button
                type="button"
                onClick={() => pick(null)}
                className={`w-full text-left px-3 py-1.5 hover:bg-surface-cream text-xs ${
                  selected == null ? 'bg-surface-cream font-medium' : 'text-text-muted'
                }`}
              >
                {clearText}
              </button>
            </li>
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-text-muted italic">
                {options.length === 0 ? 'No options.' : 'No matches.'}
              </li>
            )}
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => pick(o.value)}
                  className={`w-full text-left px-3 py-1.5 hover:bg-surface-cream ${
                    selected === o.value ? 'bg-surface-cream font-medium' : ''
                  }`}
                >
                  <span className="block truncate" title={o.label}>{o.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
