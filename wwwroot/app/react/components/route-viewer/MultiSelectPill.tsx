import { useMemo, useRef, useState } from 'react';
import type { Lookup } from '../../services/routeViewerService';

// Minimal chip-style multi-select for the Route Viewer pickDate filter.
// Legacy RunViewer used AngularJS md-select with checkbox rows; the React
// port keeps the same UX intent (compact popover, checkbox rows, chip
// summary) without pulling in a heavy component library. If we grow into
// grouped options or typeahead search here, swap for downshift/react-select
// - the pickDate box is the only current caller and its option counts are
// small (<50).

interface Props {
  label: string;
  options: Lookup[];
  selected: number[];
  onChange: (ids: number[]) => void;
  emptyText?: string;
  className?: string;
}

export function MultiSelectPill({
  label,
  options,
  selected,
  onChange,
  emptyText = 'All',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const summary = useMemo(() => {
    if (selected.length === 0) return emptyText;
    if (selected.length === 1) {
      const one = options.find((o) => o.id === selected[0]);
      return one?.label ?? '1 selected';
    }
    return `${selected.length} selected`;
  }, [selected, options, emptyText]);

  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter((v) => v !== id));
    else onChange([...selected, id]);
  };

  const clearAll = () => onChange([]);

  return (
    <div className={`relative inline-block ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="border border-border bg-surface-white text-text-primary rounded-md px-2 py-1 text-xs flex items-center gap-1 min-w-[8rem]"
      >
        <span className="text-text-muted">{label}:</span>
        <span className="truncate">{summary}</span>
        <span className="ml-auto text-text-muted">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 bg-surface-white border border-border rounded-md shadow-lg z-20 max-h-72 overflow-auto min-w-[12rem]">
            {options.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="w-full text-left px-3 py-1.5 text-xs text-text-muted hover:bg-surface-cream border-b border-border"
              >
                Clear
              </button>
            )}
            {options.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-muted">No options</div>
            )}
            {options.map((opt) => {
              const checked = selected.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-surface-cream"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.id)}
                    className="accent-brand-cyan"
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
