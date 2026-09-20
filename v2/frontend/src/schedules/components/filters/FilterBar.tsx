import { useState, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

interface Filter {
  id: string;
  label: string;
  icon?: ReactNode;
  options: string[];
}

export interface FilterBarProps {
  filters: Filter[];
  activeFilters: Record<string, string[]>;
  onFilterChange: (filterId: string, values: string[]) => void;
  onClear: () => void;
}

/** Toolbar of filter dropdowns with checkbox options and a clear-all action. */
export function FilterBar({
  filters,
  activeFilters,
  onFilterChange,
  onClear,
}: FilterBarProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const hasActiveFilters = Object.values(activeFilters).some(
    (values) => values.length > 0
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdown) {
        const dropdownElement = dropdownRefs.current[openDropdown];
        if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
          setOpenDropdown(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown]);

  const toggleDropdown = (filterId: string) => {
    setOpenDropdown(openDropdown === filterId ? null : filterId);
  };

  const handleOptionToggle = (filterId: string, option: string) => {
    const currentValues = activeFilters[filterId] || [];
    const newValues = currentValues.includes(option)
      ? currentValues.filter((v) => v !== option)
      : [...currentValues, option];
    onFilterChange(filterId, newValues);
  };

  const getActiveCount = (filterId: string) => {
    return activeFilters[filterId]?.length || 0;
  };

  const isActive = (filterId: string) => {
    return getActiveCount(filterId) > 0;
  };

  return (
    <div className="bg-surface-light border-b border-border px-6 py-3" role="toolbar" aria-label="Filters" data-testid="filter-bar">
      <div className="flex items-center gap-3">
        {filters.map((filter) => {
          const activeCount = getActiveCount(filter.id);
          const filterIsActive = isActive(filter.id);
          const isOpen = openDropdown === filter.id;

          return (
            <div
              key={filter.id}
              ref={(el) => { dropdownRefs.current[filter.id] = el; }}
              className="relative"
            >
              <button
                onClick={() => toggleDropdown(filter.id)}
                aria-expanded={isOpen}
                aria-haspopup="listbox"
                data-testid={`filter-${filter.id}`}
                className={`
                  flex items-center gap-2 px-4 py-2 rounded-md border transition-colors
                  ${
                    filterIsActive
                      ? 'bg-brand-cyan/10 border-brand-cyan text-brand-cyan'
                      : 'bg-surface-white border-border text-text-secondary hover:bg-surface-cream'
                  }
                `}
              >
                {filter.icon && <span className="flex-shrink-0">{filter.icon}</span>}
                <span className="text-sm font-medium">{filter.label}</span>
                {activeCount > 0 && (
                  <span className="text-xs bg-brand-cyan text-white rounded-full px-2 py-0.5">
                    {activeCount}
                  </span>
                )}
                <svg
                  className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {isOpen && (
                <div className="absolute top-full left-0 mt-1 bg-surface-white border border-border rounded-md shadow-lg z-10 min-w-[200px] max-h-[300px] overflow-y-auto">
                  {filter.options.map((option) => {
                    const isSelected = activeFilters[filter.id]?.includes(option);
                    return (
                      <label
                        key={option}
                        className="flex items-center gap-3 px-4 py-2 hover:bg-surface-cream cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleOptionToggle(filter.id, option)}
                          className="w-4 h-4 rounded border-border text-brand-cyan focus:ring-brand-cyan"
                        />
                        <span className="text-sm text-text-secondary">{option}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {hasActiveFilters && (
          <button
            onClick={onClear}
            className="ml-auto px-4 py-2 text-sm font-medium text-text-secondary hover:text-brand-cyan transition-colors"
          >
            Clear Filters
          </button>
        )}
      </div>
    </div>
  );
}
