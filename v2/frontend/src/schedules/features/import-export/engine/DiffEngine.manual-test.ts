/**
 * Manual test/demonstration file for DiffEngine
 * Run this with: npx tsx src/features/import-export/engine/DiffEngine.manual-test.ts
 */

import {
  diffRow,
  diffAll,
  compareValues,
  hasDeleteMarker,
} from './DiffEngine';
import type { ImportSchema } from '../types/schema.types';

// Mock schema for testing
const schema: ImportSchema = {
  id: 'companies',
  label: 'Companies',
  columns: [
    { key: 'companyId', header: 'Company ID', type: 'id', required: true },
    { key: 'companyName', header: 'Company Name', type: 'string', required: true },
    { key: 'email', header: 'Email', type: 'email' },
    { key: 'employees', header: 'Employees', type: 'number' },
    { key: 'active', header: 'Active', type: 'boolean' },
    { key: 'lockedField', header: 'Locked Field', type: 'string', locked: true },
  ],
  uniqueKey: 'companyId',
  generateId: () => `comp-${Date.now()}`,
};

console.log('=== DiffEngine Manual Test ===\n');

// Test 1: Delete Marker Detection
console.log('Test 1: Delete Marker Detection');
console.log('Row with _DELETE=YES:', hasDeleteMarker({ _DELETE: 'YES' })); // true
console.log('Row with _DELETE=NO:', hasDeleteMarker({ _DELETE: 'NO' })); // false
console.log('Row without _DELETE:', hasDeleteMarker({})); // false
console.log('');

// Test 2: String Comparison
console.log('Test 2: String Comparison');
const stringCol = schema.columns.find(c => c.key === 'companyName')!;
const result1 = compareValues('ACME Corp', 'acme corp', stringCol);
console.log('Case-insensitive compare "ACME Corp" vs "acme corp":', result1.isEqual); // true

const result2 = compareValues('  ACME Corp  ', 'ACME Corp', stringCol);
console.log('Whitespace compare "  ACME Corp  " vs "ACME Corp":', result2.isEqual); // true
console.log('');

// Test 3: Number Comparison
console.log('Test 3: Number Comparison');
const numberCol = schema.columns.find(c => c.key === 'employees')!;
const result3 = compareValues('123', 123, numberCol);
console.log('String "123" vs number 123:', result3.isEqual); // true

const result4 = compareValues(100, 200, numberCol);
console.log('Number 100 vs 200:', result4.isEqual); // false
console.log('');

// Test 4: Boolean Comparison
console.log('Test 4: Boolean Comparison');
const boolCol = schema.columns.find(c => c.key === 'active')!;
const result5 = compareValues('yes', true, boolCol);
console.log('"yes" vs true:', result5.isEqual); // true

const result6 = compareValues('1', true, boolCol);
console.log('"1" vs true:', result6.isEqual); // true
console.log('');

// Test 5: New Record Detection
console.log('Test 5: New Record Detection');
const newRow = { companyId: 'C001', companyName: 'Acme Corp', email: 'info@acme.com' };
const diffResult1 = diffRow(newRow, null, schema);
console.log('Status:', diffResult1.status); // 'new'
console.log('Diffs:', diffResult1.diffs.length); // 0
console.log('');

// Test 6: Modified Record Detection
console.log('Test 6: Modified Record Detection');
const importedRow = {
  companyId: 'C001',
  companyName: 'ACME Corporation', // Changed
  email: 'info@acme.com',
  employees: 150, // Changed from 100
  active: true,
};
const existingRecord = {
  companyId: 'C001',
  companyName: 'ACME Corp',
  email: 'info@acme.com',
  employees: 100,
  active: true,
};
const diffResult2 = diffRow(importedRow, existingRecord, schema);
console.log('Status:', diffResult2.status); // 'modified'
console.log('Changed fields:', diffResult2.changedFields); // ['companyName', 'employees']
console.log('Unchanged fields:', diffResult2.unchangedFields); // ['email', 'active']
console.log('Number of diffs:', diffResult2.diffs.length); // 2
console.log('Diffs:', JSON.stringify(diffResult2.diffs, null, 2));
console.log('');

