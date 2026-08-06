import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Modal } from '../components/common/Modal';
import { Button } from '../components/common/Button';

// Promise-based Confirm + Alert dialogs. Replacement for window.confirm /
// window.alert - the native browser dialogs are jarring, don't match our
// visual style, and block the JS main thread. This context mounts a
// single Modal at app root; the hooks return promises that resolve when
// the operator answers.

interface ConfirmOptions {
  /** Body text (or React node). Required. */
  message: React.ReactNode;
  /** Modal title. Defaults to "Confirm". */
  title?: string;
  /** Text for the primary (confirm) action. Defaults to "OK". */
  confirmLabel?: string;
  /** Text for the secondary (cancel) action. Defaults to "Cancel". */
  cancelLabel?: string;
  /** When true, the confirm button uses the danger (red) variant.
   *  Use for destructive actions - delete, void, remove, discard. */
  danger?: boolean;
}

interface AlertOptions {
  /** Body text (or React node). Required. */
  message: React.ReactNode;
  /** Modal title. Defaults to "Notice". */
  title?: string;
  /** Text for the OK button. Defaults to "OK". */
  okLabel?: string;
}

interface ConfirmApi {
  /** Show a confirm dialog. Returns a promise that resolves to
   *  true if the operator confirms, false if they cancel / close. */
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>;
  /** Show an informational alert dialog. Returns a promise that
   *  resolves when the operator dismisses. */
  alert: (opts: AlertOptions | string) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmApi>({
  confirm: async () => false,
  alert: async () => undefined,
});

type PendingRequest =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'alert'; opts: AlertOptions; resolve: () => void };

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  // Ref mirrors state so the confirm/alert functions in the API object
  // (memoized once, see below) can peek at pending without needing to
  // be recreated on every render.
  const pendingRef = useRef<PendingRequest | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    const resolved: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => {
      // If another dialog is already pending, resolve it as cancelled
      // and replace with the new one. Rare but happens if code fires
      // two confirms back-to-back (a bug on the caller's side, but we
      // shouldn't just hang).
      if (pendingRef.current) {
        if (pendingRef.current.kind === 'confirm') pendingRef.current.resolve(false);
        else pendingRef.current.resolve();
      }
      setPending({ kind: 'confirm', opts: resolved, resolve });
    });
  }, []);

  const alert = useCallback((opts: AlertOptions | string) => {
    const resolved: AlertOptions = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise<void>((resolve) => {
      if (pendingRef.current) {
        if (pendingRef.current.kind === 'confirm') pendingRef.current.resolve(false);
        else pendingRef.current.resolve();
      }
      setPending({ kind: 'alert', opts: resolved, resolve });
    });
  }, []);

  const api = useMemo<ConfirmApi>(() => ({ confirm, alert }), [confirm, alert]);

  // Handlers close the modal + resolve the promise. onCloseCancel is
  // the default for backdrop-click / X-click on a confirm (safer than
  // proceeding).
  const closeConfirm = () => {
    if (!pending || pending.kind !== 'confirm') return;
    pending.resolve(false);
    setPending(null);
  };
  const acceptConfirm = () => {
    if (!pending || pending.kind !== 'confirm') return;
    pending.resolve(true);
    setPending(null);
  };
  const closeAlert = () => {
    if (!pending || pending.kind !== 'alert') return;
    pending.resolve();
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {pending?.kind === 'confirm' && (
        <Modal
          open={true}
          onClose={closeConfirm}
          size="md"
          title={pending.opts.title ?? 'Confirm'}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="neutral" onClick={closeConfirm}>
                {pending.opts.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                variant={pending.opts.danger ? 'danger' : 'secondary'}
                data-primary="true"
                onClick={acceptConfirm}
              >
                {pending.opts.confirmLabel ?? 'OK'}
              </Button>
            </div>
          }
        >
          <div className="text-sm text-text-primary whitespace-pre-wrap">
            {pending.opts.message}
          </div>
        </Modal>
      )}
      {pending?.kind === 'alert' && (
        <Modal
          open={true}
          onClose={closeAlert}
          size="md"
          title={pending.opts.title ?? 'Notice'}
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" data-primary="true" onClick={closeAlert}>
                {pending.opts.okLabel ?? 'OK'}
              </Button>
            </div>
          }
        >
          <div className="text-sm text-text-primary whitespace-pre-wrap">
            {pending.opts.message}
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

/** Promise-based replacement for window.confirm. Awaiting resolves
 *  to true on confirm, false on cancel / backdrop / X.
 *
 *  Usage:
 *    const confirm = useConfirm();
 *    if (!(await confirm('Remove this zip?'))) return;
 *
 *  Or with full options:
 *    if (await confirm({
 *      title: 'Delete route',
 *      message: 'This is not reversible.',
 *      confirmLabel: 'Delete',
 *      danger: true,
 *    })) { ... }
 */
export function useConfirm(): ConfirmApi['confirm'] {
  return useContext(ConfirmContext).confirm;
}

/** Promise-based replacement for window.alert. Awaiting resolves when
 *  the operator dismisses. Useful when you want to block a flow on
 *  the operator acknowledging a warning. */
export function useAlert(): ConfirmApi['alert'] {
  return useContext(ConfirmContext).alert;
}
