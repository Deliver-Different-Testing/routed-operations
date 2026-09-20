import { memo, useCallback, useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  fieldCount?: number;
  className?: string;
}

/**
 * Collapsible section with animated expand/collapse, optional icon,
 * field count badge, and full keyboard + ARIA accessibility.
 * Memoized to avoid unnecessary re-renders.
 */
export const CollapsibleSection = memo(function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  children,
  fieldCount,
  className = '',
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();
  const headerId = useId();

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    },
    [toggle],
  );

  return (
    <div
      className={`border border-border rounded-lg overflow-hidden ${className}`}
      role="region"
      aria-labelledby={headerId}
    >
      {/* Header */}
      <button
        id={headerId}
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        className={`
          w-full flex items-center gap-3 px-4 py-3 text-left
          transition-colors duration-200
          focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:ring-inset
          ${isOpen ? 'bg-white' : 'bg-surface-light'}
        `}
      >
        {/* Optional icon */}
        {icon && (
          <span className="text-text-secondary flex-shrink-0" aria-hidden="true">
            {icon}
          </span>
        )}

        {/* Title */}
        <span className="flex-1 text-sm font-semibold text-text-primary">
          {title}
        </span>

        {/* Field count badge */}
        {fieldCount !== undefined && (
          <span className="bg-brand-cyan/10 text-brand-cyan text-xs px-2 py-0.5 rounded-full flex-shrink-0">
            {fieldCount} {fieldCount === 1 ? 'field' : 'fields'}
          </span>
        )}

        {/* Chevron */}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`
            flex-shrink-0 text-text-muted
            transition-transform duration-200
            ${isOpen ? 'rotate-180' : 'rotate-0'}
          `}
        />
      </button>

      {/* Content — grid-template-rows trick for smooth animation */}
      <div
        id={contentId}
        role="region"
        aria-labelledby={headerId}
        className={`
          grid transition-[grid-template-rows] duration-300 ease-out
          ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}
        `}
      >
        <div className="overflow-hidden">
          <div className="bg-white border-t border-border px-4 py-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
});
