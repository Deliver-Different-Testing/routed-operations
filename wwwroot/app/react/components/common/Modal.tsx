type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | '6xl' | '7xl';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Modal max-width. Defaults to 'lg'. */
  size?: ModalSize;
  /** When true, dims the modal body + shows a centered spinner. */
  loading?: boolean;
  /** Text shown under the spinner when loading is true. */
  loadingMessage?: string;
}

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'lg',
  loading = false,
  loadingMessage,
}: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-brand-dark/40 flex items-center justify-center z-40"
      onClick={onClose}
      data-modal-open="true"
    >
      <div
        className={`relative bg-surface-white rounded-lg shadow-lg ${SIZE_CLASS[size]} w-full mx-4 max-h-[90vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light shrink-0">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary disabled:opacity-40"
            aria-label="Close"
            disabled={loading}
          >
            X
          </button>
        </div>
        <div className="px-4 py-4 overflow-auto flex-1">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-border-light bg-surface-cream shrink-0">{footer}</div>}
        {loading && (
          // Full-modal overlay mirrors BulkImportHyper's `<div class="loading">`
          // pattern (homeControl.js sets $scope.loadingMessage before every
          // long-running step). Prevents interaction with the underlying
          // controls while a network request or heavy compute is running.
          <div
            className="absolute inset-0 bg-surface-white/85 rounded-lg flex items-center justify-center z-10"
            aria-busy="true"
            aria-live="polite"
          >
            <div className="flex flex-col items-center gap-3 max-w-md text-center px-4">
              <div className="w-10 h-10 border-4 border-brand-cyan/30 border-t-brand-cyan rounded-full animate-spin" />
              {loadingMessage && (
                <p className="text-sm text-text-primary">{loadingMessage}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
