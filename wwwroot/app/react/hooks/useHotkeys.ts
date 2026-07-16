import { useEffect } from 'react';

/**
 * Global keyboard shortcut hook. Mirrors the legacy hotkeys.add() bindings in
 * RunBuilder homeControl.js:687-741:
 * - Ctrl+D  -> Dispatch selected jobs
 * - Ctrl+A  -> Select all (jobs)
 * - Esc     -> Close open modal / clear selection
 * - Del     -> Remove focused job from its run
 *
 * Bindings are attached to `document`, so they fire regardless of which panel
 * has focus. Individual inputs still get first crack (browser default), we
 * only step in when the target is not an editable field.
 */
export interface Hotkeys {
  onDispatch?: () => void;
  onSelectAll?: () => void;
  onEscape?: () => void;
  onDelete?: () => void;
}

export function useHotkeys(bindings: Hotkeys) {
  useEffect(() => {
    const isEditing = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      // Esc closes modals - fire even from inside inputs so operators can
      // dismiss a "Fix GPS" dialog without clicking away first.
      if (e.key === 'Escape') {
        if (bindings.onEscape) {
          e.preventDefault();
          bindings.onEscape();
        }
        return;
      }

      // The rest suppress default browser behaviour (Ctrl+D bookmark,
      // Ctrl+A select-all-text, Del delete-char), so we only fire when
      // the operator isn't typing into a field.
      if (isEditing(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (bindings.onDispatch) {
          e.preventDefault();
          bindings.onDispatch();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (bindings.onSelectAll) {
          e.preventDefault();
          bindings.onSelectAll();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (bindings.onDelete) {
          e.preventDefault();
          bindings.onDelete();
        }
        return;
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bindings.onDispatch, bindings.onSelectAll, bindings.onEscape, bindings.onDelete]);
}
