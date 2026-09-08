/**
 * CSV Parser with robust edge case handling
 * Supports auto-delimiter detection, quoted fields, escaped quotes, and newlines in fields
 */

export interface CSVParseOptions {
  delimiter?: string;        // Auto-detect if not provided
  hasHeaders?: boolean;      // Default true
  skipEmptyRows?: boolean;   // Default true
  trimValues?: boolean;      // Default true
}

export interface CSVParseResult {
  headers: string[];
  rows: Record<string, string>[];
  detectedDelimiter: string;
  totalRows: number;
  skippedRows: number;
}

/**
 * Remove UTF-8 BOM (Byte Order Mark) from start of content
 */
export function removeBOM(content: string): string {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}

/**
 * Detect the most likely delimiter by analyzing first 5 lines
 * Checks for comma, semicolon, and tab
 */
export function detectDelimiter(content: string): string {
  const lines = content.split('\n').slice(0, 5);
  const delimiters = [',', ';', '\t'];
  const counts: Record<string, number[]> = {
    ',': [],
    ';': [],
    '\t': []
  };

  // Count occurrences of each delimiter per line (excluding quoted sections)
  for (const line of lines) {
    if (!line.trim()) continue;

    for (const delimiter of delimiters) {
      let count = 0;
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
          // Check for escaped quote
          if (i + 1 < line.length && line[i + 1] === '"') {
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          count++;
        }
      }

      counts[delimiter].push(count);
    }
  }

  // Find delimiter with highest consistent count
  let bestDelimiter = ',';
  let bestScore = -1;

  for (const delimiter of delimiters) {
    const delimiterCounts = counts[delimiter];
    if (delimiterCounts.length === 0) continue;

    // Calculate consistency: average count and standard deviation
    const avg = delimiterCounts.reduce((a, b) => a + b, 0) / delimiterCounts.length;

    // Prefer delimiter with higher average and consistency
    // Consistency = counts are similar across lines
    const variance = delimiterCounts.reduce((sum, count) => sum + Math.pow(count - avg, 2), 0) / delimiterCounts.length;
    const consistency = avg > 0 ? avg / (1 + variance) : 0;

    if (consistency > bestScore) {
      bestScore = consistency;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

/**
 * Parse a single CSV row, handling quoted fields, escaped quotes, and delimiters inside quotes
 */
export function parseRow(row: string, delimiter: string): string[] {
  const fields: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < row.length) {
    const char = row[i];

    if (char === '"') {
      if (inQuotes && i + 1 < row.length && row[i + 1] === '"') {
        // Escaped quote: "" → "
        currentField += '"';
        i += 2;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === delimiter && !inQuotes) {
      // End of field
      fields.push(currentField);
      currentField = '';
      i++;
    } else {
      // Regular character
      currentField += char;
      i++;
    }
  }

  // Add the last field
  fields.push(currentField);

  return fields;
}

/**
 * Parse CSV content into structured data
 */
export function parseCSV(content: string, options?: CSVParseOptions): CSVParseResult {
  // Default options
  const opts: Required<CSVParseOptions> = {
    delimiter: options?.delimiter || '',
    hasHeaders: options?.hasHeaders ?? true,
    skipEmptyRows: options?.skipEmptyRows ?? true,
    trimValues: options?.trimValues ?? true
  };

  // Remove BOM if present
  content = removeBOM(content);

  // Handle empty content
  if (!content.trim()) {
    return {
      headers: [],
      rows: [],
      detectedDelimiter: opts.delimiter || ',',
      totalRows: 0,
      skippedRows: 0
    };
  }

  // Auto-detect delimiter if not provided
  const delimiter = opts.delimiter || detectDelimiter(content);

  // Parse lines, handling newlines inside quoted fields
  const allLines: string[] = [];  // Track all lines including empty
  const lines: string[] = [];     // Track non-empty lines only
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (char === '"') {
      currentLine += char;
      // Check for escaped quote
      if (i + 1 < content.length && content[i + 1] === '"') {
        currentLine += content[i + 1];
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // End of line (handle both \n and \r\n)
      allLines.push(currentLine);  // Track all lines
      if (currentLine.trim()) {
        lines.push(currentLine);   // Track non-empty lines
      } else if (!opts.skipEmptyRows) {
        lines.push(currentLine);
      }
      currentLine = '';

      // Skip \n if we just processed \r
      if (char === '\r' && i + 1 < content.length && content[i + 1] === '\n') {
        i++;
      }
    } else {
      currentLine += char;
    }
  }

  // Add last line if not empty
  if (currentLine || content.length > 0) {
    allLines.push(currentLine);
    if (currentLine.trim() || !opts.skipEmptyRows) {
      lines.push(currentLine);
    }
  }

  // Calculate lines that were skipped
  const nonEmptyLines = lines;

  if (nonEmptyLines.length === 0) {
    return {
      headers: [],
      rows: [],
      detectedDelimiter: delimiter,
      totalRows: 0,
      skippedRows: lines.length - nonEmptyLines.length
    };
  }

  // Parse headers
  let headers: string[] = [];
  let dataStartIndex = 0;

  if (opts.hasHeaders && nonEmptyLines.length > 0) {
    headers = parseRow(nonEmptyLines[0], delimiter);
    if (opts.trimValues) {
      headers = headers.map(h => h.trim());
    }
    dataStartIndex = 1;
  }

  // Parse data rows
  const rows: Record<string, string>[] = [];
  const dataLines = nonEmptyLines.slice(dataStartIndex);

  for (const line of dataLines) {
    const fields = parseRow(line, delimiter);

    // Skip completely empty rows
    if (opts.skipEmptyRows && fields.every(f => !f.trim())) {
      continue;
    }

    // Trim values if requested
    const processedFields = opts.trimValues
      ? fields.map(f => f.trim())
      : fields;

    // Create row object
    if (opts.hasHeaders && headers.length > 0) {
      const rowObj: Record<string, string> = {};

      // Handle inconsistent column count
      for (let i = 0; i < headers.length; i++) {
        rowObj[headers[i]] = processedFields[i] || ''; // Pad with empty string if missing
      }

      rows.push(rowObj);
    } else {
      // No headers: create object with numeric keys
      const rowObj: Record<string, string> = {};
      processedFields.forEach((field, index) => {
        rowObj[`column_${index}`] = field;
      });
      rows.push(rowObj);
    }
  }

  return {
    headers,
    rows,
    detectedDelimiter: delimiter,
    totalRows: dataLines.length,
    skippedRows: (allLines.length - nonEmptyLines.length) + (dataLines.length - rows.length)
  };
}

/* ============================================================================
 * TESTS (Commented out - uncomment to run basic validation)
 * ============================================================================

// Test 1: Basic CSV
const test1 = `name,age,city
John,30,NYC
Jane,25,LA`;

console.log('Test 1: Basic CSV');
console.log(parseCSV(test1));
// Expected: 2 rows with headers [name, age, city]

// Test 2: Quoted fields with commas
const test2 = `name,address,city
"Doe, John","123 Main St, Apt 4",NYC
Jane,"456 Elm St",LA`;

console.log('\nTest 2: Quoted fields with commas');
console.log(parseCSV(test2));
// Expected: Correctly parse "123 Main St, Apt 4" as single field

// Test 3: Escaped quotes
const test3 = `name,quote
John,"He said ""Hello"""`

console.log('\nTest 3: Escaped quotes');
console.log(parseCSV(test3));
// Expected: quote field = He said "Hello"

// Test 4: Newlines in quoted fields
const test4 = `name,bio
John,"Line 1
Line 2"
Jane,"Single line"`;

console.log('\nTest 4: Newlines in quoted fields');
console.log(parseCSV(test4));
// Expected: John's bio should be "Line 1\nLine 2"

// Test 5: Empty file
const test5 = '';
console.log('\nTest 5: Empty file');
console.log(parseCSV(test5));
// Expected: Empty headers and rows

// Test 6: Only headers
const test6 = 'name,age,city';
console.log('\nTest 6: Only headers');
console.log(parseCSV(test6));
// Expected: Headers present, 0 rows

// Test 7: Semicolon delimiter auto-detect
const test7 = `name;age;city
John;30;NYC`;

console.log('\nTest 7: Semicolon delimiter');
const result7 = parseCSV(test7);
console.log(result7);
console.log('Detected delimiter:', result7.detectedDelimiter);
// Expected: Auto-detect semicolon

// Test 8: Tab delimiter
const test8 = `name\tage\tcity
John\t30\tNYC`;

console.log('\nTest 8: Tab delimiter');
const result8 = parseCSV(test8);
console.log(result8);
console.log('Detected delimiter:', result8.detectedDelimiter);
// Expected: Auto-detect tab

// Test 9: BOM handling
const test9 = '\uFEFFname,age\nJohn,30';
console.log('\nTest 9: BOM handling');
console.log(parseCSV(test9));
// Expected: BOM removed, normal parsing

// Test 10: Inconsistent column count
const test10 = `name,age,city
John,30
Jane,25,LA,Extra`;

console.log('\nTest 10: Inconsistent columns');
console.log(parseCSV(test10));
// Expected: John's row padded with empty city, Jane's Extra ignored

// Test 11: Empty rows
const test11 = `name,age

John,30

Jane,25`;

console.log('\nTest 11: Empty rows');
console.log(parseCSV(test11));
// Expected: 2 rows (empty rows skipped)

============================================================================ */
