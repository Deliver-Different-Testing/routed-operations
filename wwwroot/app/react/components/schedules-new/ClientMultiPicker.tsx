import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { scheduleService } from '../../services/scheduleService';

// Async-loaded multi-select client picker for the Schedules NEW page.
// Powers the "View as" filter (multi-client union) + the Attach
// Clients modal (single schedule's client set).
//
// Behaviour Kevin asked for:
//   - Opens showing the first 50 clients alphabetically.
//   - Live server-side search when the operator types (250ms
//     debounce). Backend endpoint /api/schedules/clients caps at 50
//     rows per response.
//   - Checkbox per row; ticked = in the selection set.
//   - Selection persists across searches (a picked client stays in
//     the "selected" set even when it drops out of the current
//     search hits).
//   - Trigger button reports "N selected" or the plural label.
//   - Optional per-row disabled-with-hint (e.g. "already attached",
//     "has own override #1051") for the Attach Clients modal use.

export interface ClientOption {
  id: number;
  name: string;
}

export interface ClientHint {
  /** When set, disables the row and renders the text after the name. */
  disabled?: boolean;
  hint?: string;
  /** When true, the row starts pre-checked. Used by Attach modal to
   *  show already-attached clients. */
  preChecked?: boolean;
}

interface Props {
  /** Currently selected client ids. Controlled by parent. */
  selected: number[];
  onChange: (ids: number[]) => void;
  /** Trigger button text when nothing is selected. */
  placeholder?: string;
  /** Extra per-client hints (already attached, has override, etc). */
  hintsById?: Map<number, ClientHint>;
  /** Fixed width for the trigger button (Tailwind class). */
  triggerWidth?: string;
  /** Label rendered inside the panel header. */
  panelTitle?: string;
}

export function ClientMultiPicker({
  selected,
  onChange,
  placeholder = 'All clients',
  hintsById,
  triggerWidth = 'w-56',
  panelTitle,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  // Client details cached by id so the trigger label + hint list can
  // resolve names even after the current search evicts a row.
  const [known, setKnown] = useState<Map<number, ClientOption>>(new Map());
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Debounce the search input so we don't fire a fetch per keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  // Load first-50 on open + on every debounced-search change.
  const q = useQuery({
    queryKey: ['schedules-v2-client-picker', debounced],
    queryFn: () => scheduleService.searchClients(debounced, 50).then((r) => r.response),
    enabled: open,
    staleTime: 30_000,
  });

  // Merge new results into the "known" cache so labels stay resolved.
  useEffect(() => {
    if (!q.data) return;
    setKnown((prev) => {
      const next = new Map(prev);
      for (const o of q.data!) next.set(o.id, o);
      return next;
    });
  }, [q.data]);

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
  const toggle = (id: number) => {
    if (selectedSet.has(id)) onChange(selected.filter((v) => v !== id));
    else onChange([...selected, id]);
  };
  const clearAll = () => onChange([]);

  // Trigger label: N selected, or the first name + overflow.
  const triggerLabel = useMemo(() => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) {
      const first = known.get(selected[0]);
      return first?.name ?? `#${selected[0]}`;
    }
    return `${selected.length} clients`;
  }, [selected, known, placeholder]);

  const options = q.data ?? [];

  return (
    <div ref={wrapperRef} className={`relative ${triggerWidth}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between pl-3 pr-2 py-1.5 text-sm border border-border rounded bg-surface-white text-left focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
      >
        <span className={selected.length === 0 ? 'text-text-muted' : 'text-text-primary'}>
          {triggerLabel}
        </span>
        <span className="text-text-muted text-xs">▼</span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-30 w-80 bg-surface-white border border-border rounded shadow-lg"
          data-testid="client-multi-picker-panel"
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
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-brand-cyan/40"
            />
          </div>

          <div className="max-h-72 overflow-y-auto">
            {q.isLoading && (
              <div className="p-3 text-xs text-text-muted text-center">Loading...</div>
            )}
            {!q.isLoading && options.length === 0 && (
              <div className="p-3 text-xs text-text-muted text-center">No clients match.</div>
            )}
            {options.map((c) => {
              const hint = hintsById?.get(c.id);
              const isDisabled = hint?.disabled ?? false;
              const isChecked = selectedSet.has(c.id) || (hint?.preChecked ?? false);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-2 px-3 py-2 text-sm border-b border-border-light last:border-b-0 ${
                    isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-light cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => !isDisabled && toggle(c.id)}
                    className="accent-brand-cyan"
                  />
                  <span className="flex-1 text-text-primary">{c.name}</span>
                  {hint?.hint && (
                    <span className="text-[10px] text-text-muted">{hint.hint}</span>
                  )}
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
