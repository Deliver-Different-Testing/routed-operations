import { useEffect, useRef, useState, type ReactNode } from 'react';

interface FilterDropdownProps {
  /** Small uppercase caption before the value, e.g. "Used by". */
  caption: string;
  /** Current value text, e.g. "Any app". */
  value: string;
  /** Set filters turn the pill cyan (spec 4.4.1). */
  active?: boolean;
  /** Accessible name for the pill button. */
  ariaLabel?: string;
  /** Popover content. Receives close() so an item can dismiss it. */
  children: (close: () => void) => ReactNode;
  /** Popover min width in px. */
  width?: number;
  testId?: string;
}

/** Pill button with a popover underneath (Design B dropdowns). Closes on an
 *  outside click or Esc. The popover content is only mounted while open,
 *  so its tick boxes do not crowd the page's accessible tree. */
export function FilterDropdown({ caption, value, active = false, ariaLabel, children, width = 260, testId }: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block" data-testid={testId}>
      <button type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true" aria-expanded={open}
        aria-label={ariaLabel ?? `${caption}: ${value}`}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs whitespace-nowrap ${
          active
            ? 'border-brand-cyan bg-brand-cyan/15 text-brand-dark'
            : 'border-border bg-surface-white text-text-primary hover:border-brand-cyan'}`}>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">{caption}:</span>
        <span className="font-semibold max-w-[10rem] truncate">{value}</span>
        <span aria-hidden="true" className="text-[9px] text-text-muted">▾</span>
      </button>
      {open && (
        <div role="dialog" aria-label={caption}
          className="absolute left-0 top-full mt-1 z-50 rounded-lg border border-border bg-surface-white shadow-lg py-1 text-xs"
          style={{ minWidth: width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface DropdownCheckRowProps {
  label: string;
  checked: boolean;
  onChange: () => void;
  count?: number;
  hint?: string;
  colour?: string;
  indeterminate?: boolean;
}

/** One tick-box row inside a FilterDropdown: label, optional colour dot,
 *  one-line hint and a right-aligned count. */
export function DropdownCheckRow({ label, checked, onChange, count, hint, colour, indeterminate = false }: DropdownCheckRowProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate && !checked; }, [indeterminate, checked]);
  return (
    <label className="flex items-start gap-2 px-3 py-1.5 hover:bg-surface-cream cursor-pointer">
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange} className="mt-0.5" aria-label={label} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          {colour && <span aria-hidden="true" className="w-2 h-2 rounded-sm shrink-0" style={{ background: colour }} />}
          <span className="text-text-primary">{label}</span>
        </span>
        {hint && <span className="block text-[10px] text-text-muted leading-tight">{hint}</span>}
      </span>
      {count != null && <span className="text-[10px] text-text-muted tabular-nums">{count}</span>}
    </label>
  );
}
