/**
 * Simple test runner for SmartDateParser
 * Run with: npx tsx src/features/import-export/engine/test-runner.ts
 */

import {
  parseDate,
  parseTime,
  parseDateTime,
  isValidDate,
} from './SmartDateParser';

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
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (actual < expected) {
        throw new Error(`Expected >= ${expected}, got ${actual}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null, got ${actual}`);
      }
    },
  };
}

console.log('\n🧪 Running SmartDateParser Tests...\n');

// isValidDate tests
console.log('=== isValidDate ===');
test('should validate correct dates', () => {
  expect(isValidDate(2024, 1, 15)).toBe(true);
  expect(isValidDate(2024, 12, 31)).toBe(true);
  expect(isValidDate(2024, 2, 29)).toBe(true); // Leap year
});

test('should reject invalid dates', () => {
  expect(isValidDate(2024, 13, 1)).toBe(false); // Invalid month
  expect(isValidDate(2024, 2, 30)).toBe(false); // Feb 30
  expect(isValidDate(2023, 2, 29)).toBe(false); // Not a leap year
  expect(isValidDate(2024, 4, 31)).toBe(false); // April has 30 days
});

// parseTime tests
console.log('\n=== parseTime ===');
test('should parse 24-hour time HH:mm', () => {
  const result = parseTime('14:30');
  expect(result.value).toBe('14:30:00');
  expect(result.confidence).toBe(1.0);
});

test('should parse 24-hour time HH:mm:ss', () => {
  const result = parseTime('14:30:45');
  expect(result.value).toBe('14:30:45');
  expect(result.confidence).toBe(1.0);
});

test('should parse 12-hour time with AM/PM', () => {
  const result1 = parseTime('2:30 PM');
  expect(result1.value).toBe('14:30:00');
  expect(result1.confidence).toBe(0.95);

  const result2 = parseTime('2:30 AM');
  expect(result2.value).toBe('02:30:00');
  expect(result2.confidence).toBe(0.95);
});

test('should handle 12 PM and 12 AM correctly', () => {
  const result1 = parseTime('12:00 PM');
  expect(result1.value).toBe('12:00:00');

  const result2 = parseTime('12:00 AM');
  expect(result2.value).toBe('00:00:00');
});

test('should return null for invalid time', () => {
  expect(parseTime('25:00').value).toBeNull();
  expect(parseTime('14:99').value).toBeNull();
  expect(parseTime('not a time').value).toBeNull();
});

// parseDate tests - ISO formats
console.log('\n=== parseDate - ISO Formats ===');
test('should parse YYYY-MM-DD', () => {
  const result = parseDate('2024-01-15');
  expect(result.value).toBe('2024-01-15');
  expect(result.confidence).toBe(1.0);
  expect(result.originalFormat).toBe('YYYY-MM-DD');
  expect(result.wasAmbiguous).toBe(false);
});

test('should parse YYYY/MM/DD', () => {
  const result = parseDate('2024/01/15');
  expect(result.value).toBe('2024-01-15');
  expect(result.confidence).toBe(1.0);
  expect(result.originalFormat).toBe('YYYY/MM/DD');
  expect(result.wasAmbiguous).toBe(false);
});

test('should parse ISO datetime', () => {
  const result = parseDate('2024-01-15T14:30:00');
  expect(result.value).toBe('2024-01-15');
  expect(result.confidence).toBe(1.0);
  expect(result.originalFormat).toBe('YYYY-MM-DDTHH:mm:ss');
  expect(result.wasAmbiguous).toBe(false);
});

// parseDate tests - US format
console.log('\n=== parseDate - US Format ===');
test('should parse MM/DD/YYYY with US preference', () => {
  const result = parseDate('01/15/2024', 'US');
  expect(result.value).toBe('2024-01-15');
  expect(result.wasAmbiguous).toBe(false); // 15 cannot be a month
});

