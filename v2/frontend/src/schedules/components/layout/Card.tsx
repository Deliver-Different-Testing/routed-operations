import { memo, type ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingStyles = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

/** Presentational card wrapper. Memoized to avoid unnecessary re-renders. */
export const Card = memo(function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div
      className={`
        bg-surface-white rounded-lg border border-border shadow-sm
        ${paddingStyles[padding]}
        ${className}
      `}
    >
      {children}
    </div>
  );
});
