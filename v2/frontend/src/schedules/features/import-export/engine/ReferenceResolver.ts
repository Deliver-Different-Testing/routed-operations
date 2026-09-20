// ReferenceResolver.ts - Client-side reference lookup for import preview
// Resolves foreign key references using fuzzy matching and suggestions

export interface ReferenceData {
  id: string;
  displayValue: string;
  [key: string]: unknown;   // Additional fields
}

export interface ReferenceRegistry {
  [tableName: string]: ReferenceData[];
}

export interface ResolveResult {
  found: boolean;
  id: string | null;
  displayValue: string | null;
  confidence: number;        // 1.0 = exact match, <1.0 = fuzzy match
  suggestions?: ReferenceData[];  // Near matches if not found
}

export interface ResolveOptions {
  searchField?: string;     // Which field to search (default: 'id' then 'displayValue')
  fuzzyMatch?: boolean;     // Allow partial/fuzzy matching (default: false)
  maxSuggestions?: number;  // Max suggestions to return (default: 3)
}

// Create a registry instance
export function createReferenceRegistry(): ReferenceRegistry {
  return {};
}

// Register reference data for a table
export function registerReferenceData(
  registry: ReferenceRegistry,
  tableName: string,
  data: ReferenceData[]
): void {
  // Validate data structure
  for (const item of data) {
    if (!item.id) {
      console.warn(`ReferenceResolver: Item in ${tableName} missing 'id' field`, item);
    }
    if (!item.displayValue) {
      console.warn(`ReferenceResolver: Item in ${tableName} missing 'displayValue' field`, item);
    }
  }

  registry[tableName] = [...data];
}

// Clear reference data for a table
export function clearReferenceData(
  registry: ReferenceRegistry,
  tableName: string
): void {
  delete registry[tableName];
}

// Get all reference data for a table
export function getReferenceData(
  registry: ReferenceRegistry,
  tableName: string
): ReferenceData[] {
  return registry[tableName] || [];
}

// Resolve a reference value
export function resolveReference(
  registry: ReferenceRegistry,
  tableName: string,
  value: string,
  options: ResolveOptions = {}
): ResolveResult {
  const {
    searchField,
    fuzzyMatch: allowFuzzy = false,
    maxSuggestions = 3
  } = options;

  const data = registry[tableName];

  // No data registered for this table
  if (!data || data.length === 0) {
    return {
      found: false,
      id: null,
      displayValue: null,
      confidence: 0,
      suggestions: []
    };
  }

  const searchValue = value.trim().toLowerCase();

  // If searchField is specified, search only that field
  if (searchField) {
    return resolveByField(data, searchField, searchValue, allowFuzzy, maxSuggestions);
  }

  // Otherwise, try id first, then displayValue
  let result = resolveByField(data, 'id', searchValue, false, maxSuggestions);
  if (result.found) {
    return result;
  }

  result = resolveByField(data, 'displayValue', searchValue, false, maxSuggestions);
  if (result.found) {
    return result;
  }

  // If fuzzy matching is enabled and no exact match found, try fuzzy
  if (allowFuzzy) {
    return resolveFuzzy(data, searchValue, maxSuggestions);
  }

  // Not found - return suggestions based on similarity
  const suggestions = getSuggestions(data, searchValue, maxSuggestions);
  return {
    found: false,
    id: null,
    displayValue: null,
    confidence: 0,
    suggestions
  };
}

// Resolve by specific field
function resolveByField(
  data: ReferenceData[],
  field: string,
  searchValue: string,
  allowFuzzy: boolean,
  maxSuggestions: number
): ResolveResult {
  // Try exact match first (case insensitive)
  for (const item of data) {
    const fieldValue = String(item[field] || '').toLowerCase();
    if (fieldValue === searchValue) {
      return {
        found: true,
        id: item.id,
        displayValue: item.displayValue,
        confidence: 1.0
      };
    }
  }

  // If fuzzy matching enabled, try fuzzy
  if (allowFuzzy) {
    return resolveFuzzyByField(data, field, searchValue, maxSuggestions);
  }

  return {
    found: false,
    id: null,
    displayValue: null,
    confidence: 0
  };
}

