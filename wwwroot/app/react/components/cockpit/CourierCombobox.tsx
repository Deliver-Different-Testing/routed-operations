import { useEffect, useMemo, useRef, useState } from 'react';
import type { Courier } from '../../types';

interface Props {
  value: number | null;
  couriers: Courier[];
  onChange: (courierId: number | null) => void;
  disabled?: boolean;
}

/**
 * Compact typeahead courier picker for the RunList Courier column. Replaces
 * the raw `<select>` which forced operators to scroll a 100+-row native
 * dropdown to find a courier. Filters client-side against the already-loaded
 * `couriers` prop (no server call).
 *
 * Behaviour:
 *   - Input shows the currently-assigned courier's `code + displayName`
 *   - Focus opens a dropdown of all couriers; typing narrows the list
 *   - Match on `code` and `displayName` (case-insensitive)
 *   - Click / Enter selects, Escape closes without change
 *   - Backspace-empty then Enter unassigns (or click the "-" row)
 *   - List capped at 50 rows to keep the popover snappy
 */
export function CourierCombobox({ value, couriers, onChange, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value != null ? couriers.find((c) => c.courierId === value) ?? null : null;
  const selectedLabel = selected ? selected.displayName : '';

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return couriers.slice(0, 50);
    return couriers.filter((c) =>
      (c.code ?? '').toLowerCase().includes(q)
      || (c.displayName ?? '').toLowerCase().includes(q)
      || (c.firstName ?? '').toLowerCase().includes(q)
    ).slice(0, 50);
  }, [query, couriers]);

  useEffect(() => { setHi(0); }, [query, open]);

  const commit = (courierId: number | null) => {
    onChange(courierId);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const displayValue = open ? query : selectedLabel;

  return (
    <div ref={containerRef} className="relative min-w-24">
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={displayValue}
        placeholder={selected ? '' : '-'}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          if (!open) setOpen(true);
          setQuery(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); setQuery(''); inputRef.current?.blur(); return; }
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(i + 1, filtered.length)); return; }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); return; }
          if (e.key === 'Enter') {
            e.preventDefault();
            // Row 0 = "-" (unassign), rows 1..N = filtered[i-1]
            if (hi === 0) commit(null);
            else {
              const pick = filtered[hi - 1];
              if (pick) commit(pick.courierId);
            }
          }
        }}
        className="w-full text-xs border border-border rounded px-1 py-0.5 focus:outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan"
        title="Type to filter couriers"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-0.5 left-0 min-w-40 max-h-64 overflow-auto bg-surface-white border border-border rounded shadow-lg text-xs"
          onMouseDown={(e) => e.preventDefault()}
        >
          <li
            role="option"
            aria-selected={value == null}
            onMouseDown={(e) => { e.preventDefault(); commit(null); }}
            className={`px-2 py-1 cursor-pointer italic text-text-muted ${
              hi === 0 ? 'bg-brand-cyan/15' : 'hover:bg-brand-cyan/10'
            }`}
          >
            - unassign
          </li>
          {filtered.length === 0 && (
            <li className="px-2 py-1 text-text-muted">No matching couriers.</li>
          )}
          {filtered.map((c, idx) => (
            <li
              key={c.courierId}
              role="option"
              aria-selected={value === c.courierId}
              onMouseDown={(e) => { e.preventDefault(); commit(c.courierId); }}
              className={`px-2 py-1 cursor-pointer ${
                hi === idx + 1 ? 'bg-brand-cyan/15'
                  : value === c.courierId ? 'bg-brand-cyan/10'
                  : 'hover:bg-brand-cyan/10'
              }`}
            >
              {c.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
