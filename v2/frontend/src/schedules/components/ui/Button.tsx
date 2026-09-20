import { forwardRef, type ButtonHTMLAttributes } from 'react';

/** Visual style of the button. */
type ButtonVariant = 'primary' | 'secondary' | 'save' | 'danger' | 'ghost' | 'icon';
/** Physical size of the button. */
type ButtonSize = 'sm' | 'md' | 'lg';

/** Standard button with variant and size props. Forwards ref. */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. @default 'primary' */
  variant?: ButtonVariant;
  /** Size preset. @default 'md' */
  size?: ButtonSize;
}

export type { ButtonProps, ButtonVariant, ButtonSize };

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand-cyan text-brand-dark hover:shadow-cyan-glow',
  secondary: 'bg-white text-text-secondary border-2 border-border hover:bg-surface-light',
  save: 'bg-success text-white hover:bg-success/90',
  danger: 'bg-error text-white hover:bg-error/90',
  ghost: 'bg-transparent text-text-secondary hover:bg-surface-light',
  icon: 'bg-transparent text-current hover:bg-surface-light p-2',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-base',
  lg: 'px-6 py-3 text-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', disabled, children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center gap-2 font-medium rounded-[8px] transition-all duration-normal hover:-translate-y-px active:translate-y-0 disabled:opacity-50 disabled:pointer-events-none';

    return (
      <button
        ref={ref}
        data-testid="button"
        className={`${baseStyles} ${variantStyles[variant]} ${variant !== 'icon' ? sizeStyles[size] : ''} ${className}`}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
