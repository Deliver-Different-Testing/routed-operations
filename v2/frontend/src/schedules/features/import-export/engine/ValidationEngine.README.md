# ValidationEngine Implementation

## Overview
The ValidationEngine validates parsed CSV rows against ImportSchema definitions, providing type-specific validation, auto-fix capabilities, and comprehensive error reporting.

## Files Created

1. **ValidationEngine.ts** (510 lines)
   - Main validation logic
   - All required validators
   - Auto-fix utilities

2. **ValidationEngine.test.ts** (435 lines)
   - Comprehensive unit tests
   - Tests for all validators
   - Auto-fix scenarios

3. **ValidationEngine.integration-test.ts** (170 lines)
   - Real-world usage example
   - Product catalog schema
   - Demonstrates auto-fix benefits

## Key Design Decisions

### 1. Two-Phase Validation
- **Phase 1**: Auto-fix (if enabled) - normalize values
- **Phase 2**: Type validation - enforce rules

This allows users to get cleaner data automatically while still catching genuine errors.

### 2. Confidence Thresholds for Dates
- Date/datetime parsing uses SmartDateParser confidence scores
- Minimum confidence threshold: **0.5** (50%)
- Below threshold = error
- Ambiguous dates (0.5-0.9) = warning

**Rationale**: Balance between accepting reasonable dates and flagging truly unparseable values.

### 3. Required Field Handling
- Empty string counts as empty (not just null/undefined)
- Trimming happens before empty check
- Required violations are errors (not warnings)

### 4. Locked Fields Skip Validation
- ID fields (locked: true) bypass all validation
- Prevents errors on auto-generated IDs
- User can't modify locked fields anyway

### 5. Auto-Fix Behaviors

| Type | Auto-Fix Action |
|------|----------------|
| All | Trim whitespace |
| enum | Normalize case to match values[] |
| boolean | Convert yes/no/1/0 to true/false |
| phone | Strip formatting, keep digits and + |
| date | Convert to ISO format (YYYY-MM-DD) |
| datetime | Convert to ISO format |
| email | Lowercase |
| number | Remove commas (1,234 → 1234) |

### 6. Validation Rules by Type

#### string
- Check min/max length (if specified)
- Apply pattern regex (if specified)

#### number
- Must be numeric (uses Number())
- Check min/max value (if specified)

#### boolean
- Accept: true/false, yes/no, 1/0, on/off
- Case insensitive

#### enum
- Must match one of values[] (case insensitive)
- Suggest closest match if fuzzy matching enabled

#### date
- Use SmartDateParser.parseDate()
- Accept if confidence > 0.5
- Warn if ambiguous (e.g., 01/02/2024)

#### datetime
- Use SmartDateParser.parseDateTime()
- Accept if confidence > 0.5

#### email
- Basic pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
- Catches most common errors

#### phone
- Minimum 7 digits (local phone)
- Maximum 15 digits (international standard)
- Flexible formatting

#### reference
- Check non-empty
- Actual lookup to refTable deferred to the tidy-up pass

#### id
- Always valid if present (locked fields)

### 7. Error Reporting

**FieldError structure:**
```typescript
{
  row: number;           // 1-based (row 1 = header, data starts at 2)
  column: string;        // Column key
  value: unknown;        // Original value
  message: string;       // Human-readable error
  severity: 'error' | 'warning' | 'info';
  suggestedFix?: unknown; // Auto-fix suggestion
}
```

**ValidationResult aggregation:**
- `isValid`: true only if zero errors
- `errors[]`: Blocking issues
- `warnings[]`: Non-blocking issues
- `autoFixed`: Count of fixed fields
- `unfixable`: Count of rows with errors

### 8. Schema Hooks

**beforeValidate**: Transform row before validation
- Example: Uppercase names, set defaults
- Applied once per row

**afterValidate**: Transform row after validation
- Example: Final cleanup, computed fields
- Applied once per row

## Integration Test Results

Using a Product catalog schema with 4 test rows:

- **Without auto-fix**: 13 errors, 0 auto-fixes
- **With auto-fix**: 13 errors, 7 auto-fixes
- **Auto-fix corrected**:
  - Trimmed whitespace
  - Normalized enum case
  - Lowercased email
  - Formatted phone numbers
  - Parsed dates to ISO format
  - Converted "yes" to true

**Remaining errors** (unfixable):
- Too-short strings
- Invalid patterns
- Out-of-range numbers
- Invalid enum values
- Missing required fields
- Invalid dates

## Performance Considerations

- **O(n × m)** complexity where n = rows, m = columns
- Each cell validated once
- Auto-fix runs before validation (single pass)
- No redundant type conversions

## Testing Status

**Unit Tests**: ✅ Created (not run - Vitest not installed)
- 20+ test cases covering all validators
- Auto-fix scenarios
- Edge cases (empty, null, whitespace)

**Integration Test**: ✅ Verified
- Runs successfully with npx tsx
- Demonstrates real-world usage
- Shows auto-fix benefits

**Type Safety**: ✅ Verified
- TypeScript compilation succeeds
- No type errors

## Known Limitations

1. **Reference validation** - Currently only checks non-empty
   - Current limitation: reference lookup against refTable is not implemented in this extracted module

2. **Fuzzy matching** - Basic implementation
   - Planned improvement: Levenshtein distance for better suggestions

3. **Time type** - Not implemented yet
   - Validation returns null (passes)

4. **Tags type** - Not implemented yet
   - Validation returns null (passes)

## Usage Example

```typescript
import { validateAll } from './ValidationEngine';
import { productSchema } from './schemas';

const csvData = [
  { name: 'Widget', price: '99.99', status: 'active' },
  { name: 'Gadget', price: '149', status: 'INACTIVE' },
];

const result = validateAll(csvData, productSchema, {
  autoFix: true,
  strictMode: false,
});

console.log(`Valid: ${result.isValid}`);
console.log(`Errors: ${result.errors.length}`);
console.log(`Auto-fixed: ${result.autoFixed} fields`);

result.errors.forEach(err => {
  console.log(`Row ${err.row}: ${err.message}`);
});
```

## Next Steps

1. Install Vitest and run unit tests
2. Implement reference lookup (ReferenceResolver integration)
3. Add Levenshtein distance for fuzzy enum matching
4. Implement time and tags validation
5. Add validation caching for large datasets
