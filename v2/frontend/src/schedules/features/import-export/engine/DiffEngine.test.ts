import { describe, it, expect } from 'vitest';
import {
  diffRow,
  diffAll,
  compareValues,
  hasDeleteMarker,
  type DiffOptions,
} from './DiffEngine';
import type { ImportSchema, ColumnDef } from '../types/schema.types';

describe('DiffEngine', () => {
  // Mock schema for testing
  const mockSchema: ImportSchema = {
    id: 'test-schema',
    label: 'Test Schema',
    columns: [
      { key: 'id', header: 'ID', type: 'id', required: true },
      { key: 'name', header: 'Name', type: 'string', required: true },
      { key: 'email', header: 'Email', type: 'email' },
      { key: 'age', header: 'Age', type: 'number' },
      { key: 'active', header: 'Active', type: 'boolean' },
      { key: 'lockedField', header: 'Locked', type: 'string', locked: true },
      { key: 'createdAt', header: 'Created', type: 'datetime' },
      { key: 'tags', header: 'Tags', type: 'tags' },
    ],
    uniqueKey: 'id',
    generateId: () => `test-${Date.now()}`,
  };

  describe('hasDeleteMarker', () => {
    it('should return true for various truthy delete markers', () => {
      expect(hasDeleteMarker({ _DELETE: 'YES' })).toBe(true);
      expect(hasDeleteMarker({ _DELETE: 'yes' })).toBe(true);
      expect(hasDeleteMarker({ _DELETE: 'TRUE' })).toBe(true);
      expect(hasDeleteMarker({ _DELETE: 'true' })).toBe(true);
      expect(hasDeleteMarker({ _DELETE: '1' })).toBe(true);
      expect(hasDeleteMarker({ _DELETE: 'Y' })).toBe(true);
      expect(hasDeleteMarker({ _DELETE: 'T' })).toBe(true);
    });

    it('should return false for falsy or missing delete markers', () => {
      expect(hasDeleteMarker({ _DELETE: 'NO' })).toBe(false);
      expect(hasDeleteMarker({ _DELETE: 'FALSE' })).toBe(false);
      expect(hasDeleteMarker({ _DELETE: '0' })).toBe(false);
      expect(hasDeleteMarker({ _DELETE: '' })).toBe(false);
      expect(hasDeleteMarker({ _DELETE: null })).toBe(false);
      expect(hasDeleteMarker({ _DELETE: undefined })).toBe(false);
      expect(hasDeleteMarker({})).toBe(false);
    });
  });

  describe('compareValues', () => {
    const stringColumn: ColumnDef = { key: 'name', header: 'Name', type: 'string' };
    const numberColumn: ColumnDef = { key: 'age', header: 'Age', type: 'number' };
    const booleanColumn: ColumnDef = { key: 'active', header: 'Active', type: 'boolean' };
    const dateColumn: ColumnDef = { key: 'createdAt', header: 'Created', type: 'datetime' };
    const tagsColumn: ColumnDef = { key: 'tags', header: 'Tags', type: 'tags' };

    describe('string comparison', () => {
      it('should handle case-insensitive comparison by default', () => {
        const result = compareValues('ACME Corp', 'acme corp', stringColumn);
        expect(result.isEqual).toBe(true);
      });

      it('should handle case-sensitive comparison when ignoreCase is false', () => {
        const result = compareValues('ACME Corp', 'acme corp', stringColumn, { ignoreCase: false });
        expect(result.isEqual).toBe(false);
      });

      it('should trim whitespace by default', () => {
        const result = compareValues('  ACME Corp  ', 'ACME Corp', stringColumn);
        expect(result.isEqual).toBe(true);
      });

      it('should not trim whitespace when ignoreWhitespace is false', () => {
        const result = compareValues('  ACME Corp  ', 'ACME Corp', stringColumn, { ignoreWhitespace: false });
        expect(result.isEqual).toBe(false);
      });

      it('should treat null/undefined/empty as equal by default', () => {
        expect(compareValues(null, undefined, stringColumn).isEqual).toBe(true);
        expect(compareValues('', null, stringColumn).isEqual).toBe(true);
        expect(compareValues(undefined, '', stringColumn).isEqual).toBe(true);
      });

      it('should not treat null/undefined/empty as equal when compareNulls is false', () => {
        const options: DiffOptions = { compareNulls: false };
        expect(compareValues('', 'test', stringColumn, options).isEqual).toBe(false);
      });
    });

    describe('number comparison', () => {
      it('should compare numeric values correctly', () => {
        expect(compareValues(123, 123, numberColumn).isEqual).toBe(true);
        expect(compareValues(123, 456, numberColumn).isEqual).toBe(false);
      });

      it('should handle string numbers vs numeric numbers', () => {
        expect(compareValues('123', 123, numberColumn).isEqual).toBe(true);
        expect(compareValues('123.45', 123.45, numberColumn).isEqual).toBe(true);
      });

      it('should handle NaN cases', () => {
        expect(compareValues('invalid', 'invalid', numberColumn).isEqual).toBe(true);
        expect(compareValues('invalid', 123, numberColumn).isEqual).toBe(false);
      });
    });

    describe('boolean comparison', () => {
      it('should normalize boolean values', () => {
        expect(compareValues('true', true, booleanColumn).isEqual).toBe(true);
        expect(compareValues('YES', true, booleanColumn).isEqual).toBe(true);
        expect(compareValues('1', true, booleanColumn).isEqual).toBe(true);
        expect(compareValues('false', false, booleanColumn).isEqual).toBe(true);
        expect(compareValues('NO', false, booleanColumn).isEqual).toBe(true);
        expect(compareValues('0', false, booleanColumn).isEqual).toBe(true);
      });
    });

    describe('date comparison', () => {
      it('should compare ISO date strings', () => {
        const date1 = '2024-01-15T10:30:00Z';
        const date2 = '2024-01-15T10:30:00Z';
        const date3 = '2024-01-16T10:30:00Z';

        expect(compareValues(date1, date2, dateColumn).isEqual).toBe(true);
        expect(compareValues(date1, date3, dateColumn).isEqual).toBe(false);
      });

      it('should compare Date objects', () => {
        const date1 = new Date('2024-01-15T10:30:00Z');
        const date2 = new Date('2024-01-15T10:30:00Z');
        const date3 = new Date('2024-01-16T10:30:00Z');

        expect(compareValues(date1, date2, dateColumn).isEqual).toBe(true);
        expect(compareValues(date1, date3, dateColumn).isEqual).toBe(false);
      });
    });

    describe('tags comparison', () => {
      it('should compare arrays of tags', () => {
        expect(compareValues(['tag1', 'tag2'], ['tag1', 'tag2'], tagsColumn).isEqual).toBe(true);
        expect(compareValues(['tag1', 'tag2'], ['tag2', 'tag1'], tagsColumn).isEqual).toBe(true); // Order doesn't matter
      });

      it('should handle comma-separated string tags', () => {
        expect(compareValues('tag1,tag2', ['tag1', 'tag2'], tagsColumn).isEqual).toBe(true);
        expect(compareValues('tag1, tag2', ['tag1', 'tag2'], tagsColumn).isEqual).toBe(true);
      });

      it('should handle semicolon-separated string tags', () => {
        expect(compareValues('tag1;tag2', ['tag1', 'tag2'], tagsColumn).isEqual).toBe(true);
      });
    });
  });

  describe('diffRow', () => {
    it('should identify a new record when no existing record', () => {
      const importedRow = { id: '1', name: 'John Doe', email: 'john@example.com' };
      const result = diffRow(importedRow, null, mockSchema);

      expect(result.status).toBe('new');
      expect(result.diffs).toEqual([]);
      expect(result.changedFields).toEqual([]);
    });

    it('should identify unchanged record when all fields match', () => {
      const importedRow = { id: '1', name: 'John Doe', email: 'john@example.com', age: 30 };
      const existingRecord = { id: '1', name: 'John Doe', email: 'john@example.com', age: 30 };
      const result = diffRow(importedRow, existingRecord, mockSchema);

      expect(result.status).toBe('unchanged');
      expect(result.diffs).toEqual([]);
      expect(result.changedFields).toEqual([]);
      expect(result.unchangedFields.length).toBeGreaterThan(0);
    });

    it('should identify modified record with field changes', () => {
      const importedRow = { id: '1', name: 'John Doe Updated', email: 'john@example.com', age: 31 };
      const existingRecord = { id: '1', name: 'John Doe', email: 'john@example.com', age: 30 };
      const result = diffRow(importedRow, existingRecord, mockSchema);

      expect(result.status).toBe('modified');
      expect(result.diffs.length).toBe(2);
      expect(result.changedFields).toContain('name');
      expect(result.changedFields).toContain('age');
      expect(result.unchangedFields).toContain('email');
    });

    it('should identify delete record when _DELETE marker present', () => {
      const importedRow = { id: '1', name: 'John Doe', _DELETE: 'YES' };
      const existingRecord = { id: '1', name: 'John Doe', email: 'john@example.com' };
      const result = diffRow(importedRow, existingRecord, mockSchema);

      expect(result.status).toBe('delete');
      expect(result.diffs).toEqual([]);
    });

    it('should skip locked fields when ignoreLocked is true', () => {
      const importedRow = { id: '1', name: 'John Doe', lockedField: 'changed' };
      const existingRecord = { id: '1', name: 'John Doe', lockedField: 'original' };
      const result = diffRow(importedRow, existingRecord, mockSchema, { ignoreLocked: true });

      expect(result.status).toBe('unchanged');
      expect(result.changedFields).not.toContain('lockedField');
    });

    it('should include locked fields when ignoreLocked is false', () => {
      const importedRow = { id: '1', name: 'John Doe', lockedField: 'changed' };
      const existingRecord = { id: '1', name: 'John Doe', lockedField: 'original' };
      const result = diffRow(importedRow, existingRecord, mockSchema, { ignoreLocked: false });

      expect(result.status).toBe('modified');
      expect(result.changedFields).toContain('lockedField');
    });

    it('should correctly identify diff types: added, changed, removed', () => {
      const importedRow = {
        id: '1',
        name: 'John Doe Updated', // changed
        email: 'john@example.com',  // added (was null)
        age: null,                   // removed (was 30)
      };
      const existingRecord = {
        id: '1',
        name: 'John Doe',
        email: null,
        age: 30,
      };
      const result = diffRow(importedRow, existingRecord, mockSchema);

      expect(result.status).toBe('modified');

      const nameDiff = result.diffs.find(d => d.field === 'name');
      expect(nameDiff?.type).toBe('changed');

      const emailDiff = result.diffs.find(d => d.field === 'email');
      expect(emailDiff?.type).toBe('added');

      const ageDiff = result.diffs.find(d => d.field === 'age');
      expect(ageDiff?.type).toBe('removed');
    });
  });

  describe('diffAll', () => {
    it('should compare multiple rows and return batch results', () => {
      const importedRows = [
        { id: '1', name: 'John Doe Updated', email: 'john@example.com' },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com' }, // New
        { id: '3', name: 'Bob Johnson', _DELETE: 'YES' }, // Delete
        { id: '4', name: 'Alice Brown', email: 'alice@example.com' }, // Unchanged
      ];

      const existingData = [
        { id: '1', name: 'John Doe', email: 'john@example.com' }, // Modified
        { id: '3', name: 'Bob Johnson', email: 'bob@example.com' }, // To be deleted
        { id: '4', name: 'Alice Brown', email: 'alice@example.com' }, // Unchanged
      ];

      const result = diffAll(importedRows, existingData, mockSchema);

      expect(result.summary.new).toBe(1); // Jane
      expect(result.summary.modified).toBe(1); // John
      expect(result.summary.unchanged).toBe(1); // Alice
      expect(result.summary.deleted).toBe(1); // Bob

      expect(result.results.size).toBe(4);

      const johnResult = result.results.get('1');
      expect(johnResult?.status).toBe('modified');

      const janeResult = result.results.get('2');
      expect(janeResult?.status).toBe('new');

      const bobResult = result.results.get('3');
      expect(bobResult?.status).toBe('delete');

      const aliceResult = result.results.get('4');
      expect(aliceResult?.status).toBe('unchanged');
    });

    it('should handle empty imported rows', () => {
      const result = diffAll([], [], mockSchema);

      expect(result.summary.new).toBe(0);
      expect(result.summary.modified).toBe(0);
      expect(result.summary.unchanged).toBe(0);
      expect(result.summary.deleted).toBe(0);
      expect(result.results.size).toBe(0);
    });

    it('should handle rows without unique keys', () => {
      const importedRows = [
        { name: 'John Doe' }, // No id
        { id: '2', name: 'Jane Smith' }, // Has id
      ];

      const existingData = [
        { id: '2', name: 'Jane Smith' },
      ];

      const result = diffAll(importedRows, existingData, mockSchema);

      // Row without id should be skipped
      expect(result.results.size).toBe(1);
      expect(result.results.has('2')).toBe(true);
    });

    it('should use O(1) lookup for existing data', () => {
      // Create large datasets to test performance
      const importedRows = Array.from({ length: 1000 }, (_, i) => ({
        id: String(i),
        name: `User ${i}`,
      }));

      const existingData = Array.from({ length: 1000 }, (_, i) => ({
        id: String(i),
        name: `User ${i}`,
      }));

      const startTime = Date.now();
      const result = diffAll(importedRows, existingData, mockSchema);
      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 100ms for 1000 rows)
      expect(duration).toBeLessThan(100);
      expect(result.results.size).toBe(1000);
      expect(result.summary.unchanged).toBe(1000);
    });
  });

  describe('integration scenarios', () => {
    it('should handle a realistic import scenario', () => {
      const schema: ImportSchema = {
        id: 'companies',
        label: 'Companies',
        columns: [
          { key: 'companyId', header: 'Company ID', type: 'id', required: true },
          { key: 'companyName', header: 'Company Name', type: 'string', required: true },
          { key: 'email', header: 'Email', type: 'email' },
          { key: 'employees', header: 'Employees', type: 'number' },
          { key: 'active', header: 'Active', type: 'boolean' },
        ],
        uniqueKey: 'companyId',
        generateId: () => `comp-${Date.now()}`,
      };

      const importedRows = [
        { companyId: 'C001', companyName: 'Acme Corp', email: 'info@acme.com', employees: 150, active: true },
        { companyId: 'C002', companyName: 'Beta LLC', email: 'contact@beta.com', employees: 75, active: true },
        { companyId: 'C003', companyName: 'Gamma Inc', email: 'hello@gamma.com', employees: 200, active: false },
        { companyId: 'C004', companyName: 'Delta Co', _DELETE: 'YES' },
      ];

      const existingData = [
        { companyId: 'C001', companyName: 'ACME Corporation', email: 'info@acme.com', employees: 100, active: true }, // Modified
        { companyId: 'C003', companyName: 'Gamma Inc', email: 'hello@gamma.com', employees: 200, active: false }, // Unchanged
        { companyId: 'C004', companyName: 'Delta Co', email: 'delta@example.com', employees: 50, active: true }, // To be deleted
      ];

      const result = diffAll(importedRows, existingData, schema);

      expect(result.summary.new).toBe(1); // Beta
      expect(result.summary.modified).toBe(1); // Acme (name and employees changed)
      expect(result.summary.unchanged).toBe(1); // Gamma
      expect(result.summary.deleted).toBe(1); // Delta

      // Check Acme details
      const acmeResult = result.results.get('C001');
      expect(acmeResult?.status).toBe('modified');
      expect(acmeResult?.changedFields).toContain('companyName');
      expect(acmeResult?.changedFields).toContain('employees');
      expect(acmeResult?.unchangedFields).toContain('email');
      expect(acmeResult?.unchangedFields).toContain('active');
    });
  });
});
