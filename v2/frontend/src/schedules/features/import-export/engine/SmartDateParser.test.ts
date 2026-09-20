/**
 * Tests for SmartDateParser
 */

import { describe, it, expect } from 'vitest';
import {
  parseDate,
  parseTime,
  parseDateTime,
  isValidDate,
  type DateParseResult,
  type TimeParseResult,
  type DateTimeParseResult,
} from './SmartDateParser';

describe('SmartDateParser', () => {
  describe('isValidDate', () => {
    it('should validate correct dates', () => {
      expect(isValidDate(2024, 1, 15)).toBe(true);
      expect(isValidDate(2024, 12, 31)).toBe(true);
      expect(isValidDate(2024, 2, 29)).toBe(true); // Leap year
    });

    it('should reject invalid dates', () => {
      expect(isValidDate(2024, 13, 1)).toBe(false); // Invalid month
      expect(isValidDate(2024, 2, 30)).toBe(false); // Feb 30
      expect(isValidDate(2023, 2, 29)).toBe(false); // Not a leap year
      expect(isValidDate(2024, 4, 31)).toBe(false); // April has 30 days
    });
  });

  describe('parseTime', () => {
    it('should parse 24-hour time HH:mm', () => {
      const result = parseTime('14:30');
      expect(result.value).toBe('14:30:00');
      expect(result.confidence).toBe(1.0);
    });

    it('should parse 24-hour time HH:mm:ss', () => {
      const result = parseTime('14:30:45');
      expect(result.value).toBe('14:30:45');
      expect(result.confidence).toBe(1.0);
    });

    it('should parse 12-hour time with AM/PM', () => {
      const result1 = parseTime('2:30 PM');
      expect(result1.value).toBe('14:30:00');
      expect(result1.confidence).toBe(0.95);

      const result2 = parseTime('2:30 AM');
      expect(result2.value).toBe('02:30:00');
      expect(result2.confidence).toBe(0.95);
    });

    it('should handle 12 PM and 12 AM correctly', () => {
      const result1 = parseTime('12:00 PM');
      expect(result1.value).toBe('12:00:00');

      const result2 = parseTime('12:00 AM');
      expect(result2.value).toBe('00:00:00');
    });

    it('should parse 12-hour time with seconds', () => {
      const result = parseTime('2:30:15 PM');
      expect(result.value).toBe('14:30:15');
      expect(result.confidence).toBe(0.95);
    });

    it('should handle leading zeros', () => {
      const result = parseTime('02:30 PM');
      expect(result.value).toBe('14:30:00');
    });

    it('should return null for invalid time', () => {
      expect(parseTime('25:00').value).toBe(null);
      expect(parseTime('14:99').value).toBe(null);
      expect(parseTime('not a time').value).toBe(null);
      expect(parseTime('').value).toBe(null);
    });
  });

  describe('parseDate', () => {
    describe('ISO formats (highest confidence)', () => {
      it('should parse YYYY-MM-DD', () => {
        const result = parseDate('2024-01-15');
        expect(result.value).toBe('2024-01-15');
        expect(result.confidence).toBe(1.0);
        expect(result.originalFormat).toBe('YYYY-MM-DD');
        expect(result.wasAmbiguous).toBe(false);
      });

      it('should parse YYYY/MM/DD', () => {
        const result = parseDate('2024/01/15');
        expect(result.value).toBe('2024-01-15');
        expect(result.confidence).toBe(1.0);
        expect(result.originalFormat).toBe('YYYY/MM/DD');
        expect(result.wasAmbiguous).toBe(false);
      });

      it('should parse ISO datetime', () => {
        const result = parseDate('2024-01-15T14:30:00');
        expect(result.value).toBe('2024-01-15');
        expect(result.confidence).toBe(1.0);
        expect(result.originalFormat).toBe('YYYY-MM-DDTHH:mm:ss');
        expect(result.wasAmbiguous).toBe(false);
      });
    });

    describe('US format (MM/DD/YYYY)', () => {
      it('should parse MM/DD/YYYY with US preference', () => {
        const result = parseDate('01/15/2024', 'US');
        expect(result.value).toBe('2024-01-15');
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
        expect(result.wasAmbiguous).toBe(false); // 15 cannot be a month
      });

      it('should detect ambiguity', () => {
        const result = parseDate('01/02/2024', 'US');
        expect(result.value).toBe('2024-01-02'); // US: Jan 2
        expect(result.wasAmbiguous).toBe(true);
        expect(result.confidence).toBe(0.8);
      });

      it('should parse with hyphens', () => {
        const result = parseDate('01-15-2024', 'US');
        expect(result.value).toBe('2024-01-15');
      });

      it('should parse with dots', () => {
        const result = parseDate('01.15.2024', 'US');
        expect(result.value).toBe('2024-01-15');
      });
    });

    describe('EU format (DD/MM/YYYY)', () => {
      it('should parse DD/MM/YYYY with EU preference', () => {
        const result = parseDate('15/01/2024', 'EU');
        expect(result.value).toBe('2024-01-15');
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it('should detect ambiguity', () => {
        const result = parseDate('02/01/2024', 'EU');
        expect(result.value).toBe('2024-01-02'); // EU: 2 Jan
        expect(result.wasAmbiguous).toBe(true);
      });
    });

    describe('Month names', () => {
      it('should parse MMM DD, YYYY', () => {
        const result = parseDate('Jan 15, 2024');
        expect(result.value).toBe('2024-01-15');
        expect(result.confidence).toBe(0.9);
        expect(result.originalFormat).toBe('MMM DD, YYYY');
        expect(result.wasAmbiguous).toBe(false);
      });

      it('should parse without comma', () => {
        const result = parseDate('Jan 15 2024');
        expect(result.value).toBe('2024-01-15');
      });

      it('should parse DD MMM YYYY', () => {
        const result = parseDate('15 Jan 2024');
        expect(result.value).toBe('2024-01-15');
        expect(result.confidence).toBe(0.9);
        expect(result.originalFormat).toBe('DD MMM YYYY');
      });

      it('should parse MMMM DD, YYYY', () => {
        const result = parseDate('January 15, 2024');
        expect(result.value).toBe('2024-01-15');
        expect(result.confidence).toBe(0.9);
        expect(result.originalFormat).toBe('MMMM DD, YYYY');
      });

      it('should handle case insensitivity', () => {
        expect(parseDate('JANUARY 15, 2024').value).toBe('2024-01-15');
        expect(parseDate('january 15, 2024').value).toBe('2024-01-15');
        expect(parseDate('JaNuArY 15, 2024').value).toBe('2024-01-15');
      });

      it('should handle common typos', () => {
        expect(parseDate('Janury 15, 2024').value).toBe('2024-01-15');
        expect(parseDate('Feburary 15, 2024').value).toBe('2024-02-15');
        expect(parseDate('Decemeber 15, 2024').value).toBe('2024-12-15');
      });

      it('should handle all months', () => {
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
    });

    describe('Single digit month/day', () => {
      it('should parse M/D/YYYY', () => {
        const result = parseDate('1/5/2024', 'US');
        expect(result.value).toBe('2024-01-05');
        expect(result.confidence).toBe(0.7);
      });

      it('should parse D/M/YYYY with EU preference', () => {
        const result = parseDate('5/1/2024', 'EU');
        expect(result.value).toBe('2024-01-05');
      });
    });

    describe('Invalid dates', () => {
      it('should return null for invalid dates', () => {
        expect(parseDate('2024-13-01').value).toBe(null); // Invalid month
        expect(parseDate('2024-02-30').value).toBe(null); // Feb 30
        expect(parseDate('not a date').value).toBe(null);
        expect(parseDate('').value).toBe(null);
      });
    });

    describe('Edge cases', () => {
      it('should handle whitespace', () => {
        expect(parseDate('  2024-01-15  ').value).toBe('2024-01-15');
        expect(parseDate('  Jan 15, 2024  ').value).toBe('2024-01-15');
      });

      it('should validate leap years', () => {
        expect(parseDate('2024-02-29').value).toBe('2024-02-29'); // Valid leap year
        expect(parseDate('2023-02-29').value).toBe(null); // Not a leap year
      });
    });
  });

  describe('parseDateTime', () => {
    it('should parse ISO datetime', () => {
      const result = parseDateTime('2024-01-15T14:30:00');
      expect(result.date).toBe('2024-01-15');
      expect(result.time).toBe('14:30:00');
      expect(result.combined).toBe('2024-01-15T14:30:00');
      expect(result.confidence).toBe(1.0);
      expect(result.wasAmbiguous).toBe(false);
    });

    it('should parse date and time separated by space', () => {
      const result = parseDateTime('2024-01-15 14:30:00');
      expect(result.date).toBe('2024-01-15');
      expect(result.time).toBe('14:30:00');
      expect(result.combined).toBe('2024-01-15T14:30:00');
    });

    it('should parse with 12-hour time', () => {
      const result = parseDateTime('Jan 15, 2024 2:30 PM');
      expect(result.date).toBe('2024-01-15');
      expect(result.time).toBe('14:30:00');
      expect(result.combined).toBe('2024-01-15T14:30:00');
    });

    it('should parse US format with time', () => {
      const result = parseDateTime('01/15/2024 14:30', 'US');
      expect(result.date).toBe('2024-01-15');
      expect(result.time).toBe('14:30:00');
    });

    it('should handle date-only input', () => {
      const result = parseDateTime('2024-01-15');
      expect(result.date).toBe('2024-01-15');
      expect(result.time).toBe(null);
      expect(result.combined).toBe('2024-01-15');
    });

    it('should handle time-only input', () => {
      const result = parseDateTime('14:30:00');
      expect(result.date).toBe(null);
      expect(result.time).toBe('14:30:00');
      expect(result.combined).toBe(null);
    });

    it('should handle comma separator', () => {
      const result = parseDateTime('2024-01-15, 14:30:00');
      expect(result.date).toBe('2024-01-15');
      expect(result.time).toBe('14:30:00');
    });

    it('should return null for invalid input', () => {
      const result = parseDateTime('not a datetime');
      expect(result.date).toBe(null);
      expect(result.time).toBe(null);
      expect(result.combined).toBe(null);
      expect(result.confidence).toBe(0);
    });

    it('should preserve ambiguity flag', () => {
      const result = parseDateTime('01/02/2024 14:30', 'US');
      expect(result.wasAmbiguous).toBe(true);
    });
  });

  describe('Format support verification', () => {
    it('should support all required date formats', () => {
      const formats = [
        { input: '2024-01-15', name: 'YYYY-MM-DD', confidence: 1.0 },
        { input: '2024/01/15', name: 'YYYY/MM/DD', confidence: 1.0 },
        { input: '01/15/2024', name: 'MM/DD/YYYY', confidence: 0.9, pref: 'US' as const },
        { input: '15/01/2024', name: 'DD/MM/YYYY', confidence: 0.9, pref: 'EU' as const },
        { input: '01-15-2024', name: 'MM-DD-YYYY', confidence: 0.9, pref: 'US' as const },
        { input: '15-01-2024', name: 'DD-MM-YYYY', confidence: 0.9, pref: 'EU' as const },
        { input: '1/15/2024', name: 'M/D/YYYY', confidence: 0.7, pref: 'US' as const },
        { input: '15/1/2024', name: 'D/M/YYYY', confidence: 0.9, pref: 'EU' as const },
        { input: 'Jan 15, 2024', name: 'MMM DD, YYYY', confidence: 0.9 },
        { input: '15 Jan 2024', name: 'DD MMM YYYY', confidence: 0.9 },
        { input: 'January 15, 2024', name: 'MMMM DD, YYYY', confidence: 0.9 },
        { input: '2024-01-15T14:30:00', name: 'ISO datetime', confidence: 1.0 },
      ];

      formats.forEach(({ input, name, confidence, pref }) => {
        const result = parseDate(input, pref);
        expect(result.value).toBe('2024-01-15');
        expect(result.confidence).toBeGreaterThanOrEqual(confidence - 0.1);
        console.log(`✓ ${name}: ${input} → ${result.value} (confidence: ${result.confidence})`);
      });
    });

    it('should support all required time formats', () => {
      const formats = [
        { input: '14:30', expected: '14:30:00' },
        { input: '14:30:00', expected: '14:30:00' },
        { input: '2:30 PM', expected: '14:30:00' },
        { input: '2:30:00 PM', expected: '14:30:00' },
        { input: '02:30 PM', expected: '14:30:00' },
      ];

      formats.forEach(({ input, expected }) => {
        const result = parseTime(input);
        expect(result.value).toBe(expected);
        console.log(`✓ ${input} → ${result.value}`);
      });
    });
  });
});
