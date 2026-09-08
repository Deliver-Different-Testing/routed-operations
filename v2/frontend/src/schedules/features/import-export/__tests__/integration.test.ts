/**
 * Integration Test - Universal Import/Export System
 *
 * Tests the complete import workflow from end to end:
 * 1. Parse CSV string
 * 2. Map columns to schema
 * 3. Validate data
 * 4. Calculate diffs against existing data
 * 5. Generate summary
 *
 * Also tests:
 * - Export flow (generateCSV from data)
 * - Template generation
 * - Error handling for invalid CSV
 */

import { parseCSV } from '../engine/CSVParser';
import { validateAll } from '../engine/ValidationEngine';
import { diffAll } from '../engine/DiffEngine';
import { generateCSV, generateTemplate } from '../engine/CSVGenerator';
import { clientsSchema } from '../schemas/clients.schema';
import type { ImportSummary, ParsedRow } from '../types';

console.log('=== Import/Export Integration Test ===\n');

// Test data - simulates a CSV file with various scenarios
const csvContent = `Client ID,Company Name,Status,Email,Phone
,Acme Corp,Active,acme@example.com,555-1234
,Beta Inc,Inactive,beta@example.com,555-5678
CL-001,Existing Client,Active,existing@example.com,555-9999
,New Company,Active,invalid-email,555-0000
`;

// Existing data in the system (simulates database records)
const existingData = [
  {
    id: 'CL-001',
    name: 'Existing Client',
    status: 'Inactive',  // Will be modified to 'Active'
    email: 'old@example.com',  // Will be modified
    phone: '555-9999'  // Unchanged
  },
  {
    id: 'CL-002',
    name: 'Another Client',
    status: 'Active',
    email: 'another@example.com'
  },
];

let testsPassed = true;
let errorCount = 0;

// ============================================================================
// TEST 1: Parse CSV
// ============================================================================
console.log('Test 1: Parsing CSV...');
const parseResult = parseCSV(csvContent);
console.log(`  ✓ Parsed ${parseResult.rows.length} rows`);
console.log(`  ✓ Detected ${parseResult.headers.length} columns`);
console.log(`  ✓ Delimiter: "${parseResult.detectedDelimiter}"`);

if (parseResult.rows.length !== 4) {
  console.log(`  ✗ FAIL: Expected 4 parsed rows, got ${parseResult.rows.length}`);
  testsPassed = false;
  errorCount++;
}

if (parseResult.headers.length !== 5) {
  console.log(`  ✗ FAIL: Expected 5 headers, got ${parseResult.headers.length}`);
  testsPassed = false;
  errorCount++;
}

// ============================================================================
// TEST 2: Column Mapping
// ============================================================================
console.log('\nTest 2: Column mapping...');

// Simulated column mapping (in real app, user would define this)
const columnMapping: Record<string, string> = {
  'Client ID': 'id',
  'Company Name': 'name',
  'Status': 'status',
  'Email': 'email',
  'Phone': 'phone',
};

// Apply mapping to parsed rows
const mappedRows = parseResult.rows.map(row => {
  const mapped: Record<string, unknown> = {};
  Object.entries(row).forEach(([csvCol, value]) => {
    const schemaKey = columnMapping[csvCol];
    if (schemaKey) {
      mapped[schemaKey] = value;
    }
  });
  return mapped;
});

console.log(`  ✓ Mapped ${mappedRows.length} rows to schema`);
console.log(`  ✓ Sample mapped row:`, JSON.stringify(mappedRows[0], null, 2));

// ============================================================================
// TEST 3: Validation
// ============================================================================
console.log('\nTest 3: Validating data...');
const validationResult = validateAll(mappedRows, clientsSchema);

console.log(`  Valid: ${validationResult.isValid}`);
console.log(`  Errors: ${validationResult.errors.length}`);
console.log(`  Warnings: ${validationResult.warnings.length}`);
console.log(`  Auto-fixed: ${validationResult.autoFixed}`);

// We expect 1 error (invalid-email in row 4)
if (validationResult.errors.length < 1) {
  console.log(`  ✗ FAIL: Expected at least 1 validation error (invalid email)`);
  testsPassed = false;
  errorCount++;
} else {
  console.log(`  ✓ Validation correctly detected ${validationResult.errors.length} error(s)`);
  validationResult.errors.forEach(error => {
    console.log(`    - Row ${error.row}, ${error.column}: ${error.message}`);
  });
}

