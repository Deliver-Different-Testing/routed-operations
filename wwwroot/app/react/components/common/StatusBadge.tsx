interface StatusBadgeProps {
  label: string;
  kind?: 'default' | 'success' | 'warning' | 'error' | 'info';
}

const kindClasses: Record<Required<StatusBadgeProps>['kind'], string> = {
  default: 'bg-surface-light text-text-secondary',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
  info: 'bg-brand-cyan/20 text-brand-dark',
};

export function StatusBadge({ label, kind = 'default' }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${kindClasses[kind]}`}>
      {label}
    </span>
  );
}
