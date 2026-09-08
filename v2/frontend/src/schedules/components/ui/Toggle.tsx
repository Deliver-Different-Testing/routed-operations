import { forwardRef, useId } from 'react';

/** Toggle / switch input with optional visible label. */
interface ToggleProps {
  /** Whether the toggle is on. */
  checked: boolean;
  /** Called when the user toggles. */
  onChange: (checked: boolean) => void;
  /** Size preset. @default 'md' */
  size?: 'sm' | 'md';
  /** Disables interaction. */
  disabled?: boolean;
  /** Extra classes on the button element. */
  className?: string;
  /** Visible label text. Also used as `aria-label` when provided. */
  label?: string;
}

export type { ToggleProps };

export const Toggle = forwardRef<HTMLButtonElement, ToggleProps>(
  ({ checked, onChange, size = 'md', disabled = false, className = '', label }, ref) => {
    const autoId = useId();

    const sizeStyles = {
      sm: {
        track: 'w-10 h-5',
        thumb: 'w-4 h-4',
        translate: 'translate-x-5',
      },
      md: {
        track: 'w-12 h-6',
        thumb: 'w-5 h-5',
        translate: 'translate-x-6',
      },
    };

    const styles = sizeStyles[size];

    const toggle = (
      <button
        ref={ref}
        type="button"
        role="switch"
        id={autoId}
        aria-checked={checked}
        aria-label={label || undefined}
        data-testid="toggle"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`
          ${styles.track}
          relative inline-flex shrink-0 cursor-pointer rounded-full
          transition-colors duration-normal ease-in-out
          focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed
          ${checked ? 'bg-gradient-to-r from-brand-cyan to-brand-purple' : 'bg-border'}
          ${className}
        `}
      >
        <span
          aria-hidden="true"
          className={`
            ${styles.thumb}
            pointer-events-none inline-block rounded-full bg-white shadow-md
            transform transition-transform duration-normal ease-in-out
            ${checked ? styles.translate : 'translate-x-0.5'}
            mt-0.5
          `}
        />
      </button>
    );

    if (label) {
      return (
        <label htmlFor={autoId} className="flex items-center gap-2 cursor-pointer">
          {toggle}
          <span className="text-sm text-text-secondary select-none">{label}</span>
        </label>
      );
    }

    return toggle;
  }
);

Toggle.displayName = 'Toggle';
