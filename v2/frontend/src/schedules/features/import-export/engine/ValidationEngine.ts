/**
 * ValidationEngine - Validates parsed CSV rows against ImportSchema
 *
 * Features:
 * - Type-specific validation (string, number, boolean, enum, date, email, phone, reference)
 * - Auto-fix capabilities (trim, normalize case, format dates/phones)
 * - Required field enforcement
 * - Pattern matching with regex
 * - Min/max constraints
 * - Smart date parsing with confidence thresholds
 */

import type { ColumnDef, ImportSchema } from '../types/schema.types';
import type { FieldError, ValidationResult, RowValidationResult } from '../types/validation.types';
import { parseDate, parseDateTime } from './SmartDateParser';

export interface ValidateRowOptions {
  autoFix?: boolean;         // Default true - attempt to fix minor issues
  strictMode?: boolean;      // Default false - warnings vs errors
}

const DEFAULT_OPTIONS: Required<ValidateRowOptions> = {
  autoFix: true,
  strictMode: false,
};

/**
 * Validate a single row against schema
 */
export function validateRow(
  row: Record<string, unknown>,
  schema: ImportSchema,
  rowNumber: number,
  options?: ValidateRowOptions
): RowValidationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const errors: FieldError[] = [];
  const warnings: FieldError[] = [];
  const autoFixes: { field: string; original: unknown; fixed: unknown }[] = [];

  // Apply beforeValidate hook if present
  let processedRow = row;
  if (schema.beforeValidate) {
    processedRow = schema.beforeValidate(row);
  }

  // Validate each column
  for (const column of schema.columns) {
    // Skip locked fields (id fields don't need validation)
    if (column.locked) {
      continue;
    }

    const value = processedRow[column.key];

    // Check required fields
    if (column.required && isEmpty(value)) {
      errors.push({
        row: rowNumber,
        column: column.key,
        value,
        message: `${column.header} is required`,
        severity: opts.strictMode ? 'error' : 'warning',
      });
      continue;
    }

    // Skip validation for empty optional fields
    if (isEmpty(value)) {
      continue;
    }

    // Try auto-fix first
    let processedValue = value;
    if (opts.autoFix) {
      const fixResult = tryAutoFix(value, column);
      if (fixResult.wasFixed) {
        processedValue = fixResult.fixed;
        autoFixes.push({
          field: column.key,
          original: value,
          fixed: fixResult.fixed,
        });
        processedRow[column.key] = fixResult.fixed;
      }
    }

    // Type-specific validation
    const error = validateByType(processedValue, column, rowNumber);
    if (error) {
      if (error.severity === 'error') {
        errors.push(error);
      } else {
        warnings.push(error);
      }
    }
  }

  // Apply afterValidate hook if present
  if (schema.afterValidate) {
    processedRow = schema.afterValidate(processedRow);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    autoFixes,
  };
}

/**
 * Validate all rows and return aggregate result
 */
export function validateAll(
  rows: Record<string, unknown>[],
  schema: ImportSchema,
  options?: ValidateRowOptions
): ValidationResult {
  const allErrors: FieldError[] = [];
  const allWarnings: FieldError[] = [];
  const allInfos: FieldError[] = [];
  let autoFixedCount = 0;
  let unfixableCount = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // +2 because row 1 is header, data starts at row 2
    const result = validateRow(row, schema, rowNumber, options);

    allErrors.push(...result.errors);
    allWarnings.push(...result.warnings);

    if (result.autoFixes.length > 0) {
      autoFixedCount += result.autoFixes.length;
    }

    if (result.errors.length > 0) {
      unfixableCount++;
    }
  });

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    infos: allInfos,
    autoFixed: autoFixedCount,
    unfixable: unfixableCount,
  };
}

/**
 * Route to appropriate type validator
 */
function validateByType(value: unknown, column: ColumnDef, rowNumber: number): FieldError | null {
  switch (column.type) {
    case 'id':
      // ID fields are always valid if present
      return null;

    case 'string':
      return validateString(value, column, rowNumber);

    case 'number':
      return validateNumber(value, column, rowNumber);

    case 'boolean':
      return validateBoolean(value, column, rowNumber);

    case 'enum':
      return validateEnum(value, column, rowNumber);

    case 'date':
      return validateDate(value, column, rowNumber);

    case 'datetime':
      return validateDateTime(value, column, rowNumber);

    case 'email':
      return validateEmail(value, column, rowNumber);

    case 'phone':
      return validatePhone(value, column, rowNumber);

    case 'reference':
      return validateReference(value, column, rowNumber);

    case 'time':
    case 'tags':
      // Time and tags validation not implemented yet
      return null;

    default:
      return null;
  }
}

