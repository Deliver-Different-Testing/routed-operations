/**
 * Test runner for ReferenceResolver
 * Run with: npx tsx src/features/import-export/engine/test-runner-reference.ts
 */

import {
  createReferenceRegistry,
  registerReferenceData,
  clearReferenceData,
  getReferenceData,
  resolveReference,
  fuzzyMatch,
  type ReferenceRegistry,
  type ReferenceData
} from './ReferenceResolver';

// Simple test framework
type TestResult = { name: string; passed: boolean; error?: string };
const results: TestResult[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: String(error) });
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error}`);
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (actual <= expected) {
        throw new Error(`Expected > ${expected}, got ${actual}`);
      }
    },
    toBeLessThan(expected: number) {
      if (actual >= expected) {
        throw new Error(`Expected < ${expected}, got ${actual}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (actual < expected) {
        throw new Error(`Expected >= ${expected}, got ${actual}`);
      }
    },
    toBeLessThanOrEqual(expected: number) {
      if (actual > expected) {
        throw new Error(`Expected <= ${expected}, got ${actual}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected value to be defined`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`Expected undefined, got ${JSON.stringify(actual)}`);
      }
    },
    toHaveLength(expected: number) {
      if (!actual || actual.length !== expected) {
        throw new Error(`Expected length ${expected}, got ${actual?.length}`);
      }
    },
    toContain(expected: any) {
      if (!actual.includes(expected)) {
        throw new Error(`Expected to contain ${JSON.stringify(expected)}`);
      }
    }
  };
}

console.log('\n🧪 Running ReferenceResolver Tests...\n');

let registry: ReferenceRegistry;

const sampleUsers: ReferenceData[] = [
  { id: 'user-1', displayValue: 'John Smith', email: 'john@example.com' },
  { id: 'user-2', displayValue: 'Jane Doe', email: 'jane@example.com' },
  { id: 'user-3', displayValue: 'Bob Johnson', email: 'bob@example.com' },
  { id: 'user-4', displayValue: 'Alice Williams', email: 'alice@example.com' }
];

const sampleDepartments: ReferenceData[] = [
  { id: 'dept-1', displayValue: 'Engineering' },
  { id: 'dept-2', displayValue: 'Marketing' },
  { id: 'dept-3', displayValue: 'Sales' }
];

function beforeEach() {
  registry = createReferenceRegistry();
}

// createReferenceRegistry tests
console.log('=== createReferenceRegistry ===');
beforeEach();
test('should create an empty registry', () => {
  expect(JSON.stringify(registry)).toBe(JSON.stringify({}));
});

// registerReferenceData tests
console.log('\n=== registerReferenceData ===');
beforeEach();
test('should register data for a table', () => {
  registerReferenceData(registry, 'users', sampleUsers);
  expect(registry.users).toHaveLength(4);
  expect(registry.users[0].id).toBe('user-1');
});

beforeEach();
test('should register multiple tables', () => {
  registerReferenceData(registry, 'users', sampleUsers);
  registerReferenceData(registry, 'departments', sampleDepartments);
  expect(registry.users).toHaveLength(4);
  expect(registry.departments).toHaveLength(3);
});

beforeEach();
test('should overwrite existing data', () => {
  registerReferenceData(registry, 'users', sampleUsers);
  registerReferenceData(registry, 'users', [sampleUsers[0]]);
  expect(registry.users).toHaveLength(1);
});

// clearReferenceData tests
console.log('\n=== clearReferenceData ===');
beforeEach();
test('should clear data for a table', () => {
  registerReferenceData(registry, 'users', sampleUsers);
  clearReferenceData(registry, 'users');
  expect(registry.users).toBeUndefined();
});

beforeEach();
test('should not affect other tables', () => {
  registerReferenceData(registry, 'users', sampleUsers);
  registerReferenceData(registry, 'departments', sampleDepartments);
  clearReferenceData(registry, 'users');
  expect(registry.users).toBeUndefined();
  expect(registry.departments).toHaveLength(3);
});

// getReferenceData tests
console.log('\n=== getReferenceData ===');
beforeEach();
test('should return data for a table', () => {
  registerReferenceData(registry, 'users', sampleUsers);
  const data = getReferenceData(registry, 'users');
  expect(data).toHaveLength(4);
});

beforeEach();
test('should return empty array for non-existent table', () => {
  const data = getReferenceData(registry, 'nonexistent');
  expect(data).toHaveLength(0);
});

