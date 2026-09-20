# ReferenceResolver

Client-side reference lookup for import preview operations. Resolves foreign key references with fuzzy matching and provides helpful suggestions when references are not found.

## Overview

The ReferenceResolver helps users during CSV import by:
- Looking up foreign key references (e.g., user IDs, department names)
- Providing fuzzy matching for typos and variations
- Suggesting near-matches when exact matches aren't found
- Supporting multiple search strategies (exact, partial, fuzzy)

## Key Concepts

### Design Philosophy

Per system design decisions:
- **Missing references are NOT blocking errors** - allow import to proceed
- **Client-side only** - no server roundtrips during import preview
- **Helpful suggestions** - guide users to fix issues themselves

### Resolution Priority

The resolver tries multiple strategies in order:

1. **Exact ID match** (confidence: 1.0)
   - Case-insensitive comparison
   - Fastest lookup

2. **Exact displayValue match** (confidence: 1.0)
   - Case-insensitive comparison
   - Handles user-friendly names

3. **Fuzzy match** (confidence: 0.65-0.9)
   - Partial matches (substring)
   - Typo tolerance (Levenshtein distance)
   - Word-level matching

4. **Not found** (confidence: 0)
   - Returns suggestions for correction

## API Reference

### Core Functions

#### `createReferenceRegistry(): ReferenceRegistry`

Creates an empty registry to store reference data.

```typescript
const registry = createReferenceRegistry();
```

#### `registerReferenceData(registry, tableName, data)`

Registers reference data for a table.

```typescript
registerReferenceData(registry, 'users', [
  { id: 'user-1', displayValue: 'John Smith', email: 'john@example.com' },
  { id: 'user-2', displayValue: 'Jane Doe', email: 'jane@example.com' }
]);
```

**Parameters:**
- `registry` - The reference registry
- `tableName` - Name of the table (e.g., 'users', 'departments')
- `data` - Array of reference objects with `id` and `displayValue`

**Notes:**
- Each reference must have `id` and `displayValue` fields
- Additional fields (like `email`) are preserved
- Calling this again overwrites previous data

#### `clearReferenceData(registry, tableName)`

Removes reference data for a table.

```typescript
clearReferenceData(registry, 'users');
```

#### `getReferenceData(registry, tableName): ReferenceData[]`

Retrieves all reference data for a table.

```typescript
const users = getReferenceData(registry, 'users');
console.log(`Loaded ${users.length} users`);
```

Returns empty array if table doesn't exist.

#### `resolveReference(registry, tableName, value, options?): ResolveResult`

Resolves a reference value to its ID and metadata.

```typescript
// Exact match
const result = resolveReference(registry, 'users', 'John Smith');
// { found: true, id: 'user-1', displayValue: 'John Smith', confidence: 1.0 }

// Fuzzy match
const result = resolveReference(registry, 'users', 'Jhon', { fuzzyMatch: true });
// { found: true, id: 'user-1', displayValue: 'John Smith', confidence: 0.65 }

// Not found (with suggestions)
const result = resolveReference(registry, 'users', 'Johnny');
// { found: false, id: null, displayValue: null, confidence: 0, suggestions: [...] }
```

**Parameters:**
- `registry` - The reference registry
- `tableName` - Name of the table to search
- `value` - Value to resolve (ID or display value)
- `options` - Optional configuration:
  - `searchField` - Specific field to search (default: try 'id' then 'displayValue')
  - `fuzzyMatch` - Enable fuzzy matching (default: false)
  - `maxSuggestions` - Max suggestions when not found (default: 3)

**Returns:** `ResolveResult`
```typescript
interface ResolveResult {
  found: boolean;
  id: string | null;
  displayValue: string | null;
  confidence: number;        // 1.0 = exact, 0.65-0.9 = fuzzy, 0 = not found
  suggestions?: ReferenceData[];  // Near matches if not found
}
```

#### `fuzzyMatch(needle, haystack): number`

Calculates similarity score between two strings.

```typescript
fuzzyMatch('test', 'test');      // 1.0 - exact match
fuzzyMatch('test', 'testing');   // 0.8 - starts with
fuzzyMatch('est', 'testing');    // 0.7 - contains
fuzzyMatch('tset', 'test');      // 0.75 - small typo
fuzzyMatch('abc', 'xyz');        // 0.0 - no match
```

