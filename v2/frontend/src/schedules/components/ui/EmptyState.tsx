import { memo } from 'react';
import type { ReactNode } from 'react';

/** Generic empty state placeholder for pages/tables with no data. */
export interface EmptyStateProps {
  /** Icon or illustration. */
  icon?: ReactNode;
  /** Main heading. */
  title: string;
  /** Description text. */
  description?: string;
  /** Optional action button. */
  action?: ReactNode;
}

export const EmptyState = memo(({ icon, title, description, action }: EmptyStateProps) => (
  <div data-testid="empty-state" aria-live="polite" className="flex flex-col items-center justify-center py-16 px-4 text-center">
    {icon && <div className="mb-4 text-text-muted">{icon}</div>}
    <h3 className="text-lg font-semibold text-text-primary mb-1">{title}</h3>
    {description && <p className="text-sm text-text-secondary mb-4 max-w-md">{description}</p>}
    {action && <div>{action}</div>}
  </div>
));
EmptyState.displayName = 'EmptyState';
