import { forwardRef, useId, type InputHTMLAttributes } from 'react';

/** Text input with optional label, error message, and leading icon. */
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Label text displayed above the input. */
  label?: string;
  /** Error message displayed below the input. Sets `aria-invalid`. */
  error?: string;
  /** Leading icon rendered inside the input. */
  icon?: React.ReactNode;
}

export type { InputProps };

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = '', id: externalId, ...props }, ref) => {
    const autoId = useId();
    const inputId = externalId ?? autoId;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-text-primary mb-1">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden="true">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            data-testid="input"
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={`
              w-full px-3.5 py-2.5 text-base
              border-2 border-border rounded-md
              bg-white text-text-primary
              placeholder:text-text-muted
              transition-all duration-normal
              focus:outline-none focus:border-brand-cyan focus:shadow-cyan-glow
              disabled:bg-surface-light disabled:cursor-not-allowed
              ${icon ? 'pl-10' : ''}
              ${error ? 'border-error focus:border-error focus:shadow-none' : ''}
              ${className}
            `}
            {...props}
          />
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
