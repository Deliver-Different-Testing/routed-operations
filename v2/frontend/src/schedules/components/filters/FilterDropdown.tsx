import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, MapPin, Building2, Truck, Zap, Users, DollarSign, Globe, Tag, Hash, FileText } from 'lucide-react';

// Icon mapping for filter types
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  zoneNumber: Hash,
  zoneName: MapPin,
  region: Globe,
  depot: Building2,
  service: Zap,
  vehicle: Truck,
  customer: Users,
  rateCard: DollarSign,
  tag: Tag,
  status: FileText,
};

/** Props for {@link FilterDropdown}. */
export interface FilterDropdownProps {
  id: string;
  label: string;
  options: string[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  multiSelect?: boolean;
}

/**
 * Dropdown filter with single- or multi-select, icon mapping, and active-count badge.
 * Closes on outside click. Renders a floating menu of checkbox-style options.
 */
export function FilterDropdown({
  id,
  label,
  options,
  selectedValues,
  onChange,
  multiSelect = false,
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const IconComponent = iconMap[id] || Tag;
  const activeCount = selectedValues.filter(v => !v.startsWith('All ')).length;
  const hasActiveFilters = activeCount > 0;

  const handleOptionClick = (option: string) => {
    if (option.startsWith('All ')) {
      // "All X" option clears the filter
      onChange([]);
      if (!multiSelect) setIsOpen(false);
    } else if (multiSelect) {
      // Multi-select: toggle the option
      if (selectedValues.includes(option)) {
        onChange(selectedValues.filter(v => v !== option));
      } else {
        onChange([...selectedValues.filter(v => !v.startsWith('All ')), option]);
      }
    } else {
      // Single select: replace selection and close
      onChange([option]);
      setIsOpen(false);
    }
  };

  const getDisplayText = () => {
    if (activeCount === 0) {
      return label;
    } else if (activeCount === 1) {
      return selectedValues[0];
    } else {
      return `${activeCount} selected`;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Filter Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-all duration-200
          border
          ${hasActiveFilters
            ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan hover:bg-brand-cyan/20'
            : 'bg-surface-white text-text-secondary border-border hover:bg-surface-cream hover:border-border'
          }
        `}
      >
        <IconComponent className={`w-3.5 h-3.5 ${hasActiveFilters ? 'text-brand-cyan' : 'text-text-muted'}`} />
        <span className="max-w-[100px] truncate">{getDisplayText()}</span>
        {activeCount > 1 && (
          <span className="bg-brand-cyan text-white rounded-full px-1.5 text-xs min-w-[18px] text-center">
            {activeCount}
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''} ${hasActiveFilters ? 'text-brand-cyan' : 'text-text-muted'}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-surface-white border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {options.map((option) => {
              const isAllOption = option.startsWith('All ');
              const isSelected = isAllOption
                ? selectedValues.length === 0
                : selectedValues.includes(option);

              return (
                <button
                  key={option}
                  onClick={() => handleOptionClick(option)}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors
                    ${isSelected
                      ? 'bg-brand-cyan/10 text-brand-cyan'
                      : 'text-text-primary hover:bg-surface-cream'
                    }
                    ${isAllOption ? 'border-b border-border' : ''}
                  `}
                >
                  <span className={`
                    w-4 h-4 rounded border flex items-center justify-center flex-shrink-0
                    ${isSelected
                      ? 'bg-brand-cyan border-brand-cyan'
                      : 'border-border'
                    }
                  `}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="flex-1 truncate">{option}</span>
                </button>
              );
            })}
          </div>

          {/* Clear button at bottom if filters are active */}
          {hasActiveFilters && (
            <div className="border-t border-border px-3 py-2">
              <button
                onClick={() => {
                  onChange([]);
                  setIsOpen(false);
                }}
                className="text-xs text-text-muted hover:text-brand-cyan transition-colors"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
