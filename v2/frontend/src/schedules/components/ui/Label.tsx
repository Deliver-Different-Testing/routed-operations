import { forwardRef, type LabelHTMLAttributes } from 'react';

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Whether the label is required (shows asterisk) */
  required?: boolean;
}

export type { LabelProps };

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className = '', required = false, children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        data-testid="label"
        className={`block text-sm font-medium text-text-primary mb-2 ${className}`}
        {...props}
      >
        {children}
        {required && <span className="text-error ml-1">*</span>}
      </label>
    );
  }
);

Label.displayName = 'Label';