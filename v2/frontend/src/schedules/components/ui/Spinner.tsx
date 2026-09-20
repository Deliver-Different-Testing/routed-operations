import { memo } from 'react';

/** Animated loading spinner. */
export interface SpinnerProps {
  /** Size preset. @default 'md' */
  size?: 'sm' | 'md' | 'lg';
  /** Accessible label. @default 'Loading' */
  label?: string;
  className?: string;
}

const SIZES = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' };

export const Spinner = memo(({ size = 'md', label = 'Loading', className = '' }: SpinnerProps) => (
  <div role="status" aria-live="polite" data-testid="spinner" className={`inline-flex items-center justify-center ${className}`}>
    <svg
      className={`animate-spin text-brand-cyan ${SIZES[size]}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
    <span className="sr-only">{label}</span>
  </div>
));
Spinner.displayName = 'Spinner';
