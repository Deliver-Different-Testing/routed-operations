import { forwardRef, type HTMLAttributes } from 'react';
import { AlertCircle, CheckCircle, Info, XCircle } from 'lucide-react';

type AlertVariant = 'default' | 'destructive' | 'success' | 'info';

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual variant of the alert */
  variant?: AlertVariant;
  /** Optional title for the alert */
  title?: string;
}

export type { AlertProps, AlertVariant };

const variantStyles: Record<AlertVariant, string> = {
  default: 'bg-surface-light border-border text-text-primary',
  destructive: 'bg-error/10 border-error/20 text-error',
  success: 'bg-success/10 border-success/20 text-success',
  info: 'bg-brand-cyan/10 border-brand-cyan/20 text-brand-cyan',
};

const variantIcons: Record<AlertVariant, React.ReactNode> = {
  default: <Info className="h-4 w-4" />,
  destructive: <XCircle className="h-4 w-4" />,
  success: <CheckCircle className="h-4 w-4" />,
  info: <AlertCircle className="h-4 w-4" />,
};

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ variant = 'default', title, children, className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-testid="alert"
        className={`flex items-start gap-3 p-4 rounded-lg border ${variantStyles[variant]} ${className}`}
        {...props}
      >
        <div className="flex-shrink-0 mt-0.5">
          {variantIcons[variant]}
        </div>
        <div className="flex-1">
          {title && (
            <h4 className="font-semibold mb-1">
              {title}
            </h4>
          )}
          <div className="text-sm">
            {children}
          </div>
        </div>
      </div>
    );
  }
);

Alert.displayName = 'Alert';

export const AlertDescription = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className = '', ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-testid="alert-description"
        className={`${className}`}
        {...props}
      />
    );
  }
);

AlertDescription.displayName = 'AlertDescription';