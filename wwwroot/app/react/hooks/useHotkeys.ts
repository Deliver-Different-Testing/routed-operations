import { useEffect, useRef } from 'react';

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
  // Enter key inside inputs = native form-submit, so we only fire this when
  // no input is focused. Handler should trigger the currently open modal's
  // primary button (Save / Build / Confirm / etc). Legacy analogue:
  // gather.submit() bound to the Enter hotkey.
  onEnter?: () => void;
  // P2.3 arrow-key row navigation. Legacy homeView.html:341-348 wires ng-keydown
  // 38/40 (Up/Down) to prev/next row in the active pane. Suppressed when the
  // operator is typing into an input so the arrows still move the caret.
  onArrowUp?: () => void;
  onArrowDown?: () => void;
}

export function useHotkeys(bindings: Hotkeys) {
  // Ref pattern so we bind document.keydown ONCE on mount instead of
  // unbind/rebind on every parent render. Callers pass inline arrows without
  // useCallback and it still stays cheap.
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    const isEditing = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const onKey = (e: KeyboardEvent) => {
      const b = ref.current;
      // Esc closes modals - fire even from inside inputs so operators can
      // dismiss a "Fix GPS" dialog without clicking away first.
      if (e.key === 'Escape') {
        if (b.onEscape) {
          e.preventDefault();
          b.onEscape();
        }
        return;
      }

      // The rest suppress default browser behaviour (Ctrl+D bookmark,
      // Ctrl+A select-all-text, Del delete-char), so we only fire when
      // the operator isn't typing into a field.
      if (isEditing(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (b.onDispatch) {
          e.preventDefault();
          b.onDispatch();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (b.onSelectAll) {
          e.preventDefault();
          b.onSelectAll();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (b.onDelete) {
          e.preventDefault();
          b.onDelete();
        }
        return;
      }
      if (e.key === 'Enter') {
        if (b.onEnter) {
          e.preventDefault();
          b.onEnter();
        }
        return;
      }
      // P2.3 arrow-key row navigation. Fired only when the operator isn't
      // typing (already handled by isEditing above) and only when a handler is
      // registered - otherwise the browser's native scroll wins so operators
      // can still scroll the map / tables with arrows.
      if (e.key === 'ArrowUp') {
        if (b.onArrowUp) {
          e.preventDefault();
          b.onArrowUp();
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        if (b.onArrowDown) {
          e.preventDefault();
          b.onArrowDown();
        }
        return;
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