// ============================================================================
// TEST 4: Diff Calculation
// ============================================================================
console.log('\nTest 4: Calculating diffs against existing data...');
const diffResult = diffAll(mappedRows, existingData, clientsSchema);

console.log(`  New: ${diffResult.summary.new}`);
console.log(`  Modified: ${diffResult.summary.modified}`);
console.log(`  Unchanged: ${diffResult.summary.unchanged}`);
console.log(`  Deleted: ${diffResult.summary.deleted}`);

// We expect:
// - 1 modified record (CL-001 exists, has changes)
// - Rows without IDs won't be counted in diff (they're new but without ID)
if (diffResult.summary.modified !== 1) {
  console.log(`  ✗ FAIL: Expected 1 modified record, got ${diffResult.summary.modified}`);
  testsPassed = false;
  errorCount++;
} else {
  console.log(`  ✓ Diff calculation correct`);
}

// Show the modification details for CL-001
const cl001Diff = diffResult.results.get('CL-001');
if (cl001Diff) {
  console.log(`\n  Details for modified record CL-001:`);
  console.log(`    Status: ${cl001Diff.status}`);
  console.log(`    Changed fields: ${cl001Diff.changedFields.join(', ')}`);
  cl001Diff.diffs.forEach(diff => {
    console.log(`      ${diff.field}: "${diff.oldValue}" → "${diff.newValue}"`);
  });
}

// ============================================================================
// TEST 5: Build Parsed Rows with Status
// ============================================================================
console.log('\nTest 5: Building final parsed rows with status...');

const parsedRows: ParsedRow[] = mappedRows.map((row, index) => {
  const rowId = row.id as string;
  const diffInfo = rowId ? diffResult.results.get(rowId) : null;

  // Determine status
  let status: ImportSummary['new'] extends number ? 'new' : never;
  if (!rowId || rowId === '') {
    status = 'new' as any;
  } else {
    status = (diffInfo?.status || 'new') as any;
  }

  return {
    rowNumber: index + 2, // +2 for header row and 1-based index
    status: status as any,
    data: row,
    validationResult: {
      isValid: validationResult.errors.filter(e => e.row === index + 2).length === 0,
      errors: validationResult.errors.filter(e => e.row === index + 2),
      warnings: validationResult.warnings.filter(e => e.row === index + 2),
      autoFixes: [],
    },
    diff: diffInfo?.diffs || [],
  };
});

// Calculate summary
const summary: ImportSummary = {
  total: parsedRows.length,
  new: parsedRows.filter(r => r.status === 'new').length,
  modified: parsedRows.filter(r => r.status === 'modified').length,
  unchanged: parsedRows.filter(r => r.status === 'unchanged').length,
  errors: parsedRows.filter(r => !r.validationResult.isValid).length,
  deleted: parsedRows.filter(r => r.status === 'delete').length,
};

console.log(`  ✓ Built ${parsedRows.length} parsed rows`);
console.log(`  ✓ Summary calculated`);

console.log('\n=== Final Import Summary ===');
console.log(`Total rows: ${summary.total}`);
console.log(`New records: ${summary.new}`);
console.log(`Modified records: ${summary.modified}`);
console.log(`Unchanged records: ${summary.unchanged}`);
console.log(`Error records: ${summary.errors}`);
console.log(`Deleted records: ${summary.deleted}`);

if (summary.total !== 4) {
  console.log('✗ FAIL: Expected 4 total rows in summary');
  testsPassed = false;
  errorCount++;
}

// ============================================================================
// TEST 6: Export Flow (generateCSV from data)
// ============================================================================
console.log('\n=== Test 6: Export Flow ===');
console.log('Generating CSV from existing data...');

const exportData = [
  { id: 'CL-001', name: 'Acme Corp', status: 'Active', email: 'acme@example.com', phone: '555-1234' },
  { id: 'CL-002', name: 'Beta Inc', status: 'Inactive', email: 'beta@example.com', phone: '555-5678' },
];

const exportedCSV = generateCSV(exportData, clientsSchema);
console.log(`  ✓ Generated CSV (${exportedCSV.length} bytes)`);