test('should detect ambiguity in US format', () => {
  const result = parseDate('01/02/2024', 'US');
  expect(result.value).toBe('2024-01-02'); // US: Jan 2
  expect(result.wasAmbiguous).toBe(true);
  expect(result.confidence).toBe(0.8);
});

test('should parse US format with hyphens', () => {
  const result = parseDate('01-15-2024', 'US');
  expect(result.value).toBe('2024-01-15');
});

// parseDate tests - EU format
console.log('\n=== parseDate - EU Format ===');
test('should parse DD/MM/YYYY with EU preference', () => {
  const result = parseDate('15/01/2024', 'EU');
  expect(result.value).toBe('2024-01-15');
  expect(result.confidence).toBeGreaterThanOrEqual(0.8);
});

test('should detect ambiguity in EU format', () => {
  const result = parseDate('02/01/2024', 'EU');
  expect(result.value).toBe('2024-01-02'); // EU: 2 Jan
  expect(result.wasAmbiguous).toBe(true);
});

// parseDate tests - Month names
console.log('\n=== parseDate - Month Names ===');
test('should parse MMM DD, YYYY', () => {
  const result = parseDate('Jan 15, 2024');
  expect(result.value).toBe('2024-01-15');
  expect(result.confidence).toBe(0.9);
  expect(result.originalFormat).toBe('MMM DD, YYYY');
  expect(result.wasAmbiguous).toBe(false);
});

test('should parse DD MMM YYYY', () => {
  const result = parseDate('15 Jan 2024');
  expect(result.value).toBe('2024-01-15');
  expect(result.confidence).toBe(0.9);
  expect(result.originalFormat).toBe('DD MMM YYYY');
});

test('should parse MMMM DD, YYYY', () => {
  const result = parseDate('January 15, 2024');
  expect(result.value).toBe('2024-01-15');
  expect(result.confidence).toBe(0.9);
  expect(result.originalFormat).toBe('MMMM DD, YYYY');
});

test('should handle case insensitivity', () => {
  expect(parseDate('JANUARY 15, 2024').value).toBe('2024-01-15');
  expect(parseDate('january 15, 2024').value).toBe('2024-01-15');
});

test('should handle common typos', () => {
  expect(parseDate('Janury 15, 2024').value).toBe('2024-01-15');
  expect(parseDate('Feburary 15, 2024').value).toBe('2024-02-15');
  expect(parseDate('Decemeber 15, 2024').value).toBe('2024-12-15');
});

test('should handle all months', () => {
  expect(parseDate('Feb 15, 2024').value).toBe('2024-02-15');
  expect(parseDate('Mar 15, 2024').value).toBe('2024-03-15');
  expect(parseDate('Apr 15, 2024').value).toBe('2024-04-15');
  expect(parseDate('May 15, 2024').value).toBe('2024-05-15');
  expect(parseDate('Jun 15, 2024').value).toBe('2024-06-15');
  expect(parseDate('Jul 15, 2024').value).toBe('2024-07-15');
  expect(parseDate('Aug 15, 2024').value).toBe('2024-08-15');
  expect(parseDate('Sep 15, 2024').value).toBe('2024-09-15');
  expect(parseDate('Oct 15, 2024').value).toBe('2024-10-15');
  expect(parseDate('Nov 15, 2024').value).toBe('2024-11-15');
  expect(parseDate('Dec 15, 2024').value).toBe('2024-12-15');
});

// parseDate tests - Single digit
console.log('\n=== parseDate - Single Digit ===');
test('should parse M/D/YYYY', () => {
  const result = parseDate('1/5/2024', 'US');
  expect(result.value).toBe('2024-01-05');
  // Confidence is 0.8 because it matches ambiguous pattern (both parts <= 12)
  expect(result.confidence).toBe(0.8);
});

