/**
 * Example usage of useValidation hook
 *
 * This is a reference implementation showing how to use the useValidation hook
 * in a React component. Not part of the production codebase.
 */

import { useValidation } from './useValidation';
import type { ImportSchema } from '../types';

// Example schema
const exampleSchema: ImportSchema = {
  id: 'users',
  label: 'Users',
  columns: [
    { key: 'name', header: 'Name', type: 'string', required: true },
    { key: 'email', header: 'Email', type: 'email', required: true },
    { key: 'age', header: 'Age', type: 'number', min: 0, max: 120 },
  ],
  uniqueKey: 'email',
  generateId: () => `user-${Date.now()}`,
};

export function ValidationExample() {
  const {
    result,
    isValidating,
    validate,
    reset,
    hasErrors,
    hasWarnings,
    canProceed,
  } = useValidation({
    autoFix: true,
    strictMode: false,
    onComplete: (result) => {
      console.log('Validation complete:', result);
    },
  });

  const handleValidate = () => {
    const testData = [
      { name: '  John Doe  ', email: 'john@example.com', age: '30' },
      { name: 'Jane Smith', email: 'invalid-email', age: '25' },
      { name: '', email: 'bob@example.com', age: '150' }, // Too old
    ];

    validate(testData, exampleSchema);
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold">Validation Example</h2>

      <div className="flex gap-2">
        <button
          onClick={handleValidate}
          disabled={isValidating}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          {isValidating ? 'Validating...' : 'Validate Data'}
        </button>

        <button
          onClick={reset}
          disabled={!result}
          className="px-4 py-2 bg-gray-500 text-white rounded disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      {result && (
        <div className="space-y-2">
          <div className="font-semibold">
            Status: {result.isValid ? '✅ Valid' : '❌ Invalid'}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 border rounded">
              <div className="text-sm text-gray-600">Errors</div>
              <div className="text-lg font-bold text-red-600">
                {result.errors.length}
              </div>
            </div>

            <div className="p-2 border rounded">
              <div className="text-sm text-gray-600">Warnings</div>
              <div className="text-lg font-bold text-yellow-600">
                {result.warnings.length}
              </div>
            </div>

            <div className="p-2 border rounded">
              <div className="text-sm text-gray-600">Auto-Fixed</div>
              <div className="text-lg font-bold text-green-600">
                {result.autoFixed}
              </div>
            </div>
          </div>

          {hasErrors && (
            <div className="p-3 bg-red-50 border border-red-200 rounded">
              <div className="font-semibold text-red-800 mb-2">Errors:</div>
              {result.errors.map((error, idx) => (
                <div key={idx} className="text-sm text-red-700">
                  Row {error.row}, {error.column}: {error.message}
                </div>
              ))}
            </div>
          )}

          {hasWarnings && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
              <div className="font-semibold text-yellow-800 mb-2">Warnings:</div>
              {result.warnings.map((warning, idx) => (
                <div key={idx} className="text-sm text-yellow-700">
                  Row {warning.row}, {warning.column}: {warning.message}
                </div>
              ))}
            </div>
          )}

          <div className="p-3 bg-blue-50 border border-blue-200 rounded">
            <div className="font-semibold text-blue-800">
              Can Proceed: {canProceed ? 'Yes ✅' : 'No ❌'}
            </div>
            <div className="text-sm text-blue-700 mt-1">
              {canProceed
                ? 'No errors found. Safe to proceed with import.'
                : 'Fix errors before proceeding.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
