import { useState, useEffect, memo } from 'react';
import { Search, X } from 'lucide-react';

/** Debounced search input with clear button. */
interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Debounce delay in ms. @default 300 */
  debounceMs?: number;
  className?: string;
  /** Accessible label (defaults to placeholder). */
  'aria-label'?: string;
}

export type { SearchInputProps };

export const SearchInput = memo(function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  debounceMs = 300,
  className = '',
  'aria-label': ariaLabel,
}: SearchInputProps) {
  const [internalValue, setInternalValue] = useState(value);

  useEffect(() => {
    setInternalValue(value);
  }, [value]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onChange(internalValue);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [internalValue, debounceMs, onChange]);

  const handleClear = () => {
    setInternalValue('');
    onChange('');
  };

  return (
    <div className={`relative ${className}`} role="search">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" aria-hidden="true" />
      <input
        type="search"
        value={internalValue}
        onChange={(e) => setInternalValue(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        data-testid="search-input"
        className="w-full pl-10 pr-10 py-2 border-2 border-border rounded-md focus:outline-none focus:border-brand-cyan focus:shadow-cyan-glow transition-colors"
      />
      {internalValue && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
});