// parseDate tests - Invalid dates
console.log('\n=== parseDate - Invalid Dates ===');
test('should return null for invalid dates', () => {
  expect(parseDate('2024-13-01').value).toBeNull(); // Invalid month
  expect(parseDate('2024-02-30').value).toBeNull(); // Feb 30
  expect(parseDate('not a date').value).toBeNull();
});

test('should validate leap years', () => {
  expect(parseDate('2024-02-29').value).toBe('2024-02-29'); // Valid leap year
  expect(parseDate('2023-02-29').value).toBeNull(); // Not a leap year
});

// parseDateTime tests
console.log('\n=== parseDateTime ===');
test('should parse ISO datetime', () => {
  const result = parseDateTime('2024-01-15T14:30:00');
  expect(result.date).toBe('2024-01-15');
  expect(result.time).toBe('14:30:00');
  expect(result.combined).toBe('2024-01-15T14:30:00');
  expect(result.confidence).toBe(1.0);
  expect(result.wasAmbiguous).toBe(false);
});

test('should parse date and time separated by space', () => {
  const result = parseDateTime('2024-01-15 14:30:00');
  expect(result.date).toBe('2024-01-15');
  expect(result.time).toBe('14:30:00');
  expect(result.combined).toBe('2024-01-15T14:30:00');
});

test('should parse with 12-hour time', () => {
  const result = parseDateTime('Jan 15, 2024 2:30 PM');
  expect(result.date).toBe('2024-01-15');
  expect(result.time).toBe('14:30:00');
  expect(result.combined).toBe('2024-01-15T14:30:00');
});

test('should handle date-only input', () => {
  const result = parseDateTime('2024-01-15');
  expect(result.date).toBe('2024-01-15');
  expect(result.time).toBeNull();
  expect(result.combined).toBe('2024-01-15');
});

test('should handle time-only input', () => {
  const result = parseDateTime('14:30:00');
  expect(result.date).toBeNull();
  expect(result.time).toBe('14:30:00');
  expect(result.combined).toBeNull();
});

// Format support verification
console.log('\n=== Format Support Verification ===');
const dateFormats = [
  { input: '2024-01-15', name: 'YYYY-MM-DD' },
  { input: '2024/01/15', name: 'YYYY/MM/DD' },
  { input: '01/15/2024', name: 'MM/DD/YYYY', pref: 'US' as const },
  { input: '15/01/2024', name: 'DD/MM/YYYY', pref: 'EU' as const },
  { input: '01-15-2024', name: 'MM-DD-YYYY', pref: 'US' as const },
  { input: '15-01-2024', name: 'DD-MM-YYYY', pref: 'EU' as const },
  { input: '1/15/2024', name: 'M/D/YYYY', pref: 'US' as const },
  { input: '15/1/2024', name: 'D/M/YYYY', pref: 'EU' as const },
  { input: 'Jan 15, 2024', name: 'MMM DD, YYYY' },
  { input: '15 Jan 2024', name: 'DD MMM YYYY' },
  { input: 'January 15, 2024', name: 'MMMM DD, YYYY' },
  { input: '2024-01-15T14:30:00', name: 'ISO datetime' },
];

test('should support all required date formats', () => {
  dateFormats.forEach(({ input, name, pref }) => {
    const result = parseDate(input, pref);
    if (result.value !== '2024-01-15') {
      throw new Error(`Format ${name} failed: ${input} → ${result.value}`);
    }
  });
});

const timeFormats = [
  { input: '14:30', expected: '14:30:00' },
  { input: '14:30:00', expected: '14:30:00' },
  { input: '2:30 PM', expected: '14:30:00' },
  { input: '2:30:00 PM', expected: '14:30:00' },
  { input: '02:30 PM', expected: '14:30:00' },
];

test('should support all required time formats', () => {
  timeFormats.forEach(({ input, expected }) => {
    const result = parseTime(input);
    if (result.value !== expected) {
      throw new Error(`Time format failed: ${input} → ${result.value} (expected ${expected})`);
    }
  });
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
