/**
 * EmptyState Usage Examples
 */
import { EmptyState } from './EmptyState';

/** Example 1: Basic empty list */
export function BasicExample() {
  return (
    <EmptyState
      title="No clients found"
      description="Try adjusting your filters or add a new client."
    />
  );
}

/** Example 2: With icon and action */
export function WithIconAndActionExample() {
  return (
    <EmptyState
      icon={
        <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      }
      title="No automations yet"
      description="Create your first automation to streamline your workflow."
      action={
        <button className="px-4 py-2 bg-brand-cyan text-white rounded-md text-sm">
          Create Automation
        </button>
      }
    />
  );
}

/** Example 3: Search with no results */
export function NoSearchResultsExample() {
  return (
    <EmptyState
      icon={
        <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      }
      title="No results"
      description='No items match "courier express". Try a different search term.'
    />
  );
}
