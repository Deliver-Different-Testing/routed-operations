import { useEffect, useMemo, useRef, useState } from 'react';

// Multi-select depot picker for the Schedules NEW list filter.
// Same pattern as ClientMultiPicker (trigger button + dropdown panel
// with a local search + checkbox list + Clear/Done footer), but the
// options are a local string[] (depot names) - no server search - so
// it's simpler and instant. Filter semantics: a schedule row passes
// if pickupDepotName OR regionName matches ANY selected depot; empty
// selection = all depots (no filter applied).

interface Props {
  /** Currently selected depot names. Controlled by parent. */
  selected: string[];
  /** Full list of depot names available for the current tenant. */
  options: string[];
  onChange: (names: string[]) => void;
  /** Trigger button text when nothing is selected. */
  placeholder?: string;
  /** Fixed width for the trigger button (Tailwind class). */
  triggerWidth?: string;
  /** Label rendered inside the panel header. */
  panelTitle?: string;
}

export function DepotMultiPicker({
  selected,
  options,
  onChange,
  placeholder = 'All depots',
  triggerWidth = 'w-56',
  panelTitle,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on click-outside + Escape.
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

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (name: string) => {
    if (selectedSet.has(name)) onChange(selected.filter((v) => v !== name));
    else onChange([...selected, name]);
  };
  const clearAll = () => onChange([]);

  // Client-side substring match on the local depot list. Case-insensitive.
  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const needle = search.trim().toLowerCase();
    return options.filter((n) => n.toLowerCase().includes(needle));
  }, [options, search]);

  const triggerLabel = useMemo(() => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) return selected[0];
    return `${selected.length} depots`;
  }, [selected, placeholder]);

  return (
    <div ref={wrapperRef} className={`relative ${triggerWidth}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between pl-2 pr-1 py-1 text-xs border border-border rounded bg-surface-white text-left focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
      >
        <span className={selected.length === 0 ? 'text-text-muted' : 'text-text-primary'}>
          {triggerLabel}
        </span>
        <span className="text-text-muted text-xs">▼</span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-30 w-64 bg-surface-white border border-border rounded shadow-lg"
          data-testid="depot-multi-picker-panel"
        >
          {panelTitle && (
            <div className="px-3 pt-3 pb-2 text-xs uppercase tracking-wide text-text-muted">
              {panelTitle}
            </div>
          )}
          <div className="p-2 border-b border-border-light">
            <input
              type="search"
              autoFocus
              placeholder="Search depots..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
            />
          </div>

          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="p-3 text-xs text-text-muted text-center">
                {options.length === 0 ? 'No depots defined.' : 'No depots match.'}
              </div>
            )}
            {filtered.map((name) => {
              const isChecked = selectedSet.has(name);
              return (
                <label
                  key={name}
                  className="flex items-center gap-2 px-3 py-2 text-sm border-b border-border-light last:border-b-0 hover:bg-surface-light cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(name)}
                    className="accent-brand-cyan"
                  />
                  <span className="flex-1 text-text-primary">{name}</span>
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-t border-border-light bg-surface-cream text-xs">
            <span className="text-text-muted">
              {selected.length === 0 ? 'Nothing selected' : `${selected.length} selected`}
            </span>
            <div className="flex gap-2">
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="text-text-secondary hover:text-text-primary underline"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-text-secondary hover:text-text-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