/**
 * Validate string type
 */
export function validateString(
  value: unknown,
  column: ColumnDef,
  rowNumber?: number
): FieldError | null {
  const strValue = String(value);

  // Check min length
  if (column.min !== undefined && strValue.length < column.min) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} must be at least ${column.min} characters`,
      'error'
    );
  }

  // Check max length
  if (column.max !== undefined && strValue.length > column.max) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} must be at most ${column.max} characters`,
      'error'
    );
  }

  // Check pattern
  if (column.pattern && !column.pattern.test(strValue)) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} does not match required pattern`,
      'error'
    );
  }

  return null;
}

/**
 * Validate number type
 */
export function validateNumber(
  value: unknown,
  column: ColumnDef,
  rowNumber?: number
): FieldError | null {
  const numValue = Number(value);

  if (isNaN(numValue)) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} must be a valid number`,
      'error'
    );
  }

  // Check min value
  if (column.min !== undefined && numValue < column.min) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} must be at least ${column.min}`,
      'error'
    );
  }

  // Check max value
  if (column.max !== undefined && numValue > column.max) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} must be at most ${column.max}`,
      'error'
    );
  }

  return null;
}

/**
 * Validate boolean type
 * Accepts: true/false, yes/no, 1/0, on/off (case insensitive)
 */
export function validateBoolean(
  value: unknown,
  column: ColumnDef,
  rowNumber?: number
): FieldError | null {
  const strValue = String(value).toLowerCase().trim();
  const validBooleans = ['true', 'false', 'yes', 'no', '1', '0', 'on', 'off'];

  if (!validBooleans.includes(strValue)) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} must be a boolean (true/false, yes/no, 1/0, on/off)`,
      'error',
      normalizeBoolean(strValue)
    );
  }

  return null;
}

/**
 * Validate enum type
 */
export function validateEnum(
  value: unknown,
  column: ColumnDef,
  rowNumber?: number
): FieldError | null {
  if (!column.values || column.values.length === 0) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} enum has no valid values defined`,
      'error'
    );
  }

  const strValue = String(value).trim();

  // Case-insensitive match
  const matchedValue = column.values.find(
    v => v.toLowerCase() === strValue.toLowerCase()
  );

  if (!matchedValue) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} must be one of: ${column.values.join(', ')}`,
      'error',
      column.allowFuzzyMatch ? findClosestMatch(strValue, column.values) : undefined
    );
  }

  return null;
}

/**
 * Validate date type using SmartDateParser
 */
export function validateDate(
  value: unknown,
  column: ColumnDef,
  rowNumber?: number
): FieldError | null {
  const strValue = String(value).trim();
  const parseResult = parseDate(strValue);

  if (!parseResult.value || parseResult.confidence < 0.5) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} is not a valid date`,
      'error',
      parseResult.value || undefined
    );
  }

  if (parseResult.wasAmbiguous && parseResult.confidence < 0.9) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} date format is ambiguous (${parseResult.originalFormat})`,
      'warning',
      parseResult.value
    );
  }

  return null;
}

/**
 * Validate datetime type using SmartDateParser
 */
export function validateDateTime(
  value: unknown,
  column: ColumnDef,
  rowNumber?: number
): FieldError | null {
  const strValue = String(value).trim();
  const parseResult = parseDateTime(strValue);

  if (!parseResult.combined || parseResult.confidence < 0.5) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} is not a valid date/time`,
      'error',
      parseResult.combined || undefined
    );
  }

  if (parseResult.wasAmbiguous && parseResult.confidence < 0.9) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} date/time format is ambiguous`,
      'warning',
      parseResult.combined
    );
  }

  return null;
}

/**
 * Validate email type
 */
export function validateEmail(
  value: unknown,
  column: ColumnDef,
  rowNumber?: number
): FieldError | null {
  const strValue = String(value).trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(strValue)) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} is not a valid email address`,
      'error'
    );
  }

  return null;
}

/**
 * Validate phone type
 */
