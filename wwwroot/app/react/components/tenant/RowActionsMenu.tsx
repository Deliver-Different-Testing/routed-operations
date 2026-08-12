import { useRef, useState } from 'react';

// Row-overflow (kebab) menu for table rows whose whole body is clickable
// (Recurring Routes Fixes 3/4). Folds the leftover action(s) (Copy, etc.)
// into a popover so a dedicated column isn't needed. The wrapper stops click
// and keydown propagation so opening the menu (or picking an item) never
// also fires the row's onClick that opens the edit panel.
//
// The popover is positioned `fixed`, anchored to the button via its bounding
// rect, so it escapes the table wrapper's `overflow-hidden` (which otherwise
// clips the menu on the last row) and flips upward when low on space.

export interface RowAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

const MENU_WIDTH = 160;
const ROW_HEIGHT = 40;

export function RowActionsMenu({ actions, label = 'Row actions' }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  if (actions.length === 0) return null;

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const estHeight = actions.length * ROW_HEIGHT + 8;
      const openUp = window.innerHeight - r.bottom < estHeight + 8;
      setCoords({
        top: openUp ? Math.max(8, r.top - estHeight - 4) : r.bottom + 4,
        left: Math.max(8, r.right - MENU_WIDTH),
      });
    }
    setOpen(true);
  };

  return (
    <div
      className="relative inline-block text-left"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={toggle}
        className="w-8 h-8 inline-flex items-center justify-center rounded-full text-text-secondary hover:bg-surface-cream hover:text-[#0d0c2c] focus:outline-none focus:ring-2 focus:ring-brand-cyan"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && coords && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: MENU_WIDTH }}
            className="z-50 rounded-lg border border-border bg-white shadow-lg py-1"
          >
            {actions.map((a) => (
              <button
                key={a.label}
                role="menuitem"
                type="button"
                onClick={() => { setOpen(false); a.onClick(); }}
                className={`flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-surface-cream ${a.danger ? 'text-red-600' : 'text-text-primary'}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
