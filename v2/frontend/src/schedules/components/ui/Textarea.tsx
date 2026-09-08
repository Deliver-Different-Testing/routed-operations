import { forwardRef, type TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Whether the textarea is in an error state */
  error?: boolean;
}

export type { TextareaProps };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className = '', error = false, ...props }, ref) => {
    const baseStyles = 'w-full px-4 py-3 rounded-lg border bg-white text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:border-transparent transition-all duration-normal resize-y min-h-[100px]';
    const errorStyles = error ? 'border-error focus:ring-error' : 'border-border';

    return (
      <textarea
        ref={ref}
        data-testid="textarea"
        className={`${baseStyles} ${errorStyles} ${className}`}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';