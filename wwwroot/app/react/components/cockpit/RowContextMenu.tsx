import { useEffect } from 'react';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorAfter?: boolean;
}

interface Props {
  clientX: number | null;
  clientY: number | null;
  title?: string;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Generic row-level context menu. Panels render one of these when the
 * operator right-clicks a row, seeded with per-row action items. Closes on
 * Escape, outside click, or right-click on anything else.
 *
 * Legacy analogue: the runListMenu / runBuilderMenu / jobListMenu /
 * groupedJobsMenu / detailAddressMenu / voidRunBuilderMenu bindings in
 * homeView.html, each pointing at an angular-context-menu directive.
 */
export function RowContextMenu({ clientX, clientY, title, items, onClose }: Props) {
  useEffect(() => {
    if (clientX == null || clientY == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = () => onClose();
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    // NOTE: we deliberately do NOT listen for `contextmenu` on document here.
    // React 18 batches state updates within a single native event dispatch,
    // so a document-level contextmenu listener would fire on the very event
    // that opened this menu - the setCtx({...}) from the row handler and the
    // setCtx(null) from this listener would batch, with null winning and the
    // menu never appearing. Right-clicks on other rows REPLACE ctx atomically
    // via their own row-level handler, so no cross-menu leakage.
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [clientX, clientY, onClose]);

  if (clientX == null || clientY == null) return null;

  return (
    <ul
      className="fixed z-50 bg-surface-white border border-border rounded shadow-lg text-xs min-w-52"
      style={{ top: clientY, left: clientX }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {title && (
        <li className="px-3 py-1.5 bg-surface-cream border-b border-border-light font-medium text-text-primary">
          {title}
        </li>
      )}
      {items.map((item, i) => (
        <li key={i} className={item.separatorAfter ? 'border-b border-border-light' : ''}>
          <button
            type="button"
            disabled={item.disabled}
            onClick={() => { item.onClick(); onClose(); }}
            className={`w-full text-left px-3 py-1.5 hover:bg-surface-cream disabled:opacity-40 disabled:cursor-not-allowed ${
              item.danger ? 'text-error' : 'text-text-primary'
            }`}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
