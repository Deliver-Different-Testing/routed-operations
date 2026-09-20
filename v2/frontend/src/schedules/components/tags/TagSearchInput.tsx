import { useState, useEffect, type ReactNode } from 'react';
import { Search, X, Link2 } from 'lucide-react';

/**
 * TagSearchInput - Filter by connected entities
 *
 * This search input appears on every settings page and allows
 * filtering items by their connected entities. When a user clicks
 * through from another page's TagSidebar, this input is pre-filled
 * with the search query.
 *
 * See TAG-SYSTEM-SPEC.md section 6.
 */

export interface TagSearchInputProps {
  /** Current search value */
  value: string;
  /** Called when search value changes */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Number of results matching the current search */
  resultCount?: number;
  /** Optional label for what type of entity is being searched */
  entityType?: string;
}

export function TagSearchInput({
  value,
  onChange,
  placeholder = 'Filter by connected entity...',
  resultCount,
  entityType,
}: TagSearchInputProps): ReactNode {
  const [isFocused, setIsFocused] = useState(false);

  // Check URL for tagSearch param on mount (for cross-page navigation)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tagSearch = params.get('tagSearch');
    if (tagSearch && !value) {
      onChange(tagSearch);
    }
  }, [onChange, value]);

  const handleClear = () => {
    onChange('');
    // Also clear URL param if present
    const url = new URL(window.location.href);
    url.searchParams.delete('tagSearch');
    window.history.replaceState({}, '', url.toString());
  };

  return (
    <div className="relative">
      {/* Input container */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
          isFocused
            ? 'border-brand-cyan ring-2 ring-brand-cyan/20'
            : value
              ? 'border-brand-cyan/50 bg-brand-cyan/5'
              : 'border-border-light hover:border-gray-300'
        }`}
      >
        {/* Icon */}
        <div className="flex items-center gap-1.5 text-text-secondary">
          <Link2 className="w-4 h-4" />
          <Search className="w-4 h-4" />
        </div>

        {/* Input */}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          className="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-muted"
        />

        {/* Clear button */}
        {value && (
          <button
            onClick={handleClear}
            className="p-0.5 text-text-secondary hover:text-text-primary hover:bg-gray-100 rounded transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Results indicator */}
      {value && resultCount !== undefined && (
        <div className="absolute top-full left-0 right-0 mt-1 px-3 py-1.5 bg-surface-white border border-border-light rounded-lg shadow-sm">
          <p className="text-xs text-text-secondary">
            <span className="font-medium text-brand-cyan">{resultCount}</span>
            {entityType
              ? ` ${entityType}${resultCount !== 1 ? 's' : ''}`
              : ' result'
            }{resultCount !== 1 ? 's' : ''} connected to "{value}"
          </p>
        </div>
      )}
    </div>
  );
}
