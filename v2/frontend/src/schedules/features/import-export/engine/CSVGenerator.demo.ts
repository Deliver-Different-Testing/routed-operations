/**
 * Manual Demo/Test for CSVGenerator
 * Run this file to manually verify CSVGenerator functionality
 * Usage: npx tsx src/features/import-export/engine/CSVGenerator.demo.ts
 */

import {
  generateCSV,
  generateTemplate,
  generateHeaders,
  generateHintRow,
  escapeCSVValue,
  rowToCSV,
} from './CSVGenerator';
import type { ImportSchema } from '../types/schema.types';

console.log('=== CSVGenerator Manual Demo ===\n');

// Create a mock schema
const mockSchema: ImportSchema = {
  id: 'clients',
  label: 'Client Import',
  description: 'Import client data',
  columns: [
    { key: 'id', header: 'Client ID', type: 'id', locked: true },
    { key: 'companyName', header: 'Company Name', type: 'string', required: true },
    { key: 'status', header: 'Status', type: 'enum', values: ['Active', 'Inactive'], required: true },
    { key: 'email', header: 'Email', type: 'email' },
    { key: 'phone', header: 'Phone', type: 'phone' },
    { key: 'rateGroup', header: 'Rate Group', type: 'reference', refTable: 'Rate Groups' },
    { key: 'createdDate', header: 'Created Date', type: 'date', locked: true },
    { key: 'tags', header: 'Tags', type: 'tags' },
  ],
  uniqueKey: 'id',
  generateId: () => `CLIENT-${Date.now()}`,
};

// Test 1: escapeCSVValue
console.log('1. Testing escapeCSVValue:');
console.log('   null:', escapeCSVValue(null));
console.log('   "hello":', escapeCSVValue('hello'));
console.log('   "hello,world":', escapeCSVValue('hello,world'));
console.log('   \'hello "world"\':', escapeCSVValue('hello "world"'));
console.log('   true:', escapeCSVValue(true));
console.log('   123:', escapeCSVValue(123));
console.log('   ["tag1","tag2"]:', escapeCSVValue(['tag1', 'tag2']));
console.log();

// Test 2: generateHeaders
console.log('2. Testing generateHeaders:');
console.log(generateHeaders(mockSchema));
console.log();

// Test 3: generateHintRow
console.log('3. Testing generateHintRow:');
console.log(generateHintRow(mockSchema));
console.log();

// Test 4: generateTemplate
console.log('4. Testing generateTemplate (headers + hints):');
console.log(generateTemplate(mockSchema));
console.log();

console.log('5. Testing generateTemplate (with example row):');
console.log(generateTemplate(mockSchema, { includeExampleRow: true }));
console.log();

// Test 5: rowToCSV
console.log('6. Testing rowToCSV:');
const testRow = {
  id: 'CLIENT-001',
  companyName: 'Acme, Inc.',
  status: 'Active',
  email: 'contact@acme.com',
  phone: '(555) 555-1234',
  rateGroup: 'STANDARD',
  createdDate: new Date('2024-01-15'),
  tags: ['important', 'vip'],
};
console.log(rowToCSV(testRow, mockSchema.columns));
console.log();

// Test 6: generateCSV
console.log('7. Testing generateCSV (with sample data):');
const sampleData = [
  {
    id: 'CLIENT-001',
    companyName: 'Acme Corp',
    status: 'Active',
    email: 'acme@test.com',
    phone: '555-1234',
    rateGroup: 'STANDARD',
    createdDate: new Date('2024-01-15'),
    tags: ['vip'],
  },
  {
    id: 'CLIENT-002',
    companyName: 'Beta, Inc.',
    status: 'Inactive',
    email: 'beta@test.com',
    phone: '555-5678',
    rateGroup: 'PREMIUM',
    createdDate: new Date('2024-02-20'),
    tags: ['important', 'special'],
  },
  {
    id: 'CLIENT-003',
    companyName: 'Gamma "The Best" LLC',
    status: 'Active',
    email: 'gamma@test.com',
    phone: null,
    rateGroup: undefined,
    createdDate: new Date('2024-03-10'),
    tags: [],
  },
];
const csv = generateCSV(sampleData, mockSchema);
console.log(csv);
console.log();

// Test 7: Different delimiters
console.log('8. Testing with tab delimiter:');
console.log(generateCSV(sampleData.slice(0, 1), mockSchema, { delimiter: '\t' }));
console.log();

console.log('9. Testing with semicolon delimiter:');
console.log(generateCSV(sampleData.slice(0, 1), mockSchema, { delimiter: ';' }));
console.log();

// Test 8: Quote all mode
console.log('10. Testing with quoteAll option:');
console.log(generateCSV(sampleData.slice(0, 1), mockSchema, { quoteAll: true }));
console.log();

console.log('=== All Demo Tests Complete ===');
