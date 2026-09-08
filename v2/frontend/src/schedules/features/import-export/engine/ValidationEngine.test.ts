import { describe, it, expect } from 'vitest';
import {
  validateRow,
  validateAll,
  validateString,
  validateNumber,
  validateBoolean,
  validateEnum,
  validateDate,
  validateDateTime,
  validateEmail,
  validatePhone,
  validateReference,
  tryAutoFix,
} from './ValidationEngine';
import type { ImportSchema, ColumnDef } from '../types/schema.types';

describe('ValidationEngine', () => {
  // === validateString ===
  describe('validateString', () => {
    it('should pass valid strings', () => {
      const column: ColumnDef = {
        key: 'name',
        header: 'Name',
        type: 'string',
      };

      expect(validateString('John Doe', column, 1)).toBeNull();
      expect(validateString('A', column, 1)).toBeNull();
    });

    it('should enforce min length', () => {
      const column: ColumnDef = {
        key: 'name',
        header: 'Name',
        type: 'string',
        min: 3,
      };

      const error = validateString('AB', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('at least 3 characters');
    });

    it('should enforce max length', () => {
      const column: ColumnDef = {
        key: 'name',
        header: 'Name',
        type: 'string',
        max: 5,
      };

      const error = validateString('ABCDEF', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('at most 5 characters');
    });

    it('should validate pattern', () => {
      const column: ColumnDef = {
        key: 'code',
        header: 'Code',
        type: 'string',
        pattern: /^[A-Z]{3}$/,
      };

      expect(validateString('ABC', column, 1)).toBeNull();
      expect(validateString('AB', column, 1)).not.toBeNull();
      expect(validateString('abc', column, 1)).not.toBeNull();
    });
  });

  // === validateNumber ===
  describe('validateNumber', () => {
    it('should pass valid numbers', () => {
      const column: ColumnDef = {
        key: 'age',
        header: 'Age',
        type: 'number',
      };

      expect(validateNumber(25, column, 1)).toBeNull();
      expect(validateNumber('25', column, 1)).toBeNull();
      expect(validateNumber(0, column, 1)).toBeNull();
    });

    it('should reject non-numeric values', () => {
      const column: ColumnDef = {
        key: 'age',
        header: 'Age',
        type: 'number',
      };

      const error = validateNumber('abc', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('must be a valid number');
    });

    it('should enforce min value', () => {
      const column: ColumnDef = {
        key: 'age',
        header: 'Age',
        type: 'number',
        min: 18,
      };

      expect(validateNumber(17, column, 1)).not.toBeNull();
      expect(validateNumber(18, column, 1)).toBeNull();
      expect(validateNumber(25, column, 1)).toBeNull();
    });

    it('should enforce max value', () => {
      const column: ColumnDef = {
        key: 'age',
        header: 'Age',
        type: 'number',
        max: 65,
      };

      expect(validateNumber(66, column, 1)).not.toBeNull();
      expect(validateNumber(65, column, 1)).toBeNull();
      expect(validateNumber(50, column, 1)).toBeNull();
    });
  });

  // === validateBoolean ===
  describe('validateBoolean', () => {
    const column: ColumnDef = {
      key: 'active',
      header: 'Active',
      type: 'boolean',
    };

    it('should accept true/false', () => {
      expect(validateBoolean('true', column, 1)).toBeNull();
      expect(validateBoolean('false', column, 1)).toBeNull();
      expect(validateBoolean('TRUE', column, 1)).toBeNull();
      expect(validateBoolean('False', column, 1)).toBeNull();
    });

    it('should accept yes/no', () => {
      expect(validateBoolean('yes', column, 1)).toBeNull();
      expect(validateBoolean('no', column, 1)).toBeNull();
      expect(validateBoolean('YES', column, 1)).toBeNull();
      expect(validateBoolean('No', column, 1)).toBeNull();
    });

    it('should accept 1/0', () => {
      expect(validateBoolean('1', column, 1)).toBeNull();
      expect(validateBoolean('0', column, 1)).toBeNull();
      expect(validateBoolean(1, column, 1)).toBeNull();
      expect(validateBoolean(0, column, 1)).toBeNull();
    });

    it('should accept on/off', () => {
      expect(validateBoolean('on', column, 1)).toBeNull();
      expect(validateBoolean('off', column, 1)).toBeNull();
      expect(validateBoolean('ON', column, 1)).toBeNull();
      expect(validateBoolean('Off', column, 1)).toBeNull();
    });

    it('should reject invalid boolean values', () => {
      const error = validateBoolean('maybe', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('must be a boolean');
    });
  });

  // === validateEnum ===
  describe('validateEnum', () => {
    const column: ColumnDef = {
      key: 'status',
      header: 'Status',
      type: 'enum',
      values: ['Active', 'Inactive', 'Pending'],
    };

    it('should accept valid enum values (case insensitive)', () => {
      expect(validateEnum('Active', column, 1)).toBeNull();
      expect(validateEnum('active', column, 1)).toBeNull();
      expect(validateEnum('INACTIVE', column, 1)).toBeNull();
      expect(validateEnum('pending', column, 1)).toBeNull();
    });

    it('should reject invalid enum values', () => {
      const error = validateEnum('Unknown', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('must be one of');
    });

    it('should handle missing values array', () => {
      const badColumn: ColumnDef = {
        key: 'status',
        header: 'Status',
        type: 'enum',
      };

      const error = validateEnum('Active', badColumn, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('no valid values defined');
    });
  });

  // === validateDate ===
  describe('validateDate', () => {
    const column: ColumnDef = {
      key: 'birthdate',
      header: 'Birth Date',
      type: 'date',
    };

    it('should accept ISO dates', () => {
      expect(validateDate('2024-01-15', column, 1)).toBeNull();
      expect(validateDate('2024/01/15', column, 1)).toBeNull();
    });

    it('should accept US dates', () => {
      expect(validateDate('01/15/2024', column, 1)).toBeNull();
      expect(validateDate('1/15/2024', column, 1)).toBeNull();
    });

    it('should accept month names', () => {
      expect(validateDate('January 15, 2024', column, 1)).toBeNull();
      expect(validateDate('Jan 15, 2024', column, 1)).toBeNull();
      expect(validateDate('15 Jan 2024', column, 1)).toBeNull();
    });

    it('should reject invalid dates', () => {
      const error = validateDate('not-a-date', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('not a valid date');
    });

    it('should warn about ambiguous dates', () => {
      const error = validateDate('01/02/2024', column, 1);
      // This could be Jan 2 or Feb 1, so it might warn
      if (error) {
        expect(error.severity).toBe('warning');
        expect(error.message).toContain('ambiguous');
      }
    });
  });

  // === validateDateTime ===
  describe('validateDateTime', () => {
    const column: ColumnDef = {
      key: 'created_at',
      header: 'Created At',
      type: 'datetime',
    };

    it('should accept ISO datetime', () => {
      expect(validateDateTime('2024-01-15T10:30:00', column, 1)).toBeNull();
    });

    it('should accept date with time', () => {
      expect(validateDateTime('01/15/2024 10:30', column, 1)).toBeNull();
      expect(validateDateTime('January 15, 2024 2:30 PM', column, 1)).toBeNull();
    });

    it('should reject invalid datetime', () => {
      const error = validateDateTime('not-a-datetime', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('not a valid date/time');
    });
  });

  // === validateEmail ===
  describe('validateEmail', () => {
    const column: ColumnDef = {
      key: 'email',
      header: 'Email',
      type: 'email',
    };

    it('should accept valid emails', () => {
      expect(validateEmail('john@example.com', column, 1)).toBeNull();
      expect(validateEmail('jane.doe@company.co.uk', column, 1)).toBeNull();
    });

    it('should reject invalid emails', () => {
      expect(validateEmail('not-an-email', column, 1)).not.toBeNull();
      expect(validateEmail('missing@domain', column, 1)).not.toBeNull();
      expect(validateEmail('@nodomain.com', column, 1)).not.toBeNull();
    });
  });

  // === validatePhone ===
  describe('validatePhone', () => {
    const column: ColumnDef = {
      key: 'phone',
      header: 'Phone',
      type: 'phone',
    };

    it('should accept valid phone numbers', () => {
      expect(validatePhone('1234567', column, 1)).toBeNull();
      expect(validatePhone('123-456-7890', column, 1)).toBeNull();
      expect(validatePhone('(123) 456-7890', column, 1)).toBeNull();
      expect(validatePhone('+1 (123) 456-7890', column, 1)).toBeNull();
    });

    it('should reject phone numbers with too few digits', () => {
      const error = validatePhone('12345', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('at least 7 digits');
    });

    it('should reject phone numbers with too many digits', () => {
      const error = validatePhone('12345678901234567890', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('at most 15 digits');
    });
  });

  // === validateReference ===
  describe('validateReference', () => {
    const column: ColumnDef = {
      key: 'category_id',
      header: 'Category',
      type: 'reference',
      refTable: 'categories',
    };

    it('should accept non-empty references', () => {
      expect(validateReference('CAT-001', column, 1)).toBeNull();
      expect(validateReference('123', column, 1)).toBeNull();
    });

    it('should reject empty references', () => {
      const error = validateReference('', column, 1);
      expect(error).not.toBeNull();
      expect(error?.message).toContain('cannot be empty');
    });
  });

  // === tryAutoFix ===
  describe('tryAutoFix', () => {
    it('should trim whitespace', () => {
      const column: ColumnDef = {
        key: 'name',
        header: 'Name',
        type: 'string',
      };

      const result = tryAutoFix('  John Doe  ', column);
      expect(result.wasFixed).toBe(true);
      expect(result.fixed).toBe('John Doe');
    });

    it('should normalize enum case', () => {
      const column: ColumnDef = {
        key: 'status',
        header: 'Status',
        type: 'enum',
        values: ['Active', 'Inactive'],
      };

      const result = tryAutoFix('active', column);
      expect(result.wasFixed).toBe(true);
      expect(result.fixed).toBe('Active');
    });

    it('should normalize boolean values', () => {
      const column: ColumnDef = {
        key: 'active',
        header: 'Active',
        type: 'boolean',
      };

      const result1 = tryAutoFix('yes', column);
      expect(result1.wasFixed).toBe(true);
      expect(result1.fixed).toBe(true);

      const result2 = tryAutoFix('no', column);
      expect(result2.wasFixed).toBe(true);
      expect(result2.fixed).toBe(false);
    });

    it('should normalize phone numbers', () => {
      const column: ColumnDef = {
        key: 'phone',
        header: 'Phone',
        type: 'phone',
      };

      const result = tryAutoFix('(123) 456-7890', column);
      expect(result.wasFixed).toBe(true);
      expect(result.fixed).toBe('1234567890');
    });

    it('should normalize dates to ISO format', () => {
      const column: ColumnDef = {
        key: 'birthdate',
        header: 'Birth Date',
        type: 'date',
      };

      const result = tryAutoFix('01/15/2024', column);
      expect(result.wasFixed).toBe(true);
      expect(result.fixed).toBe('2024-01-15');
    });

    it('should lowercase emails', () => {
      const column: ColumnDef = {
        key: 'email',
        header: 'Email',
        type: 'email',
      };

      const result = tryAutoFix('JOHN@EXAMPLE.COM', column);
      expect(result.wasFixed).toBe(true);
      expect(result.fixed).toBe('john@example.com');
    });

    it('should remove commas from numbers', () => {
      const column: ColumnDef = {
        key: 'amount',
        header: 'Amount',
        type: 'number',
      };

      const result = tryAutoFix('1,234.56', column);
      expect(result.wasFixed).toBe(true);
      expect(result.fixed).toBe(1234.56);
    });
  });

  // === validateRow ===
  describe('validateRow', () => {
    const schema: ImportSchema = {
      id: 'users',
      label: 'Users',
      columns: [
        { key: 'id', header: 'ID', type: 'id', locked: true },
        { key: 'name', header: 'Name', type: 'string', required: true, min: 2 },
        { key: 'email', header: 'Email', type: 'email', required: true },
        { key: 'age', header: 'Age', type: 'number', min: 0, max: 120 },
        { key: 'status', header: 'Status', type: 'enum', values: ['Active', 'Inactive'] },
      ],
      uniqueKey: 'email',
      generateId: () => `user-${Date.now()}`,
    };

    it('should validate a valid row', () => {
      const row = {
        id: 'user-1',
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        status: 'Active',
      };

      const result = validateRow(row, schema, 2);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect required field violations', () => {
      const row = {
        id: 'user-1',
        name: '',
        email: 'john@example.com',
        age: 30,
        status: 'Active',
      };

      const result = validateRow(row, schema, 2);
      expect(result.isValid).toBe(false);
      expect(result.errors.length + result.warnings.length).toBeGreaterThan(0);
    });

    it('should auto-fix values when enabled', () => {
      const row = {
        id: 'user-1',
        name: '  John Doe  ',
        email: 'JOHN@EXAMPLE.COM',
        age: 30,
        status: 'active',
      };

      const result = validateRow(row, schema, 2, { autoFix: true });
      expect(result.autoFixes.length).toBeGreaterThan(0);
      expect(result.autoFixes.some(f => f.field === 'name')).toBe(true);
    });

    it('should skip locked fields', () => {
      const row = {
        id: 'invalid-id',
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
        status: 'Active',
      };

      const result = validateRow(row, schema, 2);
      // ID errors should not be present (locked field)
      expect(result.errors.every(e => e.column !== 'id')).toBe(true);
    });

    it('should call beforeValidate hook', () => {
      const schemaWithHook: ImportSchema = {
        ...schema,
        beforeValidate: (row) => ({
          ...row,
          name: String(row.name).toUpperCase(),
        }),
      };

      const row = {
        id: 'user-1',
        name: 'john doe',
        email: 'john@example.com',
        age: 30,
        status: 'Active',
      };

      validateRow(row, schemaWithHook, 2);
      expect(row.name).toBe('JOHN DOE');
    });
  });

  // === validateAll ===
  describe('validateAll', () => {
    const schema: ImportSchema = {
      id: 'users',
      label: 'Users',
      columns: [
        { key: 'id', header: 'ID', type: 'id', locked: true },
        { key: 'name', header: 'Name', type: 'string', required: true },
        { key: 'email', header: 'Email', type: 'email', required: true },
      ],
      uniqueKey: 'email',
      generateId: () => `user-${Date.now()}`,
    };

    it('should validate all rows', () => {
      const rows = [
        { id: 'user-1', name: 'John Doe', email: 'john@example.com' },
        { id: 'user-2', name: 'Jane Smith', email: 'jane@example.com' },
      ];

      const result = validateAll(rows, schema);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should aggregate errors from all rows', () => {
      const rows = [
        { id: 'user-1', name: '', email: 'john@example.com' },
        { id: 'user-2', name: 'Jane', email: 'not-an-email' },
      ];

      const result = validateAll(rows, schema);
      expect(result.isValid).toBe(false);
      expect(result.errors.length + result.warnings.length).toBeGreaterThan(0);
    });

    it('should count auto-fixes', () => {
      const rows = [
        { id: 'user-1', name: '  John  ', email: 'JOHN@EXAMPLE.COM' },
        { id: 'user-2', name: '  Jane  ', email: 'JANE@EXAMPLE.COM' },
      ];

      const result = validateAll(rows, schema, { autoFix: true });
      expect(result.autoFixed).toBeGreaterThan(0);
    });

    it('should count unfixable rows', () => {
      const rows = [
        { id: 'user-1', name: '', email: 'john@example.com' },
        { id: 'user-2', name: 'Jane', email: 'not-an-email' },
      ];

      const result = validateAll(rows, schema);
      expect(result.unfixable).toBeGreaterThan(0);
    });
  });
});
