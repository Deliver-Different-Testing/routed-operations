import type { ImportSchema, ColumnDef } from '../types/schema.types';
import type { FieldDiff, ImportRowStatus } from '../types/import.types';

export interface DiffOptions {
  ignoreCase?: boolean;           // Default true for string comparison
  ignoreWhitespace?: boolean;     // Default true - trim before compare
  ignoreLocked?: boolean;         // Default true - skip locked fields
  compareNulls?: boolean;         // Default true - treat null/undefined/'' as equal
}

export interface DiffResult {
  status: ImportRowStatus;        // 'new' | 'modified' | 'unchanged' | 'delete'
  diffs: FieldDiff[];             // Array of field changes
  changedFields: string[];        // Just the field names that changed
  unchangedFields: string[];      // Fields that didn't change
}

export interface BatchDiffResult {
  results: Map<string, DiffResult>;  // Keyed by unique ID
  summary: {
    new: number;
    modified: number;
    unchanged: number;
    deleted: number;
  };
}

const DEFAULT_OPTIONS: Required<DiffOptions> = {
  ignoreCase: true,
  ignoreWhitespace: true,
  ignoreLocked: true,
  compareNulls: true,
};

/**
 * Detect delete markers in a row
 * Checks for _DELETE column with value 'YES', 'TRUE', '1', etc.
 */
export function hasDeleteMarker(row: Record<string, unknown>): boolean {
  const deleteValue = row._DELETE;

  if (deleteValue === undefined || deleteValue === null) {
    return false;
  }

  const deleteStr = String(deleteValue).trim().toUpperCase();
  return ['YES', 'TRUE', '1', 'Y', 'T'].includes(deleteStr);
}

/**
 * Normalize a value for comparison based on options
 */
function normalizeValue(value: unknown, options: Required<DiffOptions>): unknown {
  // Handle null/undefined/empty string equivalence
  if (options.compareNulls) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
  }

  // String normalization
  if (typeof value === 'string') {
    let normalized = value;
    if (options.ignoreWhitespace) {
      normalized = normalized.trim();
    }
    if (options.ignoreCase) {
      normalized = normalized.toLowerCase();
    }
    // After normalization, check if empty
    if (options.compareNulls && normalized === '') {
      return null;
    }
    return normalized;
  }

  return value;
}

/**
 * Check if a value is "empty" (null, undefined, or empty/whitespace string)
 */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}

/**
 * Compare two values with type awareness
 * Handles CSV string values being compared against typed data (numbers, booleans, etc.)
 */
export function compareValues(
  importedValue: unknown,
  existingValue: unknown,
  column: ColumnDef,
  options?: DiffOptions
): { isEqual: boolean; normalizedImported: unknown; normalizedExisting: unknown } {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // FIRST: Check if both values are "empty" (null, undefined, or empty string)
  // This is the most common case for missing fields in CSV round-trips
  if (opts.compareNulls && isEmpty(importedValue) && isEmpty(existingValue)) {
    return { isEqual: true, normalizedImported: null, normalizedExisting: null };
  }

  // Normalize values
  const normalizedImported = normalizeValue(importedValue, opts);
  const normalizedExisting = normalizeValue(existingValue, opts);

  // Both null after normalization - equal
  if (opts.compareNulls && normalizedImported === null && normalizedExisting === null) {
    return { isEqual: true, normalizedImported, normalizedExisting };
  }

  // One null, other not - not equal
  if (normalizedImported === null || normalizedExisting === null) {
    return { isEqual: false, normalizedImported, normalizedExisting };
  }

  // Phone numbers: compare digits only (ignore formatting like parentheses, dashes, spaces)
  if (column.type === 'phone') {
    const importedDigits = String(normalizedImported).replace(/\D/g, '');
    const existingDigits = String(normalizedExisting).replace(/\D/g, '');
    return {
      isEqual: importedDigits === existingDigits,
      normalizedImported: importedDigits,
      normalizedExisting: existingDigits
    };
  }

  // For string-like types, do case-insensitive string comparison
  // This handles CSV strings matching typed data regardless of case
  if (column.type === 'string' || column.type === 'enum' || column.type === 'id' ||
      column.type === 'email' || column.type === 'reference') {
    const importedStr = String(normalizedImported).toLowerCase().trim();
    const existingStr = String(normalizedExisting).toLowerCase().trim();
    return {
      isEqual: importedStr === existingStr,
      normalizedImported: normalizedImported,
      normalizedExisting: normalizedExisting
    };
  }

  // Type-specific comparison
  switch (column.type) {
    case 'number': {
      const importedNum = typeof normalizedImported === 'number'
        ? normalizedImported
        : Number(normalizedImported);
      const existingNum = typeof normalizedExisting === 'number'
        ? normalizedExisting
        : Number(normalizedExisting);

      // Handle NaN cases
      if (isNaN(importedNum) && isNaN(existingNum)) {
        return { isEqual: true, normalizedImported: importedNum, normalizedExisting: existingNum };
      }
      if (isNaN(importedNum) || isNaN(existingNum)) {
        return { isEqual: false, normalizedImported: importedNum, normalizedExisting: existingNum };
      }

      return {
        isEqual: importedNum === existingNum,
        normalizedImported: importedNum,
        normalizedExisting: existingNum
      };
    }

    case 'boolean': {
      const importedBool = normalizeBooleanValue(normalizedImported);
      const existingBool = normalizeBooleanValue(normalizedExisting);
      return {
        isEqual: importedBool === existingBool,
        normalizedImported: importedBool,
        normalizedExisting: existingBool
      };
    }

    case 'date':
    case 'datetime':
    case 'time': {
      // Try to parse as dates and compare
      const importedDate = parseDate(normalizedImported);
      const existingDate = parseDate(normalizedExisting);

      if (importedDate && existingDate) {
        return {
          isEqual: importedDate.getTime() === existingDate.getTime(),
          normalizedImported: importedDate.toISOString(),
          normalizedExisting: existingDate.toISOString()
        };
      }

      // Fall back to string comparison
      return {
        isEqual: normalizedImported === normalizedExisting,
        normalizedImported,
        normalizedExisting
      };
    }

    case 'tags': {
      // Compare arrays of tags
      const importedTags = normalizeTagsValue(normalizedImported);
      const existingTags = normalizeTagsValue(normalizedExisting);

      // Sort and compare
      const importedSorted = [...importedTags].sort();
      const existingSorted = [...existingTags].sort();

      const isEqual = importedSorted.length === existingSorted.length &&
        importedSorted.every((tag, idx) => tag === existingSorted[idx]);

      return {
        isEqual,
        normalizedImported: importedSorted,
        normalizedExisting: existingSorted
      };
    }

    default: {
      // String comparison (already normalized)
      return {
        isEqual: normalizedImported === normalizedExisting,
        normalizedImported,
        normalizedExisting
      };
    }
  }
}