export function validatePhone(
  value: unknown,
  column: ColumnDef,
  rowNumber?: number
): FieldError | null {
  const strValue = String(value).trim();

  // Remove all non-digit characters except + at the start
  const digitsOnly = strValue.replace(/[^\d+]/g, '');

  // Check for minimum viable phone number (at least 7 digits)
  const digitCount = digitsOnly.replace(/\+/g, '').length;

  if (digitCount < 7) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} must contain at least 7 digits`,
      'error'
    );
  }

  // Check for maximum reasonable phone number (15 digits for international)
  if (digitCount > 15) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} must contain at most 15 digits`,
      'error'
    );
  }

  return null;
}

/**
 * Validate reference type
 * For now, just check non-empty. Actual lookup will be implemented later.
 */
export function validateReference(
  value: unknown,
  column: ColumnDef,
  rowNumber?: number
): FieldError | null {
  const strValue = String(value).trim();

  if (strValue.length === 0) {
    return createError(
      rowNumber || 0,
      column.key,
      value,
      `${column.header} reference cannot be empty`,
      'error'
    );
  }

  // Current limitation: actual reference lookup against refTable is not implemented
  // For now, just validate non-empty

  return null;
}

/**
 * Try to auto-fix common issues
 */
export function tryAutoFix(value: unknown, column: ColumnDef): { fixed: unknown; wasFixed: boolean } {
  let fixed = value;
  let wasFixed = false;

  // Trim whitespace from all string values
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== value) {
      fixed = trimmed;
      wasFixed = true;
    }
    value = trimmed;
  }

  const strValue = String(value);

  // Type-specific auto-fixes
  switch (column.type) {
    case 'enum':
      // Normalize case to match values[]
      if (column.values) {
        const matchedValue = column.values.find(
          v => v.toLowerCase() === strValue.toLowerCase()
        );
        if (matchedValue && matchedValue !== value) {
          fixed = matchedValue;
          wasFixed = true;
        }
      }
      break;

    case 'boolean':
      // Normalize to true/false
      const normalized = normalizeBoolean(strValue);
      if (normalized !== undefined && normalized !== value) {
        fixed = normalized;
        wasFixed = true;
      }
      break;

    case 'phone':
      // Strip non-digits except + at start
      const phoneNormalized = normalizePhone(strValue);
      if (phoneNormalized !== value) {
        fixed = phoneNormalized;
        wasFixed = true;
      }
      break;

    case 'date':
      // Parse to ISO format
      const dateResult = parseDate(strValue);
      if (dateResult.value && dateResult.value !== value) {
        fixed = dateResult.value;
        wasFixed = true;
      }
      break;

    case 'datetime':
      // Parse to ISO datetime format
      const datetimeResult = parseDateTime(strValue);
      if (datetimeResult.combined && datetimeResult.combined !== value) {
        fixed = datetimeResult.combined;
        wasFixed = true;
      }
      break;

    case 'email':
      // Lowercase email
      const emailLower = strValue.toLowerCase();
      if (emailLower !== value) {
        fixed = emailLower;
        wasFixed = true;
      }
      break;

    case 'number':
      // Remove commas from numbers (e.g., "1,234" -> "1234")
      if (typeof value === 'string') {
        const cleaned = value.replace(/,/g, '');
        const num = Number(cleaned);
        if (!isNaN(num) && cleaned !== value) {
          fixed = num;
          wasFixed = true;
        }
      }
      break;
  }

  return { fixed, wasFixed };
}

// === Helper Functions ===

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function createError(
  row: number,
  column: string,
  value: unknown,
  message: string,
  severity: 'error' | 'warning' | 'info',
  suggestedFix?: unknown
): FieldError {
  return {
    row,
    column,
    value,
    message,
    severity,
    suggestedFix,
  };
}

function normalizeBoolean(value: string): boolean | undefined {
  const lower = value.toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(lower)) return true;
  if (['false', 'no', '0', 'off'].includes(lower)) return false;
  return undefined;
}

function normalizePhone(value: string): string {
  // Keep + at start if present, remove all other non-digits
  const hasPlus = value.startsWith('+');
  const digitsOnly = value.replace(/\D/g, '');
  return hasPlus ? `+${digitsOnly}` : digitsOnly;
}

function findClosestMatch(value: string, options: string[]): string | undefined {
  // Simple fuzzy match: find option with lowest Levenshtein distance
  // For now, just return the first case-insensitive match
  const lower = value.toLowerCase();
  return options.find(opt => opt.toLowerCase().includes(lower));
}
