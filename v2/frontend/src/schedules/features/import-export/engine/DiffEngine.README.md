# DiffEngine Documentation

## Overview

The DiffEngine compares imported data against existing records to determine what changes need to be applied. It supports intelligent field comparison with type awareness, configurable comparison options, and efficient batch processing.

## Core Functions

### `diffRow()`

Compares a single imported row against an existing record.

**Signature:**
```typescript
function diffRow(
  importedRow: Record<string, unknown>,
  existingRecord: Record<string, unknown> | null,
  schema: ImportSchema,
  options?: DiffOptions
): DiffResult
```

**Returns:**
- `status`: 'new' | 'modified' | 'unchanged' | 'delete'
- `diffs`: Array of field changes with old/new values
- `changedFields`: Field names that changed
- `unchangedFields`: Field names that didn't change

**Example:**
```typescript
const result = diffRow(
  { id: '1', name: 'ACME Corp', employees: 150 },
  { id: '1', name: 'Acme Corp', employees: 100 },
  schema
);
// result.status: 'modified'
// result.changedFields: ['name', 'employees']
```

### `diffAll()`

Compares multiple rows against existing data in a single batch operation.

**Signature:**
```typescript
function diffAll(
  importedRows: Record<string, unknown>[],
  existingData: Record<string, unknown>[],
  schema: ImportSchema,
  options?: DiffOptions
): BatchDiffResult
```

**Returns:**
- `results`: Map of unique ID → DiffResult
- `summary`: Count of new/modified/unchanged/deleted records

**Performance:** Uses O(1) lookup map for efficient comparison of large datasets.

**Example:**
```typescript
const result = diffAll(importedRows, existingData, schema);
// result.summary: { new: 5, modified: 12, unchanged: 83, deleted: 2 }
// result.results.get('C001'): DiffResult for company C001
```

### `compareValues()`

Compares two values with type-aware logic.

**Signature:**
```typescript
function compareValues(
  importedValue: unknown,
  existingValue: unknown,
  column: ColumnDef,
  options?: DiffOptions
): { isEqual: boolean; normalizedImported: unknown; normalizedExisting: unknown }
```

**Type-Specific Behavior:**
- **String**: Case-insensitive (default), whitespace-trimmed
- **Number**: Handles string "123" vs number 123
- **Boolean**: Normalizes 'yes'/'true'/'1' → true
- **Date**: Parses and compares timestamps
- **Tags**: Compares arrays (order-independent)

### `hasDeleteMarker()`

Checks if a row has a delete marker.

**Signature:**
```typescript
function hasDeleteMarker(row: Record<string, unknown>): boolean
```

**Truthy Values:** 'YES', 'TRUE', '1', 'Y', 'T' (case-insensitive)

## Options

### `DiffOptions`

Configure comparison behavior:

```typescript
interface DiffOptions {
  ignoreCase?: boolean;        // Default: true
  ignoreWhitespace?: boolean;  // Default: true
  ignoreLocked?: boolean;      // Default: true
  compareNulls?: boolean;      // Default: true
}
```

**Option Details:**

| Option | Default | Description |
|--------|---------|-------------|
| `ignoreCase` | `true` | Treat "ACME" and "acme" as equal |
| `ignoreWhitespace` | `true` | Trim strings before comparison |
| `ignoreLocked` | `true` | Skip locked fields in diff |
| `compareNulls` | `true` | Treat null/undefined/'' as equal |

## Record Status Types

### `'new'`
- No existing record found
- All fields are additions
- `diffs` array is empty

### `'modified'`
- Existing record found
- One or more non-locked fields changed
- `diffs` array contains changes

### `'unchanged'`
- Existing record found
- All non-locked fields are equal
- `diffs` array is empty

### `'delete'`
- Row has `_DELETE` marker
- Record should be deleted
- Other field comparisons skipped

## Diff Types

Each field change is classified:

### `'added'`
- Field was empty/null in existing record
- Now has a value in imported row
- Example: `email: null → "test@example.com"`

### `'changed'`
- Field had a value in existing record
- Now has a different value in imported row
- Example: `name: "ACME Corp" → "ACME Corporation"`

### `'removed'`
- Field had a value in existing record
- Now empty/null in imported row
- Example: `phone: "555-1234" → null`

## Type-Specific Comparison

### String Comparison
```typescript
// Default: case-insensitive, whitespace-trimmed
compareValues('  ACME Corp  ', 'acme corp', stringColumn)
// → isEqual: true

// Case-sensitive
compareValues('ACME', 'acme', stringColumn, { ignoreCase: false })
// → isEqual: false
```

### Number Comparison
```typescript
// String vs number
compareValues('123', 123, numberColumn)
// → isEqual: true

// Floating point
compareValues('123.45', 123.45, numberColumn)
// → isEqual: true
```

