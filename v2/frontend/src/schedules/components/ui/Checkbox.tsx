import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  /** Label text for the checkbox */
  label?: string;
  /** Callback when checkbox state changes */
  onChange?: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, onChange, className = '', disabled, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e.target.checked);
    };

    return (
      <label className={`inline-flex items-center space-x-2 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
        <input
          ref={ref}
          type="checkbox"
          onChange={handleChange}
          disabled={disabled}
          className={`h-4 w-4 rounded border-gray-300 text-brand-cyan focus:ring-brand-cyan focus:ring-2 ${className}`}
          {...props}
        />
        {label && (
          <span className="text-sm text-gray-700">{label}</span>
        )}
      </label>
    );
  }
);

Checkbox.displayName = 'Checkbox';
