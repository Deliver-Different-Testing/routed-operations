/**
 * Spinner Usage Examples
 */
import { Spinner } from './Spinner';

/** Example 1: Size variants */
export function SizeVariantsExample() {
  return (
    <div className="flex items-center gap-6">
      <Spinner size="sm" label="Loading small" />
      <Spinner size="md" label="Loading medium" />
      <Spinner size="lg" label="Loading large" />
    </div>
  );
}

/** Example 2: Centered page loader */
export function PageLoaderExample() {
  return (
    <div className="flex justify-center py-12">
      <Spinner size="lg" label="Loading page data" />
    </div>
  );
}

/** Example 3: Inline with text */
export function InlineSpinnerExample() {
  return (
    <div className="flex items-center gap-2 text-sm text-text-secondary">
      <Spinner size="sm" />
      <span>Saving changes...</span>
    </div>
  );
}