**Returns:** Score from 0 (no match) to 1.0 (exact match)

## Usage Patterns

### Basic Reference Lookup

```typescript
import {
  createReferenceRegistry,
  registerReferenceData,
  resolveReference
} from './ReferenceResolver';

// 1. Create registry
const registry = createReferenceRegistry();

// 2. Load reference data (from API or cache)
const users = await fetchUsers();
registerReferenceData(registry, 'users', users);

// 3. Resolve references during import
const csvRows = parseCSV(file);
for (const row of csvRows) {
  const result = resolveReference(registry, 'users', row.assignedTo);

  if (result.found) {
    row.assignedToId = result.id;
    row.assignedToDisplay = result.displayValue;
  } else {
    // Missing reference - not blocking, but show warning
    row.warnings.push({
      field: 'assignedTo',
      message: `User "${row.assignedTo}" not found`,
      suggestions: result.suggestions?.map(s => s.displayValue)
    });
  }
}
```

### Search by Specific Field

```typescript
// Look up user by email instead of ID or display name
const result = resolveReference(registry, 'users', 'john@example.com', {
  searchField: 'email'
});

if (result.found) {
  console.log(`Found user: ${result.displayValue} (ID: ${result.id})`);
}
```

### Fuzzy Matching for User Input

```typescript
// Enable fuzzy matching to handle typos
const result = resolveReference(registry, 'departments', 'Enginering', {
  fuzzyMatch: true
});

if (result.found && result.confidence < 1.0) {
  // Fuzzy match - ask user to confirm
  console.log(`Did you mean "${result.displayValue}"?`);
}
```

### Showing Suggestions

```typescript
const result = resolveReference(registry, 'users', 'Jon Smth', {
  maxSuggestions: 5
});

if (!result.found && result.suggestions?.length > 0) {
  console.log('Did you mean:');
  result.suggestions.forEach(s => {
    console.log(`  - ${s.displayValue} (${s.id})`);
  });
}
```

### Multiple Reference Tables

```typescript
const registry = createReferenceRegistry();

// Register multiple tables
registerReferenceData(registry, 'users', await fetchUsers());
registerReferenceData(registry, 'departments', await fetchDepartments());
registerReferenceData(registry, 'projects', await fetchProjects());

// Resolve from different tables
const user = resolveReference(registry, 'users', row.userId);
const dept = resolveReference(registry, 'departments', row.department);
const proj = resolveReference(registry, 'projects', row.projectId);
```

### Pre-loading for Performance

```typescript
// Load all reference data upfront for fast lookups
async function preloadReferences(registry: ReferenceRegistry) {
  const [users, departments, projects] = await Promise.all([
    fetchUsers(),
    fetchDepartments(),
    fetchProjects()
  ]);

  registerReferenceData(registry, 'users', users);
  registerReferenceData(registry, 'departments', departments);
  registerReferenceData(registry, 'projects', projects);
}

// Then use synchronously during import
const registry = createReferenceRegistry();
await preloadReferences(registry);

// Now lookups are instant (no async)
const result = resolveReference(registry, 'users', 'john@example.com', {
  searchField: 'email'
});
```

## Fuzzy Matching Algorithm

### Matching Strategies

The fuzzy matcher uses multiple strategies:

1. **Exact match** (score: 1.0)
   - Case-insensitive string equality

2. **Starts with** (score: 0.8)
   - Haystack starts with needle
   - Example: "test" matches "testing"

3. **Contains** (score: 0.7)
   - Haystack contains needle as substring
   - Example: "est" matches "testing"

4. **Word-level matching** (score: 0.65-0.75)
   - Matches against individual words in multi-word strings
   - Example: "Johnny" matches "John Smith" (word "John")

5. **Levenshtein distance** (score: 0.65-0.9)
   - Small edit distance (1-3 characters)
   - Relative to string length (distance/length ≤ 0.5)
   - Example: "tset" matches "test" (distance: 2)

### Performance Characteristics

