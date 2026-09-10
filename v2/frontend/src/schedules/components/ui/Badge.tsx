import { memo, type ReactNode } from 'react';

/** Visual variant for the badge. */
export type BadgeVariant = 'default' | 'blue' | 'purple' | 'green' | 'cyan' | 'system' | 'customized' | 'orange' | 'yellow' | 'red';

/** Inline status / label badge. Pure component — wrapped in React.memo. */
export interface BadgeProps {
  /** Color variant. @default 'default' */
  variant?: BadgeVariant;
  /** Badge content (text or icon). */
  children: ReactNode;
  /** Extra classes. */
  className?: string;
  /** Size preset. @default 'md' */
  size?: 'sm' | 'md';
  /** Accessible label when badge text alone is insufficient. */
  'aria-label'?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-border text-text-secondary',
  blue: 'bg-badge-blue-bg text-badge-blue-text',
  purple: 'bg-badge-purple-bg text-badge-purple-text',
  green: 'bg-badge-green-bg text-badge-green-text',
  cyan: 'bg-brand-cyan text-brand-dark',
  system: 'bg-border text-text-secondary',
  customized: 'bg-badge-purple-bg text-badge-purple-text',
  orange: 'bg-badge-orange-bg text-warning',
  yellow: 'bg-badge-yellow-bg text-warning',
  red: 'bg-error/10 text-error',
};

const sizeStyles: Record<'sm' | 'md', string> = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-xs',
};

export const Badge = memo(function Badge({
  variant = 'default',
  children,
  className = '',
  size = 'md',
  'aria-label': ariaLabel,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      data-testid="badge"
      aria-label={ariaLabel}
    >
      {children}
    </span>
  );
});
