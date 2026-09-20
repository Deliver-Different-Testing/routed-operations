/**
 * Comprehensive Engine Tests
 * Tests all 5 core engines: CSVParser, SmartDateParser, ValidationEngine, DiffEngine, CSVGenerator
 *
 * Run with: npx tsx src/features/import-export/engine/__tests__/engine.test.ts
 */

import { parseCSV, removeBOM, detectDelimiter, parseRow } from '../CSVParser';
import { parseDate, parseTime, parseDateTime } from '../SmartDateParser';
import { validateAll, validateRow, tryAutoFix } from '../ValidationEngine';
import { diffRow, compareValues } from '../DiffEngine';
import { generateCSV, generateTemplate, escapeCSVValue } from '../CSVGenerator';
import type { ImportSchema, ColumnDef } from '../../types/schema.types';

// ============================================================================
// Simple Test Framework
// ============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error instanceof Error ? error.message : error}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, message?: string) {
  if (!condition) {
    throw new Error(message || 'Expected true, got false');
  }
}

function assertFalse(condition: boolean, message?: string) {
  if (condition) {
    throw new Error(message || 'Expected false, got true');
  }
}

function assertNull(value: unknown, message?: string) {
  if (value !== null) {
    throw new Error(message || `Expected null, got ${value}`);
  }
}

function assertNotNull(value: unknown, message?: string) {
  if (value === null) {
    throw new Error(message || 'Expected non-null value');
  }
}

function assertGreaterThan(actual: number, expected: number, message?: string) {
  if (actual <= expected) {
    throw new Error(message || `Expected ${actual} > ${expected}`);
  }
}

// ============================================================================
// Test Schema
// ============================================================================

const testSchema: ImportSchema = {
  id: 'test',
  label: 'Test',
  columns: [
    { key: 'id', header: 'ID', type: 'id', locked: true },
    { key: 'name', header: 'Name', type: 'string', required: true },
    { key: 'email', header: 'Email', type: 'email' },
    { key: 'status', header: 'Status', type: 'enum', values: ['Active', 'Inactive'] },
    { key: 'age', header: 'Age', type: 'number', min: 0, max: 120 },
  ],
  uniqueKey: 'id',
  generateId: () => `T-${Date.now()}`,
};

// ============================================================================
// CSVParser Tests (5 tests)
// ============================================================================

console.log('\n=== CSVParser Tests ===\n');

test('CSVParser: basic parsing', () => {
  const result = parseCSV('name,age\nJohn,30\nJane,25');
  assertEqual(result.headers, ['name', 'age']);
  assertEqual(result.rows.length, 2);
  assertEqual(result.rows[0].name, 'John');
  assertEqual(result.rows[0].age, '30');
});

test('CSVParser: quoted fields with commas', () => {
  const result = parseCSV('name,address\n"Doe, John","123 Main St, Apt 4"');
  assertEqual(result.rows.length, 1);
  assertEqual(result.rows[0].name, 'Doe, John');
  assertEqual(result.rows[0].address, '123 Main St, Apt 4');
});

test('CSVParser: auto-detect delimiter', () => {
  const result = parseCSV('name;age\nJohn;30');
  assertEqual(result.detectedDelimiter, ';');
  assertEqual(result.rows.length, 1);
  assertEqual(result.rows[0].name, 'John');
});

test('CSVParser: skip empty rows', () => {
  const result = parseCSV('name,age\n\nJohn,30\n\nJane,25');
  assertEqual(result.rows.length, 2);
  assertEqual(result.skippedRows, 2);
});

test('CSVParser: handle BOM', () => {
  const result = parseCSV('\uFEFFname,age\nJohn,30');
  assertEqual(result.headers, ['name', 'age']);
  assertEqual(result.rows.length, 1);
});

// ============================================================================
// SmartDateParser Tests (5 tests)
// ============================================================================

console.log('\n=== SmartDateParser Tests ===\n');

test('SmartDateParser: ISO date format', () => {
  const result = parseDate('2024-01-15');
  assertEqual(result.value, '2024-01-15');
  assertEqual(result.confidence, 1.0);
  assertFalse(result.wasAmbiguous);
});

test('SmartDateParser: US date format (MM/DD/YYYY)', () => {
  const result = parseDate('01/15/2024', 'US');
  assertEqual(result.value, '2024-01-15');
  assertFalse(result.wasAmbiguous);
});

test('SmartDateParser: EU date format (DD/MM/YYYY)', () => {
  const result = parseDate('15/01/2024', 'EU');
  assertEqual(result.value, '2024-01-15');
  assertGreaterThan(result.confidence, 0.7);
});

test('SmartDateParser: time parsing (HH:mm)', () => {
  const result = parseTime('14:30');
  assertEqual(result.value, '14:30:00');
  assertEqual(result.confidence, 1.0);
});

test('SmartDateParser: datetime parsing', () => {
  const result = parseDateTime('2024-01-15T14:30:00');
  assertEqual(result.date, '2024-01-15');
  assertEqual(result.time, '14:30:00');
  assertEqual(result.combined, '2024-01-15T14:30:00');
  assertEqual(result.confidence, 1.0);
});

// ============================================================================
// ValidationEngine Tests (5 tests)
// ============================================================================

console.log('\n=== ValidationEngine Tests ===\n');

test('ValidationEngine: required field validation', () => {
  const row = { id: '1', email: 'test@test.com' };
  const result = validateRow(row, testSchema, 1);
  assertFalse(result.isValid);
  assertTrue(result.errors.length > 0);
  assertTrue(result.errors.some(e => e.column === 'name'));
});

