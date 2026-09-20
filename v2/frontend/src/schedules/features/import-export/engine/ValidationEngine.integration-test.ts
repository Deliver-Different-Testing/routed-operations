/**
 * Integration test for ValidationEngine
 * This demonstrates real-world usage with a complete schema
 * Run manually to verify functionality: npx tsx src/features/import-export/engine/ValidationEngine.integration-test.ts
 */

import { validateAll } from './ValidationEngine';
import type { ImportSchema } from '../types/schema.types';

// Example: Product import schema
const productSchema: ImportSchema = {
  id: 'products',
  label: 'Products',
  description: 'Import product catalog',
  columns: [
    {
      key: 'id',
      header: 'Product ID',
      type: 'id',
      locked: true,
    },
    {
      key: 'name',
      header: 'Product Name',
      type: 'string',
      required: true,
      min: 3,
      max: 100,
    },
    {
      key: 'sku',
      header: 'SKU',
      type: 'string',
      required: true,
      pattern: /^[A-Z0-9-]+$/,
    },
    {
      key: 'price',
      header: 'Price',
      type: 'number',
      required: true,
      min: 0,
    },
    {
      key: 'in_stock',
      header: 'In Stock',
      type: 'boolean',
      required: false,
    },
    {
      key: 'status',
      header: 'Status',
      type: 'enum',
      values: ['Active', 'Inactive', 'Discontinued'],
      required: true,
    },
    {
      key: 'category_id',
      header: 'Category',
      type: 'reference',
      refTable: 'categories',
      required: true,
    },
    {
      key: 'email',
      header: 'Contact Email',
      type: 'email',
      required: false,
    },
    {
      key: 'phone',
      header: 'Contact Phone',
      type: 'phone',
      required: false,
    },
    {
      key: 'launch_date',
      header: 'Launch Date',
      type: 'date',
      required: false,
    },
  ],
  uniqueKey: 'sku',
  generateId: () => `prod-${Date.now()}`,
};

// Test data with various issues
const testRows = [
  // Row 1: Valid data
  {
    id: 'prod-1',
    name: 'Widget Pro',
    sku: 'WGT-PRO-001',
    price: 99.99,
    in_stock: true,
    status: 'Active',
    category_id: 'cat-123',
    email: 'widget@example.com',
    phone: '(555) 123-4567',
    launch_date: '2024-01-15',
  },

  // Row 2: Needs auto-fixing (whitespace, case, format)
  {
    id: 'prod-2',
    name: '  Gadget Plus  ',
    sku: 'GDG-PLUS-002',
    price: '149.99',
    in_stock: 'yes',
    status: 'active', // Wrong case
    category_id: 'cat-456',
    email: 'GADGET@EXAMPLE.COM', // Uppercase
    phone: '555-987-6543',
    launch_date: '01/20/2024', // US format
  },

  // Row 3: Has errors (missing required, invalid formats)
  {
    id: 'prod-3',
    name: 'AB', // Too short (min: 3)
    sku: 'invalid sku', // Invalid pattern (spaces not allowed)
    price: -10, // Negative price
    in_stock: false,
    status: 'Unknown', // Not in enum
    category_id: '', // Empty reference
    email: 'not-an-email',
    phone: '123', // Too few digits
    launch_date: 'not-a-date',
  },

  // Row 4: Missing required fields
  {
    id: 'prod-4',
    name: '', // Missing required
    sku: '', // Missing required
    price: null, // Missing required
    status: '', // Missing required
    category_id: '', // Missing required
  },
];

console.log('=== ValidationEngine Integration Test ===\n');

// Test without auto-fix
console.log('1. Validation WITHOUT auto-fix:');
const result1 = validateAll(testRows, productSchema, { autoFix: false });
console.log(`   Valid: ${result1.isValid}`);
console.log(`   Errors: ${result1.errors.length}`);
console.log(`   Warnings: ${result1.warnings.length}`);
console.log(`   Auto-fixed: ${result1.autoFixed}`);
console.log(`   Unfixable rows: ${result1.unfixable}`);

if (result1.errors.length > 0) {
  console.log('\n   Sample errors:');
  result1.errors.slice(0, 5).forEach(err => {
    console.log(`   - Row ${err.row}, ${err.column}: ${err.message}`);
  });
}

// Test with auto-fix
console.log('\n2. Validation WITH auto-fix:');
const result2 = validateAll(testRows, productSchema, { autoFix: true });
console.log(`   Valid: ${result2.isValid}`);
console.log(`   Errors: ${result2.errors.length}`);
console.log(`   Warnings: ${result2.warnings.length}`);
console.log(`   Auto-fixed: ${result2.autoFixed}`);
console.log(`   Unfixable rows: ${result2.unfixable}`);

if (result2.errors.length > 0) {
  console.log('\n   Remaining errors after auto-fix:');
  result2.errors.slice(0, 5).forEach(err => {
    console.log(`   - Row ${err.row}, ${err.column}: ${err.message}`);
  });
}

console.log('\n3. Summary:');
console.log(`   - Auto-fix reduced errors from ${result1.errors.length} to ${result2.errors.length}`);
console.log(`   - ${result2.autoFixed} fields were automatically corrected`);
console.log(`   - ${result2.unfixable} rows still have unfixable issues`);

console.log('\n=== Test Complete ===');

// Export for potential programmatic use
export { productSchema, testRows };
