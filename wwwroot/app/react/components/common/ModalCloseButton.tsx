// Shared close-icon button. Uses the Configurator style: a small circular
// button with an X icon that lights up on hover. Inline modals in
// pages/recurring-routes/* use this instead of a plain text "x" so every
// modal has the same close affordance.
export function ModalCloseButton({ onClose, className = '' }: { onClose: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className={`w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-slate-100 ${className}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
