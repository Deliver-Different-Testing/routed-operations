import { memo, type ReactNode } from 'react';
import { Link2, AlertTriangle } from 'lucide-react';

/**
 * ConnectionBadge - Shows connection count for an entity
 *
 * Replaces the old "3 Tags" button with a connection-focused display.
 * Shows how many categories have connections, with optional warning
 * indicator if some expected connections are missing.
 *
 * See TAG-SYSTEM-SPEC.md section 9.1.
 */

export interface ConnectionBadgeProps {
  /** Number of categories that have connections (0-10) */
  connectionCount: number;
  /** Show warning indicator if some expected connections are missing */
  hasIssues?: boolean;
  /** Opens the TagSidebar when clicked */
  onClick: (e?: React.MouseEvent) => void;
  /** Optional size variant */
  size?: 'sm' | 'md';
  /** Compact icon-only badge for dense tables */
  compact?: boolean;
}

/** Connection badge showing count with optional warning. Memoized. */
export const ConnectionBadge = memo(function ConnectionBadge({
  connectionCount,
  hasIssues = false,
  onClick,
  size = 'md',
  compact = false,
}: ConnectionBadgeProps): ReactNode {
  const sizeClasses = {
    sm: compact ? 'h-7 w-7 justify-center p-0' : 'px-2 py-1 text-xs gap-1',
    md: compact ? 'h-8 w-8 justify-center p-0' : 'px-3 py-1.5 text-sm gap-2',
  };

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';

  // Determine badge color based on connection status
  const getBadgeStyles = () => {
    if (connectionCount === 0) {
      // No connections - could be a problem
      return compact
        ? 'bg-slate-100 text-slate-400 hover:bg-slate-200 border border-slate-200'
        : 'bg-gray-100 text-gray-500 hover:bg-gray-200';
    }
    if (hasIssues) {
      // Some connections but issues exist
      return 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200';
    }
    // Normal connected state
    return compact
      ? 'bg-brand-cyan text-white hover:bg-brand-cyan/90 shadow-sm'
      : 'bg-brand-cyan/10 text-brand-dark hover:bg-brand-cyan/20';
  };

  return (
    <button
      onClick={onClick}
      aria-label={`${connectionCount} ${connectionCount === 1 ? 'connection' : 'connections'}${hasIssues ? ' — has issues' : ''}`}
      data-testid="connection-badge"
      className={`inline-flex items-center rounded-lg font-medium transition-colors ${sizeClasses[size]} ${getBadgeStyles()}`}
    >
      {hasIssues ? (
        <AlertTriangle className={`${iconSize} ${compact ? 'text-current' : 'text-amber-500'}`} />
      ) : (
        <Link2 className={iconSize} />
      )}
      {!compact && (
        <span>
          {connectionCount} {connectionCount === 1 ? 'Connection' : 'Connections'}
        </span>
      )}
    </button>
  );
});