// Fuzzy matching across id and displayValue
function resolveFuzzy(
  data: ReferenceData[],
  searchValue: string,
  maxSuggestions: number
): ResolveResult {
  let bestMatch: ReferenceData | null = null;
  let bestScore = 0;
  const threshold = 0.6; // Minimum similarity score

  for (const item of data) {
    // Check id field
    const idScore = fuzzyMatch(searchValue, String(item.id || '').toLowerCase());
    if (idScore > bestScore) {
      bestScore = idScore;
      bestMatch = item;
    }

    // Check displayValue field
    const displayScore = fuzzyMatch(searchValue, item.displayValue.toLowerCase());
    if (displayScore > bestScore) {
      bestScore = displayScore;
      bestMatch = item;
    }
  }

  if (bestMatch && bestScore >= threshold) {
    return {
      found: true,
      id: bestMatch.id,
      displayValue: bestMatch.displayValue,
      confidence: bestScore
    };
  }

  // Not found - return suggestions
  const suggestions = getSuggestions(data, searchValue, maxSuggestions);
  return {
    found: false,
    id: null,
    displayValue: null,
    confidence: 0,
    suggestions
  };
}

// Fuzzy matching by specific field
function resolveFuzzyByField(
  data: ReferenceData[],
  field: string,
  searchValue: string,
  _maxSuggestions: number
): ResolveResult {
  let bestMatch: ReferenceData | null = null;
  let bestScore = 0;
  const threshold = 0.6;

  for (const item of data) {
    const fieldValue = String(item[field] || '').toLowerCase();
    const score = fuzzyMatch(searchValue, fieldValue);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  if (bestMatch && bestScore >= threshold) {
    return {
      found: true,
      id: bestMatch.id,
      displayValue: bestMatch.displayValue,
      confidence: bestScore
    };
  }

  return {
    found: false,
    id: null,
    displayValue: null,
    confidence: 0
  };
}

// Get suggestions for similar matches
function getSuggestions(
  data: ReferenceData[],
  searchValue: string,
  maxSuggestions: number
): ReferenceData[] {
  const scored: Array<{ item: ReferenceData; score: number }> = [];

  for (const item of data) {
    // Score against both id and displayValue
    const idScore = fuzzyMatch(searchValue, String(item.id || '').toLowerCase());
    const displayScore = fuzzyMatch(searchValue, item.displayValue.toLowerCase());
    const score = Math.max(idScore, displayScore);

    if (score > 0) { // Any match at all (was 0.3)
      scored.push({ item, score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top N suggestions
  return scored.slice(0, maxSuggestions).map(s => s.item);
}

// Fuzzy match helper - returns similarity score 0-1
export function fuzzyMatch(needle: string, haystack: string): number {
  if (!needle || !haystack) {
    return 0;
  }

  const needleLower = needle.toLowerCase();
  const haystackLower = haystack.toLowerCase();

  // Exact match
  if (needleLower === haystackLower) {
    return 1.0;
  }

  // Starts with
  if (haystackLower.startsWith(needleLower)) {
    return 0.8;
  }

  // Contains substring
  if (haystackLower.includes(needleLower)) {
    return 0.7;
  }

  // Try matching against individual words in haystack
  const words = haystackLower.split(/\s+/);
  let bestWordScore = 0;

  for (const word of words) {
    if (word.startsWith(needleLower)) {
      bestWordScore = Math.max(bestWordScore, 0.75);
    } else if (word.includes(needleLower)) {
      bestWordScore = Math.max(bestWordScore, 0.65);
    } else {
      // Check Levenshtein distance against this word
      const wordDist = levenshteinDistance(needleLower, word);
      if (wordDist <= 2 && word.length >= 3) {
        bestWordScore = Math.max(bestWordScore, 0.65);
      }
    }
  }

  if (bestWordScore > 0) {
    return bestWordScore;
  }

  // Levenshtein distance against full string
  const distance = levenshteinDistance(needleLower, haystackLower);
  const maxLen = Math.max(needleLower.length, haystackLower.length);

  // Only consider it a match if distance is small relative to length
  if (distance <= 3 && distance / maxLen <= 0.5) {
    // Score based on distance relative to length
    // Map to 0.65-0.9 range for small distances
    if (distance === 1) return 0.9;
    if (distance === 2) return 0.75;
    if (distance === 3) return 0.65;
  }

  // No match
  return 0;
}

// Levenshtein distance implementation
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
