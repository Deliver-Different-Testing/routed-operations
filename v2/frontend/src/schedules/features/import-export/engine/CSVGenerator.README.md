# CSVGenerator

Export data and generate CSV templates for the Universal Import/Export System.

## Overview

CSVGenerator provides functions to:
- Export data arrays to CSV format
- Generate empty CSV templates with hints for users
- Handle proper CSV escaping and quoting
- Support multiple delimiters and line endings
- Trigger browser downloads

## Quick Start

```typescript
import { generateCSV, generateTemplate, downloadCSV } from '@/features/import-export/engine';

// Generate CSV from data
const csv = generateCSV(dataArray, schema);
downloadCSV(csv, 'clients.csv');

// Generate empty template
const template = generateTemplate(schema);
downloadCSV(template, 'clients-template.csv');
```

## Functions

### generateCSV(data, schema, options?)

Generate CSV from an array of data objects.

```typescript
const data = [
  { id: 'C-001', name: 'Acme Corp', status: 'Active' },
  { id: 'C-002', name: 'Beta Inc', status: 'Inactive' },
];

const csv = generateCSV(data, clientSchema);
// Output:
// Client ID,Company Name,Status
// C-001,Acme Corp,Active
// C-002,Beta Inc,Inactive
```

**Options:**
- `delimiter`: Field separator (default: `,`)
- `includeHeaders`: Include header row (default: `true`)
- `quoteAll`: Quote all values (default: `false`)
- `lineEnding`: Line terminator (default: `\n`)

### generateTemplate(schema, options?)

Generate an empty CSV template with headers and optional hints.

```typescript
const template = generateTemplate(clientSchema, {
  includeHintRow: true,
  includeExampleRow: false
});

// Output:
// Client ID,Company Name,Status,Rate Group
// [AUTO - DO NOT EDIT],Required - Text,Active/Inactive,Reference to Rate Groups
```

**Options (extends CSVGenerateOptions):**
- `includeHintRow`: Add row with format hints (default: `true`)
- `includeExampleRow`: Add row with example values (default: `false`)
- `maxHintLength`: Truncate hints longer than this (default: `50`)

### generateHeaders(schema, options?)

Generate just the CSV header row.

```typescript
const headers = generateHeaders(schema);
// "Client ID,Company Name,Status"
```

### generateHintRow(schema, options?)

Generate a hint row explaining each column format.

```typescript
const hints = generateHintRow(schema);
// "[AUTO],Required - Text,Active/Inactive,Reference to Rate Groups"
```

### escapeCSVValue(value, options?)

Escape a single value for CSV output.

```typescript
escapeCSVValue('hello')           // hello
escapeCSVValue('hello,world')     // "hello,world"
escapeCSVValue('say "hi"')        // "say ""hi"""
escapeCSVValue(null)              // (empty string)
escapeCSVValue(true)              // true
escapeCSVValue(123)               // 123
escapeCSVValue(['tag1', 'tag2'])  // tag1,tag2
```

**Options:**
- `delimiter`: Field separator for detecting need to quote (default: `,`)
- `quoteAll`: Force quoting of all values (default: `false`)

### rowToCSV(row, columns, options?)

Convert a single data row to a CSV line.

```typescript
const line = rowToCSV(
  { id: 'C-001', name: 'Acme, Inc.', status: 'Active' },
  schema.columns
);
// "C-001,\"Acme, Inc.\",Active"
```

### downloadCSV(content, filename)

Trigger a browser download of CSV content.

```typescript
downloadCSV(csvContent, 'export-2024-12-08.csv');
```

## CSV Escaping Rules

Values are quoted when they contain:
- The delimiter character (`,` by default)
- Double quotes (escaped as `""`)
- Newlines (`\n` or `\r\n`)
- Leading or trailing whitespace

Examples:
```typescript
"normal text"           → normal text
"text, with comma"      → "text, with comma"
"text with \"quotes\""  → "text with ""quotes"""
" leading space"        → " leading space"
```

