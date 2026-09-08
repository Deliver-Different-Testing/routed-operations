import type { ImportSchema, ColumnDef } from '../types/schema.types';

export interface CSVGenerateOptions {
  delimiter?: string;           // Default ','
  includeHeaders?: boolean;     // Default true
  quoteAll?: boolean;           // Default false - only quote when needed
  lineEnding?: '\n' | '\r\n';   // Default '\n'
}

export interface TemplateOptions extends CSVGenerateOptions {
  includeHintRow?: boolean;     // Default true - row with format hints
  includeExampleRow?: boolean;  // Default false - row with example data
  maxHintLength?: number;       // Truncate long hints (default 50)
}

/**
 * Generate CSV from data array
 */
export function generateCSV(
  data: Record<string, unknown>[],
  schema: ImportSchema,
  options?: CSVGenerateOptions
): string {
  const opts: Required<CSVGenerateOptions> = {
    delimiter: options?.delimiter ?? ',',
    includeHeaders: options?.includeHeaders ?? true,
    quoteAll: options?.quoteAll ?? false,
    lineEnding: options?.lineEnding ?? '\n',
  };

  const lines: string[] = [];

  // Add headers
  if (opts.includeHeaders) {
    lines.push(generateHeaders(schema, opts));
  }

  // Add data rows
  for (const row of data) {
    lines.push(rowToCSV(row, schema.columns, opts));
  }

  return lines.join(opts.lineEnding);
}

/**
 * Generate empty template with headers and optional hints
 */
export function generateTemplate(
  schema: ImportSchema,
  options?: TemplateOptions
): string {
  const opts: Required<TemplateOptions> = {
    delimiter: options?.delimiter ?? ',',
    includeHeaders: options?.includeHeaders ?? true,
    quoteAll: options?.quoteAll ?? false,
    lineEnding: options?.lineEnding ?? '\n',
    includeHintRow: options?.includeHintRow ?? true,
    includeExampleRow: options?.includeExampleRow ?? false,
    maxHintLength: options?.maxHintLength ?? 50,
  };

  const lines: string[] = [];

  // Add headers
  if (opts.includeHeaders) {
    lines.push(generateHeaders(schema, opts));
  }

  // Add hint row
  if (opts.includeHintRow) {
    lines.push(generateHintRow(schema, opts));
  }

  // Add example row if requested
  if (opts.includeExampleRow) {
    lines.push(generateExampleRow(schema, opts));
  }

  return lines.join(opts.lineEnding);
}

/**
 * Generate CSV headers row
 */
export function generateHeaders(
  schema: ImportSchema,
  options?: CSVGenerateOptions
): string {
  const opts = {
    delimiter: options?.delimiter ?? ',',
    quoteAll: options?.quoteAll ?? false,
  };

  const headers = schema.columns.map((col) => col.header);
  return headers
    .map((header) => escapeCSVValue(header, opts))
    .join(opts.delimiter);
}

/**
 * Generate hint row for template
 */
export function generateHintRow(
  schema: ImportSchema,
  options?: TemplateOptions
): string {
  const opts = {
    delimiter: options?.delimiter ?? ',',
    quoteAll: options?.quoteAll ?? false,
    maxHintLength: options?.maxHintLength ?? 50,
  };

  const hints = schema.columns.map((col) => generateColumnHint(col, opts.maxHintLength));
  return hints
    .map((hint) => escapeCSVValue(hint, opts))
    .join(opts.delimiter);
}

/**
 * Generate example row for template
 */
function generateExampleRow(
  schema: ImportSchema,
  options?: TemplateOptions
): string {
  const opts = {
    delimiter: options?.delimiter ?? ',',
    quoteAll: options?.quoteAll ?? false,
  };

  const examples = schema.columns.map((col) => generateColumnExample(col));
  return examples
    .map((example) => escapeCSVValue(example, opts))
    .join(opts.delimiter);
}

/**
 * Generate hint for a column
 */
