import { describe, it, expect, beforeEach } from 'vitest';
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

describe('ReferenceResolver', () => {
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

  beforeEach(() => {
    registry = createReferenceRegistry();
  });

  describe('createReferenceRegistry', () => {
    it('should create an empty registry', () => {
      expect(registry).toEqual({});
    });
  });

  describe('registerReferenceData', () => {
    it('should register data for a table', () => {
      registerReferenceData(registry, 'users', sampleUsers);
      expect(registry.users).toHaveLength(4);
      expect(registry.users[0]).toEqual(sampleUsers[0]);
    });

    it('should register multiple tables', () => {
      registerReferenceData(registry, 'users', sampleUsers);
      registerReferenceData(registry, 'departments', sampleDepartments);

      expect(registry.users).toHaveLength(4);
      expect(registry.departments).toHaveLength(3);
    });

    it('should overwrite existing data', () => {
      registerReferenceData(registry, 'users', sampleUsers);
      registerReferenceData(registry, 'users', [sampleUsers[0]]);

      expect(registry.users).toHaveLength(1);
    });

    it('should create a copy of the data array', () => {
      const data = [...sampleUsers];
      registerReferenceData(registry, 'users', data);

      data.push({ id: 'user-5', displayValue: 'New User' });
      expect(registry.users).toHaveLength(4); // Original length
    });
  });

  describe('clearReferenceData', () => {
    it('should clear data for a table', () => {
      registerReferenceData(registry, 'users', sampleUsers);
      clearReferenceData(registry, 'users');

      expect(registry.users).toBeUndefined();
    });

    it('should not affect other tables', () => {
      registerReferenceData(registry, 'users', sampleUsers);
      registerReferenceData(registry, 'departments', sampleDepartments);

      clearReferenceData(registry, 'users');

      expect(registry.users).toBeUndefined();
      expect(registry.departments).toHaveLength(3);
    });
  });

  describe('getReferenceData', () => {
    it('should return data for a table', () => {
      registerReferenceData(registry, 'users', sampleUsers);
      const data = getReferenceData(registry, 'users');

      expect(data).toEqual(sampleUsers);
    });

    it('should return empty array for non-existent table', () => {
      const data = getReferenceData(registry, 'nonexistent');
      expect(data).toEqual([]);
    });
  });

  describe('resolveReference - exact matches', () => {
    beforeEach(() => {
      registerReferenceData(registry, 'users', sampleUsers);
    });

    it('should resolve by exact ID match (case insensitive)', () => {
      const result = resolveReference(registry, 'users', 'user-1');

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-1');
      expect(result.displayValue).toBe('John Smith');
      expect(result.confidence).toBe(1.0);
    });

    it('should resolve by exact ID match (uppercase)', () => {
      const result = resolveReference(registry, 'users', 'USER-1');

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-1');
      expect(result.confidence).toBe(1.0);
    });

    it('should resolve by exact displayValue match', () => {
      const result = resolveReference(registry, 'users', 'John Smith');

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-1');
      expect(result.displayValue).toBe('John Smith');
      expect(result.confidence).toBe(1.0);
    });

    it('should resolve by exact displayValue match (case insensitive)', () => {
      const result = resolveReference(registry, 'users', 'jane doe');

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-2');
      expect(result.displayValue).toBe('Jane Doe');
      expect(result.confidence).toBe(1.0);
    });

    it('should trim whitespace before matching', () => {
      const result = resolveReference(registry, 'users', '  user-1  ');

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-1');
    });
  });

  describe('resolveReference - searchField option', () => {
    beforeEach(() => {
      registerReferenceData(registry, 'users', sampleUsers);
    });

    it('should search by specific field', () => {
      const result = resolveReference(registry, 'users', 'john@example.com', {
        searchField: 'email'
      });

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-1');
      expect(result.displayValue).toBe('John Smith');
    });

    it('should not find match if searchField does not match', () => {
      const result = resolveReference(registry, 'users', 'user-1', {
        searchField: 'email'
      });

      expect(result.found).toBe(false);
    });
  });

  describe('resolveReference - fuzzy matching', () => {
    beforeEach(() => {
      registerReferenceData(registry, 'users', sampleUsers);
    });

    it('should find partial match with fuzzyMatch enabled', () => {
      const result = resolveReference(registry, 'users', 'John', {
        fuzzyMatch: true
      });

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-1');
      expect(result.confidence).toBeGreaterThan(0.6);
      expect(result.confidence).toBeLessThan(1.0);
    });

    it('should find match with typo', () => {
      const result = resolveReference(registry, 'users', 'Jhon Smith', {
        fuzzyMatch: true
      });

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-1');
      expect(result.confidence).toBeGreaterThan(0.6);
    });

    it('should not find fuzzy match when fuzzyMatch is false', () => {
      const result = resolveReference(registry, 'users', 'John', {
        fuzzyMatch: false
      });

      expect(result.found).toBe(false);
    });

    it('should return best fuzzy match', () => {
      const result = resolveReference(registry, 'users', 'Alice', {
        fuzzyMatch: true
      });

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-4');
    });
  });

  describe('resolveReference - not found with suggestions', () => {
    beforeEach(() => {
      registerReferenceData(registry, 'users', sampleUsers);
    });

    it('should return suggestions when not found', () => {
      const result = resolveReference(registry, 'users', 'Johnny');

      expect(result.found).toBe(false);
      expect(result.id).toBeNull();
      expect(result.displayValue).toBeNull();
      expect(result.suggestions).toBeDefined();
      expect(result.suggestions!.length).toBeGreaterThan(0);
    });

    it('should limit suggestions to maxSuggestions', () => {
      const result = resolveReference(registry, 'users', 'xyz', {
        maxSuggestions: 2
      });

      expect(result.suggestions!.length).toBeLessThanOrEqual(2);
    });

    it('should return best suggestions first', () => {
      const result = resolveReference(registry, 'users', 'John', {
        maxSuggestions: 3
      });

      expect(result.suggestions![0].displayValue).toContain('John');
    });
  });

  describe('resolveReference - edge cases', () => {
    it('should handle non-existent table', () => {
      const result = resolveReference(registry, 'nonexistent', 'test');

      expect(result.found).toBe(false);
      expect(result.suggestions).toEqual([]);
    });

    it('should handle empty table', () => {
      registerReferenceData(registry, 'empty', []);
      const result = resolveReference(registry, 'empty', 'test');

      expect(result.found).toBe(false);
      expect(result.suggestions).toEqual([]);
    });

    it('should handle empty search value', () => {
      registerReferenceData(registry, 'users', sampleUsers);
      const result = resolveReference(registry, 'users', '');

      expect(result.found).toBe(false);
    });

    it('should handle items without id field gracefully', () => {
      const invalidData = [
        { displayValue: 'Item 1' } as ReferenceData,
        { id: 'item-2', displayValue: 'Item 2' }
      ];

      // Should not throw
      expect(() => {
        registerReferenceData(registry, 'items', invalidData);
      }).not.toThrow();
    });
  });

  describe('fuzzyMatch', () => {
    it('should return 1.0 for exact match', () => {
      expect(fuzzyMatch('test', 'test')).toBe(1.0);
    });

    it('should return 1.0 for case-insensitive match', () => {
      expect(fuzzyMatch('Test', 'test')).toBe(1.0);
    });

    it('should return 0.8 for startsWith match', () => {
      expect(fuzzyMatch('test', 'testing')).toBe(0.8);
    });

    it('should return 0.7 for contains match', () => {
      expect(fuzzyMatch('est', 'testing')).toBe(0.7);
    });

    it('should return high score for small edit distance', () => {
      const score = fuzzyMatch('test', 'tset'); // 1 swap
      expect(score).toBeGreaterThan(0.6);
      expect(score).toBeLessThan(1.0);
    });

    it('should return 0 for empty strings', () => {
      expect(fuzzyMatch('', 'test')).toBe(0);
      expect(fuzzyMatch('test', '')).toBe(0);
    });

    it('should return 0 for very different strings', () => {
      expect(fuzzyMatch('abc', 'xyz')).toBe(0);
    });

    it('should handle unicode characters', () => {
      expect(fuzzyMatch('café', 'café')).toBe(1.0);
    });
  });

  describe('real-world scenarios', () => {
    it('should handle user lookup by email in import', () => {
      registerReferenceData(registry, 'users', sampleUsers);

      const result = resolveReference(registry, 'users', 'john@example.com', {
        searchField: 'email'
      });

      expect(result.found).toBe(true);
      expect(result.id).toBe('user-1');
    });

    it('should handle department lookup with typo and fuzzy matching', () => {
      registerReferenceData(registry, 'departments', sampleDepartments);

      const result = resolveReference(registry, 'departments', 'Enginering', {
        fuzzyMatch: true
      });

      expect(result.found).toBe(true);
      expect(result.displayValue).toBe('Engineering');
    });

    it('should provide suggestions when user misspells name', () => {
      registerReferenceData(registry, 'users', sampleUsers);

      const result = resolveReference(registry, 'users', 'Jon Smth', {
        maxSuggestions: 3
      });

      expect(result.suggestions!.length).toBeGreaterThan(0);
      expect(result.suggestions![0].displayValue).toBe('John Smith');
    });

    it('should handle numeric IDs as strings', () => {
      const projects: ReferenceData[] = [
        { id: '123', displayValue: 'Project Alpha' },
        { id: '456', displayValue: 'Project Beta' }
      ];

      registerReferenceData(registry, 'projects', projects);

      const result = resolveReference(registry, 'projects', '123');
      expect(result.found).toBe(true);
      expect(result.displayValue).toBe('Project Alpha');
    });
  });

  describe('performance with large datasets', () => {
    it('should handle 1000+ records efficiently', () => {
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
      expect(duration).toBeLessThan(100); // Should be very fast
    });

    it('should handle fuzzy matching on large dataset', () => {
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
      expect(duration).toBeLessThan(500); // Fuzzy is slower but still reasonable
    });
  });
});