## Value Conversion

| Type | Conversion |
|------|------------|
| `null` / `undefined` | Empty string |
| `boolean` | `"true"` or `"false"` |
| `number` | String representation |
| `Date` | ISO 8601 string |
| Simple array | Comma-separated |
| Complex array | JSON string |
| Object | JSON string |

## Hint Generation

Hints are automatically generated based on column type:

| Type | Hint Example |
|------|--------------|
| `id` | `[AUTO]` |
| `locked` | `[AUTO - DO NOT EDIT]` |
| `enum` | `Active/Inactive/Pending` |
| `reference` | `Reference to Rate Groups` |
| `date` | `YYYY-MM-DD` |
| `time` | `HH:mm` |
| `datetime` | `YYYY-MM-DD HH:mm` |
| `email` | `email@example.com` |
| `phone` | `(555) 555-5555` |
| `boolean` | `true/false` |
| `number` (with min/max) | `0-100` |
| `tags` | `comma,separated,tags` |
| `string` | `Text` |

**Custom Hints:**
```typescript
{
  key: 'discount',
  header: 'Discount %',
  type: 'number',
  templateHint: 'Enter percentage (0-100)'
}
// Hint: "Enter percentage (0-100)"
```

**Required Fields:**
```typescript
{
  key: 'name',
  header: 'Name',
  type: 'string',
  required: true
}
// Hint: "Required - Text"
```

## Template Example

For this schema:
```typescript
{
  columns: [
    { key: 'id', header: 'Client ID', type: 'id', locked: true },
    { key: 'name', header: 'Company Name', type: 'string', required: true },
    { key: 'status', header: 'Status', type: 'enum', values: ['Active', 'Inactive'] },
    { key: 'rateGroup', header: 'Rate Group', type: 'reference', refTable: 'Rate Groups' },
  ]
}
```

Generated template:
```csv
Client ID,Company Name,Status,Rate Group
[AUTO - DO NOT EDIT],Required - Text,Active/Inactive,Reference to Rate Groups
```

With example row:
```csv
Client ID,Company Name,Status,Rate Group
[AUTO - DO NOT EDIT],Required - Text,Active/Inactive,Reference to Rate Groups
,Example,Active,REF-001
```

## Custom Delimiters

```typescript
// Tab-separated values (TSV)
const tsv = generateCSV(data, schema, { delimiter: '\t' });

// Semicolon-separated (common in Europe)
const csv = generateCSV(data, schema, { delimiter: ';' });

// Pipe-separated
const csv = generateCSV(data, schema, { delimiter: '|' });
```

## Windows Line Endings

```typescript
const csv = generateCSV(data, schema, {
  lineEnding: '\r\n'  // Windows CRLF
});
```

## Usage in Components

```typescript
import { generateCSV, generateTemplate, downloadCSV } from '@/features/import-export/engine';
import { clientSchema } from './schemas/clientSchema';

function ExportButton({ data }) {
  const handleExport = () => {
    const csv = generateCSV(data, clientSchema);
    downloadCSV(csv, `clients-export-${new Date().toISOString().split('T')[0]}.csv`);
  };

  return <button onClick={handleExport}>Export to CSV</button>;
}

function TemplateButton() {
  const handleDownload = () => {
    const template = generateTemplate(clientSchema);
    downloadCSV(template, 'clients-template.csv');
  };

  return <button onClick={handleDownload}>Download Template</button>;
}
```

## Edge Cases Handled

- Empty data arrays (headers only)
- Missing/undefined values (empty cells)
- Special characters in headers
- Very long hint text (truncated)
- Complex nested objects (JSON stringified)
- Empty arrays (empty cells)
- Mixed types in arrays (JSON stringified)

## Related

- [CSVParser](./CSVParser.ts) - Parse CSV files
- [ValidationEngine](./ValidationEngine.ts) - Validate imported data
- [schema.types.ts](../types/schema.types.ts) - Schema definitions
