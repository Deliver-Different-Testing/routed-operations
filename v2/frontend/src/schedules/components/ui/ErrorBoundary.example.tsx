/**
 * ErrorBoundary Usage Examples
 *
 * The ErrorBoundary catches render errors in its children and
 * displays a fallback UI with a reset button.
 */
import { ErrorBoundary } from './ErrorBoundary';

// A component that will throw
function BuggyComponent() {
  throw new Error('Oops! Something broke.');
  return <div>This never renders</div>;
}

/** Example 1: Default fallback */
export function DefaultFallbackExample() {
  return (
    <ErrorBoundary>
      <BuggyComponent />
    </ErrorBoundary>
  );
}

/** Example 2: Custom fallback UI */
export function CustomFallbackExample() {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-yellow-800">Custom error: {error.message}</p>
          <button onClick={reset} className="mt-2 text-sm underline">
            Retry
          </button>
        </div>
      )}
    >
      <BuggyComponent />
    </ErrorBoundary>
  );
}

/** Example 3: Wrapping a module page (as used in App.tsx) */
export function ModuleWrapperExample() {
  return (
    <ErrorBoundary
      key="my-module"
      fallback={(error, reset) => (
        <div className="min-h-[200px] flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-lg font-semibold mb-2">Module Error</h2>
            <p className="text-sm text-gray-500 mb-4">{error.message}</p>
            <button onClick={reset} className="px-4 py-2 bg-brand-cyan text-white rounded">
              Reload Module
            </button>
          </div>
        </div>
      )}
    >
      <div>Module content here</div>
    </ErrorBoundary>
  );
}
