
import { memo } from 'react';

/** A single active filter represented as a removable chip. */
export interface FilterChip {
  category: string;
  value: string;
}

/** Props for {@link FilterChips}. */
export interface FilterChipsProps {
  chips: FilterChip[];
  onRemove: (category: string, value: string) => void;
  onClearAll: () => void;
}

/**
 * Renders a row of active-filter chips with individual remove buttons and a
 * "Clear All" action when more than one chip is present.
 */
export const FilterChips = memo(function FilterChips({ chips, onRemove, onClearAll }: FilterChipsProps) {
  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {chips.map((chip, index) => (
        <div
          key={`${chip.category}-${chip.value}-${index}`}
          className="inline-flex items-center gap-1.5 bg-brand-cyan/10 text-brand-dark rounded-full px-3 py-1"
        >
          <span className="text-sm">
            {chip.category}: {chip.value}
          </span>
          <button
            onClick={() => onRemove(chip.category, chip.value)}
            className="rounded-full hover:bg-brand-cyan/20 p-0.5 transition-colors"
            aria-label={`Remove ${chip.category}: ${chip.value} filter`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      ))}
      {chips.length > 1 && (
        <button
          onClick={onClearAll}
          className="text-sm text-text-muted hover:text-error transition-colors"
        >
          Clear All
        </button>
      )}
    </div>
  );
});