test('ValidationEngine: email validation', () => {
  const row = { id: '1', name: 'John', email: 'invalid-email' };
  const result = validateRow(row, testSchema, 1);
  assertFalse(result.isValid);
  assertTrue(result.errors.some(e => e.column === 'email'));
});

test('ValidationEngine: enum validation', () => {
  const row = { id: '1', name: 'John', status: 'Invalid' };
  const result = validateRow(row, testSchema, 1);
  assertFalse(result.isValid);
  assertTrue(result.errors.some(e => e.column === 'status'));
});

test('ValidationEngine: number min/max validation', () => {
  const row1 = { id: '1', name: 'John', age: -5 };
  const result1 = validateRow(row1, testSchema, 1);
  assertFalse(result1.isValid);
  assertTrue(result1.errors.some(e => e.column === 'age'));

  const row2 = { id: '1', name: 'John', age: 150 };
  const result2 = validateRow(row2, testSchema, 2);
  assertFalse(result2.isValid);
  assertTrue(result2.errors.some(e => e.column === 'age'));
});

test('ValidationEngine: auto-fix whitespace', () => {
  const column: ColumnDef = { key: 'name', header: 'Name', type: 'string' };
  const result = tryAutoFix('  John Doe  ', column);
  assertTrue(result.wasFixed);
  assertEqual(result.fixed, 'John Doe');
});

// ============================================================================
// DiffEngine Tests (5 tests)
// ============================================================================

console.log('\n=== DiffEngine Tests ===\n');

test('DiffEngine: detect new record', () => {
  const importedRow = { id: '1', name: 'John', email: 'john@test.com' };
  const result = diffRow(importedRow, null, testSchema);
  assertEqual(result.status, 'new');
  assertEqual(result.diffs.length, 0);
});

test('DiffEngine: detect modified record', () => {
  const importedRow = { id: '1', name: 'John Doe', email: 'john@test.com' };
  const existingRecord = { id: '1', name: 'John', email: 'john@test.com' };
  const result = diffRow(importedRow, existingRecord, testSchema);
  assertEqual(result.status, 'modified');
  assertTrue(result.diffs.length > 0);
  assertTrue(result.changedFields.includes('name'));
});

test('DiffEngine: detect unchanged record', () => {
  const importedRow = { id: '1', name: 'John', email: 'john@test.com' };
  const existingRecord = { id: '1', name: 'John', email: 'john@test.com' };
  const result = diffRow(importedRow, existingRecord, testSchema);
  assertEqual(result.status, 'unchanged');
  assertEqual(result.diffs.length, 0);
});

test('DiffEngine: detect delete marker', () => {
  const importedRow = { id: '1', name: 'John', _DELETE: 'YES' };
  const existingRecord = { id: '1', name: 'John', email: 'john@test.com' };
  const result = diffRow(importedRow, existingRecord, testSchema);
  assertEqual(result.status, 'delete');
});

test('DiffEngine: compare values case-insensitively', () => {
  const column: ColumnDef = { key: 'status', header: 'Status', type: 'enum', values: ['Active'] };
  const result = compareValues('ACTIVE', 'active', column);
  assertTrue(result.isEqual);
});

// ============================================================================
// CSVGenerator Tests (5 tests)
// ============================================================================

console.log('\n=== CSVGenerator Tests ===\n');

test('CSVGenerator: generate basic CSV', () => {
  const data = [
    { id: '1', name: 'John', email: 'john@test.com', status: 'Active', age: 30 },
    { id: '2', name: 'Jane', email: 'jane@test.com', status: 'Inactive', age: 25 },
  ];
  const csv = generateCSV(data, testSchema);

  const lines = csv.split('\n');
  assertEqual(lines.length, 3); // header + 2 rows
  assertTrue(lines[0].includes('ID'));
  assertTrue(lines[0].includes('Name'));
  assertTrue(lines[1].includes('John'));
  assertTrue(lines[2].includes('Jane'));
});

test('CSVGenerator: escape special characters', () => {
  const value1 = escapeCSVValue('Hello, World');
  assertEqual(value1, '"Hello, World"');

  const value2 = escapeCSVValue('Say "Hello"');
  assertEqual(value2, '"Say ""Hello"""');

  const value3 = escapeCSVValue('Line 1\nLine 2');
  assertEqual(value3, '"Line 1\nLine 2"');
});

test('CSVGenerator: generate template with hints', () => {
  const template = generateTemplate(testSchema, { includeHintRow: true });
  const lines = template.split('\n');

  assertTrue(lines.length >= 2); // header + hint row
  assertTrue(lines[0].includes('ID'));
  assertTrue(lines[1].includes('AUTO')); // ID field hint
  assertTrue(lines[1].includes('Required')); // Name field hint
});

test('CSVGenerator: handle null values', () => {
  const data = [
    { id: '1', name: 'John', email: null, status: undefined, age: 30 },
  ];
  const csv = generateCSV(data, testSchema);

  const lines = csv.split('\n');
  const dataRow = lines[1];

  // Null and undefined should become empty strings
  assertTrue(dataRow.includes('John'));
  assertTrue(dataRow.includes('30'));
});

test('CSVGenerator: correct column order', () => {
  const data = [
    { age: 30, name: 'John', id: '1', email: 'john@test.com', status: 'Active' },
  ];
  const csv = generateCSV(data, testSchema);

  const lines = csv.split('\n');
  const headerParts = lines[0].split(',');

  // Should follow schema column order, not data object key order
  assertEqual(headerParts[0], 'ID');
  assertEqual(headerParts[1], 'Name');
  assertEqual(headerParts[2], 'Email');
  assertEqual(headerParts[3], 'Status');
  assertEqual(headerParts[4], 'Age');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
console.log(`Pass Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log('\n❌ Some tests failed');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
