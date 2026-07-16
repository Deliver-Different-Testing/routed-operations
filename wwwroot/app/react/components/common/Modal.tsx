interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-brand-dark/40 flex items-center justify-center z-40"
      onClick={onClose}
    >
      <div
        className="bg-surface-white rounded-lg shadow-lg max-w-lg w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            X
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && <div className="px-4 py-3 border-t border-border-light bg-surface-cream">{footer}</div>}
      </div>
    </div>
  );
}