// resolveReference - exact matches
console.log('\n=== resolveReference - exact matches ===');
beforeEach();
registerReferenceData(registry, 'users', sampleUsers);

test('should resolve by exact ID match (case insensitive)', () => {
  const result = resolveReference(registry, 'users', 'user-1');
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-1');
  expect(result.displayValue).toBe('John Smith');
  expect(result.confidence).toBe(1.0);
});

test('should resolve by exact ID match (uppercase)', () => {
  const result = resolveReference(registry, 'users', 'USER-1');
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-1');
  expect(result.confidence).toBe(1.0);
});

test('should resolve by exact displayValue match', () => {
  const result = resolveReference(registry, 'users', 'John Smith');
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-1');
  expect(result.displayValue).toBe('John Smith');
  expect(result.confidence).toBe(1.0);
});

test('should resolve by exact displayValue match (case insensitive)', () => {
  const result = resolveReference(registry, 'users', 'jane doe');
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-2');
  expect(result.displayValue).toBe('Jane Doe');
  expect(result.confidence).toBe(1.0);
});

test('should trim whitespace before matching', () => {
  const result = resolveReference(registry, 'users', '  user-1  ');
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-1');
});

// resolveReference - searchField option
console.log('\n=== resolveReference - searchField option ===');
beforeEach();
registerReferenceData(registry, 'users', sampleUsers);

test('should search by specific field', () => {
  const result = resolveReference(registry, 'users', 'john@example.com', {
    searchField: 'email'
  });
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-1');
  expect(result.displayValue).toBe('John Smith');
});

test('should not find match if searchField does not match', () => {
  const result = resolveReference(registry, 'users', 'user-1', {
    searchField: 'email'
  });
  expect(result.found).toBe(false);
});

// resolveReference - fuzzy matching
console.log('\n=== resolveReference - fuzzy matching ===');
beforeEach();
registerReferenceData(registry, 'users', sampleUsers);

test('should find partial match with fuzzyMatch enabled', () => {
  const result = resolveReference(registry, 'users', 'John', {
    fuzzyMatch: true
  });
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-1');
  expect(result.confidence).toBeGreaterThan(0.6);
  expect(result.confidence).toBeLessThan(1.0);
});

test('should find match with typo', () => {
  const result = resolveReference(registry, 'users', 'Jhon Smith', {
    fuzzyMatch: true
  });
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-1');
  expect(result.confidence).toBeGreaterThan(0.6);
});

test('should not find fuzzy match when fuzzyMatch is false', () => {
  const result = resolveReference(registry, 'users', 'John', {
    fuzzyMatch: false
  });
  expect(result.found).toBe(false);
});

test('should return best fuzzy match', () => {
  const result = resolveReference(registry, 'users', 'Alice', {
    fuzzyMatch: true
  });
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-4');
});

// resolveReference - not found with suggestions
console.log('\n=== resolveReference - not found with suggestions ===');
beforeEach();
registerReferenceData(registry, 'users', sampleUsers);

test('should return suggestions when not found', () => {
  const result = resolveReference(registry, 'users', 'Johnny');
  expect(result.found).toBe(false);
  expect(result.id).toBeNull();
  expect(result.displayValue).toBeNull();
  expect(result.suggestions).toBeDefined();
  expect(result.suggestions!.length).toBeGreaterThan(0);
});

test('should limit suggestions to maxSuggestions', () => {
  const result = resolveReference(registry, 'users', 'xyz', {
    maxSuggestions: 2
  });
  expect(result.suggestions!.length).toBeLessThanOrEqual(2);
});

test('should return best suggestions first', () => {
  const result = resolveReference(registry, 'users', 'John', {
    maxSuggestions: 3
  });
  expect(result.suggestions![0].displayValue).toContain('John');
});

// resolveReference - edge cases
console.log('\n=== resolveReference - edge cases ===');
beforeEach();

test('should handle non-existent table', () => {
  const result = resolveReference(registry, 'nonexistent', 'test');
  expect(result.found).toBe(false);
  expect(result.suggestions).toHaveLength(0);
});

test('should handle empty table', () => {
  registerReferenceData(registry, 'empty', []);
  const result = resolveReference(registry, 'empty', 'test');
  expect(result.found).toBe(false);
  expect(result.suggestions).toHaveLength(0);
});

beforeEach();
registerReferenceData(registry, 'users', sampleUsers);
test('should handle empty search value', () => {
  const result = resolveReference(registry, 'users', '');
  expect(result.found).toBe(false);
});