// Parse it back to verify round-trip
const reparsedResult = parseCSV(exportedCSV);
if (reparsedResult.rows.length !== exportData.length) {
  console.log(`  ✗ FAIL: Round-trip export/import failed. Expected ${exportData.length} rows, got ${reparsedResult.rows.length}`);
  testsPassed = false;
  errorCount++;
} else {
  console.log(`  ✓ Round-trip export/import successful (${reparsedResult.rows.length} rows)`);
}

// ============================================================================
// TEST 7: Template Generation
// ============================================================================
console.log('\n=== Test 7: Template Generation ===');
console.log('Generating blank CSV template...');

const template = generateTemplate(clientsSchema, {
  includeHintRow: true,
  includeExampleRow: false,
});

console.log(`  ✓ Generated template (${template.length} bytes)`);

// Verify template has headers and hints
const templateLines = template.split('\n');
if (templateLines.length < 2) {
  console.log('  ✗ FAIL: Template should have at least 2 lines (header + hints)');
  testsPassed = false;
  errorCount++;
} else {
  console.log(`  ✓ Template has ${templateLines.length} lines`);
  console.log(`  ✓ Header row: ${templateLines[0].substring(0, 80)}...`);
  console.log(`  ✓ Hint row: ${templateLines[1].substring(0, 80)}...`);
}

// ============================================================================
// TEST 8: Error Handling - Invalid CSV
// ============================================================================
console.log('\n=== Test 8: Error Handling - Invalid CSV ===');

// Test 8a: Empty CSV
console.log('Testing empty CSV...');
const emptyResult = parseCSV('');
if (emptyResult.rows.length !== 0 || emptyResult.headers.length !== 0) {
  console.log('  ✗ FAIL: Empty CSV should return 0 rows and 0 headers');
  testsPassed = false;
  errorCount++;
} else {
  console.log('  ✓ Empty CSV handled correctly');
}

// Test 8b: Headers only (no data)
console.log('Testing CSV with headers only...');
const headersOnlyResult = parseCSV('Name,Email,Phone');
if (headersOnlyResult.rows.length !== 0) {
  console.log('  ✗ FAIL: Headers-only CSV should return 0 rows');
  testsPassed = false;
  errorCount++;
} else {
  console.log('  ✓ Headers-only CSV handled correctly');
}

// Test 8c: Malformed CSV (inconsistent columns)
console.log('Testing CSV with inconsistent columns...');
const malformedCSV = `Name,Email,Phone
John,john@example.com
Jane,jane@example.com,555-5678,ExtraColumn`;

const malformedResult = parseCSV(malformedCSV);
console.log(`  ✓ Parsed malformed CSV: ${malformedResult.rows.length} rows`);
console.log(`    Row 1: ${JSON.stringify(malformedResult.rows[0])}`);
console.log(`    Row 2: ${JSON.stringify(malformedResult.rows[1])}`);

// Parser should pad missing columns with empty strings
if (!('Phone' in malformedResult.rows[0])) {
  console.log('  ✗ FAIL: Parser should pad missing columns');
  testsPassed = false;
  errorCount++;
} else {
  console.log('  ✓ Missing columns padded correctly');
}

// Test 8d: CSV with special characters (quotes, commas, newlines)
console.log('Testing CSV with special characters...');
const specialCharsCSV = `Name,Address,Notes
"Doe, John","123 Main St, Apt 4","He said ""Hello"""
"Jane Smith","456 Elm St","Line 1
Line 2"`;

const specialResult = parseCSV(specialCharsCSV);
if (specialResult.rows.length !== 2) {
  console.log(`  ✗ FAIL: Expected 2 rows, got ${specialResult.rows.length}`);
  testsPassed = false;
  errorCount++;
} else {
  console.log('  ✓ Special characters handled correctly');
  console.log(`    Row 1 Address: ${specialResult.rows[0].Address}`);
  console.log(`    Row 1 Notes: ${specialResult.rows[0].Notes}`);
  console.log(`    Row 2 Notes: ${specialResult.rows[1].Notes}`);
}

// ============================================================================
// Final Results
// ============================================================================
console.log('\n' + '='.repeat(60));
if (testsPassed) {
  console.log('✅ All integration tests passed!');
  console.log('='.repeat(60));
  process.exit(0);
} else {
  console.log(`❌ ${errorCount} test(s) failed`);
  console.log('='.repeat(60));
  process.exit(1);
}
