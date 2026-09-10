import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { ConnectionBadge } from '../tags/ConnectionBadge';

export interface ExpandableRowProps {
  id: string;
  name: string;
  badge?: {
    text: string;
    variant: 'default' | 'customized' | 'system';
  };
  preview?: string;
  stats: {
    label: string;
    value: string | number;
  }[];
  /** Number of connected categories (0-10) - replaces old tagCount */
  connectionCount: number;
  /** Show warning indicator if connections have issues */
  hasConnectionIssues?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onConnectionsClick: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function ExpandableRow({
  id: _id,
  name,
  badge,
  preview: _preview,
  stats,
  connectionCount,
  hasConnectionIssues = false,
  isExpanded,
  onToggle,
  onConnectionsClick,
  actions,
  children,
}: ExpandableRowProps) {
  return (
    <div
      className={`border-l-4 transition-colors duration-expand ${
        isExpanded ? 'border-brand-cyan' : 'border-transparent'
      }`}
    >
      {/* Header Row - Entire row is clickable to expand/collapse */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-label={`${name}${isExpanded ? ', expanded' : ', collapsed'}`}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        data-testid={`expandable-row-${name}`}
        className="flex items-center gap-4 px-4 py-3 border-b border-border cursor-pointer hover:bg-surface-cream/50 transition-colors"
      >
        {/* Name and Badge */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-text-primary font-medium truncate">{name}</span>
          {badge && <Badge variant={badge.variant}>{badge.text}</Badge>}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6">
          {stats.map((stat, index) => (
            <div key={index} className="flex flex-col items-end">
              <span className="text-text-muted text-sm">{stat.label}</span>
              <span className="text-text-primary font-semibold">{stat.value}</span>
            </div>
          ))}
        </div>

        {/* Connections Badge - Stop propagation so it doesn't trigger row expand */}
        <div onClick={(e) => e.stopPropagation()}>
          <ConnectionBadge
            connectionCount={connectionCount}
            hasIssues={hasConnectionIssues}
            onClick={onConnectionsClick}
            size="sm"
          />
        </div>

        {actions && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {actions}
          </div>
        )}

        {/* Chevron indicator */}
        <ChevronDown
          aria-hidden="true"
          className={`w-5 h-5 text-text-secondary transition-transform duration-expand ease-out ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </div>

      {/* Expanded Content */}
      <div
        className={`overflow-hidden transition-all duration-expand ease-out ${
          isExpanded ? 'max-h-auto' : 'max-h-0'
        }`}
      >
        {children}
      </div>
    </div>
  );
}
