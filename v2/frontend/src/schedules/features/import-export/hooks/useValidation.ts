import { useState, useCallback } from 'react';
import { validateAll, type ValidateRowOptions } from '../engine';
import type { ValidationResult } from '../types';
import type { ImportSchema } from '../types';

export interface UseValidationOptions extends ValidateRowOptions {
  onComplete?: (result: ValidationResult) => void;
}

export interface UseValidationReturn {
  // State
  result: ValidationResult | null;
  isValidating: boolean;

  // Actions
  validate: (rows: Record<string, unknown>[], schema: ImportSchema) => void;
  reset: () => void;

  // Computed
  hasErrors: boolean;
  hasWarnings: boolean;
  canProceed: boolean;  // true if no errors (warnings OK)
}

/**
 * Hook that validates parsed CSV rows against a schema.
 * Returns validation result, loading/error state, and `validate`/`reset` actions.
 */
export function useValidation(options: UseValidationOptions = {}): UseValidationReturn {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const validate = useCallback((
    rows: Record<string, unknown>[],
    schema: ImportSchema
  ) => {
    setIsValidating(true);

    // Use setTimeout to allow UI to update before potentially heavy validation
    setTimeout(() => {
      try {
        const validationResult = validateAll(rows, schema, {
          autoFix: options.autoFix ?? true,
          strictMode: options.strictMode ?? false,
        });

        setResult(validationResult);
        options.onComplete?.(validationResult);
      } catch (err) {
        // Create error result
        setResult({
          isValid: false,
          errors: [{
            row: 0,
            column: '',
            value: null,
            message: err instanceof Error ? err.message : 'Validation failed',
            severity: 'error',
          }],
          warnings: [],
          infos: [],
          autoFixed: 0,
          unfixable: 1,
        });
      } finally {
        setIsValidating(false);
      }
    }, 0);
  }, [options]);

  const reset = useCallback(() => {
    setResult(null);
    setIsValidating(false);
  }, []);

  // Computed values
  const hasErrors = result ? result.errors.length > 0 : false;
  const hasWarnings = result ? result.warnings.length > 0 : false;
  const canProceed = result ? result.errors.length === 0 : false;

  return {
    result,
    isValidating,
    validate,
    reset,
    hasErrors,
    hasWarnings,
    canProceed,
  };
}