### Boolean Comparison
```typescript
// Various truthy values
compareValues('yes', true, boolColumn) // true
compareValues('1', true, boolColumn)   // true
compareValues('Y', true, boolColumn)   // true

// Various falsy values
compareValues('no', false, boolColumn)  // true
compareValues('0', false, boolColumn)   // true
compareValues('', false, boolColumn)    // true
```

### Date Comparison
```typescript
// ISO strings
compareValues('2024-01-15T10:30:00Z', '2024-01-15T10:30:00Z', dateColumn)
// → isEqual: true

// Date objects
compareValues(new Date('2024-01-15'), new Date('2024-01-15'), dateColumn)
// → isEqual: true
```

### Tags Comparison
```typescript
// Array comparison (order-independent)
compareValues(['tag1', 'tag2'], ['tag2', 'tag1'], tagsColumn)
// → isEqual: true

// String to array
compareValues('tag1,tag2', ['tag1', 'tag2'], tagsColumn)
// → isEqual: true

// Semicolon-separated
compareValues('tag1;tag2', ['tag1', 'tag2'], tagsColumn)
// → isEqual: true
```

## Performance Considerations

### Batch Operations
`diffAll()` uses O(1) lookup for existing data:
- Builds Map by unique key
- No nested loops
- Scales efficiently to 10,000+ rows

### Example Performance:
```typescript
// 1000 rows: ~5-10ms
// 10,000 rows: ~50-100ms
const result = diffAll(
  Array(10000).fill({...}),
  Array(10000).fill({...}),
  schema
);
```

## Common Use Cases

### 1. Import Preview
```typescript
const preview = diffAll(importedRows, existingData, schema);

console.log(`Will add ${preview.summary.new} new records`);
console.log(`Will update ${preview.summary.modified} records`);
console.log(`Will delete ${preview.summary.deleted} records`);
console.log(`${preview.summary.unchanged} records unchanged`);
```

### 2. Change Detection
```typescript
const result = diffRow(importedRow, existingRecord, schema);

if (result.status === 'modified') {
  result.diffs.forEach(diff => {
    console.log(`${diff.field}: ${diff.oldValue} → ${diff.newValue}`);
  });
}
```

### 3. Selective Updates
```typescript
const result = diffAll(importedRows, existingData, schema);

// Process only modified records
const toUpdate = Array.from(result.results.entries())
  .filter(([_, diff]) => diff.status === 'modified')
  .map(([id, diff]) => ({ id, changes: diff.diffs }));
```

### 4. Locked Field Protection
```typescript
// Skip locked fields (default)
const result1 = diffRow(imported, existing, schema, { ignoreLocked: true });

// Include locked fields (override protection)
const result2 = diffRow(imported, existing, schema, { ignoreLocked: false });
```

## Error Handling

The DiffEngine is designed to be robust:

- **Missing unique keys**: Rows without unique key are skipped in batch operations
- **Type mismatches**: Values are coerced to column type
- **Invalid dates**: Falls back to string comparison
- **NaN values**: Treated as equal to each other, unequal to numbers
- **Null/undefined**: Treated as equivalent by default

## Testing

### Manual Test
Run the manual test to verify functionality:
```bash
npx tsx src/features/import-export/engine/DiffEngine.manual-test.ts
```

### Unit Tests
Comprehensive test suite available in `DiffEngine.test.ts`:
- Delete marker detection
- Type-specific comparisons
- Record status detection
- Locked field handling
- Diff type classification
- Batch processing
- Performance tests

## Integration Example

```typescript
import { diffAll, type DiffOptions } from './engine/DiffEngine';
import { companySchema } from './schemas/company.schema';

async function importCompanies(importedRows: Record<string, unknown>[]) {
  // Fetch existing data
  const existingData = await fetchExistingCompanies();

  // Configure comparison options
  const options: DiffOptions = {
    ignoreCase: true,
    ignoreWhitespace: true,
    ignoreLocked: true,
    compareNulls: true,
  };

  // Compare imported vs existing
  const result = diffAll(importedRows, existingData, companySchema, options);

  // Process results
  for (const [id, diff] of result.results.entries()) {
    switch (diff.status) {
      case 'new':
        await createRecord(importedRows.find(r => r.companyId === id)!);
        break;
      case 'modified':
        await updateRecord(id, diff.diffs);
        break;
      case 'delete':
        await deleteRecord(id);
        break;
      case 'unchanged':
        // Skip
        break;
    }
  }

  return result.summary;
}
```

## Key Design Decisions

1. **Default Options**: Sensible defaults (ignore case/whitespace, skip locked fields)
2. **Type Awareness**: Column type determines comparison logic
3. **Null Handling**: null/undefined/'' treated as equivalent by default
4. **Performance**: O(1) lookup map for batch operations
5. **Immutable**: All functions are pure, no side effects
6. **Type Safety**: Full TypeScript support with strict types
