import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant =
  | 'primary'    // brand cyan - main action per screen (Save, Create, Build)
  | 'secondary'  // brand purple - important secondary action (Optimise, Build Runs)
  | 'warning'    // brand orange - dispatch / send-to-live
  | 'neutral'    // outline - most toolbar buttons (Refresh, Cancel, filter triggers)
  | 'ghost'      // no border - tertiary text buttons (Clear selection, Move date)
  | 'danger';    // red outline - destructive action (Delete run, Delete all)

export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  active?: boolean; // for toggle-style buttons (e.g. Auto Zoom on/off, filter pills)
  children: ReactNode;
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-sm',
};

/**
 * Base classes every variant inherits. `rounded-lg` and `transition-all` match
 * both the Configurator reference stack and the mock site under
 * routed-operations-main/v2/frontend. `disabled:opacity-40` gives a
 * consistent disabled look; each variant appends its own colour + hover.
 */
const BASE = 'rounded-lg font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed';

const VARIANT: Record<ButtonVariant, { normal: string; active: string }> = {
  primary: {
    normal: 'bg-brand-cyan text-brand-dark hover:brightness-110',
    active: 'bg-brand-cyan text-brand-dark ring-2 ring-brand-cyan',
  },
  secondary: {
    normal: 'bg-brand-purple text-white hover:brightness-110',
    active: 'bg-brand-purple text-white ring-2 ring-brand-purple/50',
  },
  warning: {
    normal: 'bg-brand-orange text-white hover:brightness-110',
    active: 'bg-brand-orange text-white ring-2 ring-brand-orange/50',
  },
  neutral: {
    normal: 'border border-border bg-surface-white text-text-secondary hover:bg-surface-cream',
    active: 'border border-brand-cyan bg-brand-cyan/20 text-brand-dark',
  },
  ghost: {
    normal: 'text-text-secondary hover:bg-surface-cream',
    active: 'bg-surface-cream text-text-primary',
  },
  danger: {
    normal: 'border border-error text-error bg-surface-white hover:bg-error-bg',
    active: 'border border-error bg-error text-white',
  },
};

/**
 * Single source of truth for cockpit button styling. Six variants, three
 * sizes. Match legacy / Configurator: rounded-lg, font-medium, transition-all.
 *
 * Usage:
 *   <Button variant="primary" onClick={...}>Save</Button>
 *   <Button variant="warning" size="sm">Send to Live</Button>
 *   <Button variant="neutral" active={autoZoom}>Auto Zoom</Button>
 */
export function Button({
  variant = 'neutral',
  size = 'md',
  active = false,
  className = '',
  type,
  children,
  ...rest
}: Props) {
  const variantClasses = active ? VARIANT[variant].active : VARIANT[variant].normal;
  return (
    <button
      type={type ?? 'button'}
      className={`${BASE} ${SIZE[size]} ${variantClasses} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