function generateColumnHint(col: ColumnDef, maxLength: number): string {
  // Locked fields
  if (col.locked) {
    return '[AUTO - DO NOT EDIT]';
  }

  // Custom template hint
  if (col.templateHint) {
    let hint = col.templateHint;
    if (col.required) {
      hint = `Required - ${hint}`;
    }
    return truncateHint(hint, maxLength);
  }

  // Generate hint based on type
  let hint = '';

  switch (col.type) {
    case 'id':
      hint = '[AUTO]';
      break;
    case 'enum':
      hint = col.values ? col.values.join('/') : 'Select value';
      break;
    case 'reference':
      hint = col.refTable ? `Reference to ${col.refTable}` : 'Reference';
      break;
    case 'date':
      hint = col.dateFormat || 'YYYY-MM-DD';
      break;
    case 'time':
      hint = 'HH:mm';
      break;
    case 'datetime':
      hint = col.dateFormat || 'YYYY-MM-DD HH:mm';
      break;
    case 'email':
      hint = 'email@example.com';
      break;
    case 'phone':
      hint = '(555) 555-5555';
      break;
    case 'boolean':
      hint = 'true/false';
      break;
    case 'number':
      if (col.min !== undefined && col.max !== undefined) {
        hint = `${col.min}-${col.max}`;
      } else if (col.min !== undefined) {
        hint = `Min: ${col.min}`;
      } else if (col.max !== undefined) {
        hint = `Max: ${col.max}`;
      } else {
        hint = 'Number';
      }
      break;
    case 'tags':
      hint = 'comma,separated,tags';
      break;
    case 'string':
    default:
      hint = 'Text';
      break;
  }

  // Prepend "Required" if needed
  if (col.required && hint !== '[AUTO]' && hint !== '[AUTO - DO NOT EDIT]') {
    hint = `Required - ${hint}`;
  }

  return truncateHint(hint, maxLength);
}

/**
 * Generate example value for a column
 */
function generateColumnExample(col: ColumnDef): string {
  if (col.locked || col.type === 'id') {
    return '';
  }

  if (col.templateDefault) {
    return col.templateDefault;
  }

  switch (col.type) {
    case 'enum':
      return col.values?.[0] || '';
    case 'reference':
      return 'REF-001';
    case 'date':
      return '2024-01-15';
    case 'time':
      return '09:00';
    case 'datetime':
      return '2024-01-15 09:00';
    case 'email':
      return 'user@example.com';
    case 'phone':
      return '(555) 555-1234';
    case 'boolean':
      return 'true';
    case 'number':
      return '100';
    case 'tags':
      return 'tag1,tag2';
    case 'string':
    default:
      return 'Example';
  }
}

/**
 * Truncate hint to max length
 */
function truncateHint(hint: string, maxLength: number): string {
  if (hint.length <= maxLength) {
    return hint;
  }
  return hint.substring(0, maxLength - 3) + '...';
}

/**
 * Escape a single value for CSV
 */
export function escapeCSVValue(
  value: unknown,
  options?: { delimiter?: string; quoteAll?: boolean }
): string {
  const delimiter = options?.delimiter ?? ',';
  const quoteAll = options?.quoteAll ?? false;

  // Handle null/undefined
  if (value === null || value === undefined) {
    return '';
  }

  // Convert to string
  let stringValue: string;

  if (value instanceof Date) {
    stringValue = value.toISOString();
  } else if (typeof value === 'boolean') {
    stringValue = value ? 'true' : 'false';
  } else if (typeof value === 'number') {
    stringValue = String(value);
  } else if (Array.isArray(value)) {
    // For simple arrays, join with comma
    // For complex objects, use JSON
    if (value.length === 0) {
      return '';
    }
    if (value.every((item) => typeof item === 'string' || typeof item === 'number')) {
      stringValue = value.join(',');
    } else {
      stringValue = JSON.stringify(value);
    }
  } else if (typeof value === 'object') {
    stringValue = JSON.stringify(value);
  } else {
    stringValue = String(value);
  }

  // Determine if quoting is needed
  const needsQuoting =
    quoteAll ||
    stringValue.includes(delimiter) ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r') ||
    stringValue.startsWith(' ') ||
    stringValue.endsWith(' ');

  if (!needsQuoting) {
    return stringValue;
  }

  // Escape double quotes by doubling them
  const escapedValue = stringValue.replace(/"/g, '""');

  return `"${escapedValue}"`;
}

/**
 * Convert data row to CSV line
 */
export function rowToCSV(
  row: Record<string, unknown>,
  columns: ColumnDef[],
  options?: CSVGenerateOptions
): string {
  const opts = {
    delimiter: options?.delimiter ?? ',',
    quoteAll: options?.quoteAll ?? false,
  };

  const values = columns.map((col) => {
    const value = row[col.key];
    return escapeCSVValue(value, opts);
  });

  return values.join(opts.delimiter);
}

/**
 * Trigger file download in browser
 */
export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