// Test 7: Unchanged Record Detection
console.log('Test 7: Unchanged Record Detection');
const diffResult3 = diffRow(existingRecord, existingRecord, schema);
console.log('Status:', diffResult3.status); // 'unchanged'
console.log('Diffs:', diffResult3.diffs.length); // 0
console.log('');

// Test 8: Delete Record Detection
console.log('Test 8: Delete Record Detection');
const deleteRow = { companyId: 'C001', companyName: 'Acme Corp', _DELETE: 'YES' };
const diffResult4 = diffRow(deleteRow, existingRecord, schema);
console.log('Status:', diffResult4.status); // 'delete'
console.log('Diffs:', diffResult4.diffs.length); // 0
console.log('');

// Test 9: Locked Fields
console.log('Test 9: Locked Fields (ignoreLocked=true)');
const rowWithLockedChange = {
  companyId: 'C001',
  companyName: 'ACME Corp',
  lockedField: 'changed',
};
const existingWithLocked = {
  companyId: 'C001',
  companyName: 'ACME Corp',
  lockedField: 'original',
};
const diffResult5 = diffRow(rowWithLockedChange, existingWithLocked, schema, { ignoreLocked: true });
console.log('Status (locked field ignored):', diffResult5.status); // 'unchanged'
console.log('Changed fields:', diffResult5.changedFields); // []

const diffResult6 = diffRow(rowWithLockedChange, existingWithLocked, schema, { ignoreLocked: false });
console.log('Status (locked field included):', diffResult6.status); // 'modified'
console.log('Changed fields:', diffResult6.changedFields); // ['lockedField']
console.log('');

// Test 10: Batch Diff
console.log('Test 10: Batch Diff');
const importedRows = [
  { companyId: 'C001', companyName: 'ACME Updated', email: 'info@acme.com' }, // Modified
  { companyId: 'C002', companyName: 'Beta LLC', email: 'contact@beta.com' }, // New
  { companyId: 'C003', companyName: 'Gamma Inc', _DELETE: 'YES' }, // Delete
  { companyId: 'C004', companyName: 'Delta Co', email: 'delta@example.com' }, // Unchanged
];

const existingData = [
  { companyId: 'C001', companyName: 'ACME Corp', email: 'info@acme.com' },
  { companyId: 'C003', companyName: 'Gamma Inc', email: 'gamma@example.com' },
  { companyId: 'C004', companyName: 'Delta Co', email: 'delta@example.com' },
];

const batchResult = diffAll(importedRows, existingData, schema);
console.log('Summary:');
console.log('  New:', batchResult.summary.new); // 1 (Beta)
console.log('  Modified:', batchResult.summary.modified); // 1 (ACME)
console.log('  Unchanged:', batchResult.summary.unchanged); // 1 (Delta)
console.log('  Deleted:', batchResult.summary.deleted); // 1 (Gamma)
console.log('Total results:', batchResult.results.size); // 4
console.log('');

// Test 11: Diff Types (added, changed, removed)
console.log('Test 11: Diff Types');
const importedWithTypes = {
  companyId: 'C001',
  companyName: 'ACME Updated', // changed
  email: 'new@email.com',      // added (was null)
  employees: null,              // removed (was 100)
};
const existingWithTypes = {
  companyId: 'C001',
  companyName: 'ACME Corp',
  email: null,
  employees: 100,
};
const diffResult7 = diffRow(importedWithTypes, existingWithTypes, schema);
console.log('Changed fields:', diffResult7.changedFields);
diffResult7.diffs.forEach(diff => {
  console.log(`  ${diff.field}: ${diff.type} (${diff.oldValue} → ${diff.newValue})`);
});
console.log('');

console.log('=== All Manual Tests Complete ===');
