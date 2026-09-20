/**
 * Performance benchmark for import/export operations
 */
import { parseCSV } from '../engine/CSVParser';
import { validateAll } from '../engine/ValidationEngine';
import { diffAll } from '../engine/DiffEngine';
import { generateCSV } from '../engine/CSVGenerator';
import { processInChunks, getVirtualWindow, LRUCache } from '../utils/performance';

// Generate test data
function generateTestData(count: number): string {
  const header = 'id,name,email,status,phone\n';
  const rows = Array.from({ length: count }, (_, i) =>
    `ID-${i},Company ${i},company${i}@example.com,Active,555-${String(i).padStart(4, '0')}`
  ).join('\n');
  return header + rows;
}

function generateExistingData(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `ID-${i}`,
    name: `Company ${i}`,
    email: `company${i}@example.com`,
    status: 'Active',
    phone: `555-${String(i).padStart(4, '0')}`,
  }));
}

// Test schema
const testSchema = {
  id: 'perf-test',
  label: 'Performance Test',
  columns: [
    { key: 'id', header: 'id', type: 'id' as const, locked: true },
    { key: 'name', header: 'name', type: 'string' as const, required: true },
    { key: 'email', header: 'email', type: 'email' as const },
    { key: 'status', header: 'status', type: 'enum' as const, values: ['Active', 'Inactive'] },
    { key: 'phone', header: 'phone', type: 'phone' as const },
  ],
  uniqueKey: 'id',
  generateId: () => `ID-${Date.now()}`,
};

// Benchmarks
function benchmark(name: string, fn: () => void): void {
  const start = performance.now();
  fn();
  const end = performance.now();
  console.log(`${name}: ${(end - start).toFixed(2)}ms`);
}

async function benchmarkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  await fn();
  const end = performance.now();
  console.log(`${name}: ${(end - start).toFixed(2)}ms`);
}

console.log('=== Performance Benchmarks ===\n');

// Test different data sizes
const sizes = [100, 500, 1000, 5000];

for (const size of sizes) {
  console.log(`\n--- ${size} rows ---`);

  const csvData = generateTestData(size);
  const existingData = generateExistingData(Math.floor(size / 2)); // Half existing

  let parsedResult: ReturnType<typeof parseCSV>;

  benchmark(`Parse CSV (${size} rows)`, () => {
    parsedResult = parseCSV(csvData);
  });

  benchmark(`Validate (${size} rows)`, () => {
    validateAll(parsedResult!.rows, testSchema);
  });

  benchmark(`Diff (${size} rows vs ${existingData.length} existing)`, () => {
    diffAll(parsedResult!.rows, existingData, testSchema);
  });

  benchmark(`Generate CSV (${size} rows)`, () => {
    generateCSV(parsedResult!.rows, testSchema);
  });
}

// Test utilities
console.log('\n--- Utility Performance ---');

await benchmarkAsync('processInChunks (1000 items)', async () => {
  const items = Array.from({ length: 1000 }, (_, i) => i);
  await processInChunks(items, x => x * 2, { chunkSize: 100 });
});

benchmark('getVirtualWindow (10000 items)', () => {
  const items = Array.from({ length: 10000 }, (_, i) => ({ id: i }));
  getVirtualWindow(items, {
    scrollTop: 5000,
    containerHeight: 500,
    itemHeight: 40,
  });
});

benchmark('LRUCache (1000 operations)', () => {
  const cache = new LRUCache<string, number>(100);
  for (let i = 0; i < 1000; i++) {
    cache.set(`key-${i}`, i);
    cache.get(`key-${i % 50}`); // Mix of hits and misses
  }
});

console.log('\n=== Benchmarks Complete ===');
