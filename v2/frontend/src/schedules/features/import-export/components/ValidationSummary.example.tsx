/**
 * Example usage of ValidationSummary component
 *
 * This file demonstrates the different states of the ValidationSummary component.
 */

import React from 'react';
import { ValidationSummary } from './ValidationSummary';
import type { ValidationResult } from '../types';

// Example 1: All valid - no errors
const validResult: ValidationResult = {
  isValid: true,
  errors: [],
  warnings: [],
  infos: [],
  autoFixed: 0,
  unfixable: 0,
};

// Example 2: Mixed validation results
const mixedResult: ValidationResult = {
  isValid: false,
  errors: [
    {
      row: 5,
      column: 'Email',
      value: 'not-an-email',
      message: 'Invalid email format: "not-an-email"',
      severity: 'error',
      suggestedFix: undefined,
    },
    {
      row: 12,
      column: 'Status',
      value: 'activ',
      message: 'Invalid value: "activ" - not in allowed values',
      severity: 'error',
      suggestedFix: 'Active',
    },
    {
      row: 18,
      column: 'Phone',
      value: '123',
      message: 'Phone number too short',
      severity: 'error',
      suggestedFix: undefined,
    },
  ],
  warnings: [
    {
      row: 3,
      column: 'Name',
      value: 'john doe',
      message: 'Name should be properly capitalized',
      severity: 'warning',
      suggestedFix: 'John Doe',
    },
    {
      row: 8,
      column: 'PostalCode',
      value: '12345',
      message: 'Postal code format may be incorrect',
      severity: 'warning',
      suggestedFix: '12345-0000',
    },
    {
      row: 15,
      column: 'City',
      value: 'new york',
      message: 'City name should be capitalized',
      severity: 'warning',
      suggestedFix: 'New York',
    },
  ],
  infos: [
    {
      row: 2,
      column: 'Country',
      value: 'US',
      message: 'Country code will be expanded to full name',
      severity: 'info',
      suggestedFix: 'United States',
    },
    {
      row: 10,
      column: 'Date',
      value: '2024-01-01',
      message: 'Date format detected as ISO',
      severity: 'info',
      suggestedFix: undefined,
    },
  ],
  autoFixed: 12,
  unfixable: 3,
};

// Example 3: Errors only with truncation
const manyErrorsResult: ValidationResult = {
  isValid: false,
  errors: Array.from({ length: 15 }, (_, i) => ({
    row: i + 1,
    column: 'Email',
    value: `invalid${i}@`,
    message: `Invalid email format in row ${i + 1}`,
    severity: 'error' as const,
    suggestedFix: undefined,
  })),
  warnings: [],
  infos: [],
  autoFixed: 0,
  unfixable: 15,
};

export function ValidationSummaryExamples() {
  return (
    <div className="p-8 space-y-8 bg-surface-light min-h-screen">
      <h1 className="text-2xl font-bold text-text-primary">ValidationSummary Examples</h1>

      {/* Example 1: All Valid */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 1: All Valid</h2>
        <ValidationSummary result={validResult} />
      </div>

      {/* Example 2: Mixed Results - Collapsed */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 2: Mixed Results (Collapsed)</h2>
        <ValidationSummary result={mixedResult} showDetails={false} />
      </div>

      {/* Example 3: Mixed Results - Expanded */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 3: Mixed Results (Expanded)</h2>
        <ValidationSummary result={mixedResult} showDetails={true} />
      </div>

      {/* Example 4: Many Errors with Truncation */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 4: Many Errors (Max 10, Expanded)</h2>
        <ValidationSummary result={manyErrorsResult} showDetails={true} maxErrors={10} />
      </div>

      {/* Example 5: Many Errors with Custom Max */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Example 5: Many Errors (Max 5, Expanded)</h2>
        <ValidationSummary result={manyErrorsResult} showDetails={true} maxErrors={5} />
      </div>
    </div>
  );
}

export default ValidationSummaryExamples;