// fuzzyMatch tests
console.log('\n=== fuzzyMatch ===');
test('should return 1.0 for exact match', () => {
  expect(fuzzyMatch('test', 'test')).toBe(1.0);
});

test('should return 1.0 for case-insensitive match', () => {
  expect(fuzzyMatch('Test', 'test')).toBe(1.0);
});

test('should return 0.8 for startsWith match', () => {
  expect(fuzzyMatch('test', 'testing')).toBe(0.8);
});

test('should return 0.7 for contains match', () => {
  expect(fuzzyMatch('est', 'testing')).toBe(0.7);
});

test('should return high score for small edit distance', () => {
  const score = fuzzyMatch('test', 'tset');
  expect(score).toBeGreaterThanOrEqual(0.65); // distance=2 -> 0.75
  expect(score).toBeLessThan(1.0);
});

test('should return 0 for empty strings', () => {
  expect(fuzzyMatch('', 'test')).toBe(0);
  expect(fuzzyMatch('test', '')).toBe(0);
});

test('should return 0 for very different strings', () => {
  expect(fuzzyMatch('abc', 'xyz')).toBe(0);
});

// Real-world scenarios
console.log('\n=== real-world scenarios ===');
beforeEach();
registerReferenceData(registry, 'users', sampleUsers);

test('should handle user lookup by email in import', () => {
  const result = resolveReference(registry, 'users', 'john@example.com', {
    searchField: 'email'
  });
  expect(result.found).toBe(true);
  expect(result.id).toBe('user-1');
});

beforeEach();
registerReferenceData(registry, 'departments', sampleDepartments);

test('should handle department lookup with typo and fuzzy matching', () => {
  const result = resolveReference(registry, 'departments', 'Enginering', {
    fuzzyMatch: true
  });
  expect(result.found).toBe(true);
  expect(result.displayValue).toBe('Engineering');
});

beforeEach();
registerReferenceData(registry, 'users', sampleUsers);

test('should provide suggestions when user misspells name', () => {
  const result = resolveReference(registry, 'users', 'Jon Smth', {
    maxSuggestions: 3
  });
  expect(result.suggestions!.length).toBeGreaterThan(0);
  expect(result.suggestions![0].displayValue).toBe('John Smith');
});

test('should handle numeric IDs as strings', () => {
  const projects: ReferenceData[] = [
    { id: '123', displayValue: 'Project Alpha' },
    { id: '456', displayValue: 'Project Beta' }
  ];
  registerReferenceData(registry, 'projects', projects);
  const result = resolveReference(registry, 'projects', '123');
  expect(result.found).toBe(true);
  expect(result.displayValue).toBe('Project Alpha');
});

// Performance test
console.log('\n=== performance with large datasets ===');
beforeEach();
test('should handle 1000+ records efficiently', () => {
  const largeDataset: ReferenceData[] = [];
  for (let i = 0; i < 1000; i++) {
    largeDataset.push({
      id: `item-${i}`,
      displayValue: `Item ${i}`
    });
  }
  registerReferenceData(registry, 'items', largeDataset);

  const startTime = Date.now();
  const result = resolveReference(registry, 'items', 'item-500');
  const duration = Date.now() - startTime;

  expect(result.found).toBe(true);
  if (duration >= 100) {
    throw new Error(`Performance too slow: ${duration}ms (expected < 100ms)`);
  }
});

beforeEach();
test('should handle fuzzy matching on large dataset', () => {
  const largeDataset: ReferenceData[] = [];
  for (let i = 0; i < 1000; i++) {
    largeDataset.push({
      id: `item-${i}`,
      displayValue: `Item ${i}`
    });
  }
  registerReferenceData(registry, 'items', largeDataset);

  const startTime = Date.now();
  const result = resolveReference(registry, 'items', 'Item 50', {
    fuzzyMatch: true
  });
  const duration = Date.now() - startTime;

  expect(result.found).toBe(true);
  if (duration >= 500) {
    throw new Error(`Fuzzy performance too slow: ${duration}ms (expected < 500ms)`);
  }
});

// Summary
console.log('\n=== Test Summary ===');
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const total = results.length;

console.log(`Total: ${total}`);
console.log(`Passed: ${passed} ✅`);
console.log(`Failed: ${failed} ❌`);
console.log(`Pass Rate: ${((passed / total) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log('\n=== Failed Tests ===');
  results
    .filter((r) => !r.passed)
    .forEach((r) => {
      console.log(`❌ ${r.name}`);
      console.log(`   ${r.error}`);
    });
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!\n');
  process.exit(0);
}