- **Exact/substring matching**: O(n) - very fast
- **Fuzzy matching**: O(n × m) where m = average string length
- **Tested with 1000+ records**: < 100ms for exact, < 500ms for fuzzy

### Tuning Thresholds

Current thresholds in the algorithm:
- Max Levenshtein distance: 3
- Max distance ratio: 0.5 (distance ≤ 50% of string length)
- Suggestion threshold: Any score > 0

To adjust, modify the `fuzzyMatch()` function:
```typescript
// Current
if (distance <= 3 && distance / maxLen <= 0.5) { ... }

// Stricter (fewer false positives)
if (distance <= 2 && distance / maxLen <= 0.4) { ... }

// Looser (more matches)
if (distance <= 4 && distance / maxLen <= 0.6) { ... }
```

## Error Handling

The resolver is designed to never throw errors:

```typescript
// Non-existent table - returns not found
const result = resolveReference(registry, 'nonexistent', 'test');
// { found: false, id: null, displayValue: null, confidence: 0, suggestions: [] }

// Empty string - returns not found
const result = resolveReference(registry, 'users', '');
// { found: false, ... }

// Missing fields in data - warns but doesn't throw
registerReferenceData(registry, 'items', [
  { displayValue: 'Item 1' } // Missing 'id' - warning logged
]);
```

## Integration with ValidationEngine

The ReferenceResolver is used by ValidationEngine for reference-type columns:

```typescript
// In ValidationEngine
if (column.type === 'reference' && column.refTable) {
  const result = resolveReference(
    registry,
    column.refTable,
    value,
    {
      fuzzyMatch: column.allowFuzzyMatch,
      searchField: column.refDisplayField
    }
  );

  if (!result.found) {
    // Soft warning - not blocking
    warnings.push({
      field: column.key,
      message: `Reference not found: ${value}`,
      suggestions: result.suggestions?.map(s => s.displayValue)
    });
  } else if (result.confidence < 1.0) {
    // Fuzzy match - suggest confirmation
    warnings.push({
      field: column.key,
      message: `Fuzzy match: "${value}" → "${result.displayValue}" (${Math.round(result.confidence * 100)}% confidence)`,
      suggestions: []
    });
  }
}
```

## Testing

Run tests with:
```bash
npx tsx src/features/import-export/engine/test-runner-reference.ts
```

Test coverage:
- ✅ Registry creation and management
- ✅ Reference registration and retrieval
- ✅ Exact matching (ID and displayValue)
- ✅ Case-insensitive matching
- ✅ Whitespace trimming
- ✅ Search by specific field
- ✅ Fuzzy matching with typos
- ✅ Partial matches
- ✅ Suggestions when not found
- ✅ Edge cases (empty table, non-existent table)
- ✅ Performance with large datasets (1000+ records)
- ✅ Real-world scenarios

## Implementation Notes

### Why Client-Side?

Per design decision #2: "Missing references are non-blocking soft warnings"
- No server validation required during import preview
- Fast lookups from in-memory registry
- User sees results immediately as they type

### Memory Usage

For typical datasets:
- 1,000 users × 200 bytes ≈ 200KB
- 100 departments × 100 bytes ≈ 10KB
- 500 projects × 150 bytes ≈ 75KB
- **Total: ~300KB** - negligible for modern browsers

### Confidence Scoring

Confidence levels guide UI feedback:
- **1.0** - Exact match, show green checkmark
- **0.65-0.9** - Fuzzy match, show warning "Did you mean...?"
- **0** - Not found, show error with suggestions

## Future Enhancements

Potential improvements (not implemented):
- [ ] Phonetic matching (Soundex, Metaphone) for name variations
- [ ] Abbreviation expansion (e.g., "JS" → "John Smith")
- [ ] Multi-field matching (search across multiple fields)
- [ ] Custom scoring functions per table
- [ ] Caching of fuzzy match results
- [ ] Internationalization (Unicode normalization)

## Related Files

- `ValidationEngine.ts` - Uses ReferenceResolver for reference-type columns
- `schema.types.ts` - Defines `refTable` and `refDisplayField` in ColumnDef
- `ReferenceResolver.test.ts` - Comprehensive test suite (vitest format)
- `test-runner-reference.ts` - Standalone test runner (custom format)
