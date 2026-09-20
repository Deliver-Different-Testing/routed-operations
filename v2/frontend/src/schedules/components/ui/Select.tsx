import { forwardRef, useId, type SelectHTMLAttributes } from 'react';

/** Native select dropdown with optional label and error message. */
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Label text displayed above the select. */
  label?: string;
  /** Error message displayed below the select. Sets `aria-invalid`. */
  error?: string;
  /** Available options. */
  options: { value: string | number; label: string }[];
}

export type { SelectProps };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className = '', id: externalId, ...props }, ref) => {
    const autoId = useId();
    const selectId = externalId ?? autoId;
    const errorId = error ? `${selectId}-error` : undefined;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-text-primary mb-1">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          data-testid="select"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className={`
            w-full px-3.5 py-2.5 text-base
            border-2 border-border rounded-md
            bg-white text-text-primary
            appearance-none cursor-pointer
            transition-all duration-normal
            focus:outline-none focus:border-brand-cyan focus:shadow-cyan-glow
            disabled:bg-surface-light disabled:cursor-not-allowed
            bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%2364748b%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')]
            bg-no-repeat bg-[right_12px_center]
            pr-10
            ${error ? 'border-error focus:border-error focus:shadow-none' : ''}
            ${className}
          `}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';