/**
 * Normalize boolean values from various representations
 */
function normalizeBooleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;

  const str = String(value).trim().toLowerCase();
  return ['true', 'yes', '1', 'y', 't'].includes(str);
}

/**
 * Parse a date from various formats
 */
function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (!value) return null;

  const str = String(value);
  const date = new Date(str);

  // Check if valid date
  if (isNaN(date.getTime())) return null;
  return date;
}

/**
 * Normalize tags value to array
 */
function normalizeTagsValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(v => String(v).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    // Split by comma or semicolon
    return value.split(/[,;]/).map(v => v.trim()).filter(Boolean);
  }

  return [];
}

/**
 * Determine the type of field difference
 */
function getDiffType(
  oldValue: unknown,
  newValue: unknown,
  options: Required<DiffOptions>
): 'added' | 'changed' | 'removed' {
  const normalizedOld = normalizeValue(oldValue, options);
  const normalizedNew = normalizeValue(newValue, options);

  const isOldEmpty = normalizedOld === null;
  const isNewEmpty = normalizedNew === null;

  if (isOldEmpty && !isNewEmpty) return 'added';
  if (!isOldEmpty && isNewEmpty) return 'removed';
  return 'changed';
}

/**
 * Compare a single imported row against existing record
 */
export function diffRow(
  importedRow: Record<string, unknown>,
  existingRecord: Record<string, unknown> | null,
  schema: ImportSchema,
  options?: DiffOptions
): DiffResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Check for delete marker first
  if (hasDeleteMarker(importedRow)) {
    return {
      status: 'delete',
      diffs: [],
      changedFields: [],
      unchangedFields: [],
    };
  }

  // New record - no existing data
  if (!existingRecord) {
    return {
      status: 'new',
      diffs: [],
      changedFields: [],
      unchangedFields: [],
    };
  }

  // Compare fields
  const diffs: FieldDiff[] = [];
  const changedFields: string[] = [];
  const unchangedFields: string[] = [];

  for (const column of schema.columns) {
    // Skip locked fields if option enabled
    if (opts.ignoreLocked && column.locked) {
      continue;
    }

    const importedValue = importedRow[column.key];
    const existingValue = existingRecord[column.key];

    // Skip comparison if field wasn't in the import (undefined means not mapped)
    // This allows partial updates where not all fields are included
    if (importedValue === undefined && existingValue !== undefined) {
      unchangedFields.push(column.key);
      continue;
    }

    const comparison = compareValues(importedValue, existingValue, column, options);

    if (comparison.isEqual) {
      unchangedFields.push(column.key);
    } else {
      changedFields.push(column.key);
      diffs.push({
        field: column.key,
        oldValue: existingValue,
        newValue: importedValue,
        type: getDiffType(existingValue, importedValue, opts),
      });
    }
  }

  // Determine status
  const status: ImportRowStatus = diffs.length > 0 ? 'modified' : 'unchanged';

  return {
    status,
    diffs,
    changedFields,
    unchangedFields,
  };
}

/**
 * Compare multiple rows against existing data
 */
export function diffAll(
  importedRows: Record<string, unknown>[],
  existingData: Record<string, unknown>[],
  schema: ImportSchema,
  _options?: DiffOptions
): BatchDiffResult {

  // Build lookup map of existing data by unique key for O(1) lookups
  const existingMap = new Map<string, Record<string, unknown>>();
  for (const record of existingData) {
    const uniqueValue = record[schema.uniqueKey];
    if (uniqueValue !== undefined && uniqueValue !== null) {
      const key = String(uniqueValue);
      existingMap.set(key, record);
    }
  }

  // Compare each imported row
  const results = new Map<string, DiffResult>();
  const summary = {
    new: 0,
    modified: 0,
    unchanged: 0,
    deleted: 0,
  };

  for (const importedRow of importedRows) {
    const uniqueValue = importedRow[schema.uniqueKey];

    // Skip rows without unique key
    if (uniqueValue === undefined || uniqueValue === null) {
      continue;
    }

    const uniqueKey = String(uniqueValue);
    const existingRecord = existingMap.get(uniqueKey) || null;

    const diffResult = diffRow(importedRow, existingRecord, schema, _options);
    results.set(uniqueKey, diffResult);

    // Update summary
    switch (diffResult.status) {
      case 'new':
        summary.new++;
        break;
      case 'modified':
        summary.modified++;
        break;
      case 'unchanged':
        summary.unchanged++;
        break;
      case 'delete':
        summary.deleted++;
        break;
    }
  }

  return {
    results,
    summary,
  };
}
