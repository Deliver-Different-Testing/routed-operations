import { useEffect, useRef, useCallback, useId, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Modal dialog with center or right-slide variants. Traps focus and supports Escape to close. */
export interface ModalProps {
  /** Whether the modal is visible. */
  isOpen: boolean;
  /** Called when the user dismisses the modal (overlay click, Escape, or close button). */
  onClose: () => void;
  /** Heading text. */
  title: string;
  /** Optional subtitle below the heading. */
  subtitle?: string;
  /** Layout variant. @default 'center' */
  variant?: 'right-slide' | 'center';
  /** Modal body content. */
  children: ReactNode;
  /** Optional footer (e.g. action buttons). */
  footer?: ReactNode;
  /** Width preset. @default 'md' */
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
}

export const Modal = ({
  isOpen,
  onClose,
  title,
  subtitle,
  variant = 'center',
  children,
  footer,
  size = 'md',
}: ModalProps) => {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key & trap focus with Tab
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  // Store the element that had focus before the modal opened
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Trap focus inside the modal while open, restore on close
  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    document.addEventListener('keydown', handleKeyDown);
    // Prevent body scroll
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Auto-focus the dialog container
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prev;
      // Return focus to the element that triggered the modal
      previousFocusRef.current?.focus();
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  // Responsive sizes — percentage-based widths for larger sizes
  const sizeClasses: Record<string, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl',
    full: 'max-w-[90vw] lg:max-w-[75vw]',
  };

  const overlayClasses = 'fixed inset-0 bg-black/30 z-50';

  // Right-slide widths — responsive
  const slideWidthClasses: Record<string, string> = {
    sm: 'w-full sm:w-[400px]',
    md: 'w-full sm:w-[480px]',
    lg: 'w-full sm:w-[600px] lg:w-[700px]',
    xl: 'w-full sm:w-[700px] lg:w-[800px] xl:w-[900px]',
    '2xl': 'w-full sm:w-[800px] lg:w-[900px] xl:w-[1000px]',
    full: 'w-full sm:w-[90vw] lg:w-[75vw] xl:w-[60vw]',
  };

  const headerContent = (
    <>
      <div>
        <h2 id={titleId} className="text-lg font-semibold text-text-primary">
          {title}
        </h2>
        {subtitle && (
          <p id={subtitleId} className="text-sm text-text-muted mt-1">
            {subtitle}
          </p>
        )}
      </div>
      <button
        onClick={onClose}
        className="text-text-muted hover:text-text-primary transition-colors"
        aria-label="Close"
        data-testid="modal-close"
      >
        <X size={20} />
      </button>
    </>
  );

  if (variant === 'right-slide') {
    return (
      <>
        <div className={overlayClasses} onClick={onClose} aria-hidden="true" />
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitle ? subtitleId : undefined}
          data-testid="modal"
          tabIndex={-1}
          className={`fixed right-0 top-0 h-full ${slideWidthClasses[size]} bg-white z-50 transform transition-transform duration-300 ${
            isOpen ? 'translate-x-0' : 'translate-x-full'
          } focus:outline-none`}
        >
          <div className="flex flex-col h-full">
            <div className="sticky top-0 border-b p-6 flex justify-between items-start bg-white">
              {headerContent}
            </div>
            <div className="flex-1 overflow-y-auto p-6">{children}</div>
            {footer && (
              <div className="sticky bottom-0 border-t p-4 flex justify-between bg-white">
                {footer}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={overlayClasses} onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitle ? subtitleId : undefined}
          data-testid="modal"
          tabIndex={-1}
          className={`bg-white rounded-lg ${sizeClasses[size]} w-full max-h-[90vh] flex flex-col transition-opacity duration-200 ${
            isOpen ? 'opacity-100' : 'opacity-0'
          } focus:outline-none`}
        >
          <div className="sticky top-0 border-b p-6 flex justify-between items-start bg-white rounded-t-lg flex-shrink-0">
            {headerContent}
          </div>
          <div className="p-6 overflow-y-auto flex-1 modal-scroll-content">{children}</div>
          {footer && (
            <div className="sticky bottom-0 border-t p-4 flex justify-end gap-2 bg-white rounded-b-lg flex-shrink-0">
              {footer}
            </div>
          )}
        </div>
      </div>
    </>
  );
};
